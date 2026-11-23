-- The writeup for a played game. Phrase banks read the line score, the
-- weather sentence, and the event tags. Hidden stats never enter the prose.
-- Density is narrative_flavor_density on that game's settings version.

create function private.narrate_game(target_game uuid)
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
  paras text[] := '{}'::text[];
  flavor_lines text[] := '{}'::text[];
  neutral_lines text[] := '{}'::text[];
  chosen text[] := '{}'::text[];
  tag_count integer := 0;
  want integer := 0;
  neutral_count integer := 1;
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

  if winner = 'home' then
    score_line := home_name || ' TOOK IT AT HOME, ' || home_runs || ' TO ' || away_runs || '.';
  elsif winner = 'away' then
    score_line := away_name || ' TOOK IT ON THE ROAD, ' || away_runs || ' TO ' || home_runs || '.';
  else
    score_line := 'IT ENDED EVEN, ' || away_runs || ' TO ' || home_runs || '.';
  end if;
  score_line := score_line || ' THE DAY READ ' || sentence || '.';
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

  want := ceil(tag_count * density)::integer;

  if want > 0 then
    select coalesce(array_agg(bank.line order by bank.roll, bank.tag), '{}'::text[])
    into flavor_lines
    from (
      select
        tagged.tag,
        case tagged.tag
          when 'late_fade' then
            case when tagged.kid = '' then 'SOMEONE LOOKED FLAT LATE.' else tagged.kid || ' LOOKED FLAT LATE.' end
          when 'awkward_slide' then
            case when tagged.kid = '' then 'A SLIDE CAME IN CLUMSY.' else tagged.kid || ' CAME IN WITH A CLUMSY SLIDE.' end
          when 'fog_lost' then 'A BALL GOT LOST IN THE FOG.'
          when 'rain_misplay' then 'THE WET BALL KICKED AWAY.'
          when 'wind_carried' then 'THE WIND TOOK ONE OUT.'
          when 'tryout_spark' then
            case when tagged.kid = '' then 'A KID WAS PLAYING FOR A SPOT.' else tagged.kid || ' WAS PLAYING FOR A SPOT.' end
          when 'penalty_effort' then
            case when tagged.kid = '' then 'A KID LOOKED A STEP SLOW.' else tagged.kid || ' LOOKED A STEP SLOW.' end
          else null
        end as line,
        private.game_roll(
          seed,
          5200 + (('x' || substr(md5('tag:' || tagged.tag), 1, 4))::bit(16)::integer)
        ) as roll
      from (
        select distinct on (ev ->> 'tag')
          ev ->> 'tag' as tag,
          upper(btrim(coalesce(ev ->> 'name', ''))) as kid
        from jsonb_array_elements(coalesce(stored -> 'events', '[]'::jsonb)) with ordinality as packed(ev, ord)
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

  neutral_lines := array[
    'THE GAME STAYED ON THE BLOCK.',
    'IT WAS A NEIGHBORHOOD GAME, START TO STOP.'
  ];
  if hit_name is not null then
    neutral_lines := neutral_lines || array[hit_name || ' COLLECTED ' || hit_n || ' HITS.'];
  end if;
  if rbi_name is not null then
    neutral_lines := neutral_lines || array[rbi_name || ' DROVE IN ' || rbi_n || '.'];
  end if;
  if mound_name is not null then
    neutral_lines := neutral_lines || array[mound_name || ' RECORDED ' || mound_n || ' OUTS.'];
  end if;

  neutral_count := case
    when cardinality(paras) > 1 then 1
    when private.game_roll(seed, 5001) < 0.5 then 2
    else 1
  end;

  select coalesce(array_agg(bank.line order by bank.roll, bank.line), '{}'::text[])
  into chosen
  from (
    select
      line,
      private.game_roll(seed, 5300 + ord::integer) as roll
    from unnest(neutral_lines) with ordinality as bank(line, ord)
  ) as bank;

  if neutral_count < cardinality(chosen) then
    chosen := chosen[1:neutral_count];
  end if;
  paras := paras || chosen;

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

comment on function private.narrate_game(uuid) is
  'Writes the matchup writeup from the stored line score, the weather sentence, and the event tags. A second call keeps the same prose. Hidden stats are not written.';

revoke all on function private.narrate_game(uuid) from public, anon, authenticated, service_role;
grant execute on function private.narrate_game(uuid) to authenticated;

create or replace function public.play_game_now(game_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  played jsonb;
begin
  played := private.simulate_game(game_id);
  perform private.narrate_game(game_id);
  return played;
end;
$func$;

comment on function public.play_game_now(uuid) is
  'The commissioner plays one locked game and stores the writeup.';

revoke all on function public.play_game_now(uuid) from public, anon;
grant execute on function public.play_game_now(uuid) to authenticated;

comment on function private.simulate_game(uuid) is
  'Plays a scheduled game from the lock snapshot and the seed. A final game returns the stored result. The writeup is written after this returns.';

comment on column public.games.narrative is
  'The writeup for a final game. Phrase banks over the line score and event tags. Hidden stats are not in this column.';

-- Games already played get a writeup. The line score stays.
do $fill$
declare
  gid uuid;
begin
  for gid in
    select games.id
    from public.games as games
    where games.status = 'final'
      and games.result is not null
      and (games.narrative is null or btrim(games.narrative) = '')
  loop
    perform private.narrate_game(gid);
  end loop;
end;
$fill$;
