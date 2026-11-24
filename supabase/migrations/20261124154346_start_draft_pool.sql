create or replace function private.start_draft(target_season uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  found_season public.seasons;
  base uuid[];
  snake uuid[] := '{}'::uuid[];
  reversed uuid[];
  round_number integer;
  waiting integer;
  shortfall integer;
  batch integer;
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
    raise exception 'ONLY THE COMMISSIONER STARTS THE DRAFT';
  end if;
  if found_season.status <> 'forming' then
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
    and team_id is null
    and offer is null;

  shortfall := found_season.draft_rounds * cardinality(base) - waiting;
  while shortfall > 0 loop
    batch := least(shortfall, 40);
    perform private.generate_kids(target_season, batch, 'pool');
    shortfall := shortfall - batch;
  end loop;

  for round_number in 1..found_season.draft_rounds loop
    if round_number % 2 = 1 then
      snake := snake || base;
    else
      select coalesce(array_agg(team_id order by ord desc), '{}'::uuid[])
      into reversed
      from unnest(base) with ordinality as slot(team_id, ord);
      snake := snake || reversed;
    end if;
  end loop;

  if cardinality(snake) is distinct from found_season.draft_rounds * cardinality(base) then
    raise exception 'THE DRAFT ORDER IS NOT READY';
  end if;

  insert into public.draft_state (season_id, pick_index, "order", rounds)
  values (target_season, 0, snake, found_season.draft_rounds);

  update public.seasons
  set status = 'drafting'
  where id = target_season;
end;
$func$;

revoke all on function private.start_draft(uuid) from public, anon, authenticated, service_role;
grant execute on function private.start_draft(uuid) to authenticated;
