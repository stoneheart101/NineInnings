-- A short shelf of temporary team items. Buying spends the purse and packs the item.
-- Effects do not change a game yet. public.games does not exist, so team_items.game_id
-- is a bare uuid and this migration must not name that table.

create table public.clubhouse_items (
  id text primary key,
  name text not null,
  blurb text not null,
  bottlecap_cost integer not null,
  reputation_cost integer not null,
  duration text not null,
  effect jsonb not null,
  constraint clubhouse_items_id check (id ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint clubhouse_items_name check (
    char_length(name) between 1 and 40
    and name = btrim(name)
  ),
  constraint clubhouse_items_blurb check (
    char_length(blurb) between 1 and 180
    and blurb = btrim(blurb)
  ),
  constraint clubhouse_items_costs check (
    bottlecap_cost >= 0
    and reputation_cost >= 0
    and bottlecap_cost + reputation_cost > 0
  ),
  constraint clubhouse_items_duration check (duration in ('next_game', 'series')),
  constraint clubhouse_items_effect check (jsonb_typeof(effect) = 'object')
);

comment on table public.clubhouse_items is
  'The shared shelf. duration is next_game or a three-game series. effect is the template, not a packed copy.';

create table public.team_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  item_id text not null references public.clubhouse_items (id),
  game_id uuid,
  remaining_games integer not null,
  bought_at timestamptz not null default now(),
  effect jsonb not null,
  constraint team_items_remaining check (remaining_games between 1 and 3),
  constraint team_items_effect check (jsonb_typeof(effect) = 'object')
);

comment on table public.team_items is
  'Items packed on one team. effect is the catalog template plus the metal bat slot when that buy named one. game_id waits for a games table.';

comment on column public.team_items.effect is
  'Copy of the catalog effect. A metal bat adds slot, the lineup slot chosen on the shelf.';

create index team_items_team_id_idx on public.team_items (team_id, bought_at);
create index team_items_item_id_idx on public.team_items (item_id);

alter table public.clubhouse_items enable row level security;
alter table public.team_items enable row level security;

revoke all on table public.clubhouse_items from public, anon, authenticated, service_role;
grant select (
  id,
  name,
  blurb,
  bottlecap_cost,
  reputation_cost,
  duration,
  effect
) on table public.clubhouse_items to authenticated;

revoke all on table public.team_items from public, anon, authenticated, service_role;
grant select (
  id,
  team_id,
  item_id,
  game_id,
  remaining_games,
  bought_at,
  effect
) on table public.team_items to authenticated;

create policy clubhouse_items_select
  on public.clubhouse_items
  for select
  to authenticated
  using (true);

create policy team_items_select
  on public.team_items
  for select
  to authenticated
  using (
    team_id in (
      select id
      from public.teams
      where coach_id = (select auth.uid())
    )
  );

insert into public.clubhouse_items (id, name, blurb, bottlecap_cost, reputation_cost, duration, effect)
values
  (
    'extra_baseballs',
    'EXTRA BASEBALLS',
    'A FEW MORE BALLS FOR THE NEXT GAME',
    4,
    0,
    'next_game',
    '{"kind":"baseballs"}'::jsonb
  ),
  (
    'ice_pops',
    'ICE POPS',
    'COLD TREATS FOR A HOT AFTERNOON',
    3,
    0,
    'next_game',
    '{"kind":"ice_pops"}'::jsonb
  ),
  (
    'borrowed_gloves',
    'BORROWED GLOVES',
    'GLOVES FROM THE NEIGHBORS FOR ONE GAME',
    0,
    4,
    'next_game',
    '{"kind":"gloves"}'::jsonb
  ),
  (
    'tarp_and_chalk',
    'TARP AND CHALK',
    'A TARP AND CHALK FOR WET DIRT',
    6,
    2,
    'next_game',
    '{"kind":"field"}'::jsonb
  ),
  (
    'metal_bat',
    'METAL BAT',
    'ONE BAT FOR A THREE GAME SERIES',
    8,
    4,
    'series',
    '{"kind":"bat","needs_slot":true}'::jsonb
  );

create function private.buy_item(target_team uuid, target_item text, chosen_slot integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  owned public.teams;
  shelf public.clubhouse_items;
  packed jsonb;
  games_left integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into owned
  from public.teams
  where id = target_team
  for update;

  if not found then
    raise exception 'THAT TEAM IS NOT HERE';
  end if;
  if owned.coach_id is distinct from uid then
    raise exception 'THAT TEAM IS NOT YOURS';
  end if;

  select * into shelf
  from public.clubhouse_items
  where id = target_item;

  if not found then
    raise exception 'THAT ITEM IS NOT ON THE SHELF';
  end if;

  packed := shelf.effect;
  if (shelf.effect ->> 'needs_slot') = 'true' then
    if chosen_slot is null or chosen_slot < 1 or chosen_slot > 9 then
      raise exception 'PICK A SLOT FOR THE BAT';
    end if;
    packed := shelf.effect || jsonb_build_object('slot', chosen_slot);
  end if;

  if owned.bottlecaps < shelf.bottlecap_cost or owned.reputation < shelf.reputation_cost then
    raise exception 'YOU CANNOT AFFORD THAT';
  end if;

  update public.teams
  set bottlecaps = bottlecaps - shelf.bottlecap_cost,
      reputation = reputation - shelf.reputation_cost
  where id = target_team;

  games_left := case shelf.duration when 'series' then 3 else 1 end;

  insert into public.team_items (team_id, item_id, remaining_games, effect)
  values (target_team, shelf.id, games_left, packed);
end;
$func$;

comment on function private.buy_item(uuid, text, integer) is
  'The owning coach packs one shelf item and spends bottlecaps and reputation in the same transaction.';

revoke all on function private.buy_item(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function private.buy_item(uuid, text, integer) to authenticated;

create function public.buy_item(team_id uuid, item_id text, slot integer default null)
returns void
language sql
security invoker
set search_path = ''
as $func$
  select private.buy_item(team_id, item_id, slot);
$func$;

comment on function public.buy_item(uuid, text, integer) is
  'Signed-in coach buys one clubhouse item for their own team. The metal bat also takes a lineup slot.';

revoke all on function public.buy_item(uuid, text, integer) from public, anon;
grant execute on function public.buy_item(uuid, text, integer) to authenticated;
