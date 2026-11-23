-- A coach locks only their next scheduled game. A later game stays open
-- because the roster, the packed items, and the penalties can still change.
-- The lock order is unchanged: players by id, then the team, then the game.

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
  'The coach on one side copies the nine and packed items for their next scheduled game into lineup_locks, and the hidden stats into the private secret. A later game is refused until that one is no longer scheduled. A second call is refused.';

revoke all on function private.lock_lineup(uuid) from public, anon, authenticated, service_role;
grant execute on function private.lock_lineup(uuid) to authenticated;

comment on function public.lock_lineup(uuid) is
  'Signed-in coach locks their card for their next scheduled game.';
