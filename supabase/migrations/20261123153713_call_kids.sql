-- Neighborhood kids for a forming season. Hidden stats stay off the API.

create function private.json_stats_ok(stats jsonb, expected text[])
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select stats is not null
    and (select count(*) from jsonb_object_keys(stats)) = cardinality(expected)
    and not exists (
      select 1
      from jsonb_each_text(stats) as item(key, value)
      where item.key <> all (expected)
        or item.value !~ '^[0-9]+$'
        or item.value::integer < 1
        or item.value::integer > 100
    );
$func$;

revoke all on function private.json_stats_ok(jsonb, text[]) from public, anon, authenticated, service_role;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id),
  team_id uuid references public.teams (id),
  given_name text not null,
  family_name text not null,
  nickname text,
  flavor text not null,
  base_stats jsonb not null,
  hidden_stats jsonb not null,
  tryout_status text,
  penalty_until_game_id uuid,
  experience integer not null default 0,
  settings_version integer not null references public.game_settings (version),
  created_at timestamptz not null default now(),
  constraint players_given_name check (given_name ~ '^[A-Z][A-Z''-]{0,23}$'),
  constraint players_family_name check (family_name ~ '^[A-Z][A-Z''-]{0,23}$'),
  constraint players_nickname check (nickname is null or nickname ~ '^[A-Z][A-Z''-]{0,23}$'),
  constraint players_flavor check (
    char_length(flavor) between 1 and 180
    and flavor = btrim(flavor)
    and flavor !~ '[0-9]'
  ),
  constraint players_base_stats check (private.json_stats_ok(
    base_stats,
    array['contact', 'power', 'eye', 'speed', 'glove', 'arm', 'stamina']
  )),
  constraint players_hidden_stats check (private.json_stats_ok(
    hidden_stats,
    array[
      'barrel_accuracy', 'swing_timing', 'two_strike_fight', 'soft_contact', 'consistency',
      'raw_strength', 'launch_tendency', 'backspin_carry',
      'strike_zone_judgment', 'pitch_recognition', 'patience', 'chase_discipline',
      'first_step', 'top_speed', 'slide_agility', 'baserunning_reads',
      'hands_softness', 'range_first_step', 'reaction', 'reliability',
      'arm_strength', 'accuracy', 'release_quickness', 'carry',
      'fade_resistance', 'late_game_energy', 'recovery', 'heat_weather_tolerance', 'focus_endurance'
    ]
  )),
  constraint players_tryout check (tryout_status is null or tryout_status = 'playing'),
  constraint players_experience check (experience >= 0)
);

comment on table public.players is
  'A kid in one season. base_stats is the seven visible ratings. hidden_stats is not granted to the API.';

comment on column public.players.hidden_stats is
  'Sub-ratings clustered on the visible stats. Authenticated and anon cannot select this column.';

comment on column public.players.penalty_until_game_id is
  'Reserved for a later game link. No games table yet, so this is a bare uuid.';

create index players_season_created_idx on public.players (season_id, created_at);
create index players_team_id_idx on public.players (team_id);
create index players_settings_version_idx on public.players (settings_version);

alter table public.players enable row level security;

revoke all on table public.players from public, anon, authenticated, service_role;
grant select (
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
) on table public.players to authenticated;

create policy players_select
  on public.players
  for select
  to authenticated
  using (true);

create table private.given_names (
  name text primary key
);

create table private.family_names (
  name text primary key
);

create table private.nicknames (
  name text primary key
);

comment on table private.given_names is
  'Curated given names for generated kids. Not exposed to the API.';

comment on table private.family_names is
  'Curated family names for generated kids. Not exposed to the API.';

comment on table private.nicknames is
  'Short nicknames. About 8 percent of kids get one.';

revoke all on table private.given_names from public, anon, authenticated, service_role;
revoke all on table private.family_names from public, anon, authenticated, service_role;
revoke all on table private.nicknames from public, anon, authenticated, service_role;

