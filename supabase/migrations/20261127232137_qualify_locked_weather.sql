-- The locked weather is a variable with the same name as the column.
-- Qualify it so the save at the end of the game can see which one to write.

create or replace function private.simulate_game(target_game uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  game_id uuid;
  season_id uuid;
  home_id uuid;
  away_id uuid;
  game_status text;
  weather jsonb;
  seed bigint;
  settings_version integer;
  stored jsonb;
  boss uuid;
  away_name text;
  home_name text;
  away jsonb;
  home jsonb;
  strength numeric;
  sky text;
  wind text;
  heat text;
  contact_mul numeric := 1;
  power_mul numeric := 1;
  error_mul numeric := 1;
  hot_fade numeric := 0;
  ball_n integer := 0;
  ice_n integer := 0;
  has_field boolean := false;
  inning integer;
  pa integer := 0;
  away_bat integer := 0;
  home_bat integer := 0;
  away_runs integer := 0;
  home_runs integer := 0;
  away_hits integer := 0;
  home_hits integer := 0;
  away_errors integer := 0;
  home_errors integer := 0;
  innings jsonb := '[]'::jsonb;
  events jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  top jsonb;
  bot jsonb;
  built jsonb;
  half_away integer;
  half_home integer;
  winner text;
  kid jsonb;
  i integer;
  inning_away integer;
  inning_home integer;
  away_line_runs integer;
  home_line_runs integer;
  away_line_hits integer;
  home_line_hits integer;
  air jsonb;
  shift jsonb;
  shift_hit boolean := false;
  mods jsonb;
begin
  if uid is null then
    raise exception 'SIGN IN FIRST';
  end if;

  select
    games.id,
    games.season_id,
    games.home_team_id,
    games.away_team_id,
    games.status,
    games.weather,
    games.seed,
    games.settings_version,
    games.result
  into
    game_id,
    season_id,
    home_id,
    away_id,
    game_status,
    weather,
    seed,
    settings_version,
    stored
  from public.games as games
  where games.id = target_game
  for update;

  if game_id is null then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  select seasons.commissioner_id
  into boss
  from public.seasons as seasons
  where seasons.id = season_id;

  if boss is distinct from uid then
    raise exception 'ONLY THE COMMISSIONER PLAYS THIS ONE';
  end if;

  if game_status = 'final' and stored is not null then
    return stored;
  end if;

  if game_status is distinct from 'scheduled' then
    raise exception 'THE GAME HAS ALREADY BEEN PLAYED';
  end if;

  if (
    select count(*)
    from public.lineup_locks as locks
    where locks.game_id = target_game
      and locks.team_id in (away_id, home_id)
  ) < 2 then
    raise exception 'THE CARD IS NOT LOCKED';
  end if;

  select (settings ->> 'weather_effect_strength')::numeric
  into strength
  from public.game_settings as settings
  where settings.version = settings_version;

  if strength is null then
    raise exception 'THE RULES ARE NOT HERE';
  end if;

  select teams.name into away_name from public.teams as teams where teams.id = away_id;
  select teams.name into home_name from public.teams as teams where teams.id = home_id;
  away_name := coalesce(nullif(btrim(away_name), ''), 'TEAM');
  home_name := coalesce(nullif(btrim(home_name), ''), 'TEAM');

  away := private.load_side(target_game, away_id);
  home := private.load_side(target_game, home_id);

  weather := private.realize_weather(weather, seed);
  air := weather -> 'opening';
  shift := weather -> 'shift';
  select
    count(*) filter (where item -> 'effect' ->> 'kind' = 'baseballs'),
    count(*) filter (where item -> 'effect' ->> 'kind' = 'ice_pops'),
    coalesce(bool_or(item -> 'effect' ->> 'kind' = 'field'), false)
  into ball_n, ice_n, has_field
  from public.lineup_locks as locks
  cross join lateral jsonb_array_elements(locks.card -> 'items') as packed(item)
  where locks.game_id = target_game
    and locks.team_id in (away_id, home_id);

  for inning in 1..12 loop
    if jsonb_typeof(shift) = 'object'
      and not shift_hit
      and (shift ->> 'inning')::integer = inning
      and shift ->> 'half' = 'top'
    then
      air := shift;
      shift_hit := true;
    end if;
    mods := private.weather_mods(
      air ->> 'sky',
      air ->> 'wind',
      coalesce(air ->> 'wind_speed', 'calm'),
      air ->> 'heat',
      strength,
      coalesce(ball_n, 0),
      coalesce(ice_n, 0),
      coalesce(has_field, false)
    );
    contact_mul := (mods ->> 'contact_mul')::numeric;
    power_mul := (mods ->> 'power_mul')::numeric;
    error_mul := (mods ->> 'error_mul')::numeric;
    hot_fade := (mods ->> 'hot_fade')::numeric;
    sky := mods ->> 'sky';
    wind := mods ->> 'wind';
    top := private.play_half(jsonb_build_object(
      'seed', seed,
      'pa', pa,
      'inning', inning,
      'half', 'top',
      'lineup', away,
      'fielding', home,
      'bat', away_bat,
      'team_runs', away_runs,
      'other_runs', home_runs,
      'walkoff', false,
      'contact_mul', contact_mul,
      'power_mul', power_mul,
      'error_mul', error_mul,
      'hot_fade', hot_fade,
      'sky', sky,
      'wind', wind,
      'strength', strength
    ));
    away := top -> 'lineup';
    home := top -> 'fielding';
    half_away := (top ->> 'half_runs')::integer;
    away_runs := away_runs + half_away;
    away_hits := away_hits + (top ->> 'half_hits')::integer;
    away_errors := away_errors + (top ->> 'half_errors')::integer;
    away_bat := (top ->> 'bat')::integer;
    pa := (top ->> 'pa')::integer;
    events := events || coalesce(top -> 'events', '[]'::jsonb);

    if inning >= 9 and home_runs > away_runs then
      innings := innings || jsonb_build_array(jsonb_build_object(
        'inning', inning,
        'away', half_away,
        'home', null
      ));
      exit;
    end if;

    if jsonb_typeof(shift) = 'object'
      and not shift_hit
      and (shift ->> 'inning')::integer = inning
      and shift ->> 'half' = 'bottom'
    then
      air := shift;
      shift_hit := true;
    end if;
    mods := private.weather_mods(
      air ->> 'sky',
      air ->> 'wind',
      coalesce(air ->> 'wind_speed', 'calm'),
      air ->> 'heat',
      strength,
      coalesce(ball_n, 0),
      coalesce(ice_n, 0),
      coalesce(has_field, false)
    );
    contact_mul := (mods ->> 'contact_mul')::numeric;
    power_mul := (mods ->> 'power_mul')::numeric;
    error_mul := (mods ->> 'error_mul')::numeric;
    hot_fade := (mods ->> 'hot_fade')::numeric;
    sky := mods ->> 'sky';
    wind := mods ->> 'wind';
    bot := private.play_half(jsonb_build_object(
      'seed', seed,
      'pa', pa,
      'inning', inning,
      'half', 'bottom',
      'lineup', home,
      'fielding', away,
      'bat', home_bat,
      'team_runs', home_runs,
      'other_runs', away_runs,
      'walkoff', inning >= 9,
      'contact_mul', contact_mul,
      'power_mul', power_mul,
      'error_mul', error_mul,
      'hot_fade', hot_fade,
      'sky', sky,
      'wind', wind,
      'strength', strength
    ));
    home := bot -> 'lineup';
    away := bot -> 'fielding';
    half_home := (bot ->> 'half_runs')::integer;
    home_runs := home_runs + half_home;
    home_hits := home_hits + (bot ->> 'half_hits')::integer;
    home_errors := home_errors + (bot ->> 'half_errors')::integer;
    home_bat := (bot ->> 'bat')::integer;
    pa := (bot ->> 'pa')::integer;
    events := events || coalesce(bot -> 'events', '[]'::jsonb);
    innings := innings || jsonb_build_array(jsonb_build_object(
      'inning', inning,
      'away', half_away,
      'home', half_home
    ));

    if inning >= 9 and away_runs <> home_runs then
      exit;
    end if;
  end loop;

  if not shift_hit then
    weather := (weather - 'shift') || jsonb_build_object('shift', null);
  end if;

  for i in 0..coalesce(jsonb_array_length(away), 0) - 1 loop
    kid := away -> i;
    lines := lines || jsonb_build_array(private.line_from(kid, away_id));
  end loop;
  for i in 0..coalesce(jsonb_array_length(home), 0) - 1 loop
    kid := home -> i;
    lines := lines || jsonb_build_array(private.line_from(kid, home_id));
  end loop;

  winner := case
    when home_runs > away_runs then 'home'
    when away_runs > home_runs then 'away'
    else 'tie'
  end;

  built := jsonb_build_object(
    'innings', innings,
    'away', jsonb_build_object(
      'team_id', away_id,
      'name', away_name,
      'runs', away_runs,
      'hits', away_hits,
      'errors', away_errors
    ),
    'home', jsonb_build_object(
      'team_id', home_id,
      'name', home_name,
      'runs', home_runs,
      'hits', home_hits,
      'errors', home_errors
    ),
    'winner', winner,
    'lines', lines,
    'events', events
  );

  select coalesce(sum((inn ->> 'away')::integer), 0)
  into inning_away
  from jsonb_array_elements(innings) as inn;

  select coalesce(sum(
    case
      when jsonb_typeof(inn -> 'home') = 'number' then (inn ->> 'home')::integer
      else 0
    end
  ), 0)
  into inning_home
  from jsonb_array_elements(innings) as inn;

  select
    coalesce(sum((ln ->> 'r')::integer) filter (where ln ->> 'team_id' = away_id::text), 0),
    coalesce(sum((ln ->> 'r')::integer) filter (where ln ->> 'team_id' = home_id::text), 0),
    coalesce(sum((ln ->> 'h')::integer) filter (where ln ->> 'team_id' = away_id::text), 0),
    coalesce(sum((ln ->> 'h')::integer) filter (where ln ->> 'team_id' = home_id::text), 0)
  into away_line_runs, home_line_runs, away_line_hits, home_line_hits
  from jsonb_array_elements(lines) as ln;

  if inning_away <> away_runs
    or inning_home <> home_runs
    or away_line_runs <> away_runs
    or home_line_runs <> home_runs
    or away_line_hits <> away_hits
    or home_line_hits <> home_hits
    or exists (
      select 1
      from jsonb_array_elements(lines) as ln
      where (ln ->> 'ab')::integer < 0
        or (ln ->> 'h')::integer < 0
        or (ln ->> 'r')::integer < 0
        or (ln ->> 'rbi')::integer < 0
        or (ln ->> 'bb')::integer < 0
        or (ln ->> 'k')::integer < 0
        or (ln ->> 'outs')::integer < 0
        or (ln ->> 'h')::integer > (ln ->> 'ab')::integer
    )
  then
    raise exception 'THE BOOKS DO NOT BALANCE';
  end if;

  -- Phase 15 owns the purse, the standings, packed-item counts, and removing this button.
  update public.games as games
  set status = 'final',
      result = built,
      weather = simulate_game.weather
  where games.id = target_game;

  return built;
end;
$func$;

comment on function private.simulate_game(uuid) is
  'Plays a scheduled game from the lock snapshot and the seed. The opening weather locks here and may change at one later top or bottom. A final game returns the stored result.';
