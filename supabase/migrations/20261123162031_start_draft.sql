-- The commissioner starts a snake draft. Picks come later.

create table public.draft_state (
  season_id uuid primary key references public.seasons (id) on delete cascade,
  pick_index integer not null,
  "order" uuid[] not null,
  rounds integer not null,
  constraint draft_state_pick_index check (
    pick_index >= 0
    and pick_index <= cardinality("order")
  ),
  constraint draft_state_rounds check (rounds >= 1),
  constraint draft_state_order_length check (
    cardinality("order") >= rounds * 2
    and cardinality("order") % rounds = 0
  )
);

comment on table public.draft_state is
  'One snake draft for a season. order is every pick. pick_index is whose turn it is, starting at 0.';

comment on column public.draft_state."order" is
  'Team ids already expanded into snake order. Round 1 follows the shuffle. Even rounds reverse it.';

comment on column public.draft_state.pick_index is
  'Zero-based index into order. Equal to the length means the draft is complete.';

alter table public.draft_state enable row level security;

revoke all on table public.draft_state from public, anon, authenticated, service_role;
grant select (season_id, pick_index, "order", rounds) on table public.draft_state to authenticated;

create policy draft_state_select
  on public.draft_state
  for select
  to authenticated
  using (true);

create function private.start_draft(target_season uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  found public.seasons;
  base uuid[];
  snake uuid[] := '{}'::uuid[];
  reversed uuid[];
  round_number integer;
  waiting integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into found
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if found.commissioner_id is distinct from uid then
    raise exception 'ONLY THE COMMISSIONER STARTS THE DRAFT';
  end if;
  if found.status <> 'forming' then
    raise exception 'START THE DRAFT WHILE THE SEASON IS FORMING';
  end if;
  if exists (select 1 from public.draft_state where season_id = target_season) then
    raise exception 'THE DRAFT HAS ALREADY STARTED';
  end if;

  select coalesce(array_agg(id order by random()), '{}'::uuid[])
  into base
  from public.teams
  where season_id = target_season;

  if cardinality(base) < 2 then
    raise exception 'NEED AT LEAST TWO TEAMS';
  end if;

  select count(*) into waiting
  from public.players
  where season_id = target_season
    and team_id is null;
  if waiting < 1 then
    raise exception 'CALL THE KIDS BEFORE THE DRAFT';
  end if;

  for round_number in 1..found.draft_rounds loop
    if round_number % 2 = 1 then
      snake := snake || base;
    else
      select coalesce(array_agg(team_id order by ord desc), '{}'::uuid[])
      into reversed
      from unnest(base) with ordinality as slot(team_id, ord);
      snake := snake || reversed;
    end if;
  end loop;

  if cardinality(snake) is distinct from found.draft_rounds * cardinality(base) then
    raise exception 'THE DRAFT ORDER IS NOT READY';
  end if;

  insert into public.draft_state (season_id, pick_index, "order", rounds)
  values (target_season, 0, snake, found.draft_rounds);

  update public.seasons
  set status = 'drafting'
  where id = target_season;
end;
$func$;

comment on function private.start_draft(uuid) is
  'Commissioner opens the snake draft. The check is in this procedure, not only in the screen.';

revoke all on function private.start_draft(uuid) from public, anon, authenticated, service_role;
grant execute on function private.start_draft(uuid) to authenticated;

create function public.start_draft(season_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.start_draft(season_id);
$func$;

comment on function public.start_draft(uuid) is
  'Signed-in commissioner starts the draft for a forming season.';

revoke all on function public.start_draft(uuid) from public, anon;
grant execute on function public.start_draft(uuid) to authenticated;

alter publication supabase_realtime add table public.draft_state;
