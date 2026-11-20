-- Coach profiles. The login email stays in auth.users and is not granted here.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  coach_name text,
  created_at timestamptz not null default now(),
  constraint profiles_coach_name_trimmed check (
    coach_name is null
    or (
      char_length(coach_name) between 1 and 24
      and coach_name = btrim(coach_name)
    )
  )
);

create unique index profiles_coach_name_lower_idx
  on public.profiles (lower(coach_name))
  where coach_name is not null;

comment on table public.profiles is
  'Public coach name for a signed-in user. Email is not stored here.';

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select (id, coach_name) on table public.profiles to authenticated;
grant update (coach_name) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- True when this caller has no verified factor, or the session is aal2.
create or replace function private.caller_meets_aal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from auth.mfa_factors
      where user_id = (select auth.uid())
        and status = 'verified'
    )
    then (select auth.jwt() ->> 'aal') = 'aal2'
    else true
  end
$$;

revoke all on function private.caller_meets_aal() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.caller_meets_aal() to authenticated;

create policy profiles_update_aal
  on public.profiles
  as restrictive
  for update
  to authenticated
  using ((select private.caller_meets_aal()))
  with check ((select private.caller_meets_aal()));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();
