-- The nine-slot card saved on a team. Empty slots have no row.
-- Other coaches may read a card once games exist. public.games does not
-- exist yet, so the read policy stays owner-only and must not name that table.

create table public.lineups (
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  slot smallint not null,
  primary key (team_id, slot),
  unique (team_id, player_id),
  constraint lineups_slot check (slot between 1 and 9)
);

comment on table public.lineups is
  'Nine labeled slots on a team. Any kid can sit in any slot, once. Empty slots have no row.';

create index lineups_player_id_idx on public.lineups (player_id);

alter table public.lineups enable row level security;

revoke all on table public.lineups from public, anon, authenticated, service_role;
grant select (team_id, player_id, slot) on table public.lineups to authenticated;

create policy lineups_select
  on public.lineups
  for select
  to authenticated
  using (
    team_id in (
      select id
      from public.teams
      where coach_id = (select auth.uid())
    )
  );

-- Replaces private.release_player so a released kid leaves the card.
-- Lock order stays player, then team, matching set_lineup.

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

  -- Official games do not exist yet. Once they do, a status other than
  -- scheduled or final means that game is in the middle of a run.
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

  update public.players
  set team_id = null
  where id = target_player
    and team_id = kid.team_id;
  if not found then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  delete from public.lineups
  where player_id = target_player;
end;
$func$;

comment on function private.release_player(uuid) is
  'The kid''s coach clears team_id and drops that kid from the lineup. Stats stay. A live official game blocks the cut.';

create function private.set_lineup(target_team uuid, slots jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owner uuid;
  item record;
  raw text;
  chosen uuid;
  picked uuid[] := '{}'::uuid[];
  slot_list integer[] := '{}'::integer[];
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  if slots is null or jsonb_typeof(slots) <> 'object' then
    raise exception 'THE LINEUP IS NOT READY';
  end if;

  for item in
    select entry.key, entry.value
    from jsonb_each(slots) as entry
  loop
    if item.key !~ '^[1-9]$' then
      raise exception 'THAT SLOT IS NOT ON THE CARD';
    end if;
    if jsonb_typeof(item.value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(item.value) <> 'string' then
      raise exception 'THE LINEUP IS NOT READY';
    end if;
    raw := btrim(item.value #>> '{}');
    if raw = '' then
      continue;
    end if;
    begin
      chosen := raw::uuid;
    exception
      when invalid_text_representation then
        raise exception 'THE LINEUP IS NOT READY';
    end;
    if chosen = any (picked) then
      raise exception 'THAT KID IS ALREADY IN THE LINEUP';
    end if;
    picked := picked || chosen;
    slot_list := slot_list || item.key::integer;
  end loop;

  -- Players before the team. release_player locks the player, then the team.
  if cardinality(picked) > 0 then
    perform 1
    from public.players
    where id = any (picked)
    order by id
    for update;
  end if;

  select coach_id into owner
  from public.teams
  where id = target_team
  for update;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if owner is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  if (
    select count(*)
    from public.players
    where id = any (picked)
      and team_id = target_team
  ) is distinct from cardinality(picked) then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  delete from public.lineups
  where team_id = target_team;

  insert into public.lineups (team_id, player_id, slot)
  select target_team, picked[i], slot_list[i]
  from generate_subscripts(picked, 1) as i;
end;
$func$;

comment on function private.set_lineup(uuid, jsonb) is
  'The owning coach replaces the whole card. Keys are "1" through "9". A null or blank value leaves that slot empty.';

revoke all on function private.set_lineup(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.set_lineup(uuid, jsonb) to authenticated;

create function public.set_lineup(team_id uuid, slots jsonb)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.set_lineup(team_id, slots);
$func$;

comment on function public.set_lineup(uuid, jsonb) is
  'Signed-in coach saves the nine-slot card on their own team.';

revoke all on function public.set_lineup(uuid, jsonb) from public, anon;
grant execute on function public.set_lineup(uuid, jsonb) to authenticated;
