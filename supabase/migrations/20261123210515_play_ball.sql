-- The commissioner starts the season. Official games, forecasts, and zeroed standings.

create function private.weather_draw(seed bigint, draw_index integer)
returns numeric
language sql
immutable
set search_path = ''
as $func$
  select (('x' || substr(md5(seed::text || ':' || draw_index::text), 1, 6))::bit(24)::integer)::numeric
    / 16777216;
$func$;

comment on function private.weather_draw(bigint, integer) is
  'A unit draw in [0, 1) from a game seed and a draw index. Same inputs always return the same number.';

revoke all on function private.weather_draw(bigint, integer) from public, anon, authenticated, service_role;

create function private.generate_weather(seed bigint, variability numeric)
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
begin
  if seed is null then
    raise exception 'THE FORECAST HAS NO SEED';
  end if;

  -- About `variability` of days are not simply clear. 0 is always clear.
  if private.weather_draw(seed, 0) >= spread then
    return jsonb_build_object(
      'sky', 'clear',
      'wind', 'calm',
      'heat', 'mild',
      'sentence', 'CLEAR'
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
    'sentence', sentence
  );
end;
$func$;

comment on function private.generate_weather(bigint, numeric) is
  'Forecast jsonb for one game seed and that game''s weather_variability. The sentence is what both coaches read.';

revoke all on function private.generate_weather(bigint, numeric) from public, anon, authenticated, service_role;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  home_team_id uuid not null references public.teams (id),
  away_team_id uuid not null references public.teams (id),
  starts_at timestamptz not null,
  status text not null default 'scheduled',
  weather jsonb not null,
  seed bigint not null,
  settings_version integer not null references public.game_settings (version),
  result jsonb,
  narrative text,
  is_practice boolean not null default false,
  constraint games_status check (status in ('scheduled', 'final')),
  constraint games_distinct_teams check (home_team_id <> away_team_id),
  constraint games_weather_shape check (
    weather ->> 'sky' in ('clear', 'light_rain', 'heavy_rain', 'fog')
    and weather ->> 'wind' in ('calm', 'in', 'out', 'cross')
    and weather ->> 'heat' in ('mild', 'hot', 'cold')
    and char_length(weather ->> 'sentence') between 1 and 80
  ),
  constraint games_scheduled_blank check (
    status <> 'scheduled'
    or (result is null and narrative is null)
  )
);

comment on table public.games is
  'One official or practice game. Phase 11 inserts official games only. A bye is not a row.';

comment on column public.games.starts_at is
  '23:00 UTC on an official weekday, so that calendar day stays open for a later lineup lock.';

comment on column public.games.weather is
  'Forecast frozen when the game is scheduled. sky, wind, heat, and sentence. Both coaches read sentence.';

comment on column public.games.seed is
  'Deterministic counter for this game. Weather uses it now. The simulator will use it later. Not granted to the client.';

comment on column public.games.result is
  'Null while the game is scheduled. Playing the game is a later phase.';

comment on column public.games.is_practice is
  'Official schedule rows are false. Practice games are a later phase.';

create index games_season_starts_idx on public.games (season_id, starts_at);
create unique index games_home_start_idx on public.games (home_team_id, starts_at);
create unique index games_away_start_idx on public.games (away_team_id, starts_at);
create index games_settings_version_idx on public.games (settings_version);

alter table public.games enable row level security;

revoke all on table public.games from public, anon, authenticated, service_role;
grant select (
  id,
  season_id,
  home_team_id,
  away_team_id,
  starts_at,
  status,
  weather,
  settings_version,
  result,
  narrative,
  is_practice
) on table public.games to authenticated;

create policy games_select
  on public.games
  for select
  to authenticated
  using (true);

