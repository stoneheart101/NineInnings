-- Home-field perks come with certain kids. The clubhouse chooses one.
-- It stays on for every home game and is not spent. An away lock stores none.
-- A lock freezes the choice. Each perk adds 4 to one home rating.
-- About one in three kids brings a perk. Kids already in the block get one
-- from a stable hash so the board can show it before they are taken.

alter table public.players
  add column home_perk text,
  add constraint players_home_perk check (
    home_perk is null
    or home_perk in ('short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound')
  );

comment on column public.players.home_perk is
  'A home-field perk this kid brings. Null means none. Taking the kid makes it available. It is not a hidden stat.';

alter table public.teams
  add column home_perk text,
  add constraint teams_home_perk check (
    home_perk is null
    or home_perk in ('short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound')
  );

comment on column public.teams.home_perk is
  'The perk this coach chose for home games. It stays on, and a game does not spend it. Null means no edge.';

alter table public.lineup_locks
  add column home_perk text,
  add constraint lineup_locks_home_perk check (
    home_perk is null
    or home_perk in ('short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound')
  );

comment on column public.lineup_locks.home_perk is
  'The home perk frozen with this lock. Away locks stay null. A later clubhouse change does not move a locked game.';

grant select (home_perk) on table public.players to authenticated;
grant select (home_perk) on table public.teams to authenticated;
grant select (home_perk) on table public.lineup_locks to authenticated;

create function private.roll_home_perk()
returns text
language plpgsql
volatile
set search_path = ''
as $func$
declare
  names text[] := array['short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound'];
  pick integer;
begin
  if random() >= (1.0 / 3) then
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
  'About one in three new kids brings one home-field perk, chosen evenly from the five.';

revoke all on function private.roll_home_perk() from public, anon, authenticated, service_role;

