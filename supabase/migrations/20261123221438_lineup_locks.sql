-- The card frozen for one game. The public row holds names, slots, and packed
-- items. Hidden stats stay in private.lineup_lock_secrets. This table is not
-- in the realtime publication: a replica would send the card.

create table public.lineup_locks (
  game_id uuid not null references public.games (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  locked_at timestamptz not null default now(),
  card jsonb not null,
  primary key (game_id, team_id),
  constraint lineup_locks_card_shape check (
    jsonb_typeof(card -> 'slots') = 'array'
    and jsonb_array_length(card -> 'slots') = 9
    and jsonb_typeof(card -> 'items') = 'array'
    and not (card ? 'hidden_stats')
  )
);

comment on table public.lineup_locks is
  'One team''s card for one game. A second lock is refused. The simulator reads this snapshot, not the live roster.';

comment on column public.lineup_locks.card is
  'Nine slots plus packed items. Names and visible stats only. Hidden stats are not in this column. Not granted to the client.';

comment on column public.lineup_locks.locked_at is
  'When this team locked. Other coaches can see that a lock exists and cannot see the nine.';

alter table public.lineup_locks enable row level security;

revoke all on table public.lineup_locks from public, anon, authenticated, service_role;
grant select (game_id, team_id, locked_at) on table public.lineup_locks to authenticated;

create policy lineup_locks_select
  on public.lineup_locks
  for select
  to authenticated
  using (true);

create table private.lineup_lock_secrets (
  game_id uuid not null,
  team_id uuid not null,
  kids jsonb not null,
  primary key (game_id, team_id),
  constraint lineup_lock_secrets_lock
    foreign key (game_id, team_id)
    references public.lineup_locks (game_id, team_id)
    on delete cascade,
  constraint lineup_lock_secrets_kids check (jsonb_typeof(kids) = 'array')
);

comment on table private.lineup_lock_secrets is
  'Hidden stats, tryout status, and penalty flags frozen with a lineup lock. One object per slotted kid.';

comment on column private.lineup_lock_secrets.kids is
  'player_id, slot, base_stats, hidden_stats, tryout_status, and penalty_until_game_id. Empty when the locked card has no kids.';

alter table private.lineup_lock_secrets enable row level security;

revoke all on table private.lineup_lock_secrets from public, anon, authenticated, service_role;

-- Lock order stays clear of set_lineup and release_player, which lock the
-- chosen players by id and then the team. buy_item and play_ball lock the
-- team and do not then wait on a player.
-- 1. Read the lineup's player ids. Lock those players in id order. Read again.
--    If the set changed, raise THE LINEUP CHANGED. Do not lock the new ids in
--    this transaction: a later id held here while a lower id is wanted would
--    deadlock with a lock that walks ids in order.
-- 2. Lock the team. Read the lineup again. If it changed, raise THE LINEUP
--    CHANGED. Do not lock the new players while the team lock is held.
-- 3. Lock the game. Recheck that it is scheduled and that this team has no lock.
-- 4. Read packed items after the team lock, then write the card and the secret.

create function private.lock_lineup(target_game uuid)
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
  'The coach on one side copies the nine and packed items into lineup_locks, and the hidden stats into the private secret. A second call is refused.';

revoke all on function private.lock_lineup(uuid) from public, anon, authenticated, service_role;
grant execute on function private.lock_lineup(uuid) to authenticated;

create function public.lock_lineup(game_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $func$
  select private.lock_lineup(game_id);
$func$;

comment on function public.lock_lineup(uuid) is
  'Signed-in coach locks their card for one scheduled game they are playing.';

revoke all on function public.lock_lineup(uuid) from public, anon;
grant execute on function public.lock_lineup(uuid) to authenticated;

create function private.own_locked_card(target_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  snapshot jsonb;
begin
  if uid is null then
    return null;
  end if;

  select locks.card
  into snapshot
  from public.lineup_locks as locks
  join public.teams as team on team.id = locks.team_id
  where locks.game_id = target_game
    and team.coach_id = uid;

  return snapshot;
end;
$func$;

comment on function private.own_locked_card(uuid) is
  'The caller''s locked card for one game, or null when they have not locked. Other coaches'' nines stay unread.';

revoke all on function private.own_locked_card(uuid) from public, anon, authenticated, service_role;
grant execute on function private.own_locked_card(uuid) to authenticated;

create function public.own_locked_card(game_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $func$
  select private.own_locked_card(game_id);
$func$;

comment on function public.own_locked_card(uuid) is
  'Signed-in coach reads the nine they locked for one game.';

revoke all on function public.own_locked_card(uuid) from public, anon;
grant execute on function public.own_locked_card(uuid) to authenticated;