create table public.standings (
  season_id uuid not null references public.seasons (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  wins integer not null default 0,
  losses integer not null default 0,
  primary key (season_id, team_id),
  constraint standings_wins check (wins >= 0),
  constraint standings_losses check (losses >= 0)
);

comment on table public.standings is
  'Wins and losses for one team. Play creates a zero row. Results update it in a later phase.';

create index standings_team_id_idx on public.standings (team_id);

alter table public.standings enable row level security;

revoke all on table public.standings from public, anon, authenticated, service_role;
grant select (season_id, team_id, wins, losses) on table public.standings to authenticated;

create policy standings_select
  on public.standings
  for select
  to authenticated
  using (true);

create function private.play_ball(target_season uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  found_season public.seasons;
  pick_at integer;
  draft_order uuid[];
  variability numeric;
  roster uuid[];
  circle uuid[];
  n integer;
  round_count integer;
  day_count integer;
  cursor_day date;
  slots timestamptz[] := '{}';
  dow integer;
  slate integer := 0;
  cycle integer;
  pair_slot integer;
  a uuid;
  b uuid;
  home_id uuid;
  away_id uuid;
  game_seed bigint;
  slot_at timestamptz;
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
    raise exception 'ONLY THE COMMISSIONER STARTS THE SEASON';
  end if;
  if found_season.status in ('active', 'completed')
    or exists (select 1 from public.games where season_id = target_season and is_practice = false)
  then
    raise exception 'THE SEASON HAS ALREADY STARTED';
  end if;
  if found_season.status <> 'drafting' then
    raise exception 'FINISH THE DRAFT BEFORE PLAY BALL';
  end if;

  select pick_index, "order"
  into pick_at, draft_order
  from public.draft_state
  where season_id = target_season
  for update;

  if not found
    or draft_order is null
    or cardinality(draft_order) = 0
    or pick_at < cardinality(draft_order)
  then
    raise exception 'FINISH THE DRAFT BEFORE PLAY BALL';
  end if;

  perform 1
  from public.teams
  where season_id = target_season
  order by id
  for update;

  select coalesce(array_agg(id order by created_at, id), '{}'::uuid[])
  into roster
  from public.teams
  where season_id = target_season;

  if cardinality(roster) < 2 then
    raise exception 'NEED AT LEAST TWO TEAMS';
  end if;

  select (settings ->> 'weather_variability')::numeric
  into variability
  from public.game_settings
  where version = found_season.settings_version;

  if variability is null then
    raise exception 'THE RULES ARE NOT HERE';
  end if;

  perform set_config('TimeZone', 'UTC', true);

  day_count := found_season.weeks * cardinality(found_season.official_weekdays);
  cursor_day := (now() at time zone 'utc')::date;
  if (cursor_day::timestamp + time '23:00') at time zone 'utc' <= now() then
    cursor_day := cursor_day + 1;
  end if;

  while cardinality(slots) < day_count loop
    dow := extract(dow from cursor_day)::integer;
    if dow = any (found_season.official_weekdays) then
      slots := slots || array[(cursor_day::timestamp + time '23:00') at time zone 'utc'];
    end if;
    cursor_day := cursor_day + 1;
    if cursor_day > (now() at time zone 'utc')::date + 400 then
      raise exception 'THE SCHEDULE DID NOT FIT';
    end if;
  end loop;

  if cardinality(roster) % 2 = 1 then
    circle := roster || array[null]::uuid[];
  else
    circle := roster;
  end if;
  n := cardinality(circle);
  round_count := n - 1;

  while slate < day_count loop
    cycle := slate / round_count;
    slot_at := slots[slate + 1];
    pair_slot := 0;
    for i in 1 .. (n / 2) loop
      a := circle[i];
      b := circle[n + 1 - i];
      if a is not null and b is not null then
        pair_slot := pair_slot + 1;
        if cycle % 2 = 0 then
          home_id := a;
          away_id := b;
        else
          home_id := b;
          away_id := a;
        end if;
        game_seed := ('x' || substr(md5(
          target_season::text || ':' || slate::text || ':' || pair_slot::text
        ), 1, 15))::bit(60)::bigint;
        insert into public.games (
          season_id,
          home_team_id,
          away_team_id,
          starts_at,
          status,
          weather,
          seed,
          settings_version,
          result,
          narrative,
          is_practice
        )
        values (
          target_season,
          home_id,
          away_id,
          slot_at,
          'scheduled',
          private.generate_weather(game_seed, variability),
          game_seed,
          found_season.settings_version,
          null,
          null,
          false
        );
      end if;
    end loop;
    circle := array[circle[1]] || array[circle[n]] || circle[2:n - 1];
    slate := slate + 1;
  end loop;

  insert into public.standings (season_id, team_id, wins, losses)
  select target_season, id, 0, 0
  from public.teams
  where season_id = target_season;

  update public.seasons
  set status = 'active'
  where id = target_season;
end;
$func$;

comment on function private.play_ball(uuid) is
  'The commissioner opens an active season after the draft. Official games land at 23:00 UTC. Byes are not rows. Standings start at zero.';

revoke all on function private.play_ball(uuid) from public, anon, authenticated, service_role;
grant execute on function private.play_ball(uuid) to authenticated;

create function public.play_ball(season_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.play_ball(season_id);
$func$;

comment on function public.play_ball(uuid) is
  'The commissioner presses PLAY BALL once the draft is complete.';

revoke all on function public.play_ball(uuid) from public, anon;
grant execute on function public.play_ball(uuid) to authenticated;
