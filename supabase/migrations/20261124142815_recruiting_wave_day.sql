-- `wave_on` was both the day variable and the recruiting_days column.
-- Qualify it so opening the board does not raise an ambiguous column.

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
  return 1;
end;
$func$;

comment on function private.open_recruiting_board(uuid) is
  'On an off day, the commissioner adds one recruiting kid. A game day and a second open the same day add none.';

revoke all on function private.open_recruiting_board(uuid) from public, anon, authenticated, service_role;
