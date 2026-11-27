-- Cast random() to numeric. float8 does not match a numeric argument.

create or replace function private.recruit_quiet_day(target_season uuid, roll numeric)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  open_season public.seasons;
  wave_day date := (now() at time zone 'utc')::date;
  week_day integer := extract(dow from (now() at time zone 'utc'))::integer;
begin
  if roll is null or roll < 0 or roll >= 1 then
    return 0;
  end if;

  select * into open_season
  from public.seasons
  where id = target_season
  for update;

  if open_season.id is null or open_season.status is distinct from 'active' then
    return 0;
  end if;

  if exists (
    select 1
    from private.recruiting_days as days
    where days.season_id = target_season
      and days.wave_on = wave_day
  ) then
    return 0;
  end if;

  if open_season.official_weekdays is not null and week_day = any (open_season.official_weekdays) then
    if exists (
      select 1
      from public.games
      where season_id = target_season
        and is_practice = false
        and dev = false
        and (starts_at at time zone 'utc')::date = wave_day
    ) then
      return 0;
    end if;
  end if;

  if roll >= (1.0 / 3.0) then
    return 0;
  end if;

  perform private.generate_kids(target_season, 1, 'recruiting');
  insert into private.recruiting_days (season_id, wave_on, source)
  values (target_season, wave_day, 'quiet');
  perform private.maybe_depart_recruit(target_season, random()::numeric);
  return 1;
end;
$func$;


create or replace function private.recruit_quiet_days()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  target_season uuid;
begin
  for target_season in
    select seasons.id
    from public.seasons
    where seasons.status = 'active'
    order by seasons.id
  loop
    begin
      perform private.recruit_quiet_day(target_season, random()::numeric);
    exception
      when others then
        raise warning 'QUIET RECRUITS % SKIPPED: %', target_season, sqlerrm;
    end;
  end loop;
end;
$func$;


create or replace function private.recruit_for_played_days()
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
        perform private.maybe_depart_recruit(wave.season_id, random()::numeric);
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


create or replace function private.open_recruiting_board(target_season uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  open_season public.seasons;
  wave_day date := (now() at time zone 'utc')::date;
  week_day integer := extract(dow from (now() at time zone 'utc'))::integer;
begin
  if uid is null then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into open_season
  from public.seasons
  where seasons.id = target_season
  for update;

  if open_season.id is null then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if open_season.commissioner_id is distinct from uid then
    raise exception 'THE COMMISSIONER OPENS THE BOARD';
  end if;
  if open_season.status <> 'active' then
    return 0;
  end if;
  if open_season.official_weekdays is not null and week_day = any (open_season.official_weekdays) then
    return 0;
  end if;
  if exists (
    select 1
    from private.recruiting_days as days
    where days.season_id = target_season
      and days.wave_on = wave_day
  ) then
    return 0;
  end if;

  perform private.generate_kids(target_season, 1, 'recruiting');
  insert into private.recruiting_days (season_id, wave_on, source)
  values (target_season, wave_day, 'off');
  perform private.maybe_depart_recruit(target_season, random()::numeric);
  return 1;
end;
$func$;


