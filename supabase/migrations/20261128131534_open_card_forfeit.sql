-- An open card at the scheduled start uses the lineup, the batting order,
-- and the packed items as they stand. Empty field spots are filled from the
-- bench at random. Open batting spots are filled at random from that nine.
-- Fewer than nine kids is a forfeit. The other club wins and earns nothing.
-- Both forfeits are a tie. A forfeit pays no purse and no flat item reputation.

create function private.kids_order_ready(kids jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select coalesce(jsonb_typeof(kids) = 'array', false)
    and (
      select count(*) = 9
        and count(distinct kid ->> 'batting_order') filter (
          where (kid ->> 'batting_order') ~ '^[1-9]$'
        ) = 9
      from jsonb_array_elements(kids) as packed(kid)
    );
$func$;

comment on function private.kids_order_ready(jsonb) is
  'True when nine locked kids already hold batting spots 1 through 9.';

revoke all on function private.kids_order_ready(jsonb) from public, anon, authenticated, service_role;

create or replace function private.stamp_batting_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  lined integer;
begin
  if private.kids_order_ready(new.kids) then
    return new;
  end if;

  select count(*)
  into lined
  from public.lineups as seat
  where seat.team_id = new.team_id;

  if lined = 0 then
    return new;
  end if;

  if not private.batting_order_ready(new.team_id) then
    if lined = 9 then
      raise exception 'ASSIGN THE BATTING ORDER FIRST';
    end if;
    raise exception 'ASSIGN THE NINE FIRST';
  end if;

  new.kids := (
    select coalesce(jsonb_agg(
      case
        when seat.batting_order is null then kid
        else kid || jsonb_build_object('batting_order', seat.batting_order)
      end
      order by seat.batting_order nulls last, (kid ->> 'slot')::integer
    ), '[]'::jsonb)
    from jsonb_array_elements(new.kids) as packed(kid)
    left join public.lineups as seat
      on seat.team_id = new.team_id
     and (packed.kid ->> 'player_id') ~* '^[0-9a-f-]{36}$'
     and seat.player_id = (packed.kid ->> 'player_id')::uuid
  );

  if (
    select count(*)
    from jsonb_array_elements(new.kids) as packed(kid)
    where (packed.kid ->> 'batting_order') ~ '^[1-9]$'
  ) is distinct from 9 then
    raise exception 'ASSIGN THE BATTING ORDER FIRST';
  end if;

  return new;
end;
$func$;

comment on function private.stamp_batting_order() is
  'Freezes the batting order onto a new lock. A secret that already has spots 1 through 9 keeps them. A coach lock still requires the saved nine and the saved order. A side with no saved card, such as kids who exist only for that game, is left in slot order.';

create function private.flat_item_reputation(target_game uuid, target_team uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $func$
  select coalesce(sum((item -> 'effect' ->> 'reputation')::integer), 0)::integer
  from public.lineup_locks as locks
  cross join lateral jsonb_array_elements(coalesce(locks.card -> 'items', '[]'::jsonb)) as packed(item)
  where locks.game_id = target_game
    and locks.team_id = target_team
    and coalesce(item -> 'effect' ->> 'reputation', '') ~ '^[0-9]+$'
    and (item -> 'effect' ->> 'reputation')::integer between 1 and 100;
$func$;

comment on function private.flat_item_reputation(uuid, uuid) is
  'Reputation on packed items that pays on a played game whether the club wins, loses, or ties. A forfeit does not call this.';

revoke all on function private.flat_item_reputation(uuid, uuid) from public, anon, authenticated, service_role;

create function private.fill_open_side(target_game uuid, side_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $func$
declare
  roster integer;
  slot_ids uuid[] := array_fill(null::uuid, array[9]);
  orders integer[] := array_fill(null::integer, array[9]);
  bench uuid[];
  open_slots integer[] := '{}'::integer[];
  open_spots integer[];
  i integer;
  need integer;
  seat record;
  kid public.players%rowtype;
  slots jsonb := '[]'::jsonb;
  secret_kids jsonb := '[]'::jsonb;
  items jsonb;
begin
  if not exists (
    select 1
    from public.games as game
    where game.id = target_game
      and game.status = 'scheduled'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.lineup_locks as locked
    where locked.game_id = target_game
      and locked.team_id = side_id
      and private.card_is_full(locked.card)
  ) then
    return true;
  end if;

  select count(*)
  into roster
  from public.players as kid_row
  where kid_row.team_id = side_id;

  if exists (
    select 1
    from public.lineup_locks as locked
    where locked.game_id = target_game
      and locked.team_id = side_id
  ) then
    if roster >= 9 then
      raise exception 'THE CARD DID NOT LOCK';
    end if;
    return false;
  end if;

  if roster < 9 then
    return false;
  end if;

  for seat in
    select lineup.slot, lineup.player_id, lineup.batting_order
    from public.lineups as lineup
    join public.players as players
      on players.id = lineup.player_id
     and players.team_id = side_id
    where lineup.team_id = side_id
      and lineup.slot between 1 and 9
  loop
    slot_ids[seat.slot] := seat.player_id;
    orders[seat.slot] := seat.batting_order;
  end loop;

  select coalesce(array_agg(players.id order by random()), '{}'::uuid[])
  into bench
  from public.players as players
  where players.team_id = side_id
    and players.id <> all (coalesce(array_remove(slot_ids, null), '{}'::uuid[]));

  for i in 1..9 loop
    if slot_ids[i] is null then
      open_slots := open_slots || i;
    end if;
  end loop;

  if coalesce(cardinality(bench), 0) < coalesce(cardinality(open_slots), 0) then
    raise exception 'THE CARD DID NOT LOCK';
  end if;

  for i in 1..coalesce(cardinality(open_slots), 0) loop
    slot_ids[open_slots[i]] := bench[i];
  end loop;

  select coalesce(array_agg(n order by random()), '{}'::integer[])
  into open_spots
  from generate_series(1, 9) as series(n)
  where series.n not in (
    select ord
    from unnest(orders) as listed(ord)
    where ord between 1 and 9
  );

  need := 1;
  for i in 1..9 loop
    if orders[i] is null or orders[i] < 1 or orders[i] > 9 then
      orders[i] := open_spots[need];
      need := need + 1;
    end if;
  end loop;

  for i in 1..9 loop
    select players.*
    into kid
    from public.players as players
    where players.id = slot_ids[i]
      and players.team_id = side_id;

    if kid.id is null or orders[i] is null then
      raise exception 'THE CARD DID NOT LOCK';
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'slot', i,
      'player_id', kid.id,
      'given_name', kid.given_name,
      'family_name', kid.family_name,
      'nickname', kid.nickname,
      'sex', kid.sex,
      'base_stats', kid.base_stats
    ));
    secret_kids := secret_kids || jsonb_build_array(jsonb_build_object(
      'player_id', kid.id,
      'slot', i,
      'base_stats', kid.base_stats,
      'hidden_stats', kid.hidden_stats,
      'tryout_status', kid.tryout_status,
      'penalty_until_game_id', kid.penalty_until_game_id,
      'batting_order', orders[i]
    ));
  end loop;

  if not private.kids_order_ready(secret_kids) then
    raise exception 'THE CARD DID NOT LOCK';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_id', packed.item_id,
      'name', shelf.name,
      'remaining_games', packed.remaining_games,
      'effect', packed.effect
    )
    order by packed.bought_at, packed.id
  ), '[]'::jsonb)
  into items
  from public.team_items as packed
  join public.clubhouse_items as shelf on shelf.id = packed.item_id
  where packed.team_id = side_id;

  begin
    insert into public.lineup_locks (game_id, team_id, card)
    values (
      target_game,
      side_id,
      jsonb_build_object('slots', slots, 'items', items)
    );

    insert into private.lineup_lock_secrets (game_id, team_id, kids)
    values (target_game, side_id, secret_kids);
  exception
    when unique_violation then
      if exists (
        select 1
        from public.lineup_locks as locked
        where locked.game_id = target_game
          and locked.team_id = side_id
          and private.card_is_full(locked.card)
      ) then
        return true;
      end if;
      raise exception 'THE CARD IS ALREADY LOCKED';
  end;

  return true;
