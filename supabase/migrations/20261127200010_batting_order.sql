-- The batting order is separate from the field slots. The mound still
-- pitches and the other slots still field. A game does not start until
-- both the nine and the order are filled. A stored lock keeps the order
-- it was given. A lock from before this column existed still bats in
-- slot order.

alter table public.lineups
  add column batting_order smallint;

alter table public.lineups
  add constraint lineups_batting_order check (batting_order between 1 and 9);

create unique index lineups_team_batting_order_idx
  on public.lineups (team_id, batting_order)
  where batting_order is not null;

comment on column public.lineups.batting_order is
  'Where this fielder bats, 1 through 9. Empty until the coach sets it. The field slot is unchanged.';

grant select (batting_order) on table public.lineups to authenticated;

create function private.batting_rank(kid jsonb)
returns integer
language sql
immutable
set search_path = ''
as $func$
  select case
    when coalesce(kid ->> 'batting_order', '') ~ '^[1-9]$'
      then (kid ->> 'batting_order')::integer
    else coalesce((kid ->> 'slot')::integer, 99)
  end;
$func$;

comment on function private.batting_rank(jsonb) is
  'Sort key for one locked kid. The batting order wins. A card without one falls back to the field slot.';

revoke all on function private.batting_rank(jsonb) from public, anon, authenticated, service_role;

