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
  playing_tryout boolean := false;
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

  playing_tryout := kid.tryout_status = 'playing'
    and kid.offer = 'tryout'
    and kid.reputation_cost is not null
    and kid.bottlecap_cost is not null;

  update public.players
  set team_id = null,
      tryout_status = case when playing_tryout then null else tryout_status end,
      offer = case when playing_tryout then 'price' else offer end
  where id = target_player
    and team_id = kid.team_id;
  if not found then
    raise exception 'THAT KID IS NOT ON YOUR TEAM';
  end if;

  if playing_tryout then
    delete from public.recruit_passes
    where player_id = target_player;
  end if;

  delete from public.lineups
  where player_id = target_player;

end;
$func$;

comment on function private.release_player(uuid) is
  'The kid''s coach clears team_id and drops that kid from the lineup. A playing tryout goes back on the board as a priced recruit. Any other kid returns to the pool. The perk leaves with the kid. The coach''s home field stays.';

comment on function public.release_player(uuid) is
  'Signed-in coach releases one kid from their own team. A playing tryout goes back on the board as a priced recruit. Any other kid returns to the pool.';
