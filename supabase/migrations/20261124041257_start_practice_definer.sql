-- The public wrapper has to run as its owner so it can call the private
-- body. Signed-in coaches can execute this function. They cannot execute
-- the private one. The body still checks the coach.

create or replace function public.start_practice(team_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $func$
  select private.start_practice(team_id);
$func$;

comment on function public.start_practice(uuid) is
  'Signed-in coach starts one practice for their team and gets that game id back.';

revoke all on function public.start_practice(uuid) from public, anon, service_role;
grant execute on function public.start_practice(uuid) to authenticated;
