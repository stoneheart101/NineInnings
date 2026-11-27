-- The coach picks one home-field advantage, and that pick cannot change.
-- Kids may bring another. About one in twenty new kids does.
-- A kid's advantage adds on at home and does not stack with the same one.
-- An away lock stores none. A lock freezes both.

alter table public.lineup_locks
  add column kid_perks text[] not null default '{}',
  add constraint lineup_locks_kid_perks check (
    kid_perks <@ array['short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound']::text[]
  );

comment on column public.lineup_locks.kid_perks is
  'Other home perks the roster brought when this home lock was written. The coach''s perk is not repeated here. Away locks stay empty. A later roster change does not move a locked game.';

comment on column public.lineup_locks.home_perk is
  'The coach''s home perk frozen with this lock. Away locks stay null. A later choice does not move a locked game.';

comment on column public.teams.home_perk is
  'The one home-field perk this coach chose. Once set, it cannot change. A game does not spend it. Null means the coach has not chosen. Kid perks are separate.';

grant select (kid_perks) on table public.lineup_locks to authenticated;

create or replace function private.roll_home_perk()
returns text
language plpgsql
volatile
set search_path = ''
as $func$
declare
  names text[] := array['short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound'];
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
  'About one in twenty new kids brings one home-field perk, chosen evenly from the five.';

comment on function private.generate_kids(uuid, integer, text) is
  'Inserts neighborhood kids. purpose pool is the forming-season call. purpose recruiting prices each kid from the season rules and the visible stats. About one in four offers a tryout. About one in twenty brings a home-field perk. Hidden stats cluster on the matching visible stat.';

create or replace function private.release_player(target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  kid public.players;
  owner uuid;
  game_running boolean := false;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into kid
  from public.players
  where id = target_player
  for update;

  if not found then
    raise exception 'THAT KID IS NOT HERE';
  end if;
  if kid.team_id is null then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  select coach_id into owner
  from public.teams
  where id = kid.team_id
  for update;

  if owner is distinct from uid then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  if to_regclass('public.games') is not null then
    execute $sql$
      select exists (
        select 1
        from public.games
        where is_practice = false
          and status not in ('scheduled', 'final')
          and (home_team_id = $1 or away_team_id = $1)
      )
    $sql$
    into game_running
    using kid.team_id;
    if game_running then
      raise exception 'A GAME IS IN PROGRESS';
    end if;
  end if;

  update public.players
  set team_id = null
  where id = target_player
    and team_id = kid.team_id;
  if not found then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  delete from public.lineups
  where player_id = target_player;

end;
$func$;

comment on function private.release_player(uuid) is
  'The kid''s coach clears team_id and drops that kid from the lineup. The perk leaves with the kid. The coach''s home field stays.';

create or replace function private.set_home_perk(target_team uuid, perk text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owner uuid;
  held text;
  cleaned text;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  cleaned := nullif(lower(btrim(coalesce(perk, ''))), '');
  if cleaned is not null
    and cleaned not in ('short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound') then
    raise exception 'THAT PERK IS NOT HERE';
  end if;

  select coach_id, home_perk into owner, held
  from public.teams
  where id = target_team
  for update;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if owner is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  if held is not null then
    if cleaned is not distinct from held then
      return;
    end if;
    raise exception 'THE HOME FIELD CANNOT BE CHANGED';
  end if;

  if cleaned is null then
    raise exception 'PICK A HOME FIELD';
  end if;

  update public.teams
  set home_perk = cleaned
  where id = target_team;
end;
$func$;

comment on function private.set_home_perk(uuid, text) is
  'The owning coach chooses one home-field perk. A second choice is refused. A game does not spend it. The roster does not have to bring it.';

comment on function public.set_home_perk(uuid, text) is
  'Signed-in coach chooses the home-field perk on their own team. A second choice is refused.';

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
    and kid.home_perk is not null
    and kid.home_perk is distinct from chosen;

  new.kid_perks := brought;
  return new;
end;
$func$;

comment on function private.stamp_home_perk() is
  'A new home lock freezes the coach''s perk and the other perks the roster brings. An away lock stores none.';

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
  'The locked nine for one side, blended for the simulator. Kids bat in the frozen batting order. A home lock adds 4 for its frozen coach perk and for each other perk the roster brought: short_fence power, fast_grass speed, loud_block contact, high_sun glove, familiar_mound command and fade. The same perk adds once. An away side gains none. The blend is not returned to the client.';

alter publication supabase_realtime drop table public.lineup_locks;
alter publication supabase_realtime add table public.lineup_locks (
  game_id,
  team_id,
  locked_at,
  home_perk,
  kid_perks
);
