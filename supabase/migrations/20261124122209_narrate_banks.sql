-- Second pass on the writeup. Each event tag has more than one line.
-- A game that already has prose keeps it. The matchup is unchanged.

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

  score_pick := 1 + floor(private.game_roll(seed, 5101) * 3)::integer;
  weather_pick := 1 + floor(private.game_roll(seed, 5102) * 3)::integer;

  if winner = 'home' then
    score_line := case score_pick
      when 1 then home_name || ' TOOK IT AT HOME, ' || home_runs || ' TO ' || away_runs || '.'
      when 2 then home_name || ' HELD THE BLOCK, ' || home_runs || ' TO ' || away_runs || '.'
      else home_name || ' HAD THE BETTER OF IT, ' || home_runs || ' TO ' || away_runs || '.'
    end;
  elsif winner = 'away' then
    score_line := case score_pick
      when 1 then away_name || ' TOOK IT ON THE ROAD, ' || away_runs || ' TO ' || home_runs || '.'
      when 2 then away_name || ' LEFT WITH IT, ' || away_runs || ' TO ' || home_runs || '.'
      else away_name || ' HAD THE BETTER AFTERNOON, ' || away_runs || ' TO ' || home_runs || '.'
    end;
  else
    score_line := case score_pick
      when 1 then 'IT ENDED EVEN, ' || away_runs || ' TO ' || home_runs || '.'
      when 2 then 'NEITHER SIDE PULLED AHEAD, ' || away_runs || ' TO ' || home_runs || '.'
      else 'THE DAY CLOSED EVEN, ' || away_runs || ' TO ' || home_runs || '.'
    end;
  end if;

  score_line := score_line || ' ' || case weather_pick
    when 1 then 'THE DAY READ ' || sentence || '.'
    when 2 then 'THE AFTERNOON WAS ' || sentence || '.'
    else sentence || ' WEATHER SAT OVER THE BLOCK.'
  end;
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
        (
          case tagged.tag
            when 'late_fade' then
              case when tagged.kid = '' then
                array[
                  'SOMEONE LOOKED FLAT LATE.',
                  'THE LATE INNINGS CAME ON HEAVY.',
                  'LEGS GOT TIRED AFTER THE SIXTH.',
                  'THE LAST INNINGS WERE A GRIND.'
                ]
              else
                array[
                  tagged.kid || ' LOOKED FLAT LATE.',
                  'THE LATE INNINGS SAT HEAVY ON ' || tagged.kid || '.',
                  tagged.kid || ' RAN OUT OF STEAM AFTER THE SIXTH.',
                  tagged.kid || ' WAS A STEP BEHIND WHEN THE LIGHT WENT.'
                ]
              end
            when 'awkward_slide' then
              case when tagged.kid = '' then
                array[
                  'A SLIDE CAME IN CLUMSY.',
                  'SOMEBODY WENT IN AND THE PLAY WAS A MESS.',
                  'THE SLIDE RAISED DUST AND NOT MUCH ELSE.',
                  'A RUNNER ARRIVED IN A TANGLE.'
                ]
              else
                array[
                  tagged.kid || ' CAME IN WITH A CLUMSY SLIDE.',
                  'THE SLIDE FROM ' || tagged.kid || ' RAISED MORE DUST THAN SPEED.',
                  tagged.kid || ' WENT IN AND CAME UP SHORT.',
                  'A SLIDE FROM ' || tagged.kid || ' ARRIVED IN A TANGLE.'
                ]
              end
            when 'fog_lost' then
              case when tagged.kid = '' then
                array[
                  'A BALL GOT LOST IN THE FOG.',
                  'THE FOG TOOK ONE AWAY FROM THE GLOVE.',
                  'SOMEONE LOST THE BALL IN THE FOG.',
                  'THE FOG SAT ON A FLY BALL.'
                ]
              else
                array[
                  'A BALL GOT LOST IN THE FOG NEAR ' || tagged.kid || '.',
                  tagged.kid || ' LOST ONE IN THE FOG.',
                  'THE FOG HID A BALL FROM ' || tagged.kid || '.',
                  tagged.kid || ' WATCHED ONE DISAPPEAR INTO THE FOG.'
                ]
              end
            when 'rain_misplay' then
              case when tagged.kid = '' then
                array[
                  'THE WET BALL KICKED AWAY.',
                  'RAIN MADE A ROUTINE PLAY SLOPPY.',
                  'THE BALL SKIDDED ON THE WET GROUND.',
                  'A WET HOP GOT PAST THE GLOVE.'
                ]
              else
                array[
                  'THE WET BALL KICKED AWAY FROM ' || tagged.kid || '.',
                  'RAIN MADE A ROUTINE PLAY HARD FOR ' || tagged.kid || '.',
                  'A WET HOP GOT PAST ' || tagged.kid || '.',
                  tagged.kid || ' COULD NOT HOLD THE WET BALL.'
                ]
              end
            when 'wind_carried' then
              case when tagged.kid = '' then
                array[
                  'THE WIND TOOK ONE OUT.',
                  'A FLY BALL RODE THE WIND.',
                  'THE WIND CARRIED ONE PAST THE FENCE.',
                  'ONE BALL KEPT GOING ON THE WIND.'
                ]
              else
                array[
                  'THE WIND TOOK ' || tagged.kid || '''S BALL OUT.',
                  tagged.kid || ' PUT ONE ON THE WIND AND IT LEFT.',
                  'THE WIND CARRIED A FLY FROM ' || tagged.kid || ' PAST THE FENCE.',
                  tagged.kid || ' GOT HELP FROM THE WIND.'
                ]
              end
            when 'tryout_spark' then
              case when tagged.kid = '' then
                array[
                  'A KID WAS PLAYING FOR A SPOT.',
                  'SOMEBODY WAS OUT THERE TO EARN A PLACE.',
                  'A NEW KID WAS GETTING A LOOK.',
                  'THE BENCH WAS WATCHING FOR A SPOT.'
                ]
              else
                array[
                  tagged.kid || ' WAS PLAYING FOR A SPOT.',
                  tagged.kid || ' WAS OUT THERE TO EARN A PLACE.',
                  'THIS WAS A LOOK FOR ' || tagged.kid || '.',
                  tagged.kid || ' HAD A DAY TO SHOW THE BENCH.'
                ]
              end
            when 'penalty_effort' then
              case when tagged.kid = '' then
                array[
                  'A KID LOOKED A STEP SLOW.',
                  'SOMEBODY''S EFFORT CAME AND WENT.',
                  'A KID PLAYED IT A LITTLE FLAT.',
                  'THE DAY SAT HEAVY ON SOMEONE.'
                ]
              else
                array[
                  tagged.kid || ' LOOKED A STEP SLOW.',
                  tagged.kid || '''S EFFORT CAME AND WENT.',
                  tagged.kid || ' PLAYED IT A LITTLE FLAT.',
                  'THE DAY SAT HEAVY ON ' || tagged.kid || '.'
                ]
              end
            else null::text[]
          end
        )[1 + floor(tagged.roll * 4)::integer] as line,
        tagged.roll,
        tagged.tag
      from (
        select distinct on (ev ->> 'tag')
          ev ->> 'tag' as tag,
          upper(btrim(coalesce(ev ->> 'name', ''))) as kid,
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
    'IT WAS A NEIGHBORHOOD GAME, START TO STOP.',
    'THE INNINGS CAME IN A STEADY LINE.',
    'NOBODY NEEDED A SPEECH AFTERWARD.',
    'KIDS SHOUTED THE COUNT FROM THE FENCE.',
    'IT HAD THE SHAPE OF A SATURDAY GAME.'
  ];
  if hit_name is not null then
    if private.game_roll(seed, 5401) < 0.5 then
      neutral_lines := neutral_lines || array[hit_name || ' COLLECTED ' || hit_n || ' HITS.'];
    else
      neutral_lines := neutral_lines || array[hit_name || ' HAD ' || hit_n || ' HITS ON THE DAY.'];
    end if;
  end if;
  if rbi_name is not null then
    if private.game_roll(seed, 5402) < 0.5 then
      neutral_lines := neutral_lines || array[rbi_name || ' DROVE IN ' || rbi_n || '.'];
    else
      neutral_lines := neutral_lines || array[rbi_name || ' BROUGHT ' || rbi_n || ' RUNNERS HOME.'];
    end if;
  end if;
  if mound_name is not null then
    if private.game_roll(seed, 5403) < 0.5 then
      neutral_lines := neutral_lines || array[mound_name || ' RECORDED ' || mound_n || ' OUTS.'];
    else
      neutral_lines := neutral_lines || array[mound_name || ' WORKED ' || mound_n || ' OUTS.'];
    end if;
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
  'Writes the matchup writeup from the stored line score, the weather sentence, and the event tags. Each tag has more than one line. A game that already has prose keeps it. Hidden stats are not written.';

comment on column public.games.narrative is
  'The writeup for a final game. Phrase banks over the line score and event tags. A stored writeup is kept. Hidden stats are not in this column.';
