-- A day's air is shared. The next day drifts from it. A game keeps a forecast
-- until it is played, then the opening air locks and may change once, at the
-- top or the bottom of a later inning.

create function private.band_temp(heat text, roll numeric)
returns integer
language sql
immutable
set search_path = ''
as $func$
  select case heat
    when 'cold' then 38 + floor(roll * 11)::integer
    when 'cool' then 49 + floor(roll * 10)::integer
    when 'mild' then 59 + floor(roll * 14)::integer
    when 'warm' then 73 + floor(roll * 10)::integer
    when 'hot' then 83 + floor(roll * 12)::integer
    else 65
  end;
$func$;

create function private.clamp_temp(heat text, temp integer)
returns integer
language sql
immutable
set search_path = ''
as $func$
  select least(
    case heat
      when 'cold' then 48
      when 'cool' then 58
      when 'mild' then 72
      when 'warm' then 82
      when 'hot' then 94
      else 72
    end,
    greatest(
      case heat
        when 'cold' then 38
        when 'cool' then 49
        when 'mild' then 59
        when 'warm' then 73
        when 'hot' then 83
        else 59
      end,
      temp
    )
  );
$func$;

create function private.sky_rank(sky text)
returns integer
language sql
immutable
set search_path = ''
as $func$
  select case sky
    when 'clear' then 0
    when 'partly' then 1
    when 'cloudy' then 2
    when 'fog' then 2
    when 'light_rain' then 3
    when 'heavy_rain' then 4
    else 0
  end;
$func$;

create function private.heat_rank(heat text)
returns integer
language sql
immutable
set search_path = ''
as $func$
  select case heat
    when 'cold' then 0
    when 'cool' then 1
    when 'mild' then 2
    when 'warm' then 3
    when 'hot' then 4
    else 2
  end;
$func$;

create function private.wind_rank(speed text)
returns integer
language sql
immutable
set search_path = ''
as $func$
  select case speed
    when 'breeze' then 1
    when 'wind' then 2
    else 0
  end;
$func$;

create function private.sky_phrase(sky text)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case sky
    when 'clear' then 'CLEAR'
    when 'partly' then 'PARTLY CLOUDY'
    when 'cloudy' then 'MOSTLY CLOUDY'
    when 'light_rain' then 'LIGHT RAIN'
    when 'heavy_rain' then 'HEAVY RAIN'
    when 'fog' then 'FOGGY'
    else 'FAIR'
  end;
$func$;

create function private.heat_phrase(heat text)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case heat
    when 'cold' then 'COLD'
    when 'cool' then 'COOL'
    when 'mild' then 'MILD'
    when 'warm' then 'WARM'
    when 'hot' then 'HOT'
    else 'MILD'
  end;
$func$;

create function private.wind_phrase(wind text, speed text)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case
    when wind is null or wind = 'calm' or speed is null or speed = 'calm' then 'AND THE AIR IS STILL'
    when wind = 'in' and speed = 'breeze' then 'WITH A LIGHT BREEZE BLOWING IN'
    when wind = 'out' and speed = 'breeze' then 'WITH A LIGHT BREEZE BLOWING OUT'
    when wind = 'cross' and speed = 'breeze' then 'WITH A LIGHT BREEZE ACROSS THE DIAMOND'
    when wind = 'in' then 'WITH A STEADY WIND BLOWING IN'
    when wind = 'out' then 'WITH A STEADY WIND BLOWING OUT'
    else 'WITH A STEADY WIND ACROSS THE DIAMOND'
  end;
$func$;

create function private.inning_name(inning integer)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case inning
    when 1 then 'FIRST'
    when 2 then 'SECOND'
    when 3 then 'THIRD'
    when 4 then 'FOURTH'
    when 5 then 'FIFTH'
    when 6 then 'SIXTH'
    when 7 then 'SEVENTH'
    when 8 then 'EIGHTH'
    when 9 then 'NINTH'
    when 10 then 'TENTH'
    when 11 then 'ELEVENTH'
    when 12 then 'TWELFTH'
    else 'EXTRA'
  end;
$func$;

