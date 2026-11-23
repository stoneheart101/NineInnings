-- A coach sends one of their own kids back to the season pool. Stats stay put.

create function private.release_player(target_player uuid)
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

  -- Official games do not exist yet. Once they do, a status other than
  -- scheduled or final means that game is in the middle of a run.
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
end;
$func$;

comment on function private.release_player(uuid) is
  'The kid''s coach clears team_id. Visible and hidden stats stay. A live official game blocks the cut.';

revoke all on function private.release_player(uuid) from public, anon, authenticated, service_role;
grant execute on function private.release_player(uuid) to authenticated;

create function public.release_player(player_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.release_player(player_id);
$func$;

comment on function public.release_player(uuid) is
  'Signed-in coach releases one kid from their own team back to the pool.';

revoke all on function public.release_player(uuid) from public, anon;
grant execute on function public.release_player(uuid) to authenticated;
