-- Forecasts keep the realized sky, wind, heat, and sentence, and also store
-- the percent chance of each weather type. Chances follow weather_variability
-- only, so every game on the same rules version shows the same percents.

create or replace function private.generate_weather(seed bigint, variability numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  spread numeric := least(greatest(coalesce(variability, 0), 0), 1);
  sky text := 'clear';
  wind text := 'calm';
  heat text := 'mild';
  parts text[] := '{}';
  sentence text;
  roll numeric;
  chances jsonb := '[]'::jsonb;
  listed text[] := array[
    'CLEAR',
    'LIGHT RAIN',
    'HEAVY RAIN',
    'FOG',
    'WIND IN',
    'WIND OUT',
    'CROSSWIND',
    'HOT AND HUMID',
    'COLD'
  ];
  weights numeric[];
  percent integer;
begin
  if seed is null then
    raise exception 'THE FORECAST HAS NO SEED';
  end if;

  -- CLEAR is a simply clear day. The other rates are the unsettled share.
  -- A draw that lands on every default is forced to hot, so hot is 41.5 of that share.
  weights := array[
    (1 - spread) * 100,
    spread * 34,
    spread * 21,
    spread * 20,
    spread * 30,
    spread * 25,
    spread * 25,
    spread * 41.5,
    spread * 30
  ];
  for i in 1 .. cardinality(listed) loop
    percent := round(weights[i])::integer;
    if percent > 0 then
      chances := chances || jsonb_build_array(
        jsonb_build_object('type', listed[i], 'percent', percent)
      );
    end if;
  end loop;

  -- About `variability` of days are not simply clear. 0 is always clear.
  if private.weather_draw(seed, 0) >= spread then
    return jsonb_build_object(
      'sky', 'clear',
      'wind', 'calm',
      'heat', 'mild',
      'sentence', 'CLEAR',
      'chances', chances
    );
  end if;

  roll := private.weather_draw(seed, 1);
  if roll < 0.34 then
    sky := 'light_rain';
  elsif roll < 0.55 then
    sky := 'heavy_rain';
  elsif roll < 0.75 then
    sky := 'fog';
  end if;

  roll := private.weather_draw(seed, 2);
  if roll < 0.30 then
    wind := 'in';
  elsif roll < 0.55 then
    wind := 'out';
  elsif roll < 0.80 then
    wind := 'cross';
  end if;

  roll := private.weather_draw(seed, 3);
  if roll < 0.40 then
    heat := 'hot';
  elsif roll < 0.70 then
    heat := 'cold';
  end if;

  -- A draw that landed on every default is still not a clear day.
  if sky = 'clear' and wind = 'calm' and heat = 'mild' then
    if private.weather_draw(seed, 1) < 0.34 then
      sky := 'light_rain';
    elsif private.weather_draw(seed, 1) < 0.67 then
      wind := 'in';
    else
      heat := 'hot';
    end if;
  end if;

  if sky = 'light_rain' then
    parts := array_append(parts, 'LIGHT RAIN');
  elsif sky = 'heavy_rain' then
    parts := array_append(parts, 'HEAVY RAIN');
  elsif sky = 'fog' then
    parts := array_append(parts, 'FOG');
  end if;
  if wind = 'in' then
    parts := array_append(parts, 'WIND IN');
  elsif wind = 'out' then
    parts := array_append(parts, 'WIND OUT');
  elsif wind = 'cross' then
    parts := array_append(parts, 'CROSSWIND');
  end if;
  if heat = 'hot' then
    parts := array_append(parts, 'HOT AND HUMID');
  elsif heat = 'cold' then
    parts := array_append(parts, 'COLD');
  end if;

  sentence := case cardinality(parts)
    when 0 then 'CLEAR'
    when 1 then parts[1]
    when 2 then parts[1] || ' AND ' || parts[2]
    else parts[1] || ', ' || parts[2] || ', AND ' || parts[3]
  end;

  return jsonb_build_object(
    'sky', sky,
    'wind', wind,
    'heat', heat,
    'sentence', sentence,
    'chances', chances
  );
end;
$func$;

comment on function private.generate_weather(bigint, numeric) is
  'Forecast jsonb for one game seed and that game''s weather_variability. chances lists each weather percent. The sentence stays for the simulator.';

revoke all on function private.generate_weather(bigint, numeric) from public, anon, authenticated, service_role;

comment on column public.games.weather is
  'Forecast frozen when the game is scheduled. sky, wind, heat, sentence, and chances. Both coaches read the same chances.';

update public.games as game
set weather = private.generate_weather(
  game.seed,
  (settings.settings ->> 'weather_variability')::numeric
)
from public.game_settings as settings
where settings.version = game.settings_version
  and (settings.settings ->> 'weather_variability') is not null;
