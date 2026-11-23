-- The coach on the clock claims one unassigned kid. The season stays drafting.

create function private.draft_pick(target_season uuid, target_player uuid)
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
end;
$func$;

comment on function private.draft_pick(uuid, uuid) is
  'The coach on the clock takes one unassigned kid. The roster cap and the clock are checked here.';

revoke all on function private.draft_pick(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.draft_pick(uuid, uuid) to authenticated;

create function public.draft_pick(season_id uuid, player_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.draft_pick(season_id, player_id);
$func$;

comment on function public.draft_pick(uuid, uuid) is
  'Signed-in coach on the clock drafts one kid from that season.';

revoke all on function public.draft_pick(uuid, uuid) from public, anon;
grant execute on function public.draft_pick(uuid, uuid) to authenticated;

alter publication supabase_realtime add table public.players (
  id,
  season_id,
  team_id,
  given_name,
  family_name,
  nickname,
  flavor,
  base_stats,
  tryout_status,
  penalty_until_game_id,
  experience,
  settings_version,
  created_at
);
