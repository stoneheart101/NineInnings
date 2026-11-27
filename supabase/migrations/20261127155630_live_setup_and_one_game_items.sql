-- Live season screens, an automatic PLAY BALL, and one-game clubhouse items.
-- lineup_locks is published without the card column.

alter table public.seasons
  add column start_error text;

comment on column public.seasons.start_error is
  'Why PLAY BALL did not open the season after the last draft pick. Null when that start has not failed.';

grant select (start_error) on table public.seasons to authenticated;

update public.clubhouse_items
set duration = 'next_game',
    blurb = 'ONE BAT FOR THE NEXT GAME'
where id = 'metal_bat';

update public.clubhouse_items
set duration = 'next_game'
where duration is distinct from 'next_game';

alter table public.clubhouse_items drop constraint clubhouse_items_duration;

alter table public.clubhouse_items
  add constraint clubhouse_items_duration check (duration = 'next_game');

update public.team_items
set remaining_games = 1
where remaining_games is distinct from 1;

create or replace function private.spend_packed(target_game uuid, target_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  packed_n integer;
  row record;
begin
  select coalesce(jsonb_array_length(locks.card -> 'items'), 0)
  into packed_n
  from public.lineup_locks as locks
  where locks.game_id = target_game
    and locks.team_id = target_team;

  if coalesce(packed_n, 0) < 1 then
    return;
  end if;

  for row in
    select packed.id
    from public.team_items as packed
    where packed.team_id = target_team
    order by packed.bought_at, packed.id
    limit packed_n
    for update
  loop
    delete from public.team_items as packed
    where packed.id = row.id;
  end loop;
end;
$func$;

comment on function private.spend_packed(uuid, uuid) is
  'The next game spends the packed copies frozen on one card. Each of those rows is deleted.';

create or replace function private.buy_item(target_team uuid, target_item text, chosen_slot integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owned public.teams;
  shelf public.clubhouse_items;
  packed jsonb;
  games_left integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into owned
  from public.teams
  where id = target_team
  for update;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if owned.coach_id is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  select * into shelf
  from public.clubhouse_items
  where id = target_item;

  if not found then
    raise exception 'THAT ITEM IS NOT ON THE SHELF';
  end if;

  packed := shelf.effect;
  if (shelf.effect ->> 'needs_slot') = 'true' then
    if chosen_slot is null or chosen_slot < 1 or chosen_slot > 9 then
      raise exception 'PICK A SLOT FOR THE BAT';
    end if;
    packed := shelf.effect || jsonb_build_object('slot', chosen_slot);
  end if;

  if exists (
    select 1
    from public.team_items
    where team_id = target_team
      and item_id = shelf.id
  ) then
    raise exception 'ONE IS ALREADY PACKED';
  end if;

  if owned.bottlecaps < shelf.bottlecap_cost or owned.reputation < shelf.reputation_cost then
    raise exception 'YOU CANNOT AFFORD THAT';
  end if;

  update public.teams
  set bottlecaps = bottlecaps - shelf.bottlecap_cost,
      reputation = reputation - shelf.reputation_cost
  where id = target_team;

  games_left := 1;

  insert into public.team_items (team_id, item_id, remaining_games, effect)
  values (target_team, shelf.id, games_left, packed);
end;
$func$;
create or replace function private.play_ball(target_season uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  found_season public.seasons;
  pick_at integer;
  draft_order uuid[];
  variability numeric;
  roster uuid[];
  circle uuid[];
  n integer;
  round_count integer;
  day_count integer;
  cursor_day date;
  slots timestamptz[] := '{}';
  dow integer;
  slate integer := 0;
  cycle integer;
  pair_slot integer;
  a uuid;
  b uuid;
  home_id uuid;
  away_id uuid;
  game_seed bigint;
  slot_at timestamptz;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into found_season
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if found_season.commissioner_id is distinct from uid then
    raise exception 'ONLY THE COMMISSIONER STARTS THE SEASON';
  end if;
  if found_season.status in ('active', 'completed')
    or exists (select 1 from public.games where season_id = target_season and is_practice = false)
  then
    raise exception 'THE SEASON HAS ALREADY STARTED';
  end if;
  if found_season.status <> 'drafting' then
    raise exception 'FINISH THE DRAFT BEFORE PLAY BALL';
  end if;

  select pick_index, "order"
  into pick_at, draft_order
  from public.draft_state
  where season_id = target_season
  for update;

  if not found
    or draft_order is null
    or cardinality(draft_order) = 0
    or pick_at < cardinality(draft_order)
  then
    raise exception 'FINISH THE DRAFT BEFORE PLAY BALL';
  end if;

  perform 1
  from public.teams
  where season_id = target_season
  order by id
  for update;

  select coalesce(array_agg(id order by created_at, id), '{}'::uuid[])
  into roster
  from public.teams
  where season_id = target_season;

  if cardinality(roster) < 2 then
    raise exception 'NEED AT LEAST TWO TEAMS';
  end if;

  select (settings ->> 'weather_variability')::numeric
  into variability
  from public.game_settings
  where version = found_season.settings_version;

  if variability is null then
    raise exception 'THE RULES ARE NOT HERE';
  end if;

  perform set_config('TimeZone', 'UTC', true);

  day_count := found_season.weeks * cardinality(found_season.official_weekdays);
  cursor_day := (now() at time zone 'utc')::date;
  if (cursor_day::timestamp + time '23:00') at time zone 'utc' <= now() then
    cursor_day := cursor_day + 1;
  end if;

  while cardinality(slots) < day_count loop
    dow := extract(dow from cursor_day)::integer;
    if dow = any (found_season.official_weekdays) then
      slots := slots || array[(cursor_day::timestamp + time '23:00') at time zone 'utc'];
    end if;
    cursor_day := cursor_day + 1;
    if cursor_day > (now() at time zone 'utc')::date + 400 then
      raise exception 'THE SCHEDULE DID NOT FIT';
    end if;
  end loop;

  if cardinality(roster) % 2 = 1 then
    circle := roster || array[null]::uuid[];
  else
    circle := roster;
  end if;
  n := cardinality(circle);
  round_count := n - 1;

  while slate < day_count loop
    cycle := slate / round_count;
    slot_at := slots[slate + 1];
    pair_slot := 0;
    for i in 1 .. (n / 2) loop
      a := circle[i];
      b := circle[n + 1 - i];
      if a is not null and b is not null then
        pair_slot := pair_slot + 1;
        if cycle % 2 = 0 then
          home_id := a;
          away_id := b;
        else
          home_id := b;
          away_id := a;
        end if;
        game_seed := ('x' || substr(md5(
          target_season::text || ':' || slate::text || ':' || pair_slot::text
        ), 1, 15))::bit(60)::bigint;
        insert into public.games (
          season_id,
          home_team_id,
          away_team_id,
          starts_at,
          status,
          weather,
          seed,
          settings_version,
          result,
          narrative,
          is_practice
        )
        values (
          target_season,
          home_id,
          away_id,
          slot_at,
          'scheduled',
          private.generate_weather(game_seed, variability),
          game_seed,
          found_season.settings_version,
          null,
          null,
          false
        );
      end if;
    end loop;
    circle := array[circle[1]] || array[circle[n]] || circle[2:n - 1];
    slate := slate + 1;
  end loop;

  insert into public.standings (season_id, team_id, wins, losses)
  select target_season, id, 0, 0
  from public.teams
  where season_id = target_season;

  update public.seasons
  set status = 'active',
      start_error = null
  where id = target_season;
end;
$func$;
create or replace function private.draft_pick(target_season uuid, target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  open_season public.seasons;
  draft public.draft_state;
  clock_team uuid;
  clock_coach uuid;
  kid_team uuid;
  on_team integer;
  prior_sub text;
  prior_claims text;
  boss uuid;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into open_season
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if open_season.status <> 'drafting' then
    raise exception 'THE DRAFT IS NOT OPEN';
  end if;

  select * into draft
  from public.draft_state
  where season_id = target_season
  for update;

  if not found then
    raise exception 'THE DRAFT HAS NOT STARTED';
  end if;
  if draft.pick_index >= cardinality(draft."order") then
    raise exception 'THE DRAFT IS COMPLETE';
  end if;

  clock_team := draft."order"[draft.pick_index + 1];
  select coach_id into clock_coach
  from public.teams
  where id = clock_team
    and season_id = target_season;
  if clock_coach is distinct from uid then
    raise exception 'IT IS NOT YOUR TURN';
  end if;

  select team_id into kid_team
  from public.players
  where id = target_player
    and season_id = target_season
  for update;

  if not found then
    raise exception 'THAT KID IS NOT IN THIS SEASON';
  end if;
  if kid_team is not null then
    raise exception 'THAT KID IS ALREADY ON A TEAM';
  end if;

  select count(*) into on_team
  from public.players
  where team_id = clock_team;
  if on_team >= open_season.roster_cap then
    raise exception 'THE ROSTER IS FULL';
  end if;

  update public.players
  set team_id = clock_team
  where id = target_player
    and season_id = target_season
    and team_id is null;
  if not found then
    raise exception 'THAT KID IS ALREADY ON A TEAM';
  end if;

  update public.draft_state
  set pick_index = pick_index + 1
  where season_id = target_season;

  if draft.pick_index + 1 >= cardinality(draft."order") then
    boss := open_season.commissioner_id;
    prior_sub := current_setting('request.jwt.claim.sub', true);
    prior_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claim.sub', boss::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', boss)::text, true);
    begin
      perform private.play_ball(target_season);
      perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
      perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    exception
      when others then
        perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
        update public.seasons
        set start_error = upper(sqlerrm)
        where id = target_season;
    end;
  end if;
end;
$func$;
create or replace function private.award_final_game(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  marked uuid;
  winner_name text;
  winner_id uuid;
  loser_id uuid;
  caps integer;
  rep integer;
begin
  select * into game
  from public.games
  where id = target_game
  for update;

  if not found then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  if game.is_practice then
    if game.status is distinct from 'final' or game.result is null then
      return;
    end if;
    insert into private.game_awards (game_id)
    values (target_game)
    on conflict do nothing
    returning game_id into marked;
    if marked is null then
      return;
    end if;
    perform private.spend_packed(target_game, game.home_team_id);
    perform private.spend_packed(target_game, game.away_team_id);
    return;
  end if;

  if game.status is distinct from 'final' or game.result is null then
    raise exception 'THE GAME HAS NOT BEEN PLAYED';
  end if;

  insert into private.game_awards (game_id)
  values (target_game)
  on conflict do nothing
  returning game_id into marked;

  if marked is null then
    return;
  end if;

  perform 1
  from public.teams
  where id in (game.home_team_id, game.away_team_id)
  order by id
  for update;

  winner_name := game.result ->> 'winner';
  if winner_name = 'home' then
    winner_id := game.home_team_id;
    loser_id := game.away_team_id;
  elsif winner_name = 'away' then
    winner_id := game.away_team_id;
    loser_id := game.home_team_id;
  elsif winner_name = 'tie' then
    winner_id := null;
    loser_id := null;
  else
    raise exception 'THE BOOKS DO NOT BALANCE';
  end if;

  if winner_id is not null then
    select
      (rules.settings ->> 'win_bottlecaps')::integer,
      (rules.settings ->> 'win_reputation')::integer
    into caps, rep
    from public.game_settings as rules
    where rules.version = game.settings_version;

    if caps is null or rep is null or caps < 0 or rep < 0 then
      raise exception 'THE RULES ARE NOT HERE';
    end if;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, winner_id, 1, 0)
    on conflict (season_id, team_id)
    do update set wins = standing.wins + 1;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, loser_id, 0, 1)
    on conflict (season_id, team_id)
    do update set losses = standing.losses + 1;

    update public.teams
    set bottlecaps = bottlecaps + caps,
        reputation = reputation + rep
    where id = winner_id;
  end if;

  perform private.spend_packed(target_game, game.home_team_id);
  perform private.spend_packed(target_game, game.away_team_id);

  update public.players as kid
  set penalty_until_game_id = null
  where kid.penalty_until_game_id is not null
    and (
      kid.penalty_until_game_id = target_game
      or (winner_id is not null and kid.team_id = winner_id)
      or exists (
        select 1
        from jsonb_array_elements(coalesce(game.result -> 'lines', '[]'::jsonb)) as ln
        where nullif(ln ->> 'player_id', '')::uuid = kid.id
          and (
            coalesce((ln ->> 'h')::integer, 0) >= 2
            or coalesce((ln ->> 'rbi')::integer, 0) >= 2
          )
      )
    );

  update public.seasons as seasons
  set status = 'completed'
  where seasons.id = game.season_id
    and seasons.status = 'active'
    and exists (
      select 1
      from public.games as played_game
      where played_game.season_id = seasons.id
        and played_game.is_practice = false
    )
    and not exists (
      select 1
      from public.games as open_game
      where open_game.season_id = seasons.id
        and open_game.is_practice = false
        and open_game.status = 'scheduled'
    );
end;
$func$;
create or replace function private.start_practice(target_team uuid, dev_game boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  v_coach uuid;
  v_season uuid;
  v_status text;
  v_days integer;
  v_settings integer;
  v_boss uuid;
  v_rules jsonb;
  v_variability numeric;
  v_spread numeric;
  v_hidden_spread numeric;
  seen uuid[];
  fresh uuid[];
  bench uuid[];
  v_last timestamptz;
  v_ready timestamptz;
  v_local timestamp;
  v_foe uuid;
  v_foe_name text;
  v_seed bigint;
  v_starts timestamptz;
  v_weather jsonb;
  v_game uuid;
  v_placed boolean;
  v_attempt integer;
  coach_card jsonb;
  coach_secret jsonb;
  foe_slots jsonb;
  foe_secret jsonb;
  foe_card jsonb;
  slot_no integer := 0;
  gen_id uuid;
  gen_given text;
  gen_family text;
  gen_nick text;
  gen_sex text;
  gen_contact integer;
  gen_power integer;
  gen_eye integer;
  gen_speed integer;
  gen_glove integer;
  gen_arm integer;
  gen_stamina integer;
  gen_base jsonb;
  gen_hidden jsonb;
  v_prior_sub text;
  v_prior_claims text;
  v_reward integer;
  v_status_after text;
  v_narrative text;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select coach_id, season_id
  into v_coach, v_season
  from public.teams
  where id = target_team;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if v_coach is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into seen
  from public.lineups as seat
  where seat.team_id = target_team;

  select coalesce(array_agg(picked.id order by picked.id), '{}'::uuid[])
  into bench
  from (
    select players.id
    from public.players as players
    where players.team_id = target_team
      and not exists (
        select 1
        from public.lineups as seat
        where seat.team_id = target_team
          and seat.player_id = players.id
      )
    order by players.id
    limit 9
  ) as picked;

  if cardinality(seen) + cardinality(bench) > 0 then
    perform 1
    from public.players
    where id = any (seen || bench)
    order by id
    for update;
  end if;

  select coach_id, season_id
  into v_coach, v_season
  from public.teams
  where id = target_team
  for update;

  if not found or v_coach is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into fresh
  from public.lineups as seat
  where seat.team_id = target_team;

  if fresh is distinct from seen then
    raise exception 'THE LINEUP CHANGED';
  end if;

  select status, practice_every_days, settings_version, commissioner_id
  into v_status, v_days, v_settings, v_boss
  from public.seasons
  where id = v_season;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'PRACTICE STARTS WHEN THE SEASON DOES';
  end if;
  if v_boss is null then
    raise exception 'THE COMMISSIONER IS NOT HERE';
  end if;

  select max(starts_at)
  into v_last
  from public.games
  where is_practice
    and dev = false
    and (home_team_id = target_team or away_team_id = target_team);

  if not dev_game and v_last is not null and v_last + make_interval(days => v_days) > now() then
    v_ready := v_last + make_interval(days => v_days);
    v_local := v_ready at time zone 'UTC';
    raise exception '%', format(
      'PRACTICE AGAIN %s %s %s',
      (array['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])[extract(dow from v_local)::integer + 1],
      (array['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'])[extract(month from v_local)::integer],
      extract(day from v_local)::integer
    );
  end if;

  select settings
  into v_rules
  from public.game_settings
  where version = v_settings;

  if v_rules is null
    or jsonb_typeof(v_rules -> 'weather_variability') <> 'number'
    or jsonb_typeof(v_rules -> 'initial_stat_variability') <> 'number'
    or v_rules ->> 'practice_bottlecap_reward' !~ '^[0-9]+$'
  then
    raise exception 'THE RULES ARE NOT HERE';
  end if;

  v_variability := (v_rules ->> 'weather_variability')::numeric;
  v_spread := (v_rules ->> 'initial_stat_variability')::numeric;
  if v_variability < 0 or v_variability > 1 or v_spread < 0 or v_spread > 50 then
    raise exception 'THE RULES ARE NOT HERE';
  end if;
  v_hidden_spread := greatest(4, v_spread / 3);

  select id
  into v_foe
  from public.teams
  where season_id = v_season
    and practice
  for update;

  if not found then
    v_foe_name := 'NEIGHBORHOOD';
    if exists (
      select 1
      from public.teams
      where season_id = v_season
        and lower(name) = lower(v_foe_name)
    ) then
      v_foe_name := 'THE BLOCK';
    end if;
    if exists (
      select 1
      from public.teams
      where season_id = v_season
        and lower(name) = lower(v_foe_name)
    ) then
      v_foe_name := 'PRACTICE CLUB';
    end if;
    if exists (
      select 1
      from public.teams
      where season_id = v_season
        and lower(name) = lower(v_foe_name)
    ) then
      raise exception 'THE BLOCK IS FULL OF NAMES';
    end if;

    begin
      insert into public.teams (
        season_id,
        coach_id,
        name,
        bottlecaps,
        reputation,
        settings_version,
        practice
      )
      values (v_season, v_boss, v_foe_name, 0, 0, v_settings, true)
      returning id into v_foe;
    exception
      when unique_violation then
        select id
        into v_foe
        from public.teams
        where season_id = v_season
          and practice
        for update;
        if v_foe is null then
          raise exception 'THE BLOCK IS FULL OF NAMES';
        end if;
    end;
  end if;

  select jsonb_build_object(
    'slots', (
      select jsonb_agg(lined.slot_row order by lined.slot_no)
      from (
        select
          n.slot_no,
          jsonb_build_object(
            'slot', n.slot_no,
            'player_id', player.id,
            'given_name', player.given_name,
            'family_name', player.family_name,
            'nickname', player.nickname,
            'sex', player.sex,
            'base_stats', player.base_stats
          ) as slot_row
        from generate_series(1, 9) as n(slot_no)
        left join public.lineups as seat
          on seat.team_id = target_team
         and seat.slot = n.slot_no
        left join public.players as player
          on player.id = seat.player_id
         and player.team_id = target_team
      ) as lined
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', packed.item_id,
          'name', shelf.name,
          'remaining_games', 1,
          'effect', packed.effect
        )
        order by packed.bought_at, packed.id
      )
      from public.team_items as packed
      join public.clubhouse_items as shelf on shelf.id = packed.item_id
      where packed.team_id = target_team
    ), '[]'::jsonb)
  )
  into coach_card;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'player_id', player.id,
      'slot', seat.slot,
      'base_stats', player.base_stats,
      'hidden_stats', player.hidden_stats,
      'tryout_status', player.tryout_status,
      'penalty_until_game_id', player.penalty_until_game_id
    )
    order by seat.slot
  ), '[]'::jsonb)
  into coach_secret
  from public.lineups as seat
  join public.players as player
    on player.id = seat.player_id
   and player.team_id = target_team
  where seat.team_id = target_team;

  -- Empty spots stay empty. A short card does not start, and no kid is
  -- invented to fill it. The neighborhood nine is built only after this.
  if (
    select count(distinct slot ->> 'player_id')
    from jsonb_array_elements(coach_card -> 'slots') as slot
    where slot ->> 'slot' ~ '^[1-9]$'
      and nullif(slot ->> 'player_id', '') is not null
  ) is distinct from 9 then
    raise exception 'ASSIGN THE NINE FIRST';
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'slot', lined.n,
        'player_id', lined.id,
        'given_name', lined.given_name,
        'family_name', lined.family_name,
        'nickname', lined.nickname,
        'sex', lined.sex,
        'base_stats', lined.base_stats
      )
      order by lined.n
    ), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'player_id', lined.id,
        'slot', lined.n,
        'base_stats', lined.base_stats,
        'hidden_stats', lined.hidden_stats,
        'tryout_status', lined.tryout_status,
        'penalty_until_game_id', lined.penalty_until_game_id
      )
      order by lined.n
    ), '[]'::jsonb),
    coalesce(max(lined.n), 0)
  into foe_slots, foe_secret, slot_no
  from (
    select
      row_number() over (order by players.id)::integer as n,
      players.id,
      players.given_name,
      players.family_name,
      players.nickname,
      players.sex,
      players.base_stats,
      players.hidden_stats,
      players.tryout_status,
      players.penalty_until_game_id
    from public.players as players
    where players.id = any (bench)
      and players.team_id = target_team
      and not exists (
        select 1
        from public.lineups as seat
        where seat.team_id = target_team
          and seat.player_id = players.id
      )
  ) as lined;

  -- The coach's empty spots never reach this loop. These kids are the
  -- other side, after the bench, and they exist only for this game.
  while slot_no < 9 loop
    slot_no := slot_no + 1;
    gen_id := gen_random_uuid();
    select name, sex
    into gen_given, gen_sex
    from private.given_names
    order by random()
    limit 1;
    select name
    into gen_family
    from private.family_names
    order by random()
    limit 1;
    if gen_given is null or gen_family is null or gen_sex is null then
      raise exception 'THE NAME LIST IS EMPTY';
    end if;
    gen_nick := null;
    if random() < 0.08 then
      select name
      into gen_nick
      from private.nicknames
      order by random()
      limit 1;
    end if;

    gen_contact := private.roll_stat(50, v_spread);
    gen_power := private.roll_stat(50, v_spread);
    gen_eye := private.roll_stat(50, v_spread);
    gen_speed := private.roll_stat(50, v_spread);
    gen_glove := private.roll_stat(50, v_spread);
    gen_arm := private.roll_stat(50, v_spread);
    gen_stamina := private.roll_stat(50, v_spread);
    gen_base := jsonb_build_object(
      'contact', gen_contact,
      'power', gen_power,
      'eye', gen_eye,
      'speed', gen_speed,
      'glove', gen_glove,
      'arm', gen_arm,
      'stamina', gen_stamina
    );
    gen_hidden := jsonb_build_object(
      'barrel_accuracy', private.roll_stat(gen_contact, v_hidden_spread),
      'swing_timing', private.roll_stat(gen_contact, v_hidden_spread),
      'two_strike_fight', private.roll_stat(gen_contact, v_hidden_spread),
      'soft_contact', private.roll_stat(gen_contact, v_hidden_spread),
      'consistency', private.roll_stat(gen_contact, v_hidden_spread),
      'raw_strength', private.roll_stat(gen_power, v_hidden_spread),
      'launch_tendency', private.roll_stat(gen_power, v_hidden_spread),
      'backspin_carry', private.roll_stat(gen_power, v_hidden_spread),
      'strike_zone_judgment', private.roll_stat(gen_eye, v_hidden_spread),
      'pitch_recognition', private.roll_stat(gen_eye, v_hidden_spread),
      'patience', private.roll_stat(gen_eye, v_hidden_spread),
      'chase_discipline', private.roll_stat(gen_eye, v_hidden_spread),
      'first_step', private.roll_stat(gen_speed, v_hidden_spread),
      'top_speed', private.roll_stat(gen_speed, v_hidden_spread),
      'slide_agility', private.roll_stat(gen_speed, v_hidden_spread),
      'baserunning_reads', private.roll_stat(gen_speed, v_hidden_spread),
      'hands_softness', private.roll_stat(gen_glove, v_hidden_spread),
      'range_first_step', private.roll_stat(gen_glove, v_hidden_spread),
      'reaction', private.roll_stat(gen_glove, v_hidden_spread),
      'reliability', private.roll_stat(gen_glove, v_hidden_spread),
      'arm_strength', private.roll_stat(gen_arm, v_hidden_spread),
      'accuracy', private.roll_stat(gen_arm, v_hidden_spread),
      'release_quickness', private.roll_stat(gen_arm, v_hidden_spread),
      'carry', private.roll_stat(gen_arm, v_hidden_spread),
      'fade_resistance', private.roll_stat(gen_stamina, v_hidden_spread),
      'late_game_energy', private.roll_stat(gen_stamina, v_hidden_spread),
      'recovery', private.roll_stat(gen_stamina, v_hidden_spread),
      'heat_weather_tolerance', private.roll_stat(gen_stamina, v_hidden_spread),
      'focus_endurance', private.roll_stat(gen_stamina, v_hidden_spread)
    );

    foe_slots := foe_slots || jsonb_build_array(jsonb_build_object(
      'slot', slot_no,
      'player_id', gen_id,
      'given_name', gen_given,
      'family_name', gen_family,
      'nickname', gen_nick,
      'sex', gen_sex,
      'base_stats', gen_base
    ));
    foe_secret := foe_secret || jsonb_build_array(jsonb_build_object(
      'player_id', gen_id,
      'slot', slot_no,
      'base_stats', gen_base,
      'hidden_stats', gen_hidden,
      'tryout_status', null,
      'penalty_until_game_id', null
    ));
  end loop;

  if coach_card is null or jsonb_array_length(coach_card -> 'slots') is distinct from 9
    or jsonb_array_length(foe_slots) is distinct from 9
  then
    raise exception 'THE CARD DID NOT LOCK';
  end if;
  foe_card := jsonb_build_object('slots', foe_slots, 'items', '[]'::jsonb);

  v_seed := ('x' || substr(md5(target_team::text || ':' || clock_timestamp()::text || ':' || gen_random_uuid()::text), 1, 15))::bit(60)::bigint;
  v_weather := private.generate_weather(v_seed, v_variability);
  v_starts := clock_timestamp();
  v_placed := false;
  for v_attempt in 1..8 loop
    begin
      insert into public.games (
        season_id,
        home_team_id,
        away_team_id,
        starts_at,
        status,
        weather,
        seed,
        settings_version,
        result,
        narrative,
        is_practice,
        dev
      )
      values (
        v_season,
        target_team,
        v_foe,
        v_starts,
        'scheduled',
        v_weather,
        v_seed,
        v_settings,
        null,
        null,
        true,
        dev_game
      )
      returning id into v_game;
      v_placed := true;
    exception
      when unique_violation then
        v_starts := v_starts + interval '1 microsecond';
    end;
    exit when v_placed;
  end loop;
  if not v_placed or v_game is null then
    raise exception 'PRACTICE DID NOT FIT THE DAY';
  end if;

  insert into public.lineup_locks (game_id, team_id, card)
  values
    (v_game, target_team, coach_card),
    (v_game, v_foe, foe_card);

  insert into private.lineup_lock_secrets (game_id, team_id, kids)
  values
    (v_game, target_team, coach_secret),
    (v_game, v_foe, foe_secret);

  v_prior_sub := current_setting('request.jwt.claim.sub', true);
  v_prior_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', v_boss::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_boss)::text, true);

  begin
    perform public.play_game_now(v_game);
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  exception
    when others then
      perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
      perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
      raise;
  end;

  select status, narrative
  into v_status_after, v_narrative
  from public.games
  where id = v_game;

  if v_status_after is distinct from 'final' or v_narrative is null or btrim(v_narrative) = '' then
    raise exception 'PRACTICE DID NOT PLAY';
  end if;

  select (settings ->> 'practice_bottlecap_reward')::integer
  into v_reward
  from public.game_settings
  where version = v_settings;

  if v_reward is null or v_reward < 0 then
    raise exception 'THE RULES ARE NOT HERE';
  end if;

  update public.teams
  set bottlecaps = bottlecaps + v_reward
  where id = target_team;

  return v_game;
