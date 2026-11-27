-- A game does not start until nine kids are assigned.
-- The official lock refuses a short card. The clock leaves that game
-- scheduled, and the other due games still play. A neighborhood game
-- refuses before it invents anyone for the empty spots. Once the nine
-- is assigned, the other side is still the bench and then kids who
-- exist only for that game.
-- private.start_practice matches 20261127140000, including the one-game
-- item card. Apply that migration first when both are still pending.

create or replace function private.card_is_full(card jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select coalesce(jsonb_typeof(card -> 'slots') = 'array', false)
    and (
      select count(distinct slot ->> 'player_id')
      from jsonb_array_elements(card -> 'slots') as slot
      where slot ->> 'slot' ~ '^[1-9]$'
        and nullif(slot ->> 'player_id', '') is not null
    ) = 9;
$func$;

comment on function private.card_is_full(jsonb) is
  'True when slots 1 through 9 each hold a different kid.';

revoke all on function private.card_is_full(jsonb) from public, anon, authenticated, service_role;

create or replace function private.lock_lineup(target_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  game public.games%rowtype;
  my_team uuid;
  owner uuid;
  seen uuid[];
  fresh uuid[];
  snapshot jsonb;
  secret_kids jsonb;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into game
  from public.games
  where id = target_game;

  if not found then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  select team.id into my_team
  from public.teams as team
  where team.coach_id = uid
    and team.id in (game.home_team_id, game.away_team_id);

  if not found then
    raise exception 'THAT GAME IS NOT YOURS';
  end if;

  if game.status is distinct from 'scheduled' then
    raise exception 'THE GAME HAS ALREADY BEEN PLAYED';
  end if;

  if exists (
    select 1
    from public.lineup_locks
    where game_id = target_game
      and team_id = my_team
  ) then
    raise exception 'THE CARD IS ALREADY LOCKED';
  end if;

  -- Only the earliest scheduled game for this team can lock.
  if exists (
    select 1
    from public.games as earlier
    where earlier.status = 'scheduled'
      and earlier.id <> target_game
      and (earlier.home_team_id = my_team or earlier.away_team_id = my_team)
      and earlier.starts_at < game.starts_at
  ) then
    raise exception 'LOCK THE NEXT GAME FIRST';
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into seen
  from public.lineups as seat
  where seat.team_id = my_team;

  if cardinality(seen) > 0 then
    perform 1
    from public.players
    where id = any (seen)
    order by id
    for update;
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into fresh
  from public.lineups as seat
  where seat.team_id = my_team;

  if fresh is distinct from seen then
    raise exception 'THE LINEUP CHANGED';
  end if;

  select coach_id into owner
  from public.teams
  where id = my_team
  for update;

  if not found or owner is distinct from uid then
    raise exception 'THAT GAME IS NOT YOURS';
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into fresh
  from public.lineups as seat
  where seat.team_id = my_team;

  if fresh is distinct from seen then
    raise exception 'THE LINEUP CHANGED';
  end if;

  select * into game
  from public.games
  where id = target_game
  for update;

  if not found then
    raise exception 'THAT GAME IS NOT HERE';
  end if;
  if game.status is distinct from 'scheduled' then
    raise exception 'THE GAME HAS ALREADY BEEN PLAYED';
  end if;
  if game.home_team_id is distinct from my_team and game.away_team_id is distinct from my_team then
    raise exception 'THAT GAME IS NOT YOURS';
  end if;

  if exists (
    select 1
    from public.lineup_locks
    where game_id = target_game
      and team_id = my_team
  ) then
    raise exception 'THE CARD IS ALREADY LOCKED';
  end if;

  if exists (
    select 1
    from public.games as earlier
    where earlier.status = 'scheduled'
      and earlier.id <> target_game
      and (earlier.home_team_id = my_team or earlier.away_team_id = my_team)
      and earlier.starts_at < game.starts_at
  ) then
    raise exception 'LOCK THE NEXT GAME FIRST';
  end if;

  select jsonb_build_object(
    'slots', (
      select jsonb_agg(lined.slot_row order by lined.slot_no)
      from (
        select
          n.slot_no,
          jsonb_build_object(
            'slot', n.slot_no,
            'player_id', kid.id,
            'given_name', kid.given_name,
            'family_name', kid.family_name,
            'nickname', kid.nickname,
            'sex', kid.sex,
            'base_stats', kid.base_stats
          ) as slot_row
        from generate_series(1, 9) as n(slot_no)
        left join public.lineups as seat
          on seat.team_id = my_team
         and seat.slot = n.slot_no
        left join public.players as kid
          on kid.id = seat.player_id
         and kid.team_id = my_team
      ) as lined
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', packed.item_id,
          'name', shelf.name,
          'remaining_games', packed.remaining_games,
          'effect', packed.effect
        )
        order by packed.bought_at, packed.id
      )
      from public.team_items as packed
      join public.clubhouse_items as shelf on shelf.id = packed.item_id
      where packed.team_id = my_team
    ), '[]'::jsonb)
  )
  into snapshot;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'player_id', kid.id,
      'slot', seat.slot,
      'base_stats', kid.base_stats,
      'hidden_stats', kid.hidden_stats,
      'tryout_status', kid.tryout_status,
      'penalty_until_game_id', kid.penalty_until_game_id
    )
    order by seat.slot
  ), '[]'::jsonb)
  into secret_kids
  from public.lineups as seat
  join public.players as kid
    on kid.id = seat.player_id
   and kid.team_id = my_team
  where seat.team_id = my_team;

  if not private.card_is_full(snapshot) then
    raise exception 'ASSIGN THE NINE FIRST';
  end if;

  begin
    insert into public.lineup_locks (game_id, team_id, card)
    values (target_game, my_team, snapshot);
  exception
    when unique_violation then
      raise exception 'THE CARD IS ALREADY LOCKED';
  end;

  insert into private.lineup_lock_secrets (game_id, team_id, kids)
  values (target_game, my_team, secret_kids);

  return snapshot;
