-- The commissioner can play one locked game. The result is the line score,
-- the kid lines, and the event tags. Narrative, standings, and the purse wait.

create function private.game_roll(seed bigint, draw_index integer)
returns numeric
language sql
immutable
set search_path = ''
as $func$
  select (('x' || substr(md5('pa:' || seed::text || ':' || draw_index::text), 1, 6))::bit(24)::integer)::numeric
    / 16777216;
$func$;

comment on function private.game_roll(bigint, integer) is
  'A unit draw in [0, 1) for one plate appearance. The pa prefix keeps it off the weather draws.';

revoke all on function private.game_roll(bigint, integer) from public, anon, authenticated, service_role;

create function private.blend_rating(visible_value numeric, hidden jsonb, keys text[])
returns numeric
language plpgsql
immutable
set search_path = ''
as $func$
declare
  vis numeric := least(greatest(coalesce(visible_value, 50), 1), 100);
  total numeric := 0;
  seen integer := 0;
  key text;
  raw numeric;
begin
  if hidden is not null and keys is not null then
    foreach key in array keys loop
      if jsonb_typeof(hidden -> key) = 'number' then
        raw := least(greatest((hidden ->> key)::numeric, 1), 100);
        total := total + raw;
        seen := seen + 1;
      end if;
    end loop;
  end if;
  if seen = 0 then
    return vis;
  end if;
  return vis * 0.6 + (total / seen) * 0.4;
end;
$func$;

comment on function private.blend_rating(numeric, jsonb, text[]) is
  'Visible rating blended with the hidden keys that feed it. The blend stays inside the simulator.';

revoke all on function private.blend_rating(numeric, jsonb, text[]) from public, anon, authenticated, service_role;