create function private.air_fair(state jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select state ->> 'sky' = 'clear'
    and state ->> 'wind' = 'calm'
    and state ->> 'heat' = 'mild';
$func$;

create function private.air_step(state jsonb, axis text, direction integer, roll numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  sky text := coalesce(state ->> 'sky', 'clear');
  wind text := coalesce(state ->> 'wind', 'calm');
  wind_speed text := coalesce(state ->> 'wind_speed', 'calm');
  heat text := coalesce(state ->> 'heat', 'mild');
  temp integer := coalesce((state ->> 'temp')::integer, private.band_temp('mild', 0.5));
  skies text[] := array['clear', 'partly', 'cloudy', 'light_rain', 'heavy_rain'];
  heats text[] := array['cold', 'cool', 'mild', 'warm', 'hot'];
  idx integer;
  pick integer;
begin
  if axis = 'sky' then
    if sky = 'fog' then
      if direction > 0 then
        sky := 'light_rain';
      elsif direction < 0 then
        sky := 'cloudy';
      end if;
    else
      idx := array_position(skies, sky);
      if idx is null then
        idx := 1;
      end if;
      if direction > 0 and sky = 'cloudy' and roll < 0.35 then
        sky := 'fog';
      else
        idx := least(5, greatest(1, idx + direction));
        sky := skies[idx];
      end if;
    end if;
  elsif axis = 'heat' then
    idx := array_position(heats, heat);
    if idx is null then
      idx := 3;
    end if;
    pick := least(5, greatest(1, idx + direction));
    if pick <> idx then
      heat := heats[pick];
      temp := private.band_temp(heat, roll);
    end if;
  elsif axis = 'wind' then
    if direction > 0 then
      if wind = 'calm' or wind_speed = 'calm' then
        wind := case
          when roll < 0.34 then 'in'
          when roll < 0.67 then 'out'
          else 'cross'
        end;
        wind_speed := 'breeze';
      elsif wind_speed = 'breeze' then
        wind_speed := 'wind';
      end if;
    elsif direction < 0 then
      if wind_speed = 'wind' then
        wind_speed := 'breeze';
      else
        wind := 'calm';
        wind_speed := 'calm';
      end if;
    end if;
  elsif axis = 'turn' and wind <> 'calm' then
    wind := case wind
      when 'in' then 'out'
      when 'out' then 'cross'
      else 'in'
    end;
  end if;

  if wind = 'calm' then
    wind_speed := 'calm';
  elsif wind_speed = 'calm' then
    wind_speed := 'breeze';
  end if;

  return jsonb_build_object(
    'sky', sky,
    'wind', wind,
    'wind_speed', wind_speed,
    'heat', heat,
    'temp', temp
  );
end;
$func$;

create function private.forecast_report(state jsonb)
returns text
language sql
immutable
set search_path = ''
as $func$
  select 'FROM THE WEATHER DESK. THIS ONE LOOKS '
    || private.sky_phrase(state ->> 'sky')
    || ' AND '
    || private.heat_phrase(state ->> 'heat')
    || ', ABOUT '
    || (state ->> 'temp')
    || ' DEGREES, '
    || private.wind_phrase(state ->> 'wind', state ->> 'wind_speed')
    || '.';
$func$;

create function private.miss_line(opening jsonb, forecast jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $func$
declare
  notes text[] := '{}';
  fsky text := forecast ->> 'sky';
  osky text := opening ->> 'sky';
  fheat integer := private.heat_rank(forecast ->> 'heat');
  oheat integer := private.heat_rank(opening ->> 'heat');
  fwind integer := private.wind_rank(forecast ->> 'wind_speed');
  owind integer := private.wind_rank(opening ->> 'wind_speed');
begin
  if fsky in ('light_rain', 'heavy_rain') and osky not in ('light_rain', 'heavy_rain') then
    notes := array_append(notes, 'THE RAIN HELD OFF.');
  elsif osky in ('light_rain', 'heavy_rain') and fsky not in ('light_rain', 'heavy_rain') then
    notes := array_append(notes, 'THE RAIN MOVED IN.');
  elsif osky = 'fog' and fsky is distinct from 'fog' then
    notes := array_append(notes, 'FOG SETTLED IN.');
  elsif fsky = 'fog' and osky is distinct from 'fog' then
    notes := array_append(notes, 'THE FOG LIFTED.');
  elsif private.sky_rank(osky) > private.sky_rank(fsky) then
    notes := array_append(notes, 'THE SKY IS HEAVIER THAN WE CALLED.');
  elsif private.sky_rank(osky) < private.sky_rank(fsky) then
    notes := array_append(notes, 'THE SKY IS FAIRER THAN WE CALLED.');
  end if;

  if oheat < fheat then
    notes := array_append(notes, 'IT IS A LITTLE COOLER THAN WE CALLED.');
  elsif oheat > fheat then
    notes := array_append(notes, 'IT IS A LITTLE WARMER THAN WE CALLED.');
  end if;

  if cardinality(notes) < 2 then
    if owind > fwind then
      notes := array_append(notes, 'THE BREEZE PICKED UP.');
    elsif owind < fwind then
      notes := array_append(notes, 'THE WIND EASED OFF.');
    elsif opening ->> 'wind' is distinct from forecast ->> 'wind'
      and coalesce(opening ->> 'wind', 'calm') <> 'calm'
      and coalesce(forecast ->> 'wind', 'calm') <> 'calm'
    then
      notes := array_append(notes, 'THE WIND TURNED.');
    end if;
  end if;

  if cardinality(notes) = 0 then
    return 'IT IS ABOUT WHAT WE CALLED.';
  end if;
  return notes[1] || case when cardinality(notes) > 1 then ' ' || notes[2] else '' end;
end;
$func$;

create function private.opening_report(opening jsonb, forecast jsonb)
returns text
language sql
immutable
set search_path = ''
as $func$
  select 'LIVE FROM THE PARK. '
    || private.sky_phrase(opening ->> 'sky')
    || ' AND '
    || private.heat_phrase(opening ->> 'heat')
    || ', '
    || (opening ->> 'temp')
    || ' DEGREES, '
    || private.wind_phrase(opening ->> 'wind', opening ->> 'wind_speed')
    || '. '
    || private.miss_line(opening, forecast);
$func$;

create function private.shift_change(before_air jsonb, after_air jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $func$
declare
  bsky text := before_air ->> 'sky';
  asky text := after_air ->> 'sky';
begin
  if asky = 'light_rain' and bsky not in ('light_rain', 'heavy_rain') then
    return 'A LIGHT RAIN HAS STARTED.';
  elsif asky = 'heavy_rain' and bsky is distinct from 'heavy_rain' then
    return 'THE RAIN IS COMING DOWN HARD.';
  elsif bsky in ('light_rain', 'heavy_rain') and asky not in ('light_rain', 'heavy_rain') then
    return 'THE RAIN HAS LET UP.';
  elsif asky = 'fog' and bsky is distinct from 'fog' then
    return 'FOG HAS ROLLED IN.';
  elsif bsky = 'fog' and asky is distinct from 'fog' then
    return 'THE FOG HAS LIFTED.';
  elsif private.sky_rank(asky) < private.sky_rank(bsky) then
    return 'THE SKY IS OPENING UP.';
  elsif private.sky_rank(asky) > private.sky_rank(bsky) then
    return 'THE CLOUDS HAVE THICKENED.';
  elsif private.heat_rank(after_air ->> 'heat') < private.heat_rank(before_air ->> 'heat') then
    return 'THE AIR HAS TURNED COOLER.';
  elsif private.heat_rank(after_air ->> 'heat') > private.heat_rank(before_air ->> 'heat') then
    return 'THE AIR HAS TURNED WARMER.';
  elsif private.wind_rank(after_air ->> 'wind_speed') > private.wind_rank(before_air ->> 'wind_speed') then
    return 'THE BREEZE HAS PICKED UP.';
  elsif private.wind_rank(after_air ->> 'wind_speed') < private.wind_rank(before_air ->> 'wind_speed') then
    return 'THE WIND HAS EASED.';
  elsif after_air ->> 'wind' is distinct from before_air ->> 'wind' then
    return 'THE WIND HAS TURNED.';
  else
    return 'THE AIR HAS SHIFTED.';
  end if;
end;
$func$;

create function private.shift_report(before_air jsonb, after_air jsonb, inning integer, half text)
returns text
language sql
immutable
set search_path = ''
as $func$
  select 'WE BREAK IN FROM THE '
    || case when half = 'bottom' then 'BOTTOM' else 'TOP' end
    || ' OF THE '
    || private.inning_name(inning)
    || '. '
    || private.shift_change(before_air, after_air)
    || ' '
    || (after_air ->> 'temp')
    || ' DEGREES, '
    || private.wind_phrase(after_air ->> 'wind', after_air ->> 'wind_speed')
    || '.';
$func$;

create function private.advance_air(state jsonb, variability numeric, day_index integer, season_seed bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  spread numeric := least(greatest(coalesce(variability, 0), 0), 1);
  gate numeric;
  axis_roll numeric;
  dir_roll numeric;
  side numeric;
  axis text;
  direction integer;
  jumps integer;
  idx integer;
begin
  if spread = 0 then
    return state;
  end if;

  gate := private.weather_draw(season_seed, 1000 + day_index * 5);
  axis_roll := private.weather_draw(season_seed, 1000 + day_index * 5 + 1);
  dir_roll := private.weather_draw(season_seed, 1000 + day_index * 5 + 2);
  side := private.weather_draw(season_seed, 1000 + day_index * 5 + 3);

  if private.air_fair(state) and gate < spread * 0.45 then
    if axis_roll < 0.50 then
      jumps := case when side < 0.70 then 1 else 2 end;
      state := private.air_step(state, 'sky', 1, side);
      if jumps = 2 then
        state := private.air_step(state, 'sky', 1, side);
      end if;
    elsif axis_roll < 0.75 then
      state := private.air_step(state, 'heat', case when side < 0.5 then 1 else -1 end, side);
    else
      state := private.air_step(state, 'wind', 1, side);
    end if;
    return state;
  end if;

  if not private.air_fair(state) and gate < (1 - spread) * 0.45 then
    return jsonb_build_object(
      'sky', 'clear',
      'wind', 'calm',
      'wind_speed', 'calm',
      'heat', 'mild',
      'temp', private.band_temp('mild', side)
    );
  end if;

  if not private.air_fair(state) and dir_roll < 0.70 then
    axis := case
      when axis_roll < 0.55 then 'sky'
      when axis_roll < 0.75 then 'heat'
      else 'wind'
    end;
    direction := 1;
    if axis = 'sky' then
      idx := private.sky_rank(state ->> 'sky');
      if idx >= 3 then
        direction := case when side < 0.5 then 1 else -1 end;
      end if;
    elsif axis = 'heat' then
      direction := case when side < 0.5 then 1 else -1 end;
    elsif state ->> 'wind' <> 'calm' and side < 0.18 then
      axis := 'turn';
    elsif state ->> 'wind_speed' = 'wind' then
      direction := -1;
    end if;
    return private.air_step(state, axis, direction, side);
  end if;

  return state;
end;
$func$;

create function private.day_air(season_id uuid, day date, variability numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  origin date := date '2026-01-01';
  cursor_day date;
  base_seed bigint;
  state jsonb;
  day_index integer := 0;
begin
  if day is null or day < origin then
    day := origin;
  elsif day > origin + 5000 then
    day := origin + 5000;
  end if;

  base_seed := ('x' || substr(md5(season_id::text || ':weather'), 1, 15))::bit(60)::bigint;
  state := jsonb_build_object(
    'sky', 'clear',
    'wind', 'calm',
    'wind_speed', 'calm',
    'heat', 'mild',
    'temp', private.band_temp('mild', private.weather_draw(base_seed, 1))
  );
  cursor_day := origin;
  while cursor_day <= day loop
    state := private.advance_air(state, variability, day_index, base_seed);
    day_index := day_index + 1;
    cursor_day := cursor_day + 1;
  end loop;
  return state;
end;
$func$;

create function private.legacy_air(weather jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  sky text := coalesce(weather ->> 'sky', 'clear');
  wind text := coalesce(weather ->> 'wind', 'calm');
  heat text := coalesce(weather ->> 'heat', 'mild');
  speed text;
  state jsonb;
begin
  if sky not in ('clear', 'partly', 'cloudy', 'light_rain', 'heavy_rain', 'fog') then
    sky := 'clear';
  end if;
  if wind not in ('calm', 'in', 'out', 'cross') then
    wind := 'calm';
  end if;
  if heat not in ('cold', 'cool', 'mild', 'warm', 'hot') then
    heat := 'mild';
  end if;
  speed := case when wind = 'calm' then 'calm' else 'wind' end;
  state := jsonb_build_object(
    'sky', sky,
    'wind', wind,
    'wind_speed', speed,
    'heat', heat,
    'temp', private.band_temp(heat, 0.5)
  );
  return state || jsonb_build_object('report', private.forecast_report(state));
end;
$func$;

create function private.forecast_weather(season_id uuid, starts_at timestamptz, seed bigint, variability numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  day date := (starts_at at time zone 'utc')::date;
  state jsonb;
  roll numeric;
  axis_roll numeric;
  axis text;
  direction integer;
begin
  if seed is null then
    raise exception 'THE FORECAST HAS NO SEED';
  end if;
  state := private.day_air(season_id, day, variability);
  if private.weather_draw(seed, 40) < 0.25 then
    roll := private.weather_draw(seed, 41);
    axis_roll := private.weather_draw(seed, 42);
    axis := case
      when axis_roll < 0.34 then 'sky'
      when axis_roll < 0.67 then 'heat'
      else 'wind'
    end;
    direction := case when roll < 0.5 then -1 else 1 end;
    if axis = 'sky' and state ->> 'sky' = 'clear' and direction < 0 then
      direction := 1;
    end if;
    if axis = 'wind' and state ->> 'wind' = 'calm' and direction < 0 then
      direction := 1;
    end if;
    state := private.air_step(state, axis, direction, roll);
  end if;
  state := state || jsonb_build_object('report', private.forecast_report(state));
  return jsonb_build_object(
    'forecast', state,
    'opening', null,
    'shift', null
  );
end;
$func$;

create function private.realize_weather(weather jsonb, seed bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  forecast jsonb;
  opening jsonb;
  changed jsonb;
  shift jsonb := 'null'::jsonb;
  r numeric;
  side numeric;
  steps integer;
  axis_n integer;
  pass integer;
  axis text;
  direction integer;
  temp integer;
  slot integer;
  inning integer;
  half text;
begin
  if seed is null then
    raise exception 'THE FORECAST HAS NO SEED';
  end if;
  if jsonb_typeof(weather -> 'opening') = 'object' then
    return weather;
  end if;
  if jsonb_typeof(weather -> 'forecast') = 'object' then
    forecast := weather -> 'forecast';
  else
    forecast := private.legacy_air(weather);
  end if;
  opening := forecast - 'report';

  for axis_n in 1..3 loop
    axis := case axis_n when 1 then 'sky' when 2 then 'heat' else 'wind' end;
    r := private.weather_draw(seed, 69 + axis_n);
    steps := case when r < 0.70 then 0 when r < 0.95 then 1 else 2 end;
    if steps > 0 then
      side := private.weather_draw(seed, 73 + axis_n);
      direction := case
        when axis = 'sky' and opening ->> 'sky' = 'clear' then 1
        when axis = 'heat' and opening ->> 'heat' = 'mild' then case when side < 0.5 then 1 else -1 end
        when axis = 'wind' and opening ->> 'wind' = 'calm' then 1
        when side < 0.65 then -1
        else 1
      end;
      for pass in 1..steps loop
        opening := private.air_step(opening, axis, direction, side);
      end loop;
    end if;
  end loop;

  if opening ->> 'heat' = forecast ->> 'heat' then
    temp := private.clamp_temp(
      opening ->> 'heat',
      coalesce((forecast ->> 'temp')::integer, 65) + floor(private.weather_draw(seed, 78) * 9)::integer - 4
    );
    opening := jsonb_set(opening, '{temp}', to_jsonb(temp));
  end if;

  opening := opening || jsonb_build_object('report', private.opening_report(opening, forecast));

  if private.weather_draw(seed, 80) < (1.0 / 3.0) then
    slot := floor(private.weather_draw(seed, 81) * 23)::integer;
    if slot = 0 then
      inning := 1;
      half := 'bottom';
    else
      inning := 2 + (slot - 1) / 2;
      half := case when ((slot - 1) % 2) = 0 then 'top' else 'bottom' end;
    end if;
    side := private.weather_draw(seed, 82);
    r := private.weather_draw(seed, 83);
    axis := case
      when r < 0.40 then 'sky'
      when r < 0.70 then 'heat'
      else 'wind'
    end;
    direction := case
      when axis = 'sky' and opening ->> 'sky' in ('clear', 'partly') then 1
      when axis = 'sky' and opening ->> 'sky' in ('heavy_rain') then -1
      when side < 0.5 then -1
      else 1
    end;
    if axis = 'wind' and opening ->> 'wind' <> 'calm' and side < 0.15 then
      axis := 'turn';
    end if;
    changed := private.air_step(opening, axis, direction, side);
    if changed ->> 'sky' = opening ->> 'sky'
      and changed ->> 'heat' = opening ->> 'heat'
      and changed ->> 'wind' = opening ->> 'wind'
      and changed ->> 'wind_speed' = opening ->> 'wind_speed'
    then
      changed := private.air_step(opening, 'sky', 1, side);
    end if;
    shift := changed || jsonb_build_object(
      'inning', inning,
      'half', half,
      'report', private.shift_report(opening, changed, inning, half)
    );
  end if;

  return jsonb_build_object(
    'forecast', forecast,
    'opening', opening,
    'shift', shift
  );
end;
$func$;

create function private.weather_mods(
  sky text,
  wind text,
  wind_speed text,
  heat text,
  strength numeric,
  ball_n integer,
  ice_n integer,
  has_field boolean
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  contact_mul numeric := 1;
  power_mul numeric := 1;
  error_mul numeric := 1;
  hot_fade numeric := 0;
  scale numeric := case wind_speed when 'breeze' then 0.5 when 'wind' then 1 else 0 end;
  play_wind text := case when scale > 0 then coalesce(wind, 'calm') else 'calm' end;
begin
  if sky = 'partly' then
    contact_mul := 1 - 0.02 * strength;
  elsif sky = 'cloudy' then
    contact_mul := 1 - 0.04 * strength;
  elsif sky = 'light_rain' then
    contact_mul := 1 - 0.08 * strength;
    error_mul := 1 + 0.35 * strength;
  elsif sky = 'heavy_rain' then
    contact_mul := 1 - 0.16 * strength;
    error_mul := 1 + 0.60 * strength;
  elsif sky = 'fog' then
    contact_mul := 1 - 0.10 * strength;
  end if;
  if heat = 'cold' then
    power_mul := 1 - 0.12 * strength;
  elsif heat = 'cool' then
    power_mul := 1 - 0.06 * strength;
  elsif heat = 'warm' then
    hot_fade := 0.05 * strength;
  elsif heat = 'hot' then
    hot_fade := 0.10 * strength;
  end if;
  if wind = 'in' and scale > 0 then
    power_mul := power_mul * (1 - 0.15 * strength * scale);
  elsif wind = 'out' and scale > 0 then
    power_mul := power_mul * (1 + 0.18 * strength * scale);
  end if;
  if has_field and sky in ('light_rain', 'heavy_rain') then
    contact_mul := 1 - (1 - contact_mul) * 0.5;
    error_mul := 1 + (error_mul - 1) * 0.5;
  end if;
  if ball_n > 0 then
    error_mul := error_mul * power(0.75, ball_n);
  end if;
  if ice_n > 0 and hot_fade > 0 then
    hot_fade := hot_fade * power(0.5, ice_n);
  end if;
  contact_mul := least(1.25, greatest(0.45, contact_mul));
  power_mul := least(1.60, greatest(0.45, power_mul));
  error_mul := least(2.5, greatest(0.35, error_mul));
  hot_fade := least(0.35, greatest(0, hot_fade));
  return jsonb_build_object(
    'contact_mul', contact_mul,
    'power_mul', power_mul,
    'error_mul', error_mul,
    'hot_fade', hot_fade,
    'sky', coalesce(sky, 'clear'),
    'wind', play_wind
  );
end;
$func$;

create function private.air_ok(state jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select jsonb_typeof(state) = 'object'
    and state ->> 'sky' in ('clear', 'partly', 'cloudy', 'light_rain', 'heavy_rain', 'fog')
    and state ->> 'wind' in ('calm', 'in', 'out', 'cross')
    and state ->> 'wind_speed' in ('calm', 'breeze', 'wind')
    and state ->> 'heat' in ('cold', 'cool', 'mild', 'warm', 'hot')
    and (state ->> 'temp') ~ '^[0-9]+$'
    and (state ->> 'temp')::integer between 30 and 110
    and (
      (state ->> 'wind' = 'calm' and state ->> 'wind_speed' = 'calm')
      or (state ->> 'wind' <> 'calm' and state ->> 'wind_speed' in ('breeze', 'wind'))
    );
$func$;

create function private.weather_row_ok(weather jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $func$
  select weather is not null and (
    (
      weather ->> 'sky' in ('clear', 'light_rain', 'heavy_rain', 'fog')
      and weather ->> 'wind' in ('calm', 'in', 'out', 'cross')
      and weather ->> 'heat' in ('mild', 'hot', 'cold')
      and char_length(weather ->> 'sentence') between 1 and 80
      and not (weather ? 'forecast')
    )
    or (
      private.air_ok(weather -> 'forecast')
      and char_length(weather -> 'forecast' ->> 'report') between 1 and 400
      and (
        weather -> 'opening' is null
        or jsonb_typeof(weather -> 'opening') = 'null'
        or (
          private.air_ok(weather -> 'opening')
          and char_length(weather -> 'opening' ->> 'report') between 1 and 400
        )
      )
      and (
        weather -> 'shift' is null
        or jsonb_typeof(weather -> 'shift') = 'null'
        or (
          private.air_ok(weather -> 'shift')
          and (weather -> 'shift' ->> 'inning') ~ '^[0-9]+$'
          and (weather -> 'shift' ->> 'inning')::integer between 1 and 12
          and weather -> 'shift' ->> 'half' in ('top', 'bottom')
          and not (
            (weather -> 'shift' ->> 'inning')::integer = 1
            and weather -> 'shift' ->> 'half' = 'top'
          )
          and char_length(weather -> 'shift' ->> 'report') between 1 and 400
        )
      )
    )
  );
$func$;

revoke all on function private.band_temp(text, numeric) from public, anon, authenticated, service_role;
revoke all on function private.clamp_temp(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.sky_rank(text) from public, anon, authenticated, service_role;
revoke all on function private.heat_rank(text) from public, anon, authenticated, service_role;
revoke all on function private.wind_rank(text) from public, anon, authenticated, service_role;
revoke all on function private.sky_phrase(text) from public, anon, authenticated, service_role;
revoke all on function private.heat_phrase(text) from public, anon, authenticated, service_role;
revoke all on function private.wind_phrase(text, text) from public, anon, authenticated, service_role;
revoke all on function private.inning_name(integer) from public, anon, authenticated, service_role;
revoke all on function private.air_fair(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.air_step(jsonb, text, integer, numeric) from public, anon, authenticated, service_role;
revoke all on function private.forecast_report(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.miss_line(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.opening_report(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.shift_change(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.shift_report(jsonb, jsonb, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.advance_air(jsonb, numeric, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function private.day_air(uuid, date, numeric) from public, anon, authenticated, service_role;
revoke all on function private.legacy_air(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.forecast_weather(uuid, timestamptz, bigint, numeric) from public, anon, authenticated, service_role;
revoke all on function private.realize_weather(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function private.weather_mods(text, text, text, text, numeric, integer, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function private.air_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.weather_row_ok(jsonb) from public, anon, authenticated, service_role;

alter table public.games drop constraint games_weather_shape;
alter table public.games
  add constraint games_weather_shape check (private.weather_row_ok(weather));

create function private.games_set_forecast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  variability numeric;
begin
  if new.weather ? 'forecast' then
    return new;
  end if;
  select (settings ->> 'weather_variability')::numeric
  into variability
  from public.game_settings as settings
  where settings.version = new.settings_version;
  if variability is null then
    raise exception 'THE RULES ARE NOT HERE';
  end if;
  new.weather := private.forecast_weather(new.season_id, new.starts_at, new.seed, variability);
  return new;
end;
$func$;

revoke all on function private.games_set_forecast() from public, anon, authenticated, service_role;

create trigger games_set_forecast
  before insert on public.games
  for each row
  execute function private.games_set_forecast();

update public.games as game
set weather = private.forecast_weather(
  game.season_id,
  game.starts_at,
  game.seed,
  (settings.settings ->> 'weather_variability')::numeric
)
from public.game_settings as settings
where settings.version = game.settings_version
  and game.status = 'scheduled';

comment on column public.games.weather is
  'A forecast until the game is played. The opening air then locks, and it may change once at the top or the bottom of a later inning. Both coaches read the same desk report.';
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
      weather = weather
  where games.id = target_game;

  return built;
end;
$func$;

create or replace function private.narrate_game(target_game uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $func$
declare
  game_id uuid;
  weather jsonb;
  seed bigint;
  settings_version integer;
  stored jsonb;
  written text;
  density numeric;
  away_name text;
  home_name text;
  away_runs integer;
  home_runs integer;
  winner text;
  sentence text;
  score_line text;
  score_pick integer;
  weather_pick integer;
  margin_pick integer;
  margin_line text;
  primary_tag text;
  tag_times integer;
  again_line text;
  close_lines text[] := '{}'::text[];
  color_lines text[];
  paras text[] := '{}'::text[];
  flavor_lines text[] := '{}'::text[];
  tag_count integer := 0;
  want integer := 0;
  hit_name text;
  hit_n integer;
  rbi_name text;
  rbi_n integer;
  mound_name text;
  mound_n integer;
  scrub text;
  banned text[] := array[
    'barrel_accuracy', 'swing_timing', 'two_strike_fight', 'soft_contact',
    'raw_strength', 'launch_tendency', 'backspin_carry', 'consistency',
    'strike_zone_judgment', 'pitch_recognition', 'patience', 'chase_discipline',
    'first_step', 'top_speed', 'slide_agility', 'fade_resistance',
    'baserunning_reads', 'hands_softness', 'range_first_step', 'reaction',
    'reliability', 'arm_strength', 'accuracy', 'release_quickness', 'carry',
    'late_game_energy', 'recovery', 'heat_weather_tolerance', 'focus_endurance',
    'fog_lost', 'late_fade', 'awkward_slide', 'penalty_effort', 'tryout_spark',
    'wind_carried', 'rain_misplay', 'hidden_stats'
  ];
  word text;
  kid_name text;
begin
  select
    games.id,
    games.weather,
    games.seed,
    games.settings_version,
    games.result,
    games.narrative
  into
    game_id,
    weather,
    seed,
    settings_version,
    stored,
    written
  from public.games as games
  where games.id = target_game
  for update;

  if game_id is null then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  if written is not null and btrim(written) <> '' then
    return written;
  end if;

  if stored is null then
    raise exception 'THE GAME HAS NOT BEEN PLAYED';
  end if;

  select (settings.settings ->> 'narrative_flavor_density')::numeric
  into density
  from public.game_settings as settings
  where settings.version = settings_version;

  if density is null then
    raise exception 'THE RULES ARE NOT HERE';
  end if;
  density := least(1, greatest(0, density));

  away_name := upper(btrim(coalesce(stored -> 'away' ->> 'name', 'TEAM')));
  home_name := upper(btrim(coalesce(stored -> 'home' ->> 'name', 'TEAM')));
  if away_name = '' then
    away_name := 'TEAM';
  end if;
  if home_name = '' then
    home_name := 'TEAM';
  end if;
  away_runs := coalesce((stored -> 'away' ->> 'runs')::integer, 0);
  home_runs := coalesce((stored -> 'home' ->> 'runs')::integer, 0);
  winner := stored ->> 'winner';
  sentence := upper(btrim(coalesce(weather ->> 'sentence', '')));
  if sentence = '' then
    sentence := 'QUIET';
  end if;

  score_pick := 1 + floor(private.game_roll(seed, 5101) * 3)::integer;
  weather_pick := 1 + floor(private.game_roll(seed, 5102) * 3)::integer;

  if winner = 'home' then
    score_line := case score_pick
      when 1 then 'AND THAT IS THE BALLGAME. ' || home_name || ' TAKES IT AT HOME, ' || home_runs || ' TO ' || away_runs || '.'
      when 2 then 'CALL IT FOR THE HOME SIDE. ' || home_name || ', ' || home_runs || ' TO ' || away_runs || '.'
      else 'THE HOME CROWD GETS THIS ONE. ' || home_name || ' WINS IT, ' || home_runs || ' TO ' || away_runs || '.'
    end;
  elsif winner = 'away' then
    score_line := case score_pick
      when 1 then 'AND THE VISITORS TAKE THIS ONE HOME. ' || away_name || ', ' || away_runs || ' TO ' || home_runs || '.'
      when 2 then 'PACK IT UP. ' || away_name || ' LEAVES WITH THE WIN, ' || away_runs || ' TO ' || home_runs || '.'
      else 'THAT ONE BELONGS TO THE ROAD CLUB. ' || away_name || ' WINS, ' || away_runs || ' TO ' || home_runs || '.'
    end;
  else
    score_line := case score_pick
      when 1 then 'AND WE ARE STILL EVEN, ' || away_runs || ' TO ' || home_runs || '.'
      when 2 then 'NOBODY GETS THE LAST WORD. ' || away_runs || ' TO ' || home_runs || '.'
      else 'THE SCOREBOARD STAYS TIED, ' || away_runs || ' TO ' || home_runs || '.'
    end;
  end if;

  if jsonb_typeof(weather -> 'opening') = 'object'
    and coalesce(btrim(weather -> 'opening' ->> 'report'), '') <> ''
  then
    sentence := upper(btrim(weather -> 'opening' ->> 'report'));
    if jsonb_typeof(weather -> 'shift') = 'object'
      and coalesce(btrim(weather -> 'shift' ->> 'report'), '') <> ''
    then
      sentence := sentence || ' ' || upper(btrim(weather -> 'shift' ->> 'report'));
    end if;
    score_line := score_line || ' ' || sentence;
  else
    score_line := score_line || ' ' || case weather_pick
      when 1 then 'THE BOOTH CALLS THE DAY ' || sentence || '.'
      when 2 then 'FROM THE BOOTH: ' || sentence || '.'
      else 'THE CALL ON THE WEATHER IS ' || sentence || '.'
    end;
  end if;

  margin_pick := 1 + floor(private.game_roll(seed, 5103) * 3)::integer;
  if winner = 'tie' or away_runs = home_runs then
    margin_line := case margin_pick
      when 1 then 'NEITHER CLUB CAN GRAB THE LEAD.'
      when 2 then 'THE GAME WILL NOT TIP.'
      else 'EVEN THROUGH THE LAST OUT.'
    end;
  elsif abs(away_runs - home_runs) = 1 and least(away_runs, home_runs) = 0 then
    margin_line := case margin_pick
      when 1 then 'A SHUTOUT, AND IT ONLY TAKES ONE.'
      when 2 then 'ONE RUN DOES IT. THE OTHER SIDE STAYS QUIET.'
      else 'SHUTOUT. ONE RUN IS THE WHOLE CALL.'
    end;
  elsif abs(away_runs - home_runs) = 1 then
    margin_line := case margin_pick
      when 1 then 'ONE RUN. THAT IS THE WHOLE CALL.'
      when 2 then 'IT COMES DOWN TO A SINGLE RUN.'
      else 'THE GAME TURNS ON ONE RUN.'
    end;
  elsif least(away_runs, home_runs) = 0 then
    margin_line := case margin_pick
      when 1 then 'AND THAT IS A SHUTOUT.'
      when 2 then 'THE OTHER SIDE NEVER CROSSES THE PLATE.'
      else 'ZERO ON THE BOARD FOR ONE CLUB.'
    end;
  elsif abs(away_runs - home_runs) >= 5 then
    margin_line := case margin_pick
      when 1 then 'THIS ONE GETS AWAY FROM THEM.'
      when 2 then 'THE SCOREBOARD STOPS BEING KIND.'
      else 'CALL IT A LAUGHER.'
    end;
  else
    margin_line := case margin_pick
      when 1 then 'BOTH CLUBS HAVE A SAY IN IT.'
      when 2 then 'THE RUNS COME IN A SMALL BUNCH.'
      else 'THERE IS ROOM IN THIS ONE.'
    end;
  end if;
  score_line := score_line || ' ' || margin_line;
  paras := array[score_line];

  select count(*)
  into tag_count
  from (
    select distinct ev ->> 'tag' as tag
    from jsonb_array_elements(coalesce(stored -> 'events', '[]'::jsonb)) as ev
    where coalesce(ev ->> 'tag', '') in (
      'late_fade', 'awkward_slide', 'fog_lost', 'rain_misplay',
      'wind_carried', 'tryout_spark', 'penalty_effort'
    )
  ) as tags;

  if tag_count = 0 or density <= 0 then
    want := 0;
  elsif density < 0.5 then
    want := least(4, greatest(1, ceil(tag_count * density)::integer));
  else
    want := least(4, tag_count);
  end if;

  if want > 0 then
    select coalesce(array_agg(bank.line order by bank.first_inning, bank.tag), '{}'::text[])
    into flavor_lines
    from (
      select
        (
          case tagged.tag
            when 'late_fade' then
              case
                when tagged.kid <> '' and tagged.place <> '' then
                  array[
                    tagged.place || ', ' || tagged.kid || ' LOOKS FLAT IN THE LATE GOING.',
                    'LATE IN THE GAME, ' || tagged.kid || ' IS ' || tagged.place || ' AND THE LEGS ARE HEAVY.',
                    tagged.kid || ' RUNS OUT OF GAS ' || tagged.place || '.',
                    'THE LATE INNINGS SIT ON ' || tagged.kid || ', ' || tagged.place || '.'
                  ]
                when tagged.kid <> '' then
                  array[
                    tagged.kid || ' LOOKS FLAT IN THE LATE GOING.',
                    'THE LATE INNINGS SIT HEAVY ON ' || tagged.kid || '.',
                    tagged.kid || ' RUNS OUT OF GAS AFTER THE SIXTH.',
                    tagged.kid || ' IS A STEP BEHIND WHEN THE LIGHT GOES.'
                  ]
                else
                  array[
                    'SOMEBODY LOOKS FLAT IN THE LATE GOING.',
                    'THE LATE INNINGS COME ON HEAVY.',
                    'THE LEGS GET TIRED AFTER THE SIXTH.',
                    'THE LAST INNINGS ARE A GRIND.'
                  ]
              end
            when 'awkward_slide' then
              case when tagged.kid = '' then
                array[
                  'HERE COMES A SLIDE, AND IT ARRIVES IN A TANGLE.',
                  'A RUNNER GOES IN AND THE PLAY IS A MESS.',
                  'THE SLIDE RAISES DUST AND NOT MUCH ELSE.',
                  'SOMEBODY COMES IN FEET FIRST AND COMES UP SHORT.'
                ]
              else
                array[
                  'HERE COMES ' || tagged.kid || ', AND THE SLIDE ARRIVES IN A TANGLE.',
                  tagged.kid || ' GOES IN AND THE PLAY IS A MESS.',
                  'THE SLIDE FROM ' || tagged.kid || ' RAISES DUST AND NOT MUCH ELSE.',
                  tagged.kid || ' COMES IN FEET FIRST AND COMES UP SHORT.'
                ]
              end
            when 'fog_lost' then
              case
                when tagged.kid <> '' and tagged.place <> '' then
                  array[
                    tagged.place || ', THE FOG TAKES ONE AWAY FROM ' || tagged.kid || '.',
                    tagged.kid || ' IS ' || tagged.place || ' AND LOSES THE BALL IN THE FOG.',
                    'THE FOG SITS ' || tagged.place || '. ' || tagged.kid || ' NEVER PICKS IT UP.',
                    'LOST IN THE FOG, ' || tagged.place || ', AWAY FROM ' || tagged.kid || '.'
                  ]
                when tagged.kid <> '' then
                  array[
                    'THE FOG TAKES ONE AWAY FROM ' || tagged.kid || '.',
                    tagged.kid || ' LOSES THE BALL IN THE FOG.',
                    'A FLY DISAPPEARS ON ' || tagged.kid || '.',
                    tagged.kid || ' WATCHES ONE VANISH INTO THE FOG.'
                  ]
                when tagged.place <> '' then
                  array[
                    tagged.place || ', THE FOG TAKES ONE AWAY.',
                    'THE FOG SITS ' || tagged.place || ' AND THE BALL IS GONE.',
                    'LOST IN THE FOG, ' || tagged.place || '.',
                    'A FLY DISAPPEARS ' || tagged.place || '.'
                  ]
                else
                  array[
                    'A BALL GETS LOST IN THE FOG.',
                    'THE FOG TAKES ONE AWAY FROM THE GLOVE.',
                    'SOMEBODY LOSES THE BALL IN THE FOG.',
                    'THE FOG SITS ON A FLY BALL.'
                  ]
              end
            when 'rain_misplay' then
              case
                when tagged.kid <> '' and tagged.place <> '' then
                  array[
                    tagged.place || ', A WET HOP GETS PAST ' || tagged.kid || '.',
                    tagged.kid || ' IS ' || tagged.place || ' WHEN THE WET ONE GETS THROUGH.',
                    'THE HOP ' || tagged.place || ' KICKS AWAY FROM ' || tagged.kid || '.',
                    'CALL IT A BAD HOP. ' || tagged.kid || ', ' || tagged.place || ', CANNOT COME UP WITH IT.'
                  ]
                when tagged.kid <> '' then
                  array[
                    'A WET HOP GETS PAST ' || tagged.kid || '.',
                    'RAIN MAKES A ROUTINE PLAY HARD FOR ' || tagged.kid || '.',
                    tagged.kid || ' CANNOT HOLD THE WET BALL.',
                    'THE WET ONE KICKS AWAY FROM ' || tagged.kid || '.'
                  ]
                when tagged.place <> '' then
                  array[
                    tagged.place || ', A WET HOP GETS THROUGH.',
                    'THE HOP ' || tagged.place || ' KICKS AWAY.',
                    'RAIN TURNS A PLAY ' || tagged.place || ' SLOPPY.',
                    'A WET BALL SKIPS THROUGH ' || tagged.place || '.'
                  ]
                else
                  array[
                    'A WET HOP GETS PAST THE GLOVE.',
                    'RAIN MAKES A ROUTINE PLAY SLOPPY.',
                    'THE BALL SKIDS ON THE WET GROUND.',
                    'THE WET ONE KICKS AWAY.'
                  ]
              end
            when 'wind_carried' then
              case when tagged.kid = '' then
                array[
                  'AT THE PLATE, SOMEBODY PUTS ONE UP AND THE WIND TAKES IT OUT.',
                  'THAT ONE IS GONE. THE WIND FINISHES THE JOB.',
                  'GOING, GOING, AND THE WIND CARRIES A FLY OUT OF HERE.',
                  'A FLY BALL RIDES THE WIND AND DOES NOT COME BACK.'
                ]
              else
                array[
                  'AT THE PLATE, ' || tagged.kid || ' PUTS ONE UP AND THE WIND TAKES IT OUT.',
                  'THAT ONE IS GONE. THE WIND HELPS ' || tagged.kid || '.',
                  'GOING, GOING, AND THE WIND CARRIES A FLY FROM ' || tagged.kid || '.',
                  tagged.kid || ' GETS ALL OF ONE, AND THE WIND FINISHES THE JOB.'
                ]
              end
            when 'tryout_spark' then
              case
                when tagged.kid <> '' and tagged.place <> '' then
                  array[
                    tagged.kid || ' IS ' || tagged.place || ', PLAYING FOR A PLACE ON THE CLUB.',
                    'A LOOK FOR ' || tagged.kid || ', ' || tagged.place || '.',
                    tagged.kid || ' CAME TO EARN A PLACE. TODAY THE SPOT IS ' || tagged.place || '.',
                    'THE BENCH IS WATCHING ' || tagged.kid || ', ' || tagged.place || '.'
                  ]
                when tagged.kid <> '' then
                  array[
                    tagged.kid || ' IS OUT THERE PLAYING FOR A PLACE ON THE CLUB.',
                    tagged.kid || ' CAME TO EARN A SPOT.',
                    'THIS IS A LOOK FOR ' || tagged.kid || '.',
                    'THE BENCH IS WATCHING ' || tagged.kid || '.'
                  ]
                else
                  array[
                    'A KID IS OUT THERE PLAYING FOR A PLACE ON THE CLUB.',
                    'SOMEBODY CAME TO EARN A SPOT.',
                    'A NEW KID IS GETTING A LOOK.',
                    'THE BENCH IS WATCHING FOR A PLACE.'
                  ]
              end
            when 'penalty_effort' then
              case
                when tagged.kid <> '' and tagged.place <> '' then
                  array[
                    tagged.place || ', ' || tagged.kid || ' IS A STEP SLOW.',
                    tagged.kid || ' IS ' || tagged.place || ' AND THE EFFORT COMES AND GOES.',
                    'THE DAY SITS HEAVY ON ' || tagged.kid || ', ' || tagged.place || '.',
                    tagged.kid || ' LOOKS FLAT ' || tagged.place || '.'
                  ]
                when tagged.kid <> '' then
                  array[
                    tagged.kid || ' IS A STEP SLOW TODAY.',
                    tagged.kid || '''S EFFORT COMES AND GOES.',
                    tagged.kid || ' PLAYS IT A LITTLE FLAT.',
                    'THE DAY SITS HEAVY ON ' || tagged.kid || '.'
                  ]
                else
                  array[
                    'A KID IS A STEP SLOW TODAY.',
                    'SOMEBODY''S EFFORT COMES AND GOES.',
                    'A KID PLAYS IT A LITTLE FLAT.',
                    'THE DAY SITS HEAVY ON SOMEONE.'
                  ]
              end
            else null::text[]
          end
        )[1 + floor(tagged.roll * 4)::integer] as line,
        tagged.roll,
        tagged.tag,
        tagged.first_inning
      from (
        select distinct on (ev ->> 'tag')
          ev ->> 'tag' as tag,
          case
            when ev ->> 'tag' in ('rain_misplay', 'fog_lost') then coalesce(fielder.name, '')
            else upper(btrim(coalesce(ev ->> 'name', '')))
          end as kid,
          case
            when ev ->> 'tag' in ('rain_misplay', 'fog_lost') then coalesce(fielder.place, '')
            else coalesce(own.place, '')
          end as place,
          coalesce((ev ->> 'inning')::integer, 99) as first_inning,
          private.game_roll(
            seed,
            case ev ->> 'tag'
              when 'late_fade' then 5210
              when 'awkward_slide' then 5220
              when 'fog_lost' then 5230
              when 'rain_misplay' then 5240
              when 'wind_carried' then 5250
              when 'tryout_spark' then 5260
              when 'penalty_effort' then 5270
              else 5280
            end
          ) as roll
        from jsonb_array_elements(coalesce(stored -> 'events', '[]'::jsonb)) with ordinality as packed(ev, ord)
        left join lateral (
          select
            upper(btrim(coalesce(ln ->> 'name', ''))) as name,
            private.spot_place((ln ->> 'slot')::integer) as place
          from jsonb_array_elements(coalesce(stored -> 'lines', '[]'::jsonb)) as ln
          where ev ->> 'tag' in ('rain_misplay', 'fog_lost')
            and (ln ->> 'slot') ~ '^[1-9]$'
            and btrim(coalesce(ln ->> 'name', '')) <> ''
            and ln ->> 'team_id' = case
              when ev ->> 'half' = 'bottom' then stored -> 'away' ->> 'team_id'
              else stored -> 'home' ->> 'team_id'
            end
            and (
              (ev ->> 'tag' = 'fog_lost' and (ln ->> 'slot')::integer >= 7)
              or (ev ->> 'tag' = 'rain_misplay' and (ln ->> 'slot')::integer >= 3)
            )
          order by private.game_roll(seed, 5600 + (ln ->> 'slot')::integer), (ln ->> 'slot')::integer
          limit 1
        ) as fielder on true
        left join lateral (
          select private.spot_place((ln ->> 'slot')::integer) as place
          from jsonb_array_elements(coalesce(stored -> 'lines', '[]'::jsonb)) as ln
          where ev ->> 'tag' not in ('rain_misplay', 'fog_lost')
            and upper(btrim(coalesce(ln ->> 'name', ''))) = upper(btrim(coalesce(ev ->> 'name', '')))
            and btrim(coalesce(ev ->> 'name', '')) <> ''
            and (ln ->> 'slot') ~ '^[1-9]$'
          order by (ln ->> 'slot')::integer
          limit 1
        ) as own on true
        where coalesce(ev ->> 'tag', '') in (
          'late_fade', 'awkward_slide', 'fog_lost', 'rain_misplay',
          'wind_carried', 'tryout_spark', 'penalty_effort'
        )
        order by ev ->> 'tag', coalesce((ev ->> 'inning')::integer, 99), ord
      ) as tagged
    ) as bank
    where bank.line is not null;

    if want < cardinality(flavor_lines) then
      flavor_lines := flavor_lines[1:want];
    end if;

    if cardinality(flavor_lines) = 1 then
      select ev ->> 'tag', count(*)
      into primary_tag, tag_times
      from jsonb_array_elements(coalesce(stored -> 'events', '[]'::jsonb)) as ev
      where coalesce(ev ->> 'tag', '') in (
        'late_fade', 'awkward_slide', 'fog_lost', 'rain_misplay',
        'wind_carried', 'tryout_spark', 'penalty_effort'
      )
      group by ev ->> 'tag'
      order by count(*) desc, ev ->> 'tag'
      limit 1;

      if tag_times > 1 and primary_tag is distinct from 'tryout_spark' then
        again_line := (
          case primary_tag
            when 'late_fade' then array[
              'THE TIRED STRETCH COMES BACK.',
              'THE LEGS DO NOT COME BACK WITH THE INNING.',
              'THAT LATE STRETCH SHOWS UP AGAIN.',
              'ANOTHER INNING SITS HEAVY.'
            ]
            when 'awkward_slide' then array[
              'ANOTHER RUNNER COMES IN TANGLED.',
              'THE SLIDES DO NOT GET CLEANER.',
              'A SECOND SLIDE ARRIVES IN A MESS.',
              'THE DUST COMES UP AGAIN.'
            ]
            when 'fog_lost' then array[
              'ANOTHER BALL DISAPPEARS IN THE FOG.',
              'THE FOG TAKES A SECOND BALL.',
              'THE FOG DOES NOT LET UP.',
              'ONE MORE BALL IS LOST OUT THERE.'
            ]
            when 'rain_misplay' then array[
              'THE WET GROUND CAUSES ANOTHER MISS.',
              'ANOTHER HOP KICKS OFF WET.',
              'THE RAIN KEEPS THE BALL MEAN.',
              'A SECOND PLAY SKIDS AWAY.'
            ]
            when 'wind_carried' then array[
              'THE WIND HELPS ANOTHER BALL.',
              'ANOTHER FLY KEEPS GOING ON THE WIND.',
              'THE WIND IS NOT DONE.',
              'ONE MORE BALL RIDES OUT OF THE PARK.'
            ]
            when 'penalty_effort' then array[
              'THE FLAT STRETCH LASTS MORE THAN A MOMENT.',
              'THE EFFORT DIPS AGAIN.',
              'A SECOND STRETCH LOOKS HEAVY.',
              'THE DAY STAYS A STEP SLOW.'
            ]
            else null::text[]
          end
        )[1 + floor(private.game_roll(seed, 5290) * 4)::integer];
        if again_line is not null then
          flavor_lines := flavor_lines || array[again_line];
        end if;
      end if;
    end if;

    if cardinality(flavor_lines) > 0 then
      paras := paras || array[array_to_string(flavor_lines, ' ')];
    end if;
  end if;

  select line.name, line.n
  into hit_name, hit_n
  from (
    select upper(btrim(coalesce(ln ->> 'name', ''))) as name, (ln ->> 'h')::integer as n
    from jsonb_array_elements(coalesce(stored -> 'lines', '[]'::jsonb)) as ln
    where coalesce((ln ->> 'h')::integer, 0) >= 2
      and btrim(coalesce(ln ->> 'name', '')) <> ''
    order by (ln ->> 'h')::integer desc, upper(btrim(ln ->> 'name'))
    limit 1
  ) as line;

  select line.name, line.n
  into rbi_name, rbi_n
  from (
    select upper(btrim(coalesce(ln ->> 'name', ''))) as name, (ln ->> 'rbi')::integer as n
    from jsonb_array_elements(coalesce(stored -> 'lines', '[]'::jsonb)) as ln
    where coalesce((ln ->> 'rbi')::integer, 0) >= 2
      and btrim(coalesce(ln ->> 'name', '')) <> ''
    order by (ln ->> 'rbi')::integer desc, upper(btrim(ln ->> 'name'))
    limit 1
  ) as line;

  select line.name, line.n
  into mound_name, mound_n
  from (
    select upper(btrim(coalesce(ln ->> 'name', ''))) as name, (ln ->> 'outs')::integer as n
    from jsonb_array_elements(coalesce(stored -> 'lines', '[]'::jsonb)) as ln
    where coalesce((ln ->> 'outs')::integer, 0) >= 3
      and btrim(coalesce(ln ->> 'name', '')) <> ''
    order by (ln ->> 'outs')::integer desc, upper(btrim(ln ->> 'name'))
    limit 1
  ) as line;

  if hit_name is not null then
    if private.game_roll(seed, 5401) < 0.5 then
      close_lines := close_lines || array[hit_name || ' RIPS ' || hit_n || ' HITS.'];
    else
      close_lines := close_lines || array['GIVE THE STICK TO ' || hit_name || '. ' || hit_n || ' HITS.'];
    end if;
  end if;
  if mound_name is not null and cardinality(close_lines) < 2 then
    if private.game_roll(seed, 5403) < 0.5 then
      close_lines := close_lines || array['ON THE MOUND, ' || mound_name || ' RECORDS ' || mound_n || ' OUTS.'];
    else
      close_lines := close_lines || array[mound_name || ' WORKS ' || mound_n || ' OUTS FROM THE HILL.'];
    end if;
  end if;
  if rbi_name is not null and cardinality(close_lines) < 2 then
    if private.game_roll(seed, 5402) < 0.5 then
      close_lines := close_lines || array[rbi_name || ' DRIVES IN ' || rbi_n || '.'];
    else
      close_lines := close_lines || array[rbi_name || ' BRINGS ' || rbi_n || ' RUNNERS HOME.'];
    end if;
  end if;

  if cardinality(close_lines) < 2 then
    select coalesce(array_agg(bank.line order by bank.roll, bank.line), '{}'::text[])
    into color_lines
    from (
      select
        line,
        private.game_roll(seed, 5300 + ord::integer) as roll
      from unnest(array[
        'AND THAT WRAPS THE AFTERNOON ON THE BLOCK.',
        'THE KIDS ON THE FENCE HAVE THE FINAL WORD.',
        'FILE IT AS A NEIGHBORHOOD GAME.',
        'THE INNINGS MARCH ALONG, ONE AFTER ANOTHER.',
        'NO SPEECH AFTERWARD. JUST THE SCORE.',
        'A CLEAN LITTLE GAME, FIRST PITCH TO LAST OUT.'
      ]) with ordinality as bank(line, ord)
    ) as bank;
    close_lines := close_lines || color_lines[1:(2 - cardinality(close_lines))];
  end if;
  paras := paras || array[array_to_string(close_lines, ' ')];

  if cardinality(paras) < 2 or cardinality(paras) > 4 then
    raise exception 'THE WRITEUP DID NOT HOLD';
  end if;

  written := array_to_string(paras, E'\n\n');
  scrub := lower(written);
  scrub := replace(scrub, lower(away_name), ' ');
  scrub := replace(scrub, lower(home_name), ' ');
  for kid_name in
    select distinct upper(btrim(coalesce(ln ->> 'name', '')))
    from jsonb_array_elements(coalesce(stored -> 'lines', '[]'::jsonb)) as ln
    where btrim(coalesce(ln ->> 'name', '')) <> ''
    union
    select distinct upper(btrim(coalesce(ev ->> 'name', '')))
    from jsonb_array_elements(coalesce(stored -> 'events', '[]'::jsonb)) as ev
    where btrim(coalesce(ev ->> 'name', '')) <> ''
  loop
    scrub := replace(scrub, lower(kid_name), ' ');
  end loop;

  foreach word in array banned loop
    if scrub ~ ('(^|[^a-z])' || word || '([^a-z]|$)') then
      raise exception 'THE WRITEUP SAID TOO MUCH';
    end if;
  end loop;

  update public.games as games
  set narrative = written
  where games.id = target_game;

  return written;
end;
$func$;


comment on function private.forecast_weather(uuid, timestamptz, bigint, numeric) is
  'One forecast for a game. The day is shared. A park can slip one step.';

comment on function private.realize_weather(jsonb, bigint) is
  'Locks the opening air from the forecast. About one game in three then changes once, at the top or the bottom of a later inning.';

comment on function private.simulate_game(uuid) is
  'Plays a scheduled game from the lock snapshot and the seed. The opening weather locks here and may change at one later top or bottom. A final game returns the stored result.';

comment on function private.narrate_game(uuid) is
  'Writes the matchup writeup in an announcer voice from the line score, the weather desk report, and the event tags. A line can name the spot. Each tag that happened is named, up to four. The close is two sentences. A game that already has prose keeps it. Hidden stats are not written.';
