-- The official clock. When a game's start time has passed, freeze any open
-- card from the lineup saved on that team, play it, pay the winner, and
-- move the standings. A tie pays nothing. Practice games wait. Tryouts wait.
-- The screen has no play button. public.play_game_now still plays a locked
-- game for the commissioner, and it pays through the same award.

create table private.game_awards (
  game_id uuid primary key references public.games (id) on delete cascade,
  awarded_at timestamptz not null default now()
);

comment on table private.game_awards is
  'One row once a final game has paid the purse and the standings. A second pass leaves both alone.';

alter table private.game_awards enable row level security;

revoke all on table private.game_awards from public, anon, authenticated, service_role;

create index games_due_idx
  on public.games (starts_at, id)
  where status = 'scheduled' and is_practice = false;

comment on index public.games_due_idx is
  'Official games the clock still has to play, in start order.';

comment on table public.standings is
  'Wins and losses for one team. The official clock adds a win and a loss when a game has a winner. A tie leaves the row alone.';

-- Both sides freeze together. Players lock in id order, then the two teams
-- in id order, then the game. A coach locking one side uses that same order,
-- so the two waits cannot deadlock. An open side copies the lineup saved on
-- the team. A side that is already locked is left as the coach locked it.

create function private.freeze_open_card(target_game uuid)
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
      from public.lineup_locks
      where game_id = target_game
        and team_id = side_id
    ) then
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
  'Copies each open card from the lineup saved on that team. A locked card stays. Hidden stats go to the private secret. No coach check: only the clock calls this.';

revoke all on function private.freeze_open_card(uuid) from public, anon, authenticated, service_role;

-- Packed copies are not stored with a team_items id. The first rows in
-- bought_at, id order are the ones the card froze. A count of 1 is deleted
-- so the 1-to-3 check stays honest. A later buy is past that count.

create function private.spend_packed(target_game uuid, target_team uuid)
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
    select packed.id, packed.remaining_games
    from public.team_items as packed
    where packed.team_id = target_team
    order by packed.bought_at, packed.id
    limit packed_n
    for update
  loop
    if row.remaining_games <= 1 then
      delete from public.team_items as packed
      where packed.id = row.id;
    else
      update public.team_items as packed
      set remaining_games = packed.remaining_games - 1
      where packed.id = row.id;
    end if;
  end loop;
end;
$func$;

comment on function private.spend_packed(uuid, uuid) is
  'Uses up the packed items frozen on one card. Deletes a row that would hit zero games.';

revoke all on function private.spend_packed(uuid, uuid) from public, anon, authenticated, service_role;

create function private.award_final_game(target_game uuid)
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

comment on function private.award_final_game(uuid) is
  'Pays the winner from that game''s rules, adds the win and the loss, spends packed items, and clears a met penalty. A tie leaves the purse and the standings. Tryout flags stay. A second call pays nothing.';

revoke all on function private.award_final_game(uuid) from public, anon, authenticated, service_role;

create or replace function public.play_game_now(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  played jsonb;
begin
  played := private.simulate_game(game_id);
  perform private.narrate_game(game_id);
  perform private.award_final_game(game_id);
  return played;
end;
$func$;

comment on function public.play_game_now(uuid) is
  'The commissioner plays one locked game, stores the writeup, and pays the result. The screen has no button for this. The clock calls it when the start time has passed.';

revoke all on function public.play_game_now(uuid) from public, anon, service_role;
grant execute on function public.play_game_now(uuid) to authenticated;

-- The cron session has no coach signed in. The commissioner check inside
-- simulate_game reads the request JWT, so this sets that claim for the call
-- and clears it before anything else runs. Clients cannot call this function.

create function private.settle_due_game(target_game uuid)
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
  'Freezes open cards, plays one due official game as its commissioner, and pays the result. An unlocked side uses the lineup saved on the team.';

revoke all on function private.settle_due_game(uuid) from public, anon, authenticated, service_role;

create function private.process_due_games()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  gid uuid;
begin
  for gid in
    select games.id
    from public.games as games
    where games.status = 'scheduled'
      and games.is_practice = false
      and games.starts_at <= now()
    order by games.starts_at, games.id
  loop
    begin
      perform private.settle_due_game(gid);
    exception
      when others then
        raise warning 'OFFICIAL GAME % SKIPPED: %', gid, sqlerrm;
    end;
  end loop;
end;
$func$;

comment on function private.process_due_games() is
  'Plays every official game whose start time has passed. One game that cannot play waits for the next run and does not stop the others.';

revoke all on function private.process_due_games() from public, anon, authenticated, service_role;

do $unschedule$
declare
  id bigint;
begin
  select jobid into id
  from cron.job
  where jobname = 'backend_test_pick';

  if id is not null then
    perform cron.unschedule(id);
  end if;
end;
$unschedule$;

select cron.schedule(
  'official_games',
  '*/15 * * * *',
  $job$select private.process_due_games()$job$
);
