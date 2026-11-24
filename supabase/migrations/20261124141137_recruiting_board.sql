-- Recruiting kids arrive after a played official day, one per real team.
-- An off day adds one kid when the commissioner opens the board.
-- Past game days are marked so this does not backfill the board.

alter table public.players
  add column reputation_cost integer,
  add column bottlecap_cost integer,
  add column preference text,
  add column offer text;

alter table public.players
  add constraint players_offer check (offer is null or offer in ('price', 'tryout')),
  add constraint players_preference check (preference is null or preference = 'underdog'),
  add constraint players_recruiting_shape check (
    (offer is null) = (reputation_cost is null)
    and (offer is null) = (bottlecap_cost is null)
    and (offer is not null or preference is null)
    and (reputation_cost is null or reputation_cost >= 0)
    and (bottlecap_cost is null or bottlecap_cost >= 0)
  );

comment on column public.players.reputation_cost is
  'Reputation a recruiting kid asks. Null on a draft-pool kid.';

comment on column public.players.bottlecap_cost is
  'Bottlecaps a recruiting kid asks. Null on a draft-pool kid.';

comment on column public.players.preference is
  'underdog when the kid likes a club that is not in first. The price break waits.';

comment on column public.players.offer is
  'price or tryout on the recruiting board. Null in the draft pool.';

grant select (reputation_cost, bottlecap_cost, preference, offer) on table public.players to authenticated;

create table private.recruiting_days (
  season_id uuid not null references public.seasons (id) on delete cascade,
  wave_on date not null,
  source text not null,
  primary key (season_id, wave_on),
  constraint recruiting_days_source check (source in ('game', 'off'))
);

comment on table private.recruiting_days is
  'One recruiting wave per season per UTC day. game is the played-day wave. off is the commissioner extra kid.';

alter table private.recruiting_days enable row level security;

revoke all on table private.recruiting_days from public, anon, authenticated, service_role;

create policy recruiting_days_none
  on private.recruiting_days
  for select
  to authenticated
  using (false);

insert into private.recruiting_days (season_id, wave_on, source)
select distinct games.season_id, (games.starts_at at time zone 'utc')::date, 'game'
from public.games as games
where games.status = 'final'
  and games.is_practice = false
  and games.dev = false
on conflict do nothing;

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
      offer
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
      offer_kind
    );
  end loop;

  return kid_count;
end;
$func$;

comment on function private.generate_kids(uuid, integer, text) is
  'Inserts neighborhood kids. purpose pool is the forming-season call. purpose recruiting prices each kid from the season rules and the visible stats. About one in four offers a tryout. Hidden stats cluster on the matching visible stat.';

revoke all on function private.generate_kids(uuid, integer, text) from public, anon, authenticated, service_role;

create function private.recruit_for_played_days()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  wave record;
  clubs integer;
begin
  for wave in
    select games.season_id,
           (games.starts_at at time zone 'utc')::date as wave_on
    from public.games as games
    where games.status = 'final'
      and games.is_practice = false
      and games.dev = false
      and not exists (
        select 1
        from private.recruiting_days as days
        where days.season_id = games.season_id
          and days.wave_on = (games.starts_at at time zone 'utc')::date
      )
    group by games.season_id, (games.starts_at at time zone 'utc')::date
    order by 2, 1
  loop
    begin
      select count(*) into clubs
      from public.teams
      where season_id = wave.season_id
        and practice = false;
      if clubs > 0 then
        perform private.generate_kids(wave.season_id, least(clubs, 80), 'recruiting');
      end if;
      insert into private.recruiting_days (season_id, wave_on, source)
      values (wave.season_id, wave.wave_on, 'game');
    exception
      when others then
        raise warning 'RECRUITING % % SKIPPED: %', wave.season_id, wave.wave_on, sqlerrm;
    end;
  end loop;
end;
$func$;

comment on function private.recruit_for_played_days() is
  'One recruiting kid per real team for each UTC day that has a final official game and no wave yet.';

revoke all on function private.recruit_for_played_days() from public, anon, authenticated, service_role;

create or replace function private.process_due_games()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  gid uuid;
begin
  for gid in
    select games.id
    from public.games as games
    where games.status = 'scheduled'
      and games.is_practice = false
      and games.starts_at <= now()
    order by games.starts_at, games.id
  loop
    begin
      perform private.settle_due_game(gid);
    exception
      when others then
        raise warning 'OFFICIAL GAME % SKIPPED: %', gid, sqlerrm;
    end;
  end loop;
  perform private.recruit_for_played_days();
end;
$func$;

comment on function private.process_due_games() is
  'Plays every official game whose start time has passed, then adds that day''s recruiting wave. One game that cannot play waits for the next run and does not stop the others.';

revoke all on function private.process_due_games() from public, anon, authenticated, service_role;

create function private.open_recruiting_board(target_season uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  found public.seasons;
  wave_on date := (now() at time zone 'utc')::date;
  dow integer := extract(dow from (now() at time zone 'utc'))::integer;
begin
  if uid is null then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into found
  from public.seasons
  where id = target_season
  for update;

  if not found then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if found.commissioner_id is distinct from uid then
    raise exception 'THE COMMISSIONER OPENS THE BOARD';
  end if;
  if found.status <> 'active' then
    return 0;
  end if;
  if found.official_weekdays is not null and dow = any (found.official_weekdays) then
    return 0;
  end if;
  if exists (
    select 1
    from private.recruiting_days as days
    where days.season_id = target_season
      and days.wave_on = wave_on
  ) then
    return 0;
  end if;

  perform private.generate_kids(target_season, 1, 'recruiting');
  insert into private.recruiting_days (season_id, wave_on, source)
  values (target_season, wave_on, 'off');
  return 1;
end;
$func$;

comment on function private.open_recruiting_board(uuid) is
  'On an off day, the commissioner adds one recruiting kid. A game day and a second open the same day add none.';

revoke all on function private.open_recruiting_board(uuid) from public, anon, authenticated, service_role;

create function public.open_recruiting_board(season_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $func$
  select private.open_recruiting_board(season_id);
$func$;

comment on function public.open_recruiting_board(uuid) is
  'The signed-in commissioner opens the recruiting board. An off day may add one kid.';

revoke all on function public.open_recruiting_board(uuid) from public, anon, service_role;
grant execute on function public.open_recruiting_board(uuid) to authenticated;

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
  experience,
  settings_version,
  created_at,
  reputation_cost,
  bottlecap_cost,
  preference,
  offer
);
