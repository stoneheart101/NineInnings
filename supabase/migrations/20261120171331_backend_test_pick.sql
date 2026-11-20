-- Backend test: a scheduled procedure picks a number and stores it.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.backend_picks (
  id bigint generated always as identity primary key,
  picked_number integer not null,
  picked_at timestamptz not null default now(),
  constraint backend_picks_number_range check (picked_number between 0 and 999)
);

comment on table public.backend_picks is
  'Numbers picked by private.pick_random_number. Clients may read the history and cannot write it.';

create index backend_picks_picked_at_idx
  on public.backend_picks (picked_at desc);

alter table public.backend_picks enable row level security;

revoke all on table public.backend_picks from public, anon, authenticated, service_role;
grant select on table public.backend_picks to anon, authenticated;

create policy backend_picks_select
  on public.backend_picks
  for select
  to anon, authenticated
  using (true);

create procedure private.pick_random_number()
language plpgsql
security definer
set search_path = ''
as $proc$
begin
  insert into public.backend_picks (picked_number)
  values (floor(random() * 1000)::integer);
end;
$proc$;

comment on procedure private.pick_random_number() is
  'Picks an integer from 0 through 999 and inserts it. Called by the backend_test_pick cron job.';

revoke all on procedure private.pick_random_number() from public, anon, authenticated, service_role;

select cron.schedule(
  'backend_test_pick',
  '*/15 * * * *',
  $job$call private.pick_random_number()$job$
);

create function public.backend_test_next_run()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $func$
  select case
    when exists (
      select 1
      from cron.job
      where jobname = 'backend_test_pick'
        and active
    )
    then date_bin(
      interval '15 minutes',
      now(),
      timestamptz '2000-01-01 00:00:00+00'
    ) + interval '15 minutes'
    else null
  end
$func$;

comment on function public.backend_test_next_run() is
  'Next clock-aligned 15-minute run of backend_test_pick, or null when that job is not active.';

revoke all on function public.backend_test_next_run() from public;
grant execute on function public.backend_test_next_run() to anon, authenticated;

call private.pick_random_number();
