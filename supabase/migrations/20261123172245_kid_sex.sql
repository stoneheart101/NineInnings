-- Each kid is marked M or F from the given name. The draft header shows that letter.

alter table private.given_names add column sex text;

update private.given_names as names
set sex = listed.sex
from (values
  ('MAYA', 'F'),
  ('ELI', 'M'),
  ('NOAH', 'M'),
  ('LIAM', 'M'),
  ('LILA', 'F'),
  ('JAY', 'M'),
  ('SAM', 'M'),
  ('OWEN', 'M'),
  ('RIO', 'M'),
  ('LEO', 'M'),
  ('NIA', 'F'),
  ('AMIR', 'M'),
  ('SOFIA', 'F'),
  ('LUCA', 'M'),
  ('JULES', 'M'),
  ('MIA', 'F'),
  ('OTIS', 'M'),
  ('RUBY', 'F'),
  ('THEO', 'M'),
  ('IVY', 'F'),
  ('NICO', 'M'),
  ('ADA', 'F'),
  ('BEN', 'M'),
  ('CARA', 'F'),
  ('DIEGO', 'M'),
  ('EZRA', 'M'),
  ('FREYA', 'F'),
  ('GIO', 'M'),
  ('HANA', 'F'),
  ('IDRIS', 'M'),
  ('JIN', 'M'),
  ('KIRA', 'F'),
  ('LEN', 'M'),
  ('MATEO', 'M'),
  ('NORA', 'F'),
  ('OMAR', 'M'),
  ('PRIYA', 'F'),
  ('QUINN', 'F'),
  ('ROSA', 'F'),
  ('SASHA', 'F'),
  ('TARI', 'M'),
  ('UMA', 'F'),
  ('VAL', 'M'),
  ('WES', 'M'),
  ('YARA', 'F'),
  ('ZOE', 'F'),
  ('ANDRE', 'M'),
  ('BREE', 'F'),
  ('CAM', 'M'),
  ('DEV', 'M'),
  ('ELA', 'F'),
  ('FINN', 'M'),
  ('GRETA', 'F'),
  ('HUGH', 'M'),
  ('IMAN', 'F'),
  ('JO', 'F'),
  ('KENJI', 'M'),
  ('LARS', 'M'),
  ('MINA', 'F'),
  ('NATE', 'M'),
  ('OPAL', 'F'),
  ('PAZ', 'F'),
  ('REMY', 'M'),
  ('SOL', 'M'),
  ('TESS', 'F'),
  ('VIC', 'M'),
  ('WILLA', 'F'),
  ('YUSUF', 'M'),
  ('ARI', 'M'),
  ('NOVA', 'F'),
  ('KAI', 'M'),
  ('SAGE', 'F'),
  ('EARL', 'M'),
  ('DOT', 'F'),
  ('BUD', 'M'),
  ('VERN', 'M'),
  ('PEARL', 'F'),
  ('HANK', 'M'),
  ('LOU', 'M'),
  ('RUTH', 'F'),
  ('MAE', 'F'),
  ('NED', 'M'),
  ('CLYDE', 'M'),
  ('ARCHIE', 'M'),
  ('BESSIE', 'F'),
  ('GLADYS', 'F'),
  ('IRVING', 'M'),
  ('MYRTLE', 'F'),
  ('JUNE', 'F'),
  ('CAL', 'M')
) as listed(name, sex)
where names.name = listed.name;

do $check$
begin
  if exists (select 1 from private.given_names where sex is null)
    or exists (
      select 1 from private.given_names where sex not in ('M', 'F')
    )
    or (select count(*) from private.given_names) <> 90
  then
    raise exception 'A GIVEN NAME HAS NO SEX';
  end if;
end;
$check$;

alter table private.given_names alter column sex set not null;
alter table private.given_names add constraint given_names_sex check (sex in ('M', 'F'));

comment on column private.given_names.sex is
  'M or F. Generated kids copy this so the letter matches the given name.';

alter table public.players add column sex text;

update public.players as kids
set sex = names.sex
from private.given_names as names
where names.name = kids.given_name
  and kids.sex is null;

do $check$
begin
  if exists (select 1 from public.players where sex is null) then
    raise exception 'A KID HAS NO SEX';
  end if;
end;
$check$;

alter table public.players alter column sex set not null;
alter table public.players add constraint players_sex check (sex in ('M', 'F'));

comment on column public.players.sex is
  'M or F, copied from the given name. Shown on the draft card. Not a hidden stat.';

grant select (sex) on table public.players to authenticated;

create or replace function private.generate_kids(target_season uuid, kid_count integer, purpose text)
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
  kid_sex text;
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
    select name, sex into given, kid_sex from private.given_names order by random() limit 1;
    select name into family from private.family_names order by random() limit 1;
    if given is null or family is null or kid_sex is null then
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
      sex,
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
      kid_sex,
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
  'Inserts neighborhood kids. purpose pool is the forming-season call. Sex comes from the given name. Hidden stats cluster on the matching visible stat.';

alter publication supabase_realtime drop table public.players;
alter publication supabase_realtime add table public.players (
  id,
  season_id,
  team_id,
  given_name,
  family_name,
  nickname,
  sex,
  flavor,
  base_stats,
  tryout_status,
  penalty_until_game_id,
  experience,
  settings_version,
  created_at
);
