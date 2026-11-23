-- Versioned rule book. Coaches cannot read or edit it. The admin desk reads the latest version.
alter table public.profiles
  add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'May read the rule book. Coaches cannot grant this column.';

update public.profiles
set is_admin = true
where id = 'b4d92375-0990-40b5-b18a-bc6ce965e354';

create table public.game_settings (
  version integer primary key check (version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  settings jsonb not null,
  constraint game_settings_keys check (
    settings ?& array[
      'weather_effect_strength',
      'weather_variability',
      'initial_stat_variability',
      'experience_gain_rate',
      'level_up_improvement_size',
      'recruiting_base_rep',
      'recruiting_base_caps',
      'underdog_discount_strength',
      'overpay_penalty_max_games',
      'narrative_flavor_density',
      'practice_bottlecap_reward',
      'default_roster_cap',
      'starting_bottlecaps',
      'starting_reputation',
      'win_bottlecaps',
      'win_reputation'
    ]
  )
);

comment on table public.game_settings is
  'Append-only rule book. New kids, games, and seasons copy the version they were created under.';

alter table public.game_settings enable row level security;

revoke all on table public.game_settings from public, anon, authenticated, service_role;
grant select (version) on table public.game_settings to authenticated;

create function private.caller_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $func$
  select coalesce(
    (
      select is_admin
      from public.profiles
      where id = (select auth.uid())
    ),
    false
  )
$func$;

comment on function private.caller_is_admin() is
  'True when the signed-in coach has profiles.is_admin. Used by RLS.';

revoke all on function private.caller_is_admin() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.caller_is_admin() to authenticated;

create policy game_settings_select_admin
  on public.game_settings
  for select
  to authenticated
  using ((select private.caller_is_admin()));

create function private.current_settings()
returns public.game_settings
language sql
stable
security definer
set search_path = ''
as $func$
  select s.*
  from public.game_settings as s
  order by s.version desc
  limit 1
$func$;

comment on function private.current_settings() is
  'Latest rule book row. Server jobs call this. Clients do not.';

revoke all on function private.current_settings() from public, anon, authenticated, service_role;

insert into public.game_settings (version, created_by, settings)
values (
  1,
  'b4d92375-0990-40b5-b18a-bc6ce965e354',
  jsonb_build_object(
    'weather_effect_strength', 1.0,
    'weather_variability', 0.35,
    'initial_stat_variability', 18,
    'experience_gain_rate', 1.0,
    'level_up_improvement_size', 3,
    'recruiting_base_rep', 10,
    'recruiting_base_caps', 5,
    'underdog_discount_strength', 0.4,
    'overpay_penalty_max_games', 3,
    'narrative_flavor_density', 0.5,
    'practice_bottlecap_reward', 1,
    'default_roster_cap', 15,
    'starting_bottlecaps', 20,
    'starting_reputation', 10,
    'win_bottlecaps', 8,
    'win_reputation', 3
  )
);