insert into private.given_names (name) values
  ('MAYA'), ('ELI'), ('NOAH'), ('LIAM'), ('LILA'), ('JAY'), ('SAM'), ('OWEN'), ('RIO'), ('LEO'),
  ('NIA'), ('AMIR'), ('SOFIA'), ('LUCA'), ('JULES'), ('MIA'), ('OTIS'), ('RUBY'), ('THEO'), ('IVY'),
  ('NICO'), ('ADA'), ('BEN'), ('CARA'), ('DIEGO'), ('EZRA'), ('FREYA'), ('GIO'), ('HANA'), ('IDRIS'),
  ('JIN'), ('KIRA'), ('LEN'), ('MATEO'), ('NORA'), ('OMAR'), ('PRIYA'), ('QUINN'), ('ROSA'), ('SASHA'),
  ('TARI'), ('UMA'), ('VAL'), ('WES'), ('YARA'), ('ZOE'), ('ANDRE'), ('BREE'), ('CAM'), ('DEV'),
  ('ELA'), ('FINN'), ('GRETA'), ('HUGH'), ('IMAN'), ('JO'), ('KENJI'), ('LARS'), ('MINA'), ('NATE'),
  ('OPAL'), ('PAZ'), ('REMY'), ('SOL'), ('TESS'), ('VIC'), ('WILLA'), ('YUSUF'), ('ARI'), ('NOVA'),
  ('KAI'), ('SAGE'), ('EARL'), ('DOT'), ('BUD'), ('VERN'), ('PEARL'), ('HANK'), ('LOU'), ('RUTH'),
  ('MAE'), ('NED'), ('CLYDE'), ('ARCHIE'), ('BESSIE'), ('GLADYS'), ('IRVING'), ('MYRTLE'), ('JUNE'), ('CAL');

insert into private.family_names (name) values
  ('CHEN'), ('DIAZ'), ('PARK'), ('SINGH'), ('OLSEN'), ('BAKER'), ('COSTA'), ('NOWAK'), ('ALI'), ('BERG'),
  ('CHO'), ('DALY'), ('FARAH'), ('FORD'), ('GARCIA'), ('HASSAN'), ('ITO'), ('JONES'), ('KIM'), ('LOPEZ'),
  ('MOSS'), ('NG'), ('OKONKWO'), ('PATEL'), ('REED'), ('SHAW'), ('TRAN'), ('UEDA'), ('VASQUEZ'), ('WALSH'),
  ('XU'), ('YOON'), ('ZAHIR'), ('ABBOTT'), ('BROOKS'), ('CARTER'), ('DELGADO'), ('ENG'), ('FARROW'), ('GOMEZ'),
  ('HART'), ('IVES'), ('JENSEN'), ('KOWALSKI'), ('LANE'), ('MENDEZ'), ('NASH'), ('ORTIZ'), ('PEREZ'), ('QURESHI'),
  ('RAMOS'), ('SILVA'), ('TORRES'), ('UNDERWOOD'), ('VARGAS'), ('WRIGHT'), ('YAMAMOTO'), ('ZIMMER'), ('ADEYEMI'), ('BIANCHI'),
  ('CROWE'), ('DUBOIS'), ('ELLIS'), ('FUENTES'), ('GREEN'), ('HOLT'), ('IBARRA'), ('JACOBS'), ('KLEIN'), ('MORALES'),
  ('NAKAMURA'), ('OCHOA'), ('PETROV'), ('RUIZ'), ('SANTOS'), ('TAHIR'), ('VELA'), ('WU'), ('YILMAZ'), ('BAUER');

insert into private.nicknames (name) values
  ('ACE'), ('BEAN'), ('BUG'), ('BUTTON'), ('CHIP'), ('CRICKET'), ('CUB'), ('DASH'), ('DOC'), ('NIB'),
  ('DUCK'), ('FLIP'), ('FROG'), ('GUS'), ('HAP'), ('HOP'), ('INK'), ('IZZY'), ('JET'), ('KIT'),
  ('LARK'), ('LUCKY'), ('MO'), ('PENNY'), ('PIP'), ('POCKET'), ('POP'), ('RED'), ('SCOOT'), ('SKIP'),
  ('SPARK'), ('SPROUT'), ('SUNNY'), ('TWIG'), ('WHIZ'), ('ZIP');

create function private.roll_stat(center numeric, spread numeric)
returns integer
language plpgsql
volatile
set search_path = ''
as $func$
declare
  draw numeric := random();
  z numeric;
  value integer;