end;
$func$;

comment on function private.buy_item(uuid, text, integer) is
  'The owning coach packs one copy for the next game. A second copy of that item is refused.';

comment on function private.play_ball(uuid) is
  'Opens an active season after the draft and clears a stored start error. Official games land at 23:00 UTC.';

comment on function private.draft_pick(uuid, uuid) is
  'The coach on the clock takes one unassigned kid. The last pick opens the season as the commissioner, and a failed open keeps the pick.';

comment on function private.award_final_game(uuid) is
  'Pays an official winner, spends packed items for an official game and for a practice, and clears a met penalty. A second call pays nothing and spends nothing.';

drop policy games_select on public.games;

create policy games_select
  on public.games
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = games.season_id
        and teams.coach_id = (select auth.uid())
        and not teams.practice
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = games.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );

drop policy players_select on public.players;

create policy players_select
  on public.players
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = players.season_id
        and teams.coach_id = (select auth.uid())
        and not teams.practice
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = players.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );

comment on table public.lineup_locks is
  'One team''s card for one game. Realtime publishes the game, the team, and the lock time. The card column stays out of that publication.';

alter publication supabase_realtime add table public.games (
  id,
  season_id,
  home_team_id,
  away_team_id,
  starts_at,
  status,
  weather,
  settings_version,
  result,
  narrative,
  is_practice,
  dev
);

alter publication supabase_realtime add table public.teams (
  id,
  season_id,
  coach_id,
  name,
  bottlecaps,
  reputation,
  settings_version,
  created_at
);

alter publication supabase_realtime add table public.seasons (
  id,
  name,
  commissioner_id,
  status,
  official_weekdays,
  practice_every_days,
  weeks,
  draft_rounds,
  roster_cap,
  settings_version,
  created_at,
  start_error
);

alter publication supabase_realtime add table public.standings (
  season_id,
  team_id,
  wins,
  losses
);

alter publication supabase_realtime add table public.lineup_locks (
  game_id,
  team_id,
  locked_at
);