end;
$func$;

comment on function private.lock_lineup(uuid) is
  'The coach on one side copies a full nine and the packed items for their next scheduled game. A short card raises ASSIGN THE NINE FIRST. A later game is refused until that one is no longer scheduled. A second call is refused.';

revoke all on function private.lock_lineup(uuid) from public, anon, authenticated, service_role;
grant execute on function private.lock_lineup(uuid) to authenticated;

comment on function public.lock_lineup(uuid) is
  'Signed-in coach locks a full nine for their next scheduled game.';

create or replace function private.freeze_open_card(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  side_id uuid;
  sides uuid[];
  seen uuid[];
  fresh uuid[];
  snapshot jsonb;
  secret_kids jsonb;
begin
  select * into game
  from public.games
  where id = target_game;

  if not found or game.status is distinct from 'scheduled' then
    return;
  end if;

  if game.away_team_id < game.home_team_id then
    sides := array[game.away_team_id, game.home_team_id];
  else
    sides := array[game.home_team_id, game.away_team_id];
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into seen
  from public.lineups as seat
  where seat.team_id = any (sides);

  if cardinality(seen) > 0 then
    perform 1
    from public.players
    where id = any (seen)
    order by id
    for update;
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into fresh
  from public.lineups as seat
  where seat.team_id = any (sides);

  if fresh is distinct from seen then
    raise exception 'THE LINEUP CHANGED';
  end if;

  perform 1
  from public.teams
  where id = any (sides)
  order by id
  for update;

  if (
    select count(*)
    from public.teams
    where id = any (sides)
  ) < 2 then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  select coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[])
  into fresh
  from public.lineups as seat
  where seat.team_id = any (sides);

  if fresh is distinct from seen then
    raise exception 'THE LINEUP CHANGED';
  end if;

  select * into game
  from public.games
  where id = target_game
  for update;

  if not found or game.status is distinct from 'scheduled' then
    return;
  end if;

  if game.home_team_id <> all (sides) or game.away_team_id <> all (sides) then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  foreach side_id in array sides loop
    if exists (
      select 1
      from public.lineup_locks as locked
      where locked.game_id = target_game
        and locked.team_id = side_id
    ) then
      if not exists (
        select 1
        from public.lineup_locks as locked
        where locked.game_id = target_game
          and locked.team_id = side_id
          and private.card_is_full(locked.card)
      ) then
        raise exception 'ASSIGN THE NINE FIRST';
      end if;
      continue;
    end if;

    select jsonb_build_object(
      'slots', (
        select jsonb_agg(lined.slot_row order by lined.slot_no)
        from (
          select
            n.slot_no,
            jsonb_build_object(
              'slot', n.slot_no,
              'player_id', kid.id,
              'given_name', kid.given_name,
              'family_name', kid.family_name,
              'nickname', kid.nickname,
              'sex', kid.sex,
              'base_stats', kid.base_stats
            ) as slot_row
          from generate_series(1, 9) as n(slot_no)
          left join public.lineups as seat
            on seat.team_id = side_id
           and seat.slot = n.slot_no
          left join public.players as kid
            on kid.id = seat.player_id
           and kid.team_id = side_id
        ) as lined
      ),
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'item_id', packed.item_id,
            'name', shelf.name,
            'remaining_games', packed.remaining_games,
            'effect', packed.effect
          )
          order by packed.bought_at, packed.id
        )
        from public.team_items as packed
        join public.clubhouse_items as shelf on shelf.id = packed.item_id
        where packed.team_id = side_id
      ), '[]'::jsonb)
    )
    into snapshot;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'player_id', kid.id,
        'slot', seat.slot,
        'base_stats', kid.base_stats,
        'hidden_stats', kid.hidden_stats,
        'tryout_status', kid.tryout_status,
        'penalty_until_game_id', kid.penalty_until_game_id
      )
      order by seat.slot
    ), '[]'::jsonb)
    into secret_kids
    from public.lineups as seat
    join public.players as kid
      on kid.id = seat.player_id
     and kid.team_id = side_id
    where seat.team_id = side_id;

    if not private.card_is_full(snapshot) then
      raise exception 'ASSIGN THE NINE FIRST';
    end if;

    begin
      insert into public.lineup_locks (game_id, team_id, card)
      values (target_game, side_id, snapshot);
    exception
      when unique_violation then
        continue;
    end;

    insert into private.lineup_lock_secrets (game_id, team_id, kids)
    values (target_game, side_id, secret_kids);
  end loop;