end;
$func$;

comment on function private.fill_open_side(uuid, uuid) is
  'Locks one open side from the lineup saved on the team, the packed items, and a random fill. Empty field spots come from the bench. Open batting spots come from that nine. A full lock stays. Fewer than nine kids returns false and writes nothing.';

revoke all on function private.fill_open_side(uuid, uuid) from public, anon, authenticated, service_role;

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
    perform private.fill_open_side(target_game, side_id);
  end loop;
end;
$func$;

comment on function private.freeze_open_card(uuid) is
  'Copies each open side from the lineup saved on that team. A short nine is filled from the bench, and an open batting order is filled from that nine. Fewer than nine kids is left unlocked for a forfeit. A locked full nine stays. Hidden stats go to the private secret.';

create function private.record_forfeit(target_game uuid, which text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  away_name text;
  home_name text;
  winner text;
  sentence text;
begin
  if which not in ('home', 'away', 'both') then
    raise exception 'THE BOOKS DO NOT BALANCE';
  end if;

  select * into game
  from public.games
  where id = target_game
  for update;

  if not found or game.status is distinct from 'scheduled' then
    return;
  end if;

  select upper(btrim(coalesce(team.name, '')))
  into away_name
  from public.teams as team
  where team.id = game.away_team_id;

  select upper(btrim(coalesce(team.name, '')))
  into home_name
  from public.teams as team
  where team.id = game.home_team_id;

  if away_name is null or away_name = '' then
    away_name := 'TEAM';
  end if;
  if home_name is null or home_name = '' then
    home_name := 'TEAM';
  end if;

  if which = 'both' then
    winner := 'tie';
    sentence := away_name || ' AND ' || home_name || ' BOTH FORFEIT. IT IS A TIE, AND NOBODY EARNS A THING.';
  elsif which = 'home' then
    winner := 'away';
    sentence := home_name || ' FORFEITS. ' || away_name || ' TAKES THE GAME, AND NOBODY EARNS A THING.';
  else
    winner := 'home';
    sentence := away_name || ' FORFEITS. ' || home_name || ' TAKES THE GAME, AND NOBODY EARNS A THING.';
  end if;

  update public.games as games
  set status = 'final',
      narrative = sentence,
      result = jsonb_build_object(
        'winner', winner,
        'forfeit', which,
        'innings', '[]'::jsonb,
        'lines', '[]'::jsonb,
        'events', '[]'::jsonb,
        'away', jsonb_build_object(
          'team_id', game.away_team_id,
          'name', away_name,
          'runs', 0,
          'hits', 0,
          'errors', 0
        ),
        'home', jsonb_build_object(
          'team_id', game.home_team_id,
          'name', home_name,
          'runs', 0,
          'hits', 0,
          'errors', 0
        )
      )
  where games.id = target_game;
end;
$func$;

comment on function private.record_forfeit(uuid, text) is
  'Closes a scheduled game as a forfeit. which is home, away, or both. The other club wins. Both is a tie. The line is empty.';

revoke all on function private.record_forfeit(uuid, text) from public, anon, authenticated, service_role;

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
  purse jsonb;
  forfeit text;
  bonus integer;
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

  forfeit := game.result ->> 'forfeit';
  if forfeit is not null and forfeit not in ('home', 'away', 'both') then
    raise exception 'THE BOOKS DO NOT BALANCE';
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
    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, winner_id, 1, 0)
    on conflict (season_id, team_id)
    do update set wins = standing.wins + 1;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, loser_id, 0, 1)
    on conflict (season_id, team_id)
    do update set losses = standing.losses + 1;

    if forfeit is null then
      purse := private.official_purse(game.settings_version);
      if winner_id = game.home_team_id then
        caps := (purse -> 'home_win' ->> 'bottlecaps')::integer;
        rep := (purse -> 'home_win' ->> 'reputation')::integer;
      else
        caps := (purse -> 'away_win' ->> 'bottlecaps')::integer;
        rep := (purse -> 'away_win' ->> 'reputation')::integer;
      end if;

      if caps is null or rep is null or caps < 0 or rep < 0 then
        raise exception 'THE RULES ARE NOT HERE';
      end if;

      update public.teams
      set bottlecaps = bottlecaps + caps,
          reputation = reputation + rep
      where id = winner_id;
    end if;
  end if;

  if forfeit is null then
    bonus := private.flat_item_reputation(target_game, game.home_team_id);
    if bonus > 0 then
      update public.teams
      set reputation = reputation + bonus
      where id = game.home_team_id;
    end if;
    bonus := private.flat_item_reputation(target_game, game.away_team_id);
    if bonus > 0 then
      update public.teams
      set reputation = reputation + bonus
      where id = game.away_team_id;
    end if;
    perform private.spend_packed(target_game, game.home_team_id);
    perform private.spend_packed(target_game, game.away_team_id);
  else
    if forfeit in ('home', 'both') then
      delete from public.team_items as packed
      where packed.team_id = game.home_team_id;
    else
      perform private.spend_packed(target_game, game.home_team_id);
    end if;
    if forfeit in ('away', 'both') then
      delete from public.team_items as packed
      where packed.team_id = game.away_team_id;
    else
      perform private.spend_packed(target_game, game.away_team_id);
    end if;
  end if;

  update public.players as kid
  set penalty_until_game_id = null,
      penalty_games_left = null
  where kid.penalty_until_game_id is not null
    and (
      kid.penalty_until_game_id = target_game
      or (forfeit is null and winner_id is not null and kid.team_id = winner_id)
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

  update public.players as kid
  set penalty_games_left = kid.penalty_games_left - 1
  where kid.team_id in (game.home_team_id, game.away_team_id)
    and kid.penalty_until_game_id is not null
    and kid.penalty_games_left is not null
    and kid.penalty_games_left > 0;

  update public.players as kid
  set penalty_until_game_id = null,
      penalty_games_left = null
  where kid.team_id in (game.home_team_id, game.away_team_id)
    and kid.penalty_games_left is not null
    and kid.penalty_games_left <= 0;

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

comment on function private.award_final_game(uuid) is
  'Pays a final game once. A home win pays two more bottlecaps and one less reputation than the stored win purse. An away win pays two fewer bottlecaps and one more reputation. A loss and a tie pay nothing. Packed items that name a reputation pay that amount on a played game either way. A forfeit adds the win and the loss, or a tie when both forfeit, and pays nothing, including that item reputation. A flat stretch ends on a played win, a strong line, or the last counted official game.';

create or replace function private.settle_due_game(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  boss uuid;
  home_full boolean;
  away_full boolean;
  which text;
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

  select exists (
    select 1
    from public.lineup_locks as locked
    where locked.game_id = game.id
      and locked.team_id = game.home_team_id
      and private.card_is_full(locked.card)
  )
  into home_full;

  select exists (
    select 1
    from public.lineup_locks as locked
    where locked.game_id = game.id
      and locked.team_id = game.away_team_id
      and private.card_is_full(locked.card)
  )
  into away_full;

  if not home_full or not away_full then
    which := case
      when not home_full and not away_full then 'both'
      when not home_full then 'home'
      else 'away'
    end;
    perform private.record_forfeit(target_game, which);
    perform private.award_final_game(target_game);
    perform private.resolve_tryouts(target_game);
    return;
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
    perform private.resolve_tryouts(target_game);
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
  'Freezes open cards and plays one due official game. An open nine is filled from the bench and the batting order. A club with fewer than nine kids forfeits. The other club wins and earns nothing. Both forfeits are a tie. Tryouts then stay or head home.';
