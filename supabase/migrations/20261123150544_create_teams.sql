-- A coach names one team in a forming season. The purse is copied from that season's rules.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id),
  coach_id uuid not null references public.profiles (id),
  name text not null,
  bottlecaps integer not null,
  reputation integer not null,
  settings_version integer not null references public.game_settings (version),
  created_at timestamptz not null default now(),
  constraint teams_name_trimmed check (
    char_length(name) between 1 and 40
    and name = btrim(name)
  ),
  constraint teams_purse check (bottlecaps >= 0 and reputation >= 0),
  constraint teams_one_coach unique (season_id, coach_id)
);

comment on table public.teams is
  'One coach''s team in one season. bottlecaps and reputation are copied from that season''s settings version.';

create unique index teams_season_name_lower_idx on public.teams (season_id, lower(name));
create index teams_coach_id_idx on public.teams (coach_id);
create index teams_settings_version_idx on public.teams (settings_version);

alter table public.teams enable row level security;

revoke all on table public.teams from public, anon, authenticated, service_role;
grant select (
  id,
  season_id,
  coach_id,
  name,
  bottlecaps,
  reputation,
  settings_version,
  created_at
) on table public.teams to authenticated;

create policy teams_select
  on public.teams
  for select
  to authenticated
  using (true);

create function private.create_team(target_season uuid, team_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  found_season public.seasons;
  rules jsonb;
  cleaned text;
  caps integer;
  rep integer;
  new_id uuid;
  violated text;
  message text;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  cleaned := upper(regexp_replace(btrim(coalesce(team_name, '')), '\s+', ' ', 'g'));
  if cleaned !~ '^[A-Z0-9][A-Z0-9 .''-]{0,39}$' then
    raise exception 'USE 1 TO 40 LETTERS, NUMBERS, SPACES, OR . '' -';
  end if;

  select * into found_season
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if found_season.status <> 'forming' then
    raise exception 'TEAMS JOIN WHILE THE SEASON IS FORMING';
  end if;

  if exists (
    select 1 from public.teams
    where season_id = target_season and coach_id = uid
  ) then
    raise exception 'YOU ALREADY HAVE A TEAM IN THIS SEASON';
  end if;
  if exists (
    select 1 from public.teams
    where season_id = target_season and lower(name) = lower(cleaned)
  ) then
    raise exception 'THAT TEAM NAME IS TAKEN';
  end if;

  select settings into rules
  from public.game_settings
  where version = found_season.settings_version;

  if rules is null
    or rules ->> 'starting_bottlecaps' !~ '^[0-9]+$'
    or rules ->> 'starting_reputation' !~ '^[0-9]+$'
  then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;
  caps := (rules ->> 'starting_bottlecaps')::integer;
  rep := (rules ->> 'starting_reputation')::integer;

  insert into public.teams (
    season_id,
    coach_id,
    name,
    bottlecaps,
    reputation,
    settings_version
  )
  values (
    target_season,
    uid,
    cleaned,
    caps,
    rep,
    found_season.settings_version
  )
  returning id into new_id;

  return new_id;
exception
  when unique_violation then
    get stacked diagnostics violated = constraint_name, message = message_text;
    if violated = 'teams_one_coach' or message like '%teams_one_coach%' then
      raise exception 'YOU ALREADY HAVE A TEAM IN THIS SEASON';
    end if;
    raise exception 'THAT TEAM NAME IS TAKEN';
end;
$func$;

comment on function private.create_team(uuid, text) is
  'Names the signed-in coach''s only team in a forming season and copies that season''s starting purse.';

revoke all on function private.create_team(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.create_team(uuid, text) to authenticated;

create function public.create_team(season_id uuid, team_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $func$
  select private.create_team(season_id, team_name);
$func$;

revoke all on function public.create_team(uuid, text) from public, anon;
grant execute on function public.create_team(uuid, text) to authenticated;