begin
  if draw < 0.0000001 then
    draw := 0.0000001;
  end if;
  z := sqrt(-2 * ln(draw)) * cos(2 * pi() * random());
  value := round((center + z * spread)::numeric)::integer;
  if value < 1 then
    return 1;
  end if;
  if value > 100 then
    return 100;
  end if;
  return value;
end;
$func$;

revoke all on function private.roll_stat(numeric, numeric) from public, anon, authenticated, service_role;

create function private.kid_flavor(stats jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $func$
declare
  keys text[] := array['contact', 'power', 'eye', 'speed', 'glove', 'arm', 'stamina'];
  high_line text[] := array[
    'PUTS THE BAT ON ANYTHING NEAR THE PLATE',
    'CAN SEND ONE PAST THE FENCE WHEN THEY SQUARE IT',
    'LETS THE BAD ONES GO BY',
    'BEATS THE THROW MORE OFTEN THAN NOT',
    'GETS TO BALLS THE OTHERS WAVE AT',
    'THROWS ACROSS THE DIAMOND ON A LINE',
    'STILL RUNS HARD WHEN THE LIGHT GOES'
  ];
  low_line text[] := array[
    'MISSES MORE THAN THE OTHER KIDS',
    'HITS IT ON THE GROUND',
    'CHASES PITCHES IN THE DIRT',
    'IS THE LAST ONE DOWN THE LINE',
    'LETS A FEW HOP PAST',
    'THE THROW TAKES AN EXTRA HOP',
    'FADES ONCE THE SUN DROPS'
  ];
  high_at integer := 1;
  low_at integer := 1;
  high_value integer := -1;
  low_value integer := 101;
  slot integer;
  value integer;
begin
  for slot in 1..7 loop
    value := (stats ->> keys[slot])::integer;
    if value > high_value then
      high_value := value;
      high_at := slot;
    end if;
    if value < low_value then
      low_value := value;
      low_at := slot;
    end if;
  end loop;
  if high_value = low_value then
    return 'PLAYS ABOUT LIKE THE REST OF THE BLOCK.';
  end if;
  return high_line[high_at] || ', AND ' || low_line[low_at] || '.';
end;
$func$;

revoke all on function private.kid_flavor(jsonb) from public, anon, authenticated, service_role;

create function private.generate_kids(target_season uuid, kid_count integer, purpose text)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  found_season public.seasons;
  rules jsonb;
  spread numeric;
  hidden_spread numeric;
  existing integer;
  given text;
  family text;
  nick text;
  contact integer;
  power integer;
  eye integer;
  speed integer;
  glove integer;
  arm integer;
  stamina integer;
  stats jsonb;
begin
  if purpose is distinct from 'pool' then
    raise exception 'THAT CALL IS NOT READY';
  end if;
  if kid_count is null or kid_count < 1 or kid_count > 40 then
    raise exception 'CALL BETWEEN 1 AND 40 KIDS';
  end if;

  select * into found_season
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if found_season.status <> 'forming' then
    raise exception 'CALL THE KIDS WHILE THE SEASON IS FORMING';
  end if;

  select count(*) into existing
  from public.players
  where season_id = target_season;
  if existing + kid_count > 200 then
    raise exception 'THE BLOCK IS FULL OF KIDS';
  end if;

  select settings into rules
  from public.game_settings
  where version = found_season.settings_version;
  if rules is null or jsonb_typeof(rules -> 'initial_stat_variability') <> 'number' then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;
  spread := (rules ->> 'initial_stat_variability')::numeric;
  if spread < 0 or spread > 50 then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;
  hidden_spread := greatest(4, spread / 3);

  for _step in 1..kid_count loop
    select name into given from private.given_names order by random() limit 1;
    select name into family from private.family_names order by random() limit 1;
    if given is null or family is null then
      raise exception 'THE NAME LIST IS EMPTY';
    end if;
    nick := null;
    if random() < 0.08 then
      select name into nick from private.nicknames order by random() limit 1;
    end if;

    contact := private.roll_stat(50, spread);
    power := private.roll_stat(50, spread);
    eye := private.roll_stat(50, spread);
    speed := private.roll_stat(50, spread);
    glove := private.roll_stat(50, spread);
    arm := private.roll_stat(50, spread);
    stamina := private.roll_stat(50, spread);
    stats := jsonb_build_object(
      'contact', contact,
      'power', power,
      'eye', eye,
      'speed', speed,
      'glove', glove,
      'arm', arm,
      'stamina', stamina
    );

    insert into public.players (
      season_id,
      team_id,
      given_name,
      family_name,
      nickname,
      flavor,
      base_stats,
      hidden_stats,
      tryout_status,
      penalty_until_game_id,
      experience,
      settings_version
    )
    values (
      target_season,
      null,
      given,
      family,
      nick,
      private.kid_flavor(stats),
      stats,
      jsonb_build_object(
        'barrel_accuracy', private.roll_stat(contact, hidden_spread),
        'swing_timing', private.roll_stat(contact, hidden_spread),
        'two_strike_fight', private.roll_stat(contact, hidden_spread),
        'soft_contact', private.roll_stat(contact, hidden_spread),
        'consistency', private.roll_stat(contact, hidden_spread),
        'raw_strength', private.roll_stat(power, hidden_spread),
        'launch_tendency', private.roll_stat(power, hidden_spread),
        'backspin_carry', private.roll_stat(power, hidden_spread),
        'strike_zone_judgment', private.roll_stat(eye, hidden_spread),
        'pitch_recognition', private.roll_stat(eye, hidden_spread),
        'patience', private.roll_stat(eye, hidden_spread),
        'chase_discipline', private.roll_stat(eye, hidden_spread),
        'first_step', private.roll_stat(speed, hidden_spread),
        'top_speed', private.roll_stat(speed, hidden_spread),
        'slide_agility', private.roll_stat(speed, hidden_spread),
        'baserunning_reads', private.roll_stat(speed, hidden_spread),
        'hands_softness', private.roll_stat(glove, hidden_spread),
        'range_first_step', private.roll_stat(glove, hidden_spread),
        'reaction', private.roll_stat(glove, hidden_spread),
        'reliability', private.roll_stat(glove, hidden_spread),
        'arm_strength', private.roll_stat(arm, hidden_spread),
        'accuracy', private.roll_stat(arm, hidden_spread),
        'release_quickness', private.roll_stat(arm, hidden_spread),
        'carry', private.roll_stat(arm, hidden_spread),
        'fade_resistance', private.roll_stat(stamina, hidden_spread),
        'late_game_energy', private.roll_stat(stamina, hidden_spread),
        'recovery', private.roll_stat(stamina, hidden_spread),
        'heat_weather_tolerance', private.roll_stat(stamina, hidden_spread),
        'focus_endurance', private.roll_stat(stamina, hidden_spread)
      ),
      null,
      null,
      0,
      found_season.settings_version
    );
  end loop;

  return kid_count;
end;
$func$;

comment on function private.generate_kids(uuid, integer, text) is
  'Inserts neighborhood kids. purpose pool is the forming-season call. Hidden stats cluster on the matching visible stat.';

revoke all on function private.generate_kids(uuid, integer, text) from public, anon, authenticated, service_role;

create function private.call_kids(target_season uuid, kid_count integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  boss uuid;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select commissioner_id into boss
  from public.seasons
  where id = target_season;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if boss is distinct from uid then
    raise exception 'ONLY THE COMMISSIONER CALLS THE KIDS';
  end if;

  return private.generate_kids(target_season, kid_count, 'pool');
end;
$func$;

comment on function private.call_kids(uuid, integer) is
  'Commissioner calls kids into a forming season. The check is in this procedure, not only in the screen.';

revoke all on function private.call_kids(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.call_kids(uuid, integer) to authenticated;

create function public.call_kids(season_id uuid, kid_count integer)
returns integer
language sql
security invoker
set search_path = ''
as $func$
  select private.call_kids(season_id, kid_count);
$func$;

revoke all on function public.call_kids(uuid, integer) from public, anon;
grant execute on function public.call_kids(uuid, integer) to authenticated;

do $seed$
begin
  if (select count(*) from private.given_names) < 80
    or (select count(*) from private.family_names) < 60
    or (select count(*) from private.nicknames) < 24
  then
    raise exception 'THE NAME LIST IS SHORT';
  end if;
end;
$seed$;
