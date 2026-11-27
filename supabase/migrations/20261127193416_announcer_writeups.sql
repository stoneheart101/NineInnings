-- Announcer templates. A stored writeup is kept. A new game is called
-- in that voice, and a line can name the spot.

create function private.spot_place(slot integer)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case slot
    when 1 then 'ON THE MOUND'
    when 2 then 'BEHIND THE PLATE'
    when 3 then 'AT FIRST'
    when 4 then 'AT SECOND'
    when 5 then 'AT THIRD'
    when 6 then 'AT SHORT'
    when 7 then 'IN LEFT FIELD'
    when 8 then 'IN CENTER FIELD'
    when 9 then 'IN RIGHT FIELD'
    else ''
  end;
$func$;

comment on function private.spot_place(integer) is
  'The announcer name for a lineup slot. Empty when the slot is not 1 through 9.';

revoke all on function private.spot_place(integer) from public, anon, authenticated, service_role;

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

  score_line := score_line || ' ' || case weather_pick
    when 1 then 'THE BOOTH CALLS THE DAY ' || sentence || '.'
    when 2 then 'FROM THE BOOTH: ' || sentence || '.'
    else 'THE CALL ON THE WEATHER IS ' || sentence || '.'
  end;

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

comment on function private.narrate_game(uuid) is
  'Writes the matchup writeup in an announcer voice from the line score, the weather sentence, and the event tags. A line can name the spot. Each tag that happened is named, up to four. The close is two sentences. A game that already has prose keeps it. Hidden stats are not written.';

comment on column public.games.narrative is
  'The writeup for a final game. Announcer templates over the line score, the spot, and the event tags. A stored writeup is kept. Hidden stats are not in this column.';