create function private.batting_order_ready(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $func$
  select count(*) = 9
    and count(distinct seat.batting_order) filter (where seat.batting_order between 1 and 9) = 9
  from public.lineups as seat
  where seat.team_id = target_team;
$func$;

comment on function private.batting_order_ready(uuid) is
  'True when the nine fielders also fill batting spots 1 through 9.';

revoke all on function private.batting_order_ready(uuid) from public, anon, authenticated, service_role;

create or replace function private.set_lineup(target_team uuid, slots jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owner uuid;
  item record;
  raw text;
  chosen uuid;
  picked uuid[] := '{}'::uuid[];
  slot_list integer[] := '{}'::integer[];
  kept_id uuid[] := '{}'::uuid[];
  kept_order integer[] := '{}'::integer[];
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  if slots is null or jsonb_typeof(slots) <> 'object' then
    raise exception 'THE LINEUP IS NOT READY';
  end if;

  for item in
    select entry.key, entry.value
    from jsonb_each(slots) as entry
  loop
    if item.key !~ '^[1-9]$' then
      raise exception 'THAT SLOT IS NOT ON THE CARD';
    end if;
    if jsonb_typeof(item.value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(item.value) <> 'string' then
      raise exception 'THE LINEUP IS NOT READY';
    end if;
    raw := btrim(item.value #>> '{}');
    if raw = '' then
      continue;
    end if;
    begin
      chosen := raw::uuid;
    exception
      when invalid_text_representation then
        raise exception 'THE LINEUP IS NOT READY';
    end;
    if chosen = any (picked) then
      raise exception 'THAT KID IS ALREADY IN THE LINEUP';
    end if;
    picked := picked || chosen;
    slot_list := slot_list || item.key::integer;
  end loop;

  if cardinality(picked) > 0 then
    perform 1
    from public.players
    where id = any (picked)
    order by id
    for update;
  end if;

  select coach_id into owner
  from public.teams
  where id = target_team
  for update;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if owner is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  if (
    select count(*)
    from public.players
    where id = any (picked)
      and team_id = target_team
  ) is distinct from cardinality(picked) then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  select
    coalesce(array_agg(seat.player_id order by seat.player_id), '{}'::uuid[]),
    coalesce(array_agg(seat.batting_order::integer order by seat.player_id), '{}'::integer[])
  into kept_id, kept_order
  from public.lineups as seat
  where seat.team_id = target_team;

  delete from public.lineups
  where team_id = target_team;

  insert into public.lineups (team_id, player_id, slot, batting_order)
  select
    target_team,
    picked[i],
    slot_list[i],
    (
      select kept_order[j]
      from generate_subscripts(kept_id, 1) as j
      where kept_id[j] = picked[i]
      limit 1
    )
  from generate_subscripts(picked, 1) as i;
end;
$func$;

comment on function private.set_lineup(uuid, jsonb) is
  'The owning coach replaces the whole card. Keys are "1" through "9". A null or blank value leaves that slot empty. A kid who stays on the card keeps the batting spot already saved.';

create function private.set_batting_order(target_team uuid, orders jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owner uuid;
  item record;
  raw text;
  chosen uuid;
  picked uuid[] := '{}'::uuid[];
  spot_list integer[] := '{}'::integer[];
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  if orders is null or jsonb_typeof(orders) <> 'object' then
    raise exception 'THE ORDER IS NOT READY';
  end if;

  for item in
    select entry.key, entry.value
    from jsonb_each(orders) as entry
  loop
    if item.key !~ '^[1-9]$' then
      raise exception 'THAT SPOT IS NOT IN THE ORDER';
    end if;
    if jsonb_typeof(item.value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(item.value) <> 'string' then
      raise exception 'THE ORDER IS NOT READY';
    end if;
    raw := btrim(item.value #>> '{}');
    if raw = '' then
      continue;
    end if;
    begin
      chosen := raw::uuid;
    exception
      when invalid_text_representation then
        raise exception 'THE ORDER IS NOT READY';
    end;
    if chosen = any (picked) then
      raise exception 'THAT KID IS ALREADY IN THE ORDER';
    end if;
    picked := picked || chosen;
    spot_list := spot_list || item.key::integer;
  end loop;

  if cardinality(picked) > 0 then
    perform 1
    from public.players
    where id = any (picked)
    order by id
    for update;
  end if;

  select coach_id into owner
  from public.teams
  where id = target_team
  for update;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if owner is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  if (
    select count(*)
    from public.players
    where id = any (picked)
      and team_id = target_team
  ) is distinct from cardinality(picked) then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  if (
    select count(*)
    from public.lineups
    where team_id = target_team
      and player_id = any (picked)
  ) is distinct from cardinality(picked) then
    raise exception 'THAT KID IS NOT IN THE NINE';
  end if;

  update public.lineups
  set batting_order = null
  where team_id = target_team;

  update public.lineups as seat
  set batting_order = listed.spot
  from (
    select picked[i] as player_id, spot_list[i] as spot
    from generate_subscripts(picked, 1) as i
  ) as listed
  where seat.team_id = target_team
    and seat.player_id = listed.player_id;
end;
$func$;

comment on function private.set_batting_order(uuid, jsonb) is
  'The owning coach sets who bats where. Keys are "1" through "9". Only a kid already in the nine can take a spot. A null or blank value leaves that spot empty.';

revoke all on function private.set_batting_order(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.set_batting_order(uuid, jsonb) to authenticated;

create function public.set_batting_order(team_id uuid, orders jsonb)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.set_batting_order(team_id, orders);
$func$;

comment on function public.set_batting_order(uuid, jsonb) is
  'Signed-in coach saves the batting order on their own nine.';

revoke all on function public.set_batting_order(uuid, jsonb) from public, anon;
grant execute on function public.set_batting_order(uuid, jsonb) to authenticated;

create function private.stamp_batting_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  lined integer;
begin
  select count(*)
  into lined
  from public.lineups as seat
  where seat.team_id = new.team_id;

  if lined = 0 then
    return new;
  end if;

  if not private.batting_order_ready(new.team_id) then
    if lined = 9 then
      raise exception 'ASSIGN THE BATTING ORDER FIRST';
    end if;
    raise exception 'ASSIGN THE NINE FIRST';
  end if;

  new.kids := (
    select coalesce(jsonb_agg(
      case
        when seat.batting_order is null then kid
        else kid || jsonb_build_object('batting_order', seat.batting_order)
      end
      order by seat.batting_order nulls last, (kid ->> 'slot')::integer
    ), '[]'::jsonb)
    from jsonb_array_elements(new.kids) as packed(kid)
    left join public.lineups as seat
      on seat.team_id = new.team_id
     and (packed.kid ->> 'player_id') ~* '^[0-9a-f-]{36}$'
     and seat.player_id = (packed.kid ->> 'player_id')::uuid
  );

  if (
    select count(*)
    from jsonb_array_elements(new.kids) as packed(kid)
    where (packed.kid ->> 'batting_order') ~ '^[1-9]$'
  ) is distinct from 9 then
    raise exception 'ASSIGN THE BATTING ORDER FIRST';
  end if;

  return new;
end;
$func$;

comment on function private.stamp_batting_order() is
  'Freezes the batting order onto a new lock. A full nine with an open order raises ASSIGN THE BATTING ORDER FIRST. A side with no saved card, such as kids who exist only for that game, is left in slot order.';

revoke all on function private.stamp_batting_order() from public, anon, authenticated, service_role;

create trigger lineup_lock_secrets_stamp_order
  before insert on private.lineup_lock_secrets
  for each row
  execute function private.stamp_batting_order();

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
  'The locked nine for one side, blended for the simulator. Kids bat in the frozen batting order. A card locked before that order existed still bats in slot order. The blend is not returned to the client.';
