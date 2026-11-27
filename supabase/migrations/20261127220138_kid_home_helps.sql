-- A kid's home help is something that kid or that kid's family can give.
-- The coach's park pick stays one of the five field perks.

alter table public.players drop constraint players_home_perk;

update public.players
set home_perk = case home_perk
  when 'short_fence' then 'mowed_grass'
  when 'fast_grass' then 'brothers_van'
  when 'loud_block' then 'moms_muffins'
  when 'high_sun' then 'sisters_sewing'
  when 'familiar_mound' then 'careful_raking'
  else home_perk
end
where home_perk in ('short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound');

alter table public.players
  add constraint players_home_perk check (
    home_perk is null
    or home_perk in ('moms_muffins', 'brothers_van', 'sisters_sewing', 'careful_raking', 'mowed_grass')
  );

comment on column public.players.home_perk is
  'A help this kid brings to a home game: moms_muffins, brothers_van, sisters_sewing, careful_raking, or mowed_grass. Null means none. The coach''s park pick is separate and stays on the team.';

alter table public.lineup_locks drop constraint lineup_locks_kid_perks;

update public.lineup_locks as locks
set kid_perks = (
  select coalesce(array_agg(distinct next_perk order by next_perk), '{}'::text[])
  from (
    select case perk
      when 'short_fence' then 'mowed_grass'
      when 'fast_grass' then 'brothers_van'
      when 'loud_block' then 'moms_muffins'
      when 'high_sun' then 'sisters_sewing'
      when 'familiar_mound' then 'careful_raking'
      else perk
    end as next_perk
    from unnest(locks.kid_perks) as perk
  ) as rows
)
from public.games as game
where game.id = locks.game_id
  and game.status = 'scheduled';

alter table public.lineup_locks
  add constraint lineup_locks_kid_perks check (
    kid_perks <@ array[
      'short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound',
      'moms_muffins', 'brothers_van', 'sisters_sewing', 'careful_raking', 'mowed_grass'
    ]::text[]
  );

comment on column public.lineup_locks.kid_perks is
  'Home helps the roster brought when this home lock was written. The coach''s park pick is not repeated here. A played game keeps the help it was locked with. Away locks stay empty.';

create or replace function private.roll_home_perk()
returns text
language plpgsql
volatile
set search_path = ''
as $func$
declare
  names text[] := array['moms_muffins', 'brothers_van', 'sisters_sewing', 'careful_raking', 'mowed_grass'];
  pick integer;
begin
  if random() >= 0.05 then
    return null;
  end if;
  pick := 1 + floor(random() * 5)::integer;
  if pick < 1 or pick > 5 then
    return null;
  end if;
  return names[pick];
end;
$func$;

comment on function private.roll_home_perk() is
  'About one in twenty new kids brings one home help, chosen evenly from the five a kid or that kid''s family can give.';

comment on function private.generate_kids(uuid, integer, text) is
  'Inserts neighborhood kids. purpose pool is the forming-season call. purpose recruiting prices each kid from the season rules and the visible stats. About one in four offers a tryout. About one in twenty brings a home help from the kid or the family. Hidden stats cluster on the matching visible stat.';

create or replace function private.home_perk_for(kid_id uuid)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case
    when pg_catalog.get_byte(
      pg_catalog.decode(pg_catalog.substr(pg_catalog.md5(kid_id::text), 1, 2), 'hex'),
      0
    ) % 20 = 0
    then (
      array['moms_muffins', 'brothers_van', 'sisters_sewing', 'careful_raking', 'mowed_grass']
    )[
      1 + (
        pg_catalog.get_byte(
          pg_catalog.decode(pg_catalog.substr(pg_catalog.md5(kid_id::text || ':perk'), 1, 2), 'hex'),
          0
        ) % 5
      )
    ]
    else null
  end;
$func$;

comment on function private.home_perk_for(uuid) is
  'A stable home help for a kid id. The same id always returns the same help. About one in twenty are set. New kids use roll_home_perk. This does not rewrite kids already stored.';

create or replace function private.stamp_home_perk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  chosen text;
  brought text[];
begin
  new.home_perk := null;
  new.kid_perks := '{}'::text[];
  if new.game_id is null or new.team_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.games as game
    where game.id = new.game_id
      and game.home_team_id = new.team_id
  ) then
    return new;
  end if;

  select team.home_perk into chosen
  from public.teams as team
  where team.id = new.team_id;

  new.home_perk := chosen;

  select coalesce(array_agg(distinct kid.home_perk order by kid.home_perk), '{}'::text[])
  into brought
  from public.players as kid
  where kid.team_id = new.team_id
    and kid.home_perk in ('moms_muffins', 'brothers_van', 'sisters_sewing', 'careful_raking', 'mowed_grass')
    and kid.home_perk is distinct from chosen;

  new.kid_perks := brought;
  return new;
end;
$func$;

comment on function private.stamp_home_perk() is
  'A new home lock freezes the coach''s park pick and the family helps the roster brings. The same help is stored once. An away lock stores none.';

create or replace function private.load_side(target_game uuid, target_team uuid)
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
  perk text;
  extras text[];
begin
  select locks.card, locks.home_perk, locks.kid_perks
  into card, perk, extras
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

  if extras is null then
    extras := '{}'::text[];
  end if;
  if perk is not null or cardinality(extras) > 0 then
    perform 1
    from public.games as game
    where game.id = target_game
      and game.home_team_id = target_team;
    if not found then
      perk := null;
      extras := '{}'::text[];
    end if;
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
    order by private.batting_rank(elem), (elem ->> 'slot')::integer
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
    if perk = 'short_fence' or 'short_fence' = any (extras) then
      power := power + 4;
    end if;
    if perk = 'fast_grass' or 'fast_grass' = any (extras) then
      speed := speed + 4;
    end if;
    if perk = 'loud_block' or 'loud_block' = any (extras) then
      contact := contact + 4;
    end if;
    if perk = 'high_sun' or 'high_sun' = any (extras) then
      glove := glove + 4;
    end if;
    if perk = 'familiar_mound' or 'familiar_mound' = any (extras) then
      cmd := cmd + 4;
      fade := fade + 4;
    end if;
    if 'moms_muffins' = any (extras) then
      fade := fade + 4;
    end if;
    if 'brothers_van' = any (extras) then
      speed := speed + 4;
    end if;
    if 'sisters_sewing' = any (extras) then
      glove := glove + 4;
    end if;
    if 'careful_raking' = any (extras) then
      cmd := cmd + 4;
    end if;
    if 'mowed_grass' = any (extras) then
      power := power + 4;
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
  'The locked nine for one side, blended for the simulator. Kids bat in the frozen batting order. A home lock adds 4 for its frozen coach perk: short_fence power, fast_grass speed, loud_block contact, high_sun glove, familiar_mound command and fade. Each family help on that lock adds 4 once: moms_muffins fade, brothers_van speed, sisters_sewing glove, careful_raking command, mowed_grass power. An away side gains none. The blend is not returned to the client.';
