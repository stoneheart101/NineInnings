-- Team deletes look up locks by team_id. The primary key leads with game_id.

create index lineup_locks_team_id_idx on public.lineup_locks (team_id);