end;
$func$;

comment on function private.freeze_open_card(uuid) is
  'Copies each open full nine from the lineup saved on that team. A short side raises ASSIGN THE NINE FIRST and the game stays scheduled. A locked full nine stays. Hidden stats go to the private secret. No coach check: only the clock calls this.';

revoke all on function private.freeze_open_card(uuid) from public, anon, authenticated, service_role;

create or replace function private.settle_due_game(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  boss uuid;
begin
  select * into game
  from public.games
  where id = target_game;

  if not found or game.is_practice or game.status is distinct from 'scheduled' or game.starts_at > now() then
    return;
  end if;

  perform private.freeze_open_card(target_game);

  select * into game
  from public.games
  where id = target_game
  for update;

  if not found or game.is_practice or game.status is distinct from 'scheduled' or game.starts_at > now() then
    return;
  end if;

  if (
    select count(*)
    from public.lineup_locks as locked
    where locked.game_id = game.id
      and locked.team_id in (game.home_team_id, game.away_team_id)
      and private.card_is_full(locked.card)
  ) is distinct from 2 then
    raise exception 'ASSIGN THE NINE FIRST';
  end if;

  select seasons.commissioner_id
  into boss
  from public.seasons as seasons
  where seasons.id = game.season_id;

  if boss is null then
    raise exception 'THE COMMISSIONER IS NOT HERE';
  end if;

  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', boss)::text, true);

  begin
    perform public.play_game_now(target_game);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
  exception
    when others then
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '', true);
      raise;
  end;
end;
$func$;

comment on function private.settle_due_game(uuid) is
  'Freezes open cards and plays one due official game when both nines are full. A short side raises ASSIGN THE NINE FIRST. The caller skips that game and continues.';

revoke all on function private.settle_due_game(uuid) from public, anon, authenticated, service_role;

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

comment on function private.start_practice(uuid, boolean) is
  'The signed-in coach plays one practice once nine kids are assigned. A short card raises ASSIGN THE NINE FIRST before any neighborhood kid is invented. dev_game skips the gap and does not count as the last practice. Standings stay put. The small bottlecap purse is added here.';

revoke all on function private.start_practice(uuid, boolean) from public, anon, authenticated, service_role;

