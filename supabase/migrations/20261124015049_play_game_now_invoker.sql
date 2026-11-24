-- The wrapper stays invoker, matching the other coach calls. The award
-- itself stays in private. Signed-in users can run the wrapper. They
-- cannot call the clock.

create or replace function public.play_game_now(game_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  played jsonb;
begin
  played := private.simulate_game(game_id);
  perform private.narrate_game(game_id);
  perform private.award_final_game(game_id);
  return played;
end;
$func$;

comment on function public.play_game_now(uuid) is
  'The commissioner plays one locked game, stores the writeup, and pays the result. The screen has no button for this. The clock calls it when the start time has passed.';

revoke all on function public.play_game_now(uuid) from public, anon;
grant execute on function public.play_game_now(uuid) to authenticated;

grant execute on function private.award_final_game(uuid) to authenticated;
