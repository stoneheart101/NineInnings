-- A released kid leaves the draft pool behind once the season is underway.
-- The pool stays the unsigned kids for the initial draft.

create function private.recruit_asking_price(stats jsonb, rules_version integer)
returns table (reputation_cost integer, bottlecap_cost integer)
language plpgsql
stable
security definer
set search_path = ''
as $func$
declare
  rules jsonb;
  base_rep numeric;
  base_caps numeric;
  strength numeric;
begin
  select game_settings.settings into rules
  from public.game_settings
  where game_settings.version = rules_version;

  if rules is null
    or jsonb_typeof(rules -> 'recruiting_base_rep') <> 'number'
    or jsonb_typeof(rules -> 'recruiting_base_caps') <> 'number' then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;

  base_rep := (rules ->> 'recruiting_base_rep')::numeric;
  base_caps := (rules ->> 'recruiting_base_caps')::numeric;
  if base_rep < 0 or base_rep > 1000 or base_caps < 0 or base_caps > 1000 then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;

  strength := (
    coalesce((stats ->> 'contact')::numeric, 0)
    + coalesce((stats ->> 'power')::numeric, 0)
    + coalesce((stats ->> 'eye')::numeric, 0)
    + coalesce((stats ->> 'speed')::numeric, 0)
    + coalesce((stats ->> 'glove')::numeric, 0)
    + coalesce((stats ->> 'arm')::numeric, 0)
    + coalesce((stats ->> 'stamina')::numeric, 0)
  ) / 7;

  reputation_cost := greatest(1, round(base_rep * strength / 50))::integer;
  bottlecap_cost := greatest(1, round(base_caps * strength / 50))::integer;
  return next;
end;
$func$;

comment on function private.recruit_asking_price(jsonb, integer) is
  'The recruiting price for one kid. Same formula as a new recruit: the season base times that kid''s average stat over 50, at least 1.';

revoke all on function private.recruit_asking_price(jsonb, integer) from public, anon, authenticated, service_role;

