-- The next run is a normal table row, so the client does not call a security definer function.
drop function if exists public.backend_test_next_run();

create table public.backend_test_state (
  id smallint primary key,
  next_run timestamptz not null,
  constraint backend_test_state_singleton check (id = 1)
);

comment on table public.backend_test_state is
  'One row. private.pick_random_number advances next_run after each pick.';

alter table public.backend_test_state enable row level security;

revoke all on table public.backend_test_state from public, anon, authenticated, service_role;
grant select on table public.backend_test_state to anon, authenticated;

create policy backend_test_state_select
  on public.backend_test_state
  for select
  to anon, authenticated
  using (true);

insert into public.backend_test_state (id, next_run)
values (
  1,
  date_bin(
    interval '15 minutes',
    now(),
    timestamptz '2000-01-01 00:00:00+00'
  ) + interval '15 minutes'
);

create or replace procedure private.pick_random_number()
language plpgsql
security definer
set search_path = ''
as $proc$
begin
  insert into public.backend_picks (picked_number)
  values (floor(random() * 1000)::integer);

  update public.backend_test_state
  set next_run = date_bin(
    interval '15 minutes',
    now(),
    timestamptz '2000-01-01 00:00:00+00'
  ) + interval '15 minutes'
  where id = 1;
end;
$proc$;

comment on procedure private.pick_random_number() is
  'Picks an integer from 0 through 999, inserts it, and advances backend_test_state.next_run. Called by the backend_test_pick cron job.';

revoke all on procedure private.pick_random_number() from public, anon, authenticated, service_role;
