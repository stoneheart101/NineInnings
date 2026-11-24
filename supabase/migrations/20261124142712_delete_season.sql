-- The board opener named its season row `found`, which hid the boolean FOUND.
-- `if not found` then tried to negate a seasons row.
-- The commissioner can delete a season after typing its name.

create or replace function private.open_recruiting_board(target_season uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  open_season public.seasons;
  wave_on date := (now() at time zone 'utc')::date;
  dow integer := extract(dow from (now() at time zone 'utc'))::integer;
begin
  if uid is null then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into open_season
  from public.seasons
  where id = target_season
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
  if open_season.official_weekdays is not null and dow = any (open_season.official_weekdays) then
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

create function private.delete_season(target_season uuid, season_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  open_season public.seasons;
  cleaned text;
begin
  if uid is null then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into open_season
  from public.seasons
  where id = target_season
  for update;

  if open_season.id is null then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if open_season.commissioner_id is distinct from uid then
    raise exception 'THE COMMISSIONER DELETES THE SEASON';
  end if;

  cleaned := upper(regexp_replace(btrim(coalesce(season_name, '')), '\s+', ' ', 'g'));
  if cleaned <> open_season.name then
    raise exception 'TYPE THE SEASON NAME';
  end if;

  delete from public.games as games
  where games.season_id = target_season
    or games.home_team_id in (select teams.id from public.teams as teams where teams.season_id = target_season)
    or games.away_team_id in (select teams.id from public.teams as teams where teams.season_id = target_season);

  delete from public.players as players
  where players.season_id = target_season
    or players.team_id in (select teams.id from public.teams as teams where teams.season_id = target_season);

  delete from public.teams as teams
  where teams.season_id = target_season;

  delete from public.seasons as seasons
  where seasons.id = target_season;
end;
$func$;

comment on function private.delete_season(uuid, text) is
  'The commissioner deletes one season after the typed name matches. Teams, games, and kids go with it.';

revoke all on function private.delete_season(uuid, text) from public, anon, authenticated, service_role;

create function public.delete_season(season_id uuid, season_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
begin
  perform private.delete_season(season_id, season_name);
end;
$func$;

comment on function public.delete_season(uuid, text) is
  'The signed-in commissioner deletes their season after typing its name.';

revoke all on function public.delete_season(uuid, text) from public, anon, service_role;
grant execute on function public.delete_season(uuid, text) to authenticated;
