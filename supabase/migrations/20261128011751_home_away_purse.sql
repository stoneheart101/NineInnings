create function private.official_purse(settings_version integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $func$
declare
  caps integer;
  rep integer;
begin
  select
    (rules.settings ->> 'win_bottlecaps')::integer,
    (rules.settings ->> 'win_reputation')::integer
  into caps, rep
  from public.game_settings as rules
  where rules.version = settings_version;

  if caps is null or rep is null or caps < 0 or rep < 0 then
    return null;
  end if;

  return jsonb_build_object(
    'home_win', jsonb_build_object(
      'reputation', greatest(rep - 1, 0),
      'bottlecaps', caps + 2
    ),
    'away_win', jsonb_build_object(
      'reputation', rep + 1,
      'bottlecaps', greatest(caps - 2, 0)
    ),
    'loss', jsonb_build_object('reputation', 0, 'bottlecaps', 0),
    'tie', jsonb_build_object('reputation', 0, 'bottlecaps', 0)
  );
end;
$func$;

comment on function private.official_purse(integer) is
  'Win, loss, and tie purse for one settings version. A home win takes two extra bottlecaps and one less reputation from the stored win purse. An away win takes two fewer bottlecaps and one extra reputation. A loss and a tie pay nothing.';

revoke all on function private.official_purse(integer) from public, anon, authenticated, service_role;

create function public.game_rewards(settings_version integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $func$
  select private.official_purse(settings_version);
$func$;

comment on function public.game_rewards(integer) is
  'The win, loss, and tie purse stored on one settings version. Coaches read it on the schedule. The rest of the rule book stays hidden.';

revoke all on function public.game_rewards(integer) from public, anon, service_role;
grant execute on function public.game_rewards(integer) to authenticated;

create or replace function private.award_final_game(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  marked uuid;
  winner_name text;
  winner_id uuid;
  loser_id uuid;
  caps integer;
  rep integer;
  purse jsonb;
begin
  select * into game
  from public.games
  where id = target_game
  for update;

  if not found then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  if game.is_practice then
    if game.status is distinct from 'final' or game.result is null then
      return;
    end if;
    insert into private.game_awards (game_id)
    values (target_game)
    on conflict do nothing
    returning game_id into marked;
    if marked is null then
      return;
    end if;
    perform private.spend_packed(target_game, game.home_team_id);
    perform private.spend_packed(target_game, game.away_team_id);
    return;
  end if;

  if game.status is distinct from 'final' or game.result is null then
    raise exception 'THE GAME HAS NOT BEEN PLAYED';
  end if;

  insert into private.game_awards (game_id)
  values (target_game)
  on conflict do nothing
  returning game_id into marked;

  if marked is null then
    return;
  end if;

  perform 1
  from public.teams
  where id in (game.home_team_id, game.away_team_id)
  order by id
  for update;

  winner_name := game.result ->> 'winner';
  if winner_name = 'home' then
    winner_id := game.home_team_id;
    loser_id := game.away_team_id;
  elsif winner_name = 'away' then
    winner_id := game.away_team_id;
    loser_id := game.home_team_id;
  elsif winner_name = 'tie' then
    winner_id := null;
    loser_id := null;
  else
    raise exception 'THE BOOKS DO NOT BALANCE';
  end if;

  if winner_id is not null then
    purse := private.official_purse(game.settings_version);
    if winner_id = game.home_team_id then
      caps := (purse -> 'home_win' ->> 'bottlecaps')::integer;
      rep := (purse -> 'home_win' ->> 'reputation')::integer;
    else
      caps := (purse -> 'away_win' ->> 'bottlecaps')::integer;
      rep := (purse -> 'away_win' ->> 'reputation')::integer;
    end if;

    if caps is null or rep is null or caps < 0 or rep < 0 then
      raise exception 'THE RULES ARE NOT HERE';
    end if;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, winner_id, 1, 0)
    on conflict (season_id, team_id)
    do update set wins = standing.wins + 1;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, loser_id, 0, 1)
    on conflict (season_id, team_id)
    do update set losses = standing.losses + 1;

    update public.teams
    set bottlecaps = bottlecaps + caps,
        reputation = reputation + rep
    where id = winner_id;
  end if;

  perform private.spend_packed(target_game, game.home_team_id);
  perform private.spend_packed(target_game, game.away_team_id);

  update public.players as kid
  set penalty_until_game_id = null,
      penalty_games_left = null
  where kid.penalty_until_game_id is not null
    and (
      kid.penalty_until_game_id = target_game
      or (winner_id is not null and kid.team_id = winner_id)
      or exists (
        select 1
        from jsonb_array_elements(coalesce(game.result -> 'lines', '[]'::jsonb)) as ln
        where nullif(ln ->> 'player_id', '')::uuid = kid.id
          and (
            coalesce((ln ->> 'h')::integer, 0) >= 2
            or coalesce((ln ->> 'rbi')::integer, 0) >= 2
          )
      )
    );

  update public.players as kid
  set penalty_games_left = kid.penalty_games_left - 1
  where kid.team_id in (game.home_team_id, game.away_team_id)
    and kid.penalty_until_game_id is not null
    and kid.penalty_games_left is not null
    and kid.penalty_games_left > 0;

  update public.players as kid
  set penalty_until_game_id = null,
      penalty_games_left = null
  where kid.team_id in (game.home_team_id, game.away_team_id)
    and kid.penalty_games_left is not null
    and kid.penalty_games_left <= 0;

  update public.seasons as seasons
  set status = 'completed'
  where seasons.id = game.season_id
    and seasons.status = 'active'
    and exists (
      select 1
      from public.games as played_game
      where played_game.season_id = seasons.id
        and played_game.is_practice = false
    )
    and not exists (
      select 1
      from public.games as open_game
      where open_game.season_id = seasons.id
        and open_game.is_practice = false
        and open_game.status = 'scheduled'
    );
end;
$func$;

comment on function private.award_final_game(uuid) is
  'Pays a final game once. A home win pays two more bottlecaps and one less reputation than the stored win purse. An away win pays two fewer bottlecaps and one more reputation. A loss and a tie pay nothing. A flat stretch ends on a win, a strong line, or the last counted official game.';

revoke all on function private.award_final_game(uuid) from public, anon, authenticated, service_role;