create function private.home_perk_for(kid_id uuid)
returns text
language sql
immutable
set search_path = ''
as $func$
  select case
    when pg_catalog.get_byte(
      pg_catalog.decode(pg_catalog.substr(pg_catalog.md5(kid_id::text), 1, 2), 'hex'),
      0
    ) % 3 = 0
    then (
      array['short_fence', 'fast_grass', 'loud_block', 'high_sun', 'familiar_mound']
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
  'A stable perk for a kid already in the block. The same id always returns the same perk. About one in three are set.';

revoke all on function private.home_perk_for(uuid) from public, anon, authenticated, service_role;

update public.players as kid
set home_perk = rolled.perk
from (
  select id, private.home_perk_for(id) as perk
  from public.players
) as rolled
where kid.id = rolled.id
  and rolled.perk is not null;

create or replace function private.generate_kids(target_season uuid, kid_count integer, purpose text)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  found_season public.seasons;
  rules jsonb;
  spread numeric;
  hidden_spread numeric;
  existing integer;
  given text;
  family text;
  nick text;
  kid_sex text;
  contact integer;
  power integer;
  eye integer;
  speed integer;
  glove integer;
  arm integer;
  stamina integer;
  stats jsonb;
  base_rep numeric;
  base_caps numeric;
  strength numeric;
  rep_cost integer;
  cap_cost integer;
  offer_kind text;
  pref text;
  brought text;
begin
  if purpose = 'pool' then
    if kid_count is null or kid_count < 1 or kid_count > 40 then
      raise exception 'CALL BETWEEN 1 AND 40 KIDS';
    end if;
  elsif purpose = 'recruiting' then
    if kid_count is null or kid_count < 1 or kid_count > 80 then
      raise exception 'THAT WAVE IS THE WRONG SIZE';
    end if;
  else
    raise exception 'THAT CALL IS NOT READY';
  end if;

  select * into found_season
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if purpose = 'pool' and found_season.status <> 'forming' then
    raise exception 'CALL THE KIDS WHILE THE SEASON IS FORMING';
  end if;
  if purpose = 'recruiting' and found_season.status not in ('active', 'completed') then
    raise exception 'RECRUITING WAITS FOR THE SEASON';
  end if;

  select count(*) into existing
  from public.players
  where season_id = target_season;
  if existing + kid_count > 200 then
    raise exception 'THE BLOCK IS FULL OF KIDS';
  end if;

  select settings into rules
  from public.game_settings
  where version = found_season.settings_version;
  if rules is null or jsonb_typeof(rules -> 'initial_stat_variability') <> 'number' then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;
  spread := (rules ->> 'initial_stat_variability')::numeric;
  if spread < 0 or spread > 50 then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;
  hidden_spread := greatest(4, spread / 3);

  if purpose = 'recruiting' then
    if jsonb_typeof(rules -> 'recruiting_base_rep') <> 'number'
      or jsonb_typeof(rules -> 'recruiting_base_caps') <> 'number' then
      raise exception 'THE SEASON RULES ARE MISSING';
    end if;
    base_rep := (rules ->> 'recruiting_base_rep')::numeric;
    base_caps := (rules ->> 'recruiting_base_caps')::numeric;
    if base_rep < 0 or base_rep > 1000 or base_caps < 0 or base_caps > 1000 then
      raise exception 'THE SEASON RULES ARE MISSING';
    end if;
  end if;

  for _step in 1..kid_count loop
    select name, sex into given, kid_sex from private.given_names order by random() limit 1;
    select name into family from private.family_names order by random() limit 1;
    if given is null or family is null or kid_sex is null then
      raise exception 'THE NAME LIST IS EMPTY';
    end if;
    nick := null;
    if random() < 0.08 then
      select name into nick from private.nicknames order by random() limit 1;
    end if;

    contact := private.roll_stat(50, spread);
    power := private.roll_stat(50, spread);
    eye := private.roll_stat(50, spread);
    speed := private.roll_stat(50, spread);
    glove := private.roll_stat(50, spread);
    arm := private.roll_stat(50, spread);
    stamina := private.roll_stat(50, spread);
    stats := jsonb_build_object(
      'contact', contact,
      'power', power,
      'eye', eye,
      'speed', speed,
      'glove', glove,
      'arm', arm,
      'stamina', stamina
    );

    rep_cost := null;
    cap_cost := null;
    offer_kind := null;
    pref := null;
    if purpose = 'recruiting' then
      strength := (contact + power + eye + speed + glove + arm + stamina)::numeric / 7;
      rep_cost := greatest(1, round(base_rep * strength / 50))::integer;
      cap_cost := greatest(1, round(base_caps * strength / 50))::integer;
      if random() < 0.25 then
        offer_kind := 'tryout';
      else
        offer_kind := 'price';
      end if;
      if random() < 0.30 then
        pref := 'underdog';
      end if;
    end if;

    brought := private.roll_home_perk();

    insert into public.players (
      season_id,
      team_id,
      given_name,
      family_name,
      nickname,
      sex,
      flavor,
      base_stats,
      hidden_stats,
      tryout_status,
      penalty_until_game_id,
      experience,
      settings_version,
      reputation_cost,
      bottlecap_cost,
      preference,
      offer,
      home_perk
    )
    values (
      target_season,
      null,
      given,
      family,
      nick,
      kid_sex,
      private.kid_flavor(stats),
      stats,
      jsonb_build_object(
        'barrel_accuracy', private.roll_stat(contact, hidden_spread),
        'swing_timing', private.roll_stat(contact, hidden_spread),
        'two_strike_fight', private.roll_stat(contact, hidden_spread),
        'soft_contact', private.roll_stat(contact, hidden_spread),
        'consistency', private.roll_stat(contact, hidden_spread),
        'raw_strength', private.roll_stat(power, hidden_spread),
        'launch_tendency', private.roll_stat(power, hidden_spread),
        'backspin_carry', private.roll_stat(power, hidden_spread),
        'strike_zone_judgment', private.roll_stat(eye, hidden_spread),
        'pitch_recognition', private.roll_stat(eye, hidden_spread),
        'patience', private.roll_stat(eye, hidden_spread),
        'chase_discipline', private.roll_stat(eye, hidden_spread),
        'first_step', private.roll_stat(speed, hidden_spread),
        'top_speed', private.roll_stat(speed, hidden_spread),
        'slide_agility', private.roll_stat(speed, hidden_spread),
        'baserunning_reads', private.roll_stat(speed, hidden_spread),
        'hands_softness', private.roll_stat(glove, hidden_spread),
        'range_first_step', private.roll_stat(glove, hidden_spread),
        'reaction', private.roll_stat(glove, hidden_spread),
        'reliability', private.roll_stat(glove, hidden_spread),
        'arm_strength', private.roll_stat(arm, hidden_spread),
        'accuracy', private.roll_stat(arm, hidden_spread),
        'release_quickness', private.roll_stat(arm, hidden_spread),
        'carry', private.roll_stat(arm, hidden_spread),
        'fade_resistance', private.roll_stat(stamina, hidden_spread),
        'late_game_energy', private.roll_stat(stamina, hidden_spread),
        'recovery', private.roll_stat(stamina, hidden_spread),
        'heat_weather_tolerance', private.roll_stat(stamina, hidden_spread),
        'focus_endurance', private.roll_stat(stamina, hidden_spread)
      ),
      null,
      null,
      0,
      found_season.settings_version,
      rep_cost,
      cap_cost,
      pref,
      offer_kind,
      brought
    );
  end loop;

  return kid_count;
end;
$func$;

comment on function private.generate_kids(uuid, integer, text) is
  'Inserts neighborhood kids. purpose pool is the forming-season call. purpose recruiting prices each kid from the season rules and the visible stats. About one in four offers a tryout. About one in three brings a home-field perk. Hidden stats cluster on the matching visible stat.';

revoke all on function private.generate_kids(uuid, integer, text) from public, anon, authenticated, service_role;

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

  if kid.home_perk is not null then
    update public.teams as team
    set home_perk = null
    where team.id = kid.team_id
      and team.home_perk = kid.home_perk
      and not exists (
        select 1
        from public.players as other
        where other.team_id = kid.team_id
          and other.home_perk = kid.home_perk
      );
  end if;
end;
$func$;

comment on function private.release_player(uuid) is
  'The kid''s coach clears team_id and drops that kid from the lineup. The perk leaves with the kid. If no one left brings the chosen perk, the home field clears.';

create function private.set_home_perk(target_team uuid, perk text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owner uuid;
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

  if cleaned is not null and not exists (
    select 1
    from public.players
    where team_id = target_team
      and home_perk = cleaned
  ) then
    raise exception 'THAT PERK IS NOT ON YOUR ROSTER';
  end if;

  update public.teams
  set home_perk = cleaned
  where id = target_team;
end;
$func$;

comment on function private.set_home_perk(uuid, text) is
  'The owning coach chooses one home-field perk the roster already brings, or clears it. A game does not spend it.';

revoke all on function private.set_home_perk(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.set_home_perk(uuid, text) to authenticated;

create function public.set_home_perk(team_id uuid, perk text)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.set_home_perk(team_id, perk);
$func$;

comment on function public.set_home_perk(uuid, text) is
  'Signed-in coach saves the home-field perk on their own team. A blank perk clears it.';

revoke all on function public.set_home_perk(uuid, text) from public, anon;
grant execute on function public.set_home_perk(uuid, text) to authenticated;

create function private.stamp_home_perk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  chosen text;
begin
  new.home_perk := null;
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

  if chosen is not null and exists (
    select 1
    from public.players as kid
    where kid.team_id = new.team_id
      and kid.home_perk = chosen
  ) then
    new.home_perk := chosen;
  end if;
  return new;
end;
$func$;

comment on function private.stamp_home_perk() is
  'A new home lock freezes the perk the roster still brings. An away lock stores none.';

revoke all on function private.stamp_home_perk() from public, anon, authenticated, service_role;

create trigger lineup_locks_stamp_home_perk
  before insert on public.lineup_locks
  for each row
  execute function private.stamp_home_perk();

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
begin
  select locks.card, locks.home_perk
  into card, perk
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

  if perk is not null then
    perform 1
    from public.games as game
    where game.id = target_game
      and game.home_team_id = target_team;
    if not found then
      perk := null;
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
    if perk = 'short_fence' then
      power := power + 4;
    elsif perk = 'fast_grass' then
      speed := speed + 4;
    elsif perk = 'loud_block' then
      contact := contact + 4;
    elsif perk = 'high_sun' then
      glove := glove + 4;
    elsif perk = 'familiar_mound' then
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
  'The locked nine for one side, blended for the simulator. Kids bat in the frozen batting order. A home lock adds 4 for its frozen perk: short_fence power, fast_grass speed, loud_block contact, high_sun glove, familiar_mound command and fade. An away side gains none. The blend is not returned to the client.';

revoke all on function private.load_side(uuid, uuid) from public, anon, authenticated, service_role;

alter publication supabase_realtime drop table public.players;
alter publication supabase_realtime add table public.players (
  id,
  season_id,
  team_id,
  given_name,
  family_name,
  nickname,
  sex,
  flavor,
  base_stats,
  tryout_status,
  penalty_until_game_id,
  penalty_games_left,
  experience,
  settings_version,
  created_at,
  reputation_cost,
  bottlecap_cost,
  preference,
  offer,
  home_perk
);

alter publication supabase_realtime drop table public.teams;
alter publication supabase_realtime add table public.teams (
  id,
  season_id,
  coach_id,
  name,
  bottlecaps,
  reputation,
  settings_version,
  created_at,
  home_perk
);

alter publication supabase_realtime drop table public.lineup_locks;
alter publication supabase_realtime add table public.lineup_locks (
  game_id,
  team_id,
  locked_at,
  home_perk
);