create or replace function private.release_player(target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  kid public.players;
  owner uuid;
  game_running boolean := false;
  season_status text;
  rules_version integer;
  rep_cost integer;
  cap_cost integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into kid
  from public.players
  where id = target_player
  for update;

  if not found then
    raise exception 'THAT KID IS NOT HERE';
  end if;
  if kid.team_id is null then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  select coach_id into owner
  from public.teams
  where id = kid.team_id
  for update;

  if owner is distinct from uid then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  if to_regclass('public.games') is not null then
    execute $sql$
      select exists (
        select 1
        from public.games
        where is_practice = false
          and status not in ('scheduled', 'final')
          and (home_team_id = $1 or away_team_id = $1)
      )
    $sql$
    into game_running
    using kid.team_id;
    if game_running then
      raise exception 'A GAME IS IN PROGRESS';
    end if;
  end if;

  select seasons.status, seasons.settings_version
  into season_status, rules_version
  from public.seasons as seasons
  where seasons.id = kid.season_id;

  if season_status in ('active', 'completed') then
    rep_cost := kid.reputation_cost;
    cap_cost := kid.bottlecap_cost;
    if rep_cost is null or cap_cost is null then
      select priced.reputation_cost, priced.bottlecap_cost
      into rep_cost, cap_cost
      from private.recruit_asking_price(kid.base_stats, rules_version) as priced;
    end if;

    update public.players
    set team_id = null,
        tryout_status = null,
        offer = 'price',
        reputation_cost = rep_cost,
        bottlecap_cost = cap_cost
    where id = target_player
      and team_id = kid.team_id;
  else
    update public.players
    set team_id = null,
        tryout_status = null,
        offer = null,
        reputation_cost = null,
        bottlecap_cost = null
    where id = target_player
      and team_id = kid.team_id;
  end if;

  if not found then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  delete from public.recruit_passes
  where player_id = target_player;

  delete from public.lineups
  where player_id = target_player;
end;
$func$;

comment on function private.release_player(uuid) is
  'The kid''s coach clears team_id and drops that kid from the lineup. Once the season is active or completed, the kid goes to the recruiting board as a priced recruit. A stored price is kept. Otherwise the price comes from the season rules and the kid''s stats. During the draft, the kid returns to the pool. The perk leaves with the kid. The coach''s home field stays.';

comment on function public.release_player(uuid) is
  'Signed-in coach releases one kid from their own team. After the draft, that kid is a priced recruit. During the draft, that kid returns to the pool.';

create or replace function private.resolve_tryouts(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games;
  kid public.players;
  winner_name text;
  winner_id uuid;
  rep_gain boolean := false;
  strong boolean;
  stayed boolean;
  kid_name text;
  sentence text;
  extra text := '';
  rep_cost integer;
  cap_cost integer;
begin
  select * into game
  from public.games
  where id = target_game
  for update;

  if game.id is null or game.is_practice or game.dev or game.status is distinct from 'final' or game.result is null then
    return;
  end if;

  winner_name := game.result ->> 'winner';
  if winner_name = 'home' then
    winner_id := game.home_team_id;
  elsif winner_name = 'away' then
    winner_id := game.away_team_id;
  else
    winner_id := null;
  end if;

  if winner_id is not null then
    select coalesce((rules.settings ->> 'win_reputation')::integer, 0) > 0
    into rep_gain
    from public.game_settings as rules
    where rules.version = game.settings_version;
  end if;

  for kid in
    select players.*
    from public.players
    where players.team_id in (game.home_team_id, game.away_team_id)
      and players.tryout_status = 'playing'
    order by players.id
    for update
  loop
    strong := exists (
      select 1
      from jsonb_array_elements(coalesce(game.result -> 'lines', '[]'::jsonb)) as ln
      where nullif(ln ->> 'player_id', '')::uuid = kid.id
        and (
          coalesce((ln ->> 'h')::integer, 0) >= 2
          or coalesce((ln ->> 'rbi')::integer, 0) >= 2
        )
    );
    stayed := kid.team_id = winner_id or (kid.team_id = winner_id and rep_gain) or strong;
    if stayed then
      update public.players
      set tryout_status = null,
          offer = null,
          reputation_cost = null,
          bottlecap_cost = null,
          preference = null
      where id = kid.id;
    else
      kid_name := upper(btrim(concat_ws(' ', kid.given_name, kid.family_name)));
      if kid_name = '' then
        kid_name := 'KID';
      end if;
      sentence := kid_name || ' HEADED HOME.';
      if position(sentence in coalesce(game.narrative, '')) = 0 then
        extra := btrim(concat_ws(' ', extra, sentence));
      end if;
      rep_cost := kid.reputation_cost;
      cap_cost := kid.bottlecap_cost;
      if rep_cost is null or cap_cost is null then
        select priced.reputation_cost, priced.bottlecap_cost
        into rep_cost, cap_cost
        from private.recruit_asking_price(kid.base_stats, kid.settings_version) as priced;
      end if;
      update public.players
      set team_id = null,
          tryout_status = null,
          offer = 'price',
          reputation_cost = rep_cost,
          bottlecap_cost = cap_cost
      where id = kid.id;
    end if;
  end loop;

  if extra <> '' then
    update public.games
    set narrative = btrim(concat_ws(' ', nullif(btrim(coalesce(narrative, '')), ''), extra))
    where id = game.id;
  end if;
end;
$func$;

comment on function private.resolve_tryouts(uuid) is
  'After an official game, a tryout stays on a win, a reputation gain, or a strong line. Otherwise the kid returns to the recruiting board as a priced recruit and the writeup says they headed home.';

-- Kids already sitting in the pool after the draft belong on the board.
do $backfill$
declare
  free_kid record;
  rep_cost integer;
  cap_cost integer;
begin
  for free_kid in
    select players.id, players.base_stats, seasons.settings_version
    from public.players as players
    join public.seasons as seasons on seasons.id = players.season_id
    where players.team_id is null
      and players.offer is null
      and seasons.status in ('active', 'completed')
    order by players.id
    for update of players
  loop
    select priced.reputation_cost, priced.bottlecap_cost
    into rep_cost, cap_cost
    from private.recruit_asking_price(free_kid.base_stats, free_kid.settings_version) as priced;

    update public.players
    set offer = 'price',
        reputation_cost = rep_cost,
        bottlecap_cost = cap_cost
    where id = free_kid.id
      and team_id is null
      and offer is null;

    if not found then
      raise exception 'THAT FREE KID MOVED';
    end if;
  end loop;

  if exists (
    select 1
    from public.players as players
    join public.seasons as seasons on seasons.id = players.season_id
    where players.team_id is null
      and players.offer is null
      and seasons.status in ('active', 'completed')
  ) then
    raise exception 'A FREE KID IS STILL IN THE POOL';
  end if;
end;
$backfill$;