create function private.bump_line(doc jsonb, idx integer, stat text, n integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  cur integer;
begin
  if doc is null or idx is null or idx < 1 or n is null or n = 0 then
    return doc;
  end if;
  if stat not in ('ab', 'h', 'r', 'rbi', 'bb', 'k', 'outs') then
    return doc;
  end if;
  cur := coalesce((doc -> (idx - 1) ->> stat)::integer, 0);
  return jsonb_set(doc, array[(idx - 1)::text, stat], to_jsonb(cur + n), true);
end;
$func$;

comment on function private.bump_line(jsonb, integer, text, integer) is
  'Adds to one counting stat on a working lineup. Hidden ratings are not a stat it will write.';

revoke all on function private.bump_line(jsonb, integer, text, integer) from public, anon, authenticated, service_role;

create function private.score_group(lineup jsonb, runners integer[], batter integer, credit_rbi boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $func$
declare
  doc jsonb := lineup;
  who integer;
  runs integer := 0;
begin
  if runners is not null then
    foreach who in array runners loop
      if who is null or who < 1 then
        continue;
      end if;
      doc := private.bump_line(doc, who, 'r', 1);
      runs := runs + 1;
      if credit_rbi and batter is not null and batter > 0 then
        doc := private.bump_line(doc, batter, 'rbi', 1);
      end if;
    end loop;
  end if;
  return jsonb_build_object('lineup', doc, 'runs', runs);
end;
$func$;

comment on function private.score_group(jsonb, integer[], integer, boolean) is
  'Scores the listed runners and, when asked, credits the batter with those runs batted in.';

revoke all on function private.score_group(jsonb, integer[], integer, boolean) from public, anon, authenticated, service_role;

create function private.line_from(kid jsonb, team uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $func$
  select jsonb_build_object(
    'team_id', team,
    'player_id', kid ->> 'player_id',
    'slot', (kid ->> 'slot')::integer,
    'name', kid ->> 'name',
    'ab', coalesce((kid ->> 'ab')::integer, 0),
    'h', coalesce((kid ->> 'h')::integer, 0),
    'r', coalesce((kid ->> 'r')::integer, 0),
    'rbi', coalesce((kid ->> 'rbi')::integer, 0),
    'bb', coalesce((kid ->> 'bb')::integer, 0),
    'k', coalesce((kid ->> 'k')::integer, 0),
    'outs', coalesce((kid ->> 'outs')::integer, 0)
  );
$func$;

comment on function private.line_from(jsonb, uuid) is
  'One kid line for the stored result. Counting stats and the name only.';

revoke all on function private.line_from(jsonb, uuid) from public, anon, authenticated, service_role;

create function private.load_side(target_game uuid, target_team uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $func$
declare
  card jsonb;
  secret jsonb;
  kids jsonb := '[]'::jsonb;
  row jsonb;
  item jsonb;
  gloves boolean := false;
  bat_slots integer[] := '{}';
  slot_no integer;
  base jsonb;
  hidden jsonb;
  given text;
  family text;
  kid_name text;
  eye numeric;
  contact numeric;
  power numeric;
  speed numeric;
  glove numeric;
  arm numeric;
  cmd numeric;
  fade numeric;
  heat numeric;
  penalized boolean;
  vis_arm numeric;
  vis_stamina numeric;
begin
  select locks.card
  into card
  from public.lineup_locks as locks
  where locks.game_id = target_game
    and locks.team_id = target_team;

  select sec.kids
  into secret
  from private.lineup_lock_secrets as sec
  where sec.game_id = target_game
    and sec.team_id = target_team;

  if card is null or secret is null or jsonb_typeof(secret) is distinct from 'array' then
    raise exception 'THE CARD IS NOT LOCKED';
  end if;

  for item in select elem from jsonb_array_elements(coalesce(card -> 'items', '[]'::jsonb)) as elem
  loop
    if item -> 'effect' ->> 'kind' = 'gloves' then
      gloves := true;
    elsif item -> 'effect' ->> 'kind' = 'bat' and (item -> 'effect' ->> 'slot') ~ '^[1-9]$' then
      bat_slots := bat_slots || (item -> 'effect' ->> 'slot')::integer;
    end if;
  end loop;

  for row in
    select elem
    from jsonb_array_elements(secret) as elem
    order by (elem ->> 'slot')::integer
  loop
    if jsonb_typeof(row) is distinct from 'object' then
      continue;
    end if;
    slot_no := (row ->> 'slot')::integer;
    if slot_no is null or slot_no < 1 or slot_no > 9 or row ->> 'player_id' is null then
      continue;
    end if;

    base := coalesce(row -> 'base_stats', '{}'::jsonb);
    hidden := coalesce(row -> 'hidden_stats', '{}'::jsonb);
    given := null;
    family := null;

    select elem ->> 'given_name', elem ->> 'family_name'
    into given, family
    from jsonb_array_elements(coalesce(card -> 'slots', '[]'::jsonb)) as elem
    where elem ->> 'player_id' = row ->> 'player_id'
    limit 1;

    kid_name := nullif(btrim(concat_ws(' ', given, family)), '');
    if kid_name is null then
      kid_name := 'KID';
    end if;

    eye := private.blend_rating(coalesce((base ->> 'eye')::numeric, 50), hidden, array['pitch_recognition', 'patience', 'chase_discipline', 'strike_zone_judgment']);
    contact := private.blend_rating(coalesce((base ->> 'contact')::numeric, 50), hidden, array['barrel_accuracy', 'swing_timing', 'soft_contact', 'consistency', 'two_strike_fight']);
    power := private.blend_rating(coalesce((base ->> 'power')::numeric, 50), hidden, array['raw_strength', 'launch_tendency', 'backspin_carry']);
    speed := private.blend_rating(coalesce((base ->> 'speed')::numeric, 50), hidden, array['top_speed', 'slide_agility', 'first_step', 'baserunning_reads']);
    glove := private.blend_rating(coalesce((base ->> 'glove')::numeric, 50), hidden, array['hands_softness', 'range_first_step', 'reaction', 'reliability']);
    vis_arm := coalesce((base ->> 'arm')::numeric, 50);
    vis_stamina := coalesce((base ->> 'stamina')::numeric, 50);
    arm := private.blend_rating(vis_arm, hidden, array['arm_strength', 'accuracy', 'release_quickness', 'carry']);
    cmd := private.blend_rating((vis_arm + vis_stamina) / 2, hidden, array['arm_strength', 'accuracy', 'release_quickness', 'carry']);
    fade := private.blend_rating(vis_stamina, hidden, array['late_game_energy', 'recovery', 'focus_endurance', 'fade_resistance']);
    heat := least(100, greatest(1, coalesce((hidden ->> 'heat_weather_tolerance')::numeric, vis_stamina)));

    penalized := nullif(row ->> 'penalty_until_game_id', '') is not null;
    if penalized then
      eye := eye * 0.92;
      contact := contact * 0.92;
      power := power * 0.92;
      speed := speed * 0.92;
      glove := glove * 0.92;
      arm := arm * 0.92;
      cmd := cmd * 0.92;
    end if;
    if gloves then
      glove := glove + 6;
    end if;

    eye := least(100, greatest(1, eye));
    contact := least(100, greatest(1, contact));
    power := least(100, greatest(1, power));
    speed := least(100, greatest(1, speed));
    glove := least(100, greatest(1, glove));
    arm := least(100, greatest(1, arm));
    cmd := least(100, greatest(1, cmd));
    fade := least(100, greatest(1, fade));

    kids := kids || jsonb_build_array(jsonb_build_object(
      'player_id', row ->> 'player_id',
      'slot', slot_no,
      'name', kid_name,
      'eye', eye,
      'contact', contact,
      'power', power,
      'speed', speed,
      'glove', glove,
      'arm', arm,
      'cmd', cmd,
      'fade', fade,
      'heat', heat,
      'bat', slot_no = any (bat_slots),
      'tryout', row ->> 'tryout_status' = 'playing',
      'penalty', penalized,
      'sparked', false,
      'penned', false,
      'ab', 0,
      'h', 0,
      'r', 0,
      'rbi', 0,
      'bb', 0,
      'k', 0,
      'outs', 0
    ));
  end loop;

  return kids;
end;
$func$;

comment on function private.load_side(uuid, uuid) is
  'The locked nine for one side, with hidden ratings already blended. The blend is not returned to the client.';

revoke all on function private.load_side(uuid, uuid) from public, anon, authenticated, service_role;

create function private.play_half(ctx jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $func$
declare
  seed bigint := (ctx ->> 'seed')::bigint;
  pa integer := coalesce((ctx ->> 'pa')::integer, 0);
  inning integer := coalesce((ctx ->> 'inning')::integer, 1);
  half_name text := coalesce(ctx ->> 'half', 'top');
  lineup jsonb := coalesce(ctx -> 'lineup', '[]'::jsonb);
  fielding jsonb := coalesce(ctx -> 'fielding', '[]'::jsonb);
  bat integer := coalesce((ctx ->> 'bat')::integer, 0);
  team_runs integer := coalesce((ctx ->> 'team_runs')::integer, 0);
  other_runs integer := coalesce((ctx ->> 'other_runs')::integer, 0);
  walkoff boolean := coalesce((ctx ->> 'walkoff')::boolean, false);
  contact_mul numeric := coalesce((ctx ->> 'contact_mul')::numeric, 1);
  power_mul numeric := coalesce((ctx ->> 'power_mul')::numeric, 1);
  error_mul numeric := coalesce((ctx ->> 'error_mul')::numeric, 1);
  hot_fade numeric := coalesce((ctx ->> 'hot_fade')::numeric, 0);
  sky text := coalesce(ctx ->> 'sky', 'clear');
  wind text := coalesce(ctx ->> 'wind', 'calm');
  strength numeric := coalesce((ctx ->> 'strength')::numeric, 1);
  n integer;
  field_n integer;
  outs integer := 0;
  half_runs integer := 0;
  half_hits integer := 0;
  half_errors integer := 0;
  events jsonb := '[]'::jsonb;
  b1 integer := 0;
  b2 integer := 0;
  b3 integer := 0;
  idx integer;
  pit integer := 0;
  i integer;
  glove_sum numeric := 0;
  glove_n integer := 0;
  arm_sum numeric := 0;
  arm_n integer := 0;
  field_glove numeric := 50;
  field_arm numeric := 50;
  cmd numeric := 50;
  fade_amt numeric := 0;
  fade_rating numeric := 50;
  heat_tol numeric := 50;
  eye numeric;
  contact numeric;
  power numeric;
  speed numeric;
  r0 numeric;
  r1 numeric;
  r2 numeric;
  r3 numeric;
  r4 numeric;
  r5 numeric;
  walk_p numeric;
  k_p numeric;
  hit_p numeric;
  error_p numeric;
  hr_p numeric;
  tp_p numeric;
  db_p numeric;
  attempt numeric;
  thrown numeric;
  scale numeric;
  faded boolean := false;
  scored jsonb;
  runner integer;
begin
  n := coalesce(jsonb_array_length(lineup), 0);
  field_n := coalesce(jsonb_array_length(fielding), 0);

  for i in 0..field_n - 1 loop
    if (fielding -> i ->> 'slot')::integer = 1 and pit = 0 then
      pit := i + 1;
    elsif (fielding -> i ->> 'slot')::integer between 2 and 9 then
      glove_sum := glove_sum + coalesce((fielding -> i ->> 'glove')::numeric, 50);
      arm_sum := arm_sum + coalesce((fielding -> i ->> 'arm')::numeric, 50);
      glove_n := glove_n + 1;
      arm_n := arm_n + 1;
    end if;
  end loop;
  if glove_n > 0 then
    field_glove := glove_sum / glove_n;
    field_arm := arm_sum / arm_n;
  end if;
  if pit > 0 then
    cmd := coalesce((fielding -> (pit - 1) ->> 'cmd')::numeric, 50);
    fade_rating := coalesce((fielding -> (pit - 1) ->> 'fade')::numeric, 50);
    heat_tol := coalesce((fielding -> (pit - 1) ->> 'heat')::numeric, 50);
  end if;
  if inning >= 7 then
    fade_amt := greatest(0, (65 - fade_rating) / 180);
    if hot_fade > 0 then
      fade_amt := fade_amt + hot_fade * least(1.5, greatest(0.25, 1 - (heat_tol - 50) / 120));
    end if;
    fade_amt := least(0.40, greatest(0, fade_amt));
    cmd := cmd * (1 - fade_amt);
    field_glove := field_glove * (1 - fade_amt * 0.55);
  end if;

  if n = 0 then
    if pit > 0 then
      fielding := private.bump_line(fielding, pit, 'outs', 3);
    end if;
    return jsonb_build_object(
      'lineup', lineup,
      'fielding', fielding,
      'bat', bat,
      'pa', pa,
      'half_runs', 0,
      'half_hits', 0,
      'half_errors', 0,
      'events', events
    );
  end if;

  while outs < 3 loop
    if walkoff and (team_runs + half_runs) > other_runs then
      exit;
    end if;
    if pa >= 400 then
      raise exception 'THE GAME RAN TOO LONG';
    end if;

    idx := (bat % n) + 1;
    bat := bat + 1;
    r0 := private.game_roll(seed, pa * 8);
    r1 := private.game_roll(seed, pa * 8 + 1);
    r2 := private.game_roll(seed, pa * 8 + 2);
    r3 := private.game_roll(seed, pa * 8 + 3);
    r4 := private.game_roll(seed, pa * 8 + 4);
    r5 := private.game_roll(seed, pa * 8 + 5);
    pa := pa + 1;

    if (lineup -> (idx - 1) ->> 'tryout') = 'true'
      and (lineup -> (idx - 1) ->> 'sparked') is distinct from 'true' then
      events := events || jsonb_build_array(jsonb_build_object(
        'inning', inning,
        'half', half_name,
        'tag', 'tryout_spark',
        'batter_id', lineup -> (idx - 1) ->> 'player_id',
        'name', lineup -> (idx - 1) ->> 'name'
      ));
      lineup := jsonb_set(lineup, array[(idx - 1)::text, 'sparked'], 'true'::jsonb, true);
    end if;
    if (lineup -> (idx - 1) ->> 'penalty') = 'true'
      and (lineup -> (idx - 1) ->> 'penned') is distinct from 'true' then
      events := events || jsonb_build_array(jsonb_build_object(
        'inning', inning,
        'half', half_name,
        'tag', 'penalty_effort',
        'batter_id', lineup -> (idx - 1) ->> 'player_id',
        'name', lineup -> (idx - 1) ->> 'name'
      ));
      lineup := jsonb_set(lineup, array[(idx - 1)::text, 'penned'], 'true'::jsonb, true);
    end if;
    if inning >= 7 and fade_amt > 0.08 and not faded then
      events := events || jsonb_build_array(jsonb_build_object(
        'inning', inning,
        'half', half_name,
        'tag', 'late_fade',
        'batter_id', case when pit > 0 then fielding -> (pit - 1) ->> 'player_id' else lineup -> (idx - 1) ->> 'player_id' end,
        'name', case when pit > 0 then fielding -> (pit - 1) ->> 'name' else lineup -> (idx - 1) ->> 'name' end
      ));
      faded := true;
    end if;

    eye := coalesce((lineup -> (idx - 1) ->> 'eye')::numeric, 50);
    contact := coalesce((lineup -> (idx - 1) ->> 'contact')::numeric, 50);
    walk_p := least(0.20, greatest(0.03, 0.05 + (eye - cmd) / 400));
    k_p := least(0.32, greatest(0.05, 0.10 + (cmd - eye) / 350));
    if walk_p + k_p > 0.85 then
      scale := 0.85 / (walk_p + k_p);
      walk_p := walk_p * scale;
      k_p := k_p * scale;
    end if;

    if r0 < walk_p then
      lineup := private.bump_line(lineup, idx, 'bb', 1);
      if b1 > 0 and b2 > 0 and b3 > 0 then
        scored := private.score_group(lineup, array[b3], idx, true);
        lineup := scored -> 'lineup';
        half_runs := half_runs + (scored ->> 'runs')::integer;
        b3 := b2;
        b2 := b1;
        b1 := idx;
      elsif b1 > 0 and b2 > 0 then
        b3 := b2;
        b2 := b1;
        b1 := idx;
      elsif b1 > 0 then
        b2 := b1;
        b1 := idx;
      else
        b1 := idx;
      end if;
    elsif r0 < walk_p + k_p then
      lineup := private.bump_line(lineup, idx, 'ab', 1);
      lineup := private.bump_line(lineup, idx, 'k', 1);
      outs := outs + 1;
      if pit > 0 then
        fielding := private.bump_line(fielding, pit, 'outs', 1);
      end if;
    else
      hit_p := least(0.50, greatest(0.15, 0.28 + (contact - field_glove) / 300));
      hit_p := least(0.70, greatest(0.05, hit_p * contact_mul));
      error_p := least(0.12, greatest(0.01, (0.02 + greatest(0, 55 - field_glove) / 800) * error_mul));
      if hit_p + error_p > 0.92 then
        error_p := greatest(0.01, 0.92 - hit_p);
      end if;

      if r1 < hit_p then
        lineup := private.bump_line(lineup, idx, 'ab', 1);
        lineup := private.bump_line(lineup, idx, 'h', 1);
        half_hits := half_hits + 1;
        power := coalesce((lineup -> (idx - 1) ->> 'power')::numeric, 50) * power_mul;
        if (lineup -> (idx - 1) ->> 'bat') = 'true' then
          power := power * 1.15;
        end if;
        speed := coalesce((lineup -> (idx - 1) ->> 'speed')::numeric, 50);
        hr_p := least(0.22, greatest(0.01, 0.04 + (power - 50) / 350));
        tp_p := least(0.08, greatest(0.005, 0.015 + (speed - 50) / 900));
        db_p := least(0.30, greatest(0.08, 0.14 + (power - 45) / 500 + (speed - 50) / 800));

        if r2 < hr_p then
          scored := private.score_group(lineup, array[b3, b2, b1, idx], idx, true);
          lineup := scored -> 'lineup';
          half_runs := half_runs + (scored ->> 'runs')::integer;
          b1 := 0;
          b2 := 0;
          b3 := 0;
          if wind = 'out' then
            events := events || jsonb_build_array(jsonb_build_object(
              'inning', inning,
              'half', half_name,
              'tag', 'wind_carried',
              'batter_id', lineup -> (idx - 1) ->> 'player_id',
              'name', lineup -> (idx - 1) ->> 'name'
            ));
          end if;
        elsif r2 < hr_p + tp_p then
          scored := private.score_group(lineup, array[b3, b2, b1], idx, true);
          lineup := scored -> 'lineup';
          half_runs := half_runs + (scored ->> 'runs')::integer;
          b1 := 0;
          b2 := 0;
          b3 := idx;
        elsif r2 < hr_p + tp_p + db_p then
          scored := private.score_group(lineup, array[b3, b2], idx, true);
          lineup := scored -> 'lineup';
          half_runs := half_runs + (scored ->> 'runs')::integer;
          b3 := 0;
          b2 := 0;
          if b1 > 0 then
            b3 := b1;
          end if;
          b1 := 0;
          b2 := idx;
        else
          if b3 > 0 then
            scored := private.score_group(lineup, array[b3], idx, true);
            lineup := scored -> 'lineup';
            half_runs := half_runs + (scored ->> 'runs')::integer;
            b3 := 0;
          end if;
          if b2 > 0 then
            attempt := least(0.60, greatest(0.05, 0.12 + (speed - field_arm) / 220));
            thrown := least(0.75, greatest(0.15, 0.40 + (field_arm - speed) / 200));
            if outs < 2 and r3 < attempt then
              if r4 < thrown then
                runner := b2;
                outs := outs + 1;
                if pit > 0 then
                  fielding := private.bump_line(fielding, pit, 'outs', 1);
                end if;
                events := events || jsonb_build_array(jsonb_build_object(
                  'inning', inning,
                  'half', half_name,
                  'tag', 'awkward_slide',
                  'batter_id', lineup -> (runner - 1) ->> 'player_id',
                  'name', lineup -> (runner - 1) ->> 'name'
                ));
                b2 := 0;
              else
                scored := private.score_group(lineup, array[b2], idx, true);
                lineup := scored -> 'lineup';
                half_runs := half_runs + (scored ->> 'runs')::integer;
                b2 := 0;
              end if;
            else
              b3 := b2;
              b2 := 0;
            end if;
          end if;
          if b1 > 0 then
            b2 := b1;
            b1 := 0;
          end if;
          b1 := idx;
        end if;
      elsif r1 < hit_p + error_p then
        lineup := private.bump_line(lineup, idx, 'ab', 1);
        half_errors := half_errors + 1;
        if sky in ('light_rain', 'heavy_rain') then
          events := events || jsonb_build_array(jsonb_build_object(
            'inning', inning,
            'half', half_name,
            'tag', 'rain_misplay',
            'batter_id', lineup -> (idx - 1) ->> 'player_id',
            'name', lineup -> (idx - 1) ->> 'name'
          ));
        end if;
        if b3 > 0 then
          scored := private.score_group(lineup, array[b3], idx, false);
          lineup := scored -> 'lineup';
          half_runs := half_runs + (scored ->> 'runs')::integer;
        end if;
        b3 := b2;
        b2 := b1;
        b1 := idx;
      else
        lineup := private.bump_line(lineup, idx, 'ab', 1);
        if b1 > 0 and outs <= 1 and r4 < 0.16 then
          outs := outs + 2;
          b1 := 0;
          if pit > 0 then
            fielding := private.bump_line(fielding, pit, 'outs', 2);
          end if;
        else
          outs := outs + 1;
          if pit > 0 then
            fielding := private.bump_line(fielding, pit, 'outs', 1);
          end if;
        end if;
        if sky = 'fog' and r5 < least(0.40, 0.22 * strength) then
          events := events || jsonb_build_array(jsonb_build_object(
            'inning', inning,
            'half', half_name,
            'tag', 'fog_lost',
            'batter_id', lineup -> (idx - 1) ->> 'player_id',
            'name', lineup -> (idx - 1) ->> 'name'
          ));
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'lineup', lineup,
    'fielding', fielding,
    'bat', bat,
    'pa', pa,
    'half_runs', half_runs,
    'half_hits', half_hits,
    'half_errors', half_errors,
    'events', events
  );
end;
$func$;

comment on function private.play_half(jsonb) is
  'One half inning from the blended card. Outs, runs, and hits stay on the working lineups.';

revoke all on function private.play_half(jsonb) from public, anon, authenticated, service_role;

create function private.simulate_game(target_game uuid)
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

  sky := weather ->> 'sky';
  wind := weather ->> 'wind';
  heat := weather ->> 'heat';
  if sky = 'light_rain' then
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
  elsif heat = 'hot' then
    hot_fade := 0.10 * strength;
  end if;
  if wind = 'in' then
    power_mul := power_mul * (1 - 0.15 * strength);
  elsif wind = 'out' then
    power_mul := power_mul * (1 + 0.18 * strength);
  end if;

  select
    count(*) filter (where item -> 'effect' ->> 'kind' = 'baseballs'),
    count(*) filter (where item -> 'effect' ->> 'kind' = 'ice_pops'),
    coalesce(bool_or(item -> 'effect' ->> 'kind' = 'field'), false)
  into ball_n, ice_n, has_field
  from public.lineup_locks as locks
  cross join lateral jsonb_array_elements(locks.card -> 'items') as packed(item)
  where locks.game_id = target_game
    and locks.team_id in (away_id, home_id);

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

  for inning in 1..12 loop
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
      result = built
  where games.id = target_game;

  return built;
end;
$func$;

comment on function private.simulate_game(uuid) is
  'Plays a scheduled game from the lock snapshot and the seed. A final game returns the stored result. Narrative stays empty.';

revoke all on function private.simulate_game(uuid) from public, anon, authenticated, service_role;
grant execute on function private.simulate_game(uuid) to authenticated;

create function public.play_game_now(game_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $func$
  select private.simulate_game(game_id);
$func$;

comment on function public.play_game_now(uuid) is
  'The commissioner plays one locked game while the clock is still being checked.';

revoke all on function public.play_game_now(uuid) from public, anon;
grant execute on function public.play_game_now(uuid) to authenticated;

alter table public.games
  add constraint games_result_shape check (
    result is null
    or (
      jsonb_typeof(result -> 'innings') = 'array'
      and jsonb_typeof(result -> 'lines') = 'array'
      and jsonb_typeof(result -> 'events') = 'array'
      and jsonb_typeof(result -> 'away') = 'object'
      and jsonb_typeof(result -> 'home') = 'object'
      and jsonb_typeof(result -> 'away' -> 'runs') = 'number'
      and jsonb_typeof(result -> 'home' -> 'runs') = 'number'
      and result ->> 'winner' in ('home', 'away', 'tie')
    )
  );

comment on column public.games.result is
  'Null while scheduled. A final game stores the line score, kid lines, and event tags. Hidden stats are not in this column.';

comment on column public.games.seed is
  'Deterministic counter for this game. Weather and the simulator both use it. Not granted to the client.';
