-- Public seasons. Creating one copies the current roster cap and rules version.
create function private.weekdays_ok(days integer[])
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select days is not null
    and cardinality(days) between 1 and 7
    and not exists (
      select 1
      from unnest(days) as day
      where day < 0 or day > 6
    )
    and cardinality(days) = (select count(distinct day) from unnest(days) as day)
$func$;

revoke all on function private.weekdays_ok(integer[]) from public, anon, authenticated, service_role;

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commissioner_id uuid not null references public.profiles (id),
  status text not null default 'forming',
  official_weekdays integer[] not null,
  practice_every_days integer not null,
  weeks integer not null,
  draft_rounds integer not null,
  roster_cap integer not null,
  settings_version integer not null references public.game_settings (version),
  created_at timestamptz not null default now(),
  constraint seasons_name_trimmed check (
    char_length(name) between 1 and 40
    and name = btrim(name)
  ),
  constraint seasons_status check (status in ('forming', 'drafting', 'active', 'completed')),
  constraint seasons_weekdays check (private.weekdays_ok(official_weekdays)),
  constraint seasons_practice check (practice_every_days between 1 and 14),
  constraint seasons_weeks check (weeks between 1 and 20),
  constraint seasons_rounds check (draft_rounds between 1 and roster_cap)
);

comment on table public.seasons is
  'One public season. roster_cap and settings_version are copied at creation and do not follow later rule changes.';

create index seasons_commissioner_id_idx on public.seasons (commissioner_id);
create index seasons_settings_version_idx on public.seasons (settings_version);

alter table public.seasons enable row level security;

revoke all on table public.seasons from public, anon, authenticated, service_role;
grant select (
  id,
  name,
  commissioner_id,
  status,
  official_weekdays,
  practice_every_days,
  weeks,
  draft_rounds,
  roster_cap,
  settings_version,
  created_at
) on table public.seasons to authenticated;

create policy seasons_select
  on public.seasons
  for select
  to authenticated
  using (true);

create function private.create_season(
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
  if cleaned !~ '^[A-Z0-9][A-Z0-9 .'']{0,39}$' and cleaned !~ '^[A-Z0-9][A-Z0-9 .''-]{0,39}$' then
    raise exception 'USE 1 TO 40 LETTERS, NUMBERS, SPACES, OR . '' -';
  end if;
  if char_length(cleaned) < 1 or char_length(cleaned) > 40 then
    raise exception 'USE 1 TO 40 LETTERS, NUMBERS, SPACES, OR . '' -';
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

revoke all on function private.create_season(text, integer[], integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.create_season(text, integer[], integer, integer, integer) to authenticated;

create function public.create_season(
  season_name text,
  official_weekdays integer[],
  practice_every_days integer,
  weeks integer,
  draft_rounds integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $func$
  select private.create_season(
    season_name,
    official_weekdays,
    practice_every_days,
    weeks,
    draft_rounds
  );
$func$;

revoke all on function public.create_season(text, integer[], integer, integer, integer) from public, anon;
grant execute on function public.create_season(text, integer[], integer, integer, integer) to authenticated;
