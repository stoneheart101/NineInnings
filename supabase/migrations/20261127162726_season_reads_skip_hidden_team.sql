-- games_select and players_select must not read teams.practice.
-- That column is not granted to authenticated. A policy that touches it
-- raises permission denied for table teams, and the dashboard cannot
-- load games. The teams policy already hides a practice row.

drop policy games_select on public.games;

create policy games_select
  on public.games
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = games.season_id
        and teams.coach_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = games.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );

drop policy players_select on public.players;

create policy players_select
  on public.players
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = players.season_id
        and teams.coach_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = players.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );
