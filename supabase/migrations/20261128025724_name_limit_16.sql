-- New season and team names stop at 16 characters.
-- The table checks stay at 40 so a team already named with 19 characters
-- can still take a purse update. A changed name has to fit the new limit.

create function private.reject_long_club_name()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;
  if new.name is null
    or char_length(new.name) < 1
    or char_length(new.name) > 16
    or new.name !~ '^[A-Z0-9][A-Z0-9 .''-]{0,15}$'
  then
    raise exception 'USE 1 TO 16 LETTERS, NUMBERS, SPACES, OR . '' -';
  end if;
  return new;
end;
$func$;

comment on function private.reject_long_club_name() is
  'A new or renamed season or team is 1 to 16 letters, numbers, spaces, or . '' -. An unchanged longer name still saves.';

revoke all on function private.reject_long_club_name() from public, anon, authenticated, service_role;

create trigger seasons_name_limit
  before insert or update of name on public.seasons
  for each row
  execute function private.reject_long_club_name();

create trigger teams_name_limit
  before insert or update of name on public.teams
  for each row
  execute function private.reject_long_club_name();

create or replace function private.create_season(
  season_name text,
  weekdays integer[],
  practice_days integer,
  season_weeks integer,
  rounds integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
  rules public.game_settings;
  cleaned text;
  cap integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  cleaned := upper(regexp_replace(btrim(coalesce(season_name, '')), '\s+', ' ', 'g'));
  if cleaned !~ '^[A-Z0-9][A-Z0-9 .'']{0,15}$' and cleaned !~ '^[A-Z0-9][A-Z0-9 .''-]{0,15}$' then
    raise exception 'USE 1 TO 16 LETTERS, NUMBERS, SPACES, OR . '' -';
  end if;
  if char_length(cleaned) < 1 or char_length(cleaned) > 16 then
    raise exception 'USE 1 TO 16 LETTERS, NUMBERS, SPACES, OR . '' -';
  end if;
  if not private.weekdays_ok(weekdays) then
    raise exception 'PICK AT LEAST ONE DAY';
  end if;
  if practice_days is null or practice_days < 1 or practice_days > 14 then
    raise exception 'PRACTICE DAYS MUST BE FROM 1 TO 14';
  end if;
  if season_weeks is null or season_weeks < 1 or season_weeks > 20 then
    raise exception 'WEEKS MUST BE FROM 1 TO 20';
  end if;

  rules := private.current_settings();
  cap := (rules.settings ->> 'default_roster_cap')::integer;
  if rounds is null or rounds < 1 or rounds > cap then
    raise exception 'DRAFT ROUNDS MUST FIT THE ROSTER';
  end if;

  insert into public.seasons (
    name,
    commissioner_id,
    status,
    official_weekdays,
    practice_every_days,
    weeks,
    draft_rounds,
    roster_cap,
    settings_version
  )
  values (
    cleaned,
    uid,
    'forming',
    (select array_agg(day order by day) from unnest(weekdays) as day),
    practice_days,
    season_weeks,
    rounds,
    cap,
    rules.version
  )
  returning id into new_id;

  return new_id;
end;
$func$;

create or replace function private.create_team(target_season uuid, team_name text)
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
  if cleaned !~ '^[A-Z0-9][A-Z0-9 .''-]{0,15}$' then
    raise exception 'USE 1 TO 16 LETTERS, NUMBERS, SPACES, OR . '' -';
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
