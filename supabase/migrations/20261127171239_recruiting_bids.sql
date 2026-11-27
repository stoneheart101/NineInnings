-- Recruiting bids, tryouts, quiet-day arrivals, and the price a coach pays.
-- Stored reputation_cost stays the posted price. Breaks apply when a coach acts.
-- Policies do not read teams.practice. That column is not granted.

alter table public.players
  add column penalty_games_left integer;

alter table public.players
  add constraint players_penalty_games check (
    penalty_games_left is null or penalty_games_left >= 0
  );

comment on column public.players.penalty_games_left is
  'Official games left in a flat stretch. Null when the kid is not playing flat.';

grant select (penalty_games_left) on table public.players to authenticated;

alter table private.recruiting_days
  drop constraint recruiting_days_source;

alter table private.recruiting_days
  add constraint recruiting_days_source check (source in ('game', 'off', 'quiet'));

create table public.recruit_bids (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  status text not null,
  reputation_bid integer not null,
  bottlecap_bid integer not null,
  high_team_id uuid not null references public.teams (id),
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  constraint recruit_bids_status check (status in ('open', 'closed')),
  constraint recruit_bids_amounts check (reputation_bid >= 0 and bottlecap_bid >= 0),
  constraint recruit_bids_window check (closes_at >= opened_at)
);

comment on table public.recruit_bids is
  'One standing bid for a priced recruit. The high bid is what the leader has committed. It closes 24 hours after it opens.';

create unique index recruit_bids_one_open on public.recruit_bids (player_id) where status = 'open';
create index recruit_bids_season_idx on public.recruit_bids (season_id, status);

alter table public.recruit_bids enable row level security;

revoke all on table public.recruit_bids from public, anon, authenticated, service_role;

grant select (
  id,
  player_id,
  season_id,
  status,
  reputation_bid,
  bottlecap_bid,
  high_team_id,
  opened_at,
  closes_at
) on table public.recruit_bids to authenticated;

create policy recruit_bids_select
  on public.recruit_bids
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = recruit_bids.season_id
        and teams.coach_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = recruit_bids.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );

create table public.recruit_offers (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.recruit_bids (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  reputation_offered integer not null default 0,
  bottlecaps_offered integer not null default 0,
  covered boolean not null default false,
  constraint recruit_offers_once unique (bid_id, team_id),
  constraint recruit_offers_amounts check (reputation_offered >= 0 and bottlecaps_offered >= 0)
);

comment on table public.recruit_offers is
  'A coach who has entered a bid. Only the leader amounts are held on the purse. covered means bottlecaps paid for short reputation.';

create index recruit_offers_season_idx on public.recruit_offers (season_id, team_id);

alter table public.recruit_offers enable row level security;

revoke all on table public.recruit_offers from public, anon, authenticated, service_role;

grant select (
  id,
  bid_id,
  season_id,
  team_id
) on table public.recruit_offers to authenticated;

create policy recruit_offers_select
  on public.recruit_offers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = recruit_offers.season_id
        and teams.coach_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = recruit_offers.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );

create function private.coach_recruit_price(target_team uuid, target_player uuid)
returns table (reputation integer, bottlecaps integer, climbing boolean)
language plpgsql
security definer
set search_path = ''
as $func$
declare
  club public.teams;
  kid public.players;
  strength numeric;
  median_rep double precision;
  top_rep integer;
  factor numeric := 1;
  due_rep integer;
begin
  select * into club
  from public.teams
  where teams.id = target_team
    and teams.practice = false;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  select * into kid
  from public.players
  where players.id = target_player
    and players.season_id = club.season_id;

  if kid.id is null or kid.reputation_cost is null or kid.bottlecap_cost is null then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;

  select (rules.settings ->> 'underdog_discount_strength')::numeric
  into strength
  from public.game_settings as rules
  where rules.version = kid.settings_version
    and jsonb_typeof(rules.settings -> 'underdog_discount_strength') = 'number';

  if strength is null or strength < 0 or strength > 1 then
    raise exception 'THE SEASON RULES ARE MISSING';
  end if;

  select
    percentile_cont(0.5) within group (order by teams.reputation),
    max(teams.reputation)
  into median_rep, top_rep
  from public.teams
  where teams.season_id = club.season_id
    and teams.practice = false;

  if median_rep is null or top_rep is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  climbing := club.reputation::numeric <= median_rep;
  if kid.preference = 'underdog' and club.reputation is distinct from top_rep then
    factor := factor * (1 - strength);
  end if;
  if climbing then
    factor := factor * (1 - strength);
  end if;

  due_rep := greatest(1, round(kid.reputation_cost * factor)::integer);
  return query select due_rep, kid.bottlecap_cost, climbing;
end;
$func$;

comment on function private.coach_recruit_price(uuid, uuid) is
  'Reputation this coach pays for the posted price. Bottom-half and non-leader breaks use the kid settings version. Bottlecaps stay posted.';

revoke all on function private.coach_recruit_price(uuid, uuid) from public, anon, authenticated, service_role;

create function private.refund_recruit_offer(target_bid uuid, target_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  held public.recruit_offers;
begin
  select * into held
  from public.recruit_offers
  where bid_id = target_bid
    and team_id = target_team
  for update;

  if held.id is null then
    return;
  end if;
  if held.reputation_offered = 0 and held.bottlecaps_offered = 0 then
    return;
  end if;

  update public.teams
  set reputation = reputation + held.reputation_offered,
      bottlecaps = bottlecaps + held.bottlecaps_offered
  where id = target_team;

  update public.recruit_offers
  set reputation_offered = 0,
      bottlecaps_offered = 0,
      covered = false
  where id = held.id;
end;
$func$;

comment on function private.refund_recruit_offer(uuid, uuid) is
  'Returns a held bid to that team purse and clears the offer amounts.';

revoke all on function private.refund_recruit_offer(uuid, uuid) from public, anon, authenticated, service_role;

create function private.enter_recruit_bid(target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  kid public.players;
  club public.teams;
  open_season public.seasons;
  bid public.recruit_bids;
  due_rep integer;
  due_caps integer;
  on_team integer;
  new_bid uuid;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into kid
  from public.players
  where id = target_player
  for update;

  if kid.id is null then
    raise exception 'THAT KID IS NOT HERE';
  end if;
  if kid.team_id is not null or kid.offer is null then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;
  if kid.offer = 'tryout' then
    raise exception 'A TRYOUT DOES NOT OPEN A BID';
  end if;
  if kid.offer is distinct from 'price' then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;

  select * into open_season
  from public.seasons
  where id = kid.season_id;

  if open_season.id is null or open_season.status is distinct from 'active' then
    raise exception 'RECRUITING WAITS FOR THE SEASON';
  end if;

  select * into club
  from public.teams
  where season_id = kid.season_id
    and coach_id = uid
    and practice = false;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  select * into bid
  from public.recruit_bids
  where player_id = kid.id
    and status = 'open'
  for update;

  perform 1
  from public.teams
  where teams.id = club.id
     or (bid.id is not null and teams.id = bid.high_team_id)
  order by teams.id
  for update;

  select * into club
  from public.teams
  where teams.id = club.id;

  select count(*) into on_team
  from public.players
  where team_id = club.id;

  if on_team >= open_season.roster_cap then
    raise exception 'RELEASE SOMEONE FIRST';
  end if;

  select quoted.reputation, quoted.bottlecaps
  into due_rep, due_caps
  from private.coach_recruit_price(club.id, kid.id) as quoted;

  if bid.id is null then
    begin
      insert into public.recruit_bids (
        player_id,
        season_id,
        status,
        reputation_bid,
        bottlecap_bid,
        high_team_id,
        closes_at
      )
      values (
        kid.id,
        kid.season_id,
        'open',
        due_rep,
        due_caps,
        club.id,
        now() + interval '24 hours'
      )
      returning id into new_bid;

      update public.teams
      set reputation = reputation - due_rep,
          bottlecaps = bottlecaps - due_caps
      where id = club.id
        and reputation >= due_rep
        and bottlecaps >= due_caps;

      if not found then
        raise exception 'CANNOT AFFORD THIS KID';
      end if;

      insert into public.recruit_offers (
        bid_id,
        season_id,
        team_id,
        reputation_offered,
        bottlecaps_offered,
        covered
      )
      values (new_bid, kid.season_id, club.id, due_rep, due_caps, false);
      return;
    exception
      when unique_violation then
        null;
    end;

    select * into bid
    from public.recruit_bids
    where player_id = kid.id
      and status = 'open'
    for update;

    if bid.id is null then
      raise exception 'THAT BID DID NOT OPEN';
    end if;
  end if;

  if exists (
    select 1
    from public.recruit_offers
    where bid_id = bid.id
      and team_id = club.id
  ) then
    raise exception 'YOU ARE ALREADY IN THIS BID';
  end if;

  due_rep := greatest(due_rep, bid.reputation_bid);
  due_caps := greatest(due_caps, bid.bottlecap_bid);

  if club.reputation < due_rep or club.bottlecaps < due_caps then
    raise exception 'CANNOT AFFORD THIS KID';
  end if;

  insert into public.recruit_offers (
    bid_id,
    season_id,
    team_id,
    reputation_offered,
    bottlecaps_offered,
    covered
  )
  values (bid.id, kid.season_id, club.id, 0, 0, false);
end;
$func$;

comment on function private.enter_recruit_bid(uuid) is
  'Opens a bid at this coach price, or joins an open bid without spending when the coach can pay it as it stands.';

revoke all on function private.enter_recruit_bid(uuid) from public, anon, authenticated, service_role;

create function public.enter_recruit_bid(player_id uuid)
returns void
language sql
security definer
set search_path = ''
as $func$
  select private.enter_recruit_bid(player_id);
$func$;

comment on function public.enter_recruit_bid(uuid) is
  'The signed-in coach enters the bid for a priced recruit.';

revoke all on function public.enter_recruit_bid(uuid) from public, anon, service_role;
grant execute on function public.enter_recruit_bid(uuid) to authenticated;

create function private.raise_recruit_bid(target_player uuid, purse text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  kid public.players;
  club public.teams;
  bid public.recruit_bids;
  mine public.recruit_offers;
  price_rep integer;
  price_caps integer;
  due_rep integer;
  due_caps integer;
  delta_rep integer;
  delta_caps integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;
  if purse is distinct from 'reputation' and purse is distinct from 'bottlecaps' then
    raise exception 'THAT RAISE IS NOT HERE';
  end if;

  select * into kid
  from public.players
  where id = target_player
  for update;

  if kid.id is null or kid.team_id is not null or kid.offer is distinct from 'price' then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;

  select * into bid
  from public.recruit_bids
  where player_id = kid.id
    and status = 'open'
  for update;

  if bid.id is null then
    raise exception 'THAT BID IS NOT OPEN';
  end if;

  select * into club
  from public.teams
  where season_id = kid.season_id
    and coach_id = uid
    and practice = false;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  perform 1
  from public.teams
  where teams.id = club.id
     or teams.id = bid.high_team_id
  order by teams.id
  for update;

  select * into club
  from public.teams
  where teams.id = club.id;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  select * into mine
  from public.recruit_offers
  where bid_id = bid.id
    and team_id = club.id
  for update;

  if mine.id is null then
    raise exception 'YOU ARE NOT IN THIS BID';
  end if;

  if (
    select count(*)
    from public.players
    where team_id = club.id
  ) >= (
    select roster_cap
    from public.seasons
    where id = kid.season_id
  ) then
    raise exception 'RELEASE SOMEONE FIRST';
  end if;

  select quoted.reputation, quoted.bottlecaps
  into price_rep, price_caps
  from private.coach_recruit_price(club.id, kid.id) as quoted;

  if purse = 'reputation' then
    due_rep := greatest(price_rep, bid.reputation_bid + 1);
    due_caps := greatest(price_caps, bid.bottlecap_bid);
  else
    due_rep := greatest(price_rep, bid.reputation_bid);
    due_caps := greatest(price_caps, bid.bottlecap_bid + 1);
  end if;

  if club.id = bid.high_team_id then
    delta_rep := due_rep - mine.reputation_offered;
    delta_caps := due_caps - mine.bottlecaps_offered;
    if purse = 'reputation' and (delta_rep < 1 or delta_caps <> 0) then
      raise exception 'CANNOT PAY THE REPUTATION';
    end if;
    if purse = 'bottlecaps' and (delta_caps < 1 or delta_rep <> 0) then
      raise exception 'CANNOT PAY THE BOTTLECAPS';
    end if;
    if purse = 'reputation' and club.reputation < delta_rep then
      raise exception 'CANNOT PAY THE REPUTATION';
    end if;
    if purse = 'bottlecaps' and club.bottlecaps < delta_caps then
      raise exception 'CANNOT PAY THE BOTTLECAPS';
    end if;

    update public.teams
    set reputation = reputation - case when purse = 'reputation' then delta_rep else 0 end,
        bottlecaps = bottlecaps - case when purse = 'bottlecaps' then delta_caps else 0 end
    where id = club.id;

    update public.recruit_offers
    set reputation_offered = due_rep,
        bottlecaps_offered = due_caps
    where id = mine.id;

    update public.recruit_bids
    set reputation_bid = due_rep,
        bottlecap_bid = due_caps
    where id = bid.id;
    return;
  end if;

  if club.reputation < due_rep then
    raise exception 'CANNOT PAY THE REPUTATION';
  end if;
  if club.bottlecaps < due_caps then
    raise exception 'CANNOT PAY THE BOTTLECAPS';
  end if;

  perform private.refund_recruit_offer(bid.id, bid.high_team_id);

  update public.teams
  set reputation = reputation - due_rep,
      bottlecaps = bottlecaps - due_caps
  where id = club.id
    and reputation >= due_rep
    and bottlecaps >= due_caps;

  if not found then
    raise exception 'CANNOT AFFORD THIS KID';
  end if;

  update public.recruit_offers
  set reputation_offered = due_rep,
      bottlecaps_offered = due_caps,
      covered = false
  where id = mine.id;

  update public.recruit_bids
  set reputation_bid = due_rep,
      bottlecap_bid = due_caps,
      high_team_id = club.id
  where id = bid.id;
end;
$func$;

comment on function private.raise_recruit_bid(uuid, text) is
  'Raises the open bid by one reputation or one bottlecap. A new leader pays the new commitment. The previous leader is refunded.';

revoke all on function private.raise_recruit_bid(uuid, text) from public, anon, authenticated, service_role;

create function public.raise_recruit_bid(player_id uuid, purse text)
returns void
language sql
security definer
set search_path = ''
as $func$
  select private.raise_recruit_bid(player_id, purse);
$func$;

comment on function public.raise_recruit_bid(uuid, text) is
  'The signed-in coach raises an open bid they have entered. purse is reputation or bottlecaps.';

revoke all on function public.raise_recruit_bid(uuid, text) from public, anon, service_role;
grant execute on function public.raise_recruit_bid(uuid, text) to authenticated;

create function private.cover_recruit_bid(target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  kid public.players;
  club public.teams;
  bid public.recruit_bids;
  mine public.recruit_offers;
  available_rep integer;
  unpaid integer;
  extra_caps integer;
  due_caps integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into kid
  from public.players
  where id = target_player
  for update;

  if kid.id is null or kid.team_id is not null or kid.offer is distinct from 'price' then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;

  select * into bid
  from public.recruit_bids
  where player_id = kid.id
    and status = 'open'
  for update;

  if bid.id is null then
    raise exception 'THAT BID IS NOT OPEN';
  end if;

  select * into club
  from public.teams
  where season_id = kid.season_id
    and coach_id = uid
    and practice = false;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  perform 1
  from public.teams
  where teams.id = club.id
     or teams.id = bid.high_team_id
  order by teams.id
  for update;

  select * into club
  from public.teams
  where teams.id = club.id;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  select * into mine
  from public.recruit_offers
  where bid_id = bid.id
    and team_id = club.id
  for update;

  if mine.id is null then
    raise exception 'YOU ARE NOT IN THIS BID';
  end if;

  if club.id = bid.high_team_id then
    raise exception 'THE REPUTATION IS ALREADY MET';
  end if;

  if (
    select count(*)
    from public.players
    where team_id = club.id
  ) >= (
    select roster_cap
    from public.seasons
    where id = kid.season_id
  ) then
    raise exception 'RELEASE SOMEONE FIRST';
  end if;

  available_rep := club.reputation + mine.reputation_offered;
  unpaid := bid.reputation_bid - available_rep;
  if unpaid <= 0 then
    raise exception 'THE REPUTATION IS ALREADY MET';
  end if;

  extra_caps := unpaid * 2;
  due_caps := bid.bottlecap_bid + extra_caps;
  if club.bottlecaps < due_caps then
    raise exception 'CANNOT PAY THE BOTTLECAPS';
  end if;

  perform private.refund_recruit_offer(bid.id, bid.high_team_id);

  update public.teams
  set reputation = reputation - available_rep,
      bottlecaps = bottlecaps - due_caps
  where id = club.id
    and reputation >= available_rep
    and bottlecaps >= due_caps;

  if not found then
    raise exception 'CANNOT AFFORD THIS KID';
  end if;

  update public.recruit_offers
  set reputation_offered = available_rep,
      bottlecaps_offered = due_caps,
      covered = true
  where id = mine.id;

  update public.recruit_bids
  set bottlecap_bid = due_caps,
      high_team_id = club.id
  where id = bid.id;
end;
$func$;

comment on function private.cover_recruit_bid(uuid) is
  'Takes the lead by paying two bottlecaps for each reputation point the coach is short. Reputation does not rise. The offer is marked covered.';

revoke all on function private.cover_recruit_bid(uuid) from public, anon, authenticated, service_role;

create function public.cover_recruit_bid(player_id uuid)
returns void
language sql
security definer
set search_path = ''
as $func$
  select private.cover_recruit_bid(player_id);
$func$;

comment on function public.cover_recruit_bid(uuid) is
  'The signed-in coach covers a short reputation bid with bottlecaps.';

revoke all on function public.cover_recruit_bid(uuid) from public, anon, service_role;
grant execute on function public.cover_recruit_bid(uuid) to authenticated;

create function private.join_tryout(target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  kid public.players;
  club public.teams;
  open_season public.seasons;
  on_team integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into kid
  from public.players
  where id = target_player
  for update;

  if kid.id is null or kid.team_id is not null or kid.offer is null then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;
  if kid.offer is distinct from 'tryout' then
    raise exception 'THAT KID IS NOT A TRYOUT';
  end if;

  if exists (
    select 1
    from public.recruit_bids
    where player_id = kid.id
      and status = 'open'
  ) then
    raise exception 'A TRYOUT DOES NOT OPEN A BID';
  end if;

  select * into open_season
  from public.seasons
  where id = kid.season_id;

  if open_season.id is null or open_season.status is distinct from 'active' then
    raise exception 'RECRUITING WAITS FOR THE SEASON';
  end if;

  select * into club
  from public.teams
  where season_id = kid.season_id
    and coach_id = uid
    and practice = false
  for update;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  select count(*) into on_team
  from public.players
  where team_id = club.id;

  if on_team >= open_season.roster_cap then
    raise exception 'RELEASE SOMEONE FIRST';
  end if;

  update public.players
  set team_id = club.id,
      tryout_status = 'playing'
  where id = kid.id
    and team_id is null
    and offer = 'tryout';

  if not found then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;
end;
$func$;

comment on function private.join_tryout(uuid) is
  'A tryout joins this coach now and does not charge the purse. The next official game keeps or sends the kid home.';

revoke all on function private.join_tryout(uuid) from public, anon, authenticated, service_role;

create function public.join_tryout(player_id uuid)
returns void
language sql
security definer
set search_path = ''
as $func$
  select private.join_tryout(player_id);
$func$;

comment on function public.join_tryout(uuid) is
  'The signed-in coach takes a tryout onto the roster.';

revoke all on function public.join_tryout(uuid) from public, anon, service_role;
grant execute on function public.join_tryout(uuid) to authenticated;

create function private.resolve_tryouts(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games;
  kid public.players;
  winner_name text;
  winner_id uuid;
  rep_gain boolean := false;
  strong boolean;
  stayed boolean;
  kid_name text;
  sentence text;
  extra text := '';
begin
  select * into game
  from public.games
  where id = target_game
  for update;

  if game.id is null or game.is_practice or game.dev or game.status is distinct from 'final' or game.result is null then
    return;
  end if;

  winner_name := game.result ->> 'winner';
  if winner_name = 'home' then
    winner_id := game.home_team_id;
  elsif winner_name = 'away' then
    winner_id := game.away_team_id;
  else
    winner_id := null;
  end if;

  if winner_id is not null then
    select coalesce((rules.settings ->> 'win_reputation')::integer, 0) > 0
    into rep_gain
    from public.game_settings as rules
    where rules.version = game.settings_version;
  end if;

  for kid in
    select players.*
    from public.players
    where players.team_id in (game.home_team_id, game.away_team_id)
      and players.tryout_status = 'playing'
    order by players.id
    for update
  loop
    strong := exists (
      select 1
      from jsonb_array_elements(coalesce(game.result -> 'lines', '[]'::jsonb)) as ln
      where nullif(ln ->> 'player_id', '')::uuid = kid.id
        and (
          coalesce((ln ->> 'h')::integer, 0) >= 2
          or coalesce((ln ->> 'rbi')::integer, 0) >= 2
        )
    );
    stayed := kid.team_id = winner_id or (kid.team_id = winner_id and rep_gain) or strong;
    if stayed then
      update public.players
      set tryout_status = null,
          offer = null,
          reputation_cost = null,
          bottlecap_cost = null,
          preference = null
      where id = kid.id;
    else
      kid_name := upper(btrim(concat_ws(' ', kid.given_name, kid.family_name)));
      if kid_name = '' then
        kid_name := 'KID';
      end if;
      sentence := kid_name || ' HEADED HOME.';
      if position(sentence in coalesce(game.narrative, '')) = 0 then
        extra := btrim(concat_ws(' ', extra, sentence));
      end if;
      update public.players
      set team_id = null,
          tryout_status = null,
          offer = null,
          reputation_cost = null,
          bottlecap_cost = null,
          preference = null
      where id = kid.id;
    end if;
  end loop;

  if extra <> '' then
    update public.games
    set narrative = btrim(concat_ws(' ', nullif(btrim(coalesce(narrative, '')), ''), extra))
    where id = game.id;
  end if;
end;
$func$;

comment on function private.resolve_tryouts(uuid) is
  'After an official game, a tryout stays on a win, a reputation gain, or a strong line. Otherwise the kid returns to the pool and the writeup says they headed home.';

revoke all on function private.resolve_tryouts(uuid) from public, anon, authenticated, service_role;

create function private.maybe_depart_recruit(target_season uuid, roll numeric)
returns boolean
language plpgsql
security definer
set search_path = ''
as $func$
declare
  clubs integer;
  open_count integer;
  line integer;
  surplus integer;
  chance numeric;
  leaving uuid;
begin
  if roll is null or roll < 0 or roll >= 1 then
    return false;
  end if;

  select count(*) into clubs
  from public.teams
  where season_id = target_season
    and practice = false;

  if clubs < 1 then
    return false;
  end if;

  select count(*) into open_count
  from public.players
  where season_id = target_season
    and team_id is null
    and offer is not null
    and not exists (
      select 1
      from public.recruit_bids as bid
      where bid.player_id = players.id
        and bid.status = 'open'
    );

  line := clubs * 2;
  if open_count <= line then
    return false;
  end if;

  surplus := open_count - line;
  chance := least(0.8, 0.25 * surplus);
  if roll >= chance then
    return false;
  end if;

  select players.id into leaving
  from public.players
  where players.season_id = target_season
    and players.team_id is null
    and players.offer is not null
    and not exists (
      select 1
      from public.recruit_bids as bid
      where bid.player_id = players.id
        and bid.status = 'open'
    )
  order by players.created_at, players.id
  limit 1
  for update;

  if leaving is null then
    return false;
  end if;

  delete from public.players
  where id = leaving
    and team_id is null
    and not exists (
      select 1
      from public.recruit_bids as bid
      where bid.player_id = leaving
        and bid.status = 'open'
    );

  return found;
end;
$func$;

comment on function private.maybe_depart_recruit(uuid, numeric) is
  'When passed-over recruits are past two per team, one older kid may leave. The chance rises with the surplus and stops at 80 percent.';

revoke all on function private.maybe_depart_recruit(uuid, numeric) from public, anon, authenticated, service_role;

create function private.recruit_quiet_day(target_season uuid, roll numeric)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  open_season public.seasons;
  wave_day date := (now() at time zone 'utc')::date;
  week_day integer := extract(dow from (now() at time zone 'utc'))::integer;
begin
  if roll is null or roll < 0 or roll >= 1 then
    return 0;
  end if;

  select * into open_season
  from public.seasons
  where id = target_season
  for update;

  if open_season.id is null or open_season.status is distinct from 'active' then
    return 0;
  end if;

  if exists (
    select 1
    from private.recruiting_days as days
    where days.season_id = target_season
      and days.wave_on = wave_day
  ) then
    return 0;
  end if;

  if open_season.official_weekdays is not null and week_day = any (open_season.official_weekdays) then
    if exists (
      select 1
      from public.games
      where season_id = target_season
        and is_practice = false
        and dev = false
        and (starts_at at time zone 'utc')::date = wave_day
    ) then
      return 0;
    end if;
  end if;

  if roll >= (1.0 / 3.0) then
    return 0;
  end if;

  perform private.generate_kids(target_season, 1, 'recruiting');
  insert into private.recruiting_days (season_id, wave_on, source)
  values (target_season, wave_day, 'quiet');
  perform private.maybe_depart_recruit(target_season, random());
  return 1;
end;
$func$;

comment on function private.recruit_quiet_day(uuid, numeric) is
  'On a quiet UTC day, a one-in-three roll adds one recruit. A day that already has a wave, or an official day that already has games, adds none.';

revoke all on function private.recruit_quiet_day(uuid, numeric) from public, anon, authenticated, service_role;

create function private.recruit_quiet_days()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  target_season uuid;
begin
  for target_season in
    select seasons.id
    from public.seasons
    where seasons.status = 'active'
    order by seasons.id
  loop
    begin
      perform private.recruit_quiet_day(target_season, random());
    exception
      when others then
        raise warning 'QUIET RECRUITS % SKIPPED: %', target_season, sqlerrm;
    end;
  end loop;
end;
$func$;

comment on function private.recruit_quiet_days() is
  'Rolls the quiet-day recruit for each active season. The official clock calls this.';

revoke all on function private.recruit_quiet_days() from public, anon, authenticated, service_role;

create function private.close_due_bids()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  due_id uuid;
  bid public.recruit_bids;
  kid public.players;
  held public.recruit_offers;
  open_season public.seasons;
  on_team integer;
  flat_games integer;
begin
  for due_id in
    select recruit_bids.id
    from public.recruit_bids
    where status = 'open'
      and closes_at <= now()
    order by closes_at, id
  loop
    begin
      select * into kid
      from public.players
      where id = (
        select player_id
        from public.recruit_bids
        where id = due_id
      )
      for update;

      select * into bid
      from public.recruit_bids
      where id = due_id
      for update;

      if bid.id is null or bid.status is distinct from 'open' or bid.closes_at > now() then
        continue;
      end if;

      perform 1
      from public.teams
      where id = bid.high_team_id
      for update;

      select * into held
      from public.recruit_offers
      where bid_id = bid.id
        and team_id = bid.high_team_id
      for update;

      if held.id is null then
        update public.recruit_bids
        set status = 'closed'
        where id = bid.id;
        continue;
      end if;

      select * into open_season
      from public.seasons
      where id = bid.season_id;

      select count(*) into on_team
      from public.players
      where team_id = bid.high_team_id;

      if kid.id is null
        or kid.team_id is not null
        or kid.offer is distinct from 'price'
        or open_season.id is null
        or on_team >= open_season.roster_cap
      then
        perform private.refund_recruit_offer(bid.id, bid.high_team_id);
        update public.recruit_bids
        set status = 'closed'
        where id = bid.id;
        continue;
      end if;

      flat_games := null;
      if held.covered then
        select (rules.settings ->> 'overpay_penalty_max_games')::integer
        into flat_games
        from public.game_settings as rules
        where rules.version = kid.settings_version
          and jsonb_typeof(rules.settings -> 'overpay_penalty_max_games') = 'number';
        if flat_games is null or flat_games < 1 or flat_games > 20 then
          flat_games := 3;
        end if;
      end if;

      update public.players
      set team_id = bid.high_team_id,
          offer = null,
          reputation_cost = null,
          bottlecap_cost = null,
          preference = null,
          penalty_until_game_id = case when held.covered and flat_games > 0 then gen_random_uuid() else penalty_until_game_id end,
          penalty_games_left = case when held.covered and flat_games > 0 then flat_games else penalty_games_left end
      where id = kid.id;

      update public.recruit_bids
      set status = 'closed'
      where id = bid.id;
    exception
      when others then
        raise warning 'RECRUIT BID % SKIPPED: %', due_id, sqlerrm;
    end;
  end loop;
end;
$func$;

comment on function private.close_due_bids() is
  'Gives a due bid to the leader. A full roster refunds the leader and leaves the kid on the board. A covered offer starts the flat stretch.';

revoke all on function private.close_due_bids() from public, anon, authenticated, service_role;

create function public.recruiting_strength(settings_version integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $func$
  select (rules.settings ->> 'underdog_discount_strength')::numeric
  from public.game_settings as rules
  where rules.version = settings_version
    and jsonb_typeof(rules.settings -> 'underdog_discount_strength') = 'number'
    and (rules.settings ->> 'underdog_discount_strength')::numeric between 0 and 1;
$func$;

comment on function public.recruiting_strength(integer) is
  'The underdog break stored on one settings version. Coaches use it to price a recruit. The rest of the rule book stays hidden.';

revoke all on function public.recruiting_strength(integer) from public, anon, service_role;
grant execute on function public.recruiting_strength(integer) to authenticated;

create or replace function private.recruit_for_played_days()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  wave record;
  clubs integer;
begin
  for wave in
    select games.season_id,
           (games.starts_at at time zone 'utc')::date as wave_on
    from public.games as games
    where games.status = 'final'
      and games.is_practice = false
      and games.dev = false
      and not exists (
        select 1
        from private.recruiting_days as days
        where days.season_id = games.season_id
          and days.wave_on = (games.starts_at at time zone 'utc')::date
      )
    group by games.season_id, (games.starts_at at time zone 'utc')::date
    order by 2, 1
  loop
    begin
      select count(*) into clubs
      from public.teams
      where season_id = wave.season_id
        and practice = false;
      if clubs > 0 then
        perform private.generate_kids(wave.season_id, least(clubs, 80), 'recruiting');
        perform private.maybe_depart_recruit(wave.season_id, random());
      end if;
      insert into private.recruiting_days (season_id, wave_on, source)
      values (wave.season_id, wave.wave_on, 'game');
    exception
      when others then
        raise warning 'RECRUITING % % SKIPPED: %', wave.season_id, wave.wave_on, sqlerrm;
    end;
  end loop;
end;
$func$;

comment on function private.recruit_for_played_days() is
  'One recruiting kid per real team for each UTC day that has a final official game and no wave yet. A crowded board may then lose one older kid.';

revoke all on function private.recruit_for_played_days() from public, anon, authenticated, service_role;

create or replace function private.open_recruiting_board(target_season uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := (select auth.uid());
  open_season public.seasons;
  wave_day date := (now() at time zone 'utc')::date;
  week_day integer := extract(dow from (now() at time zone 'utc'))::integer;
begin
  if uid is null then
    raise exception 'SIGN IN FIRST';
  end if;

  select * into open_season
  from public.seasons
  where seasons.id = target_season
  for update;

  if open_season.id is null then
    raise exception 'THAT SEASON IS NOT HERE';
  end if;
  if open_season.commissioner_id is distinct from uid then
    raise exception 'THE COMMISSIONER OPENS THE BOARD';
  end if;
  if open_season.status <> 'active' then
    return 0;
  end if;
  if open_season.official_weekdays is not null and week_day = any (open_season.official_weekdays) then
    return 0;
  end if;
  if exists (
    select 1
    from private.recruiting_days as days
    where days.season_id = target_season
      and days.wave_on = wave_day
  ) then
    return 0;
  end if;

  perform private.generate_kids(target_season, 1, 'recruiting');
  insert into private.recruiting_days (season_id, wave_on, source)
  values (target_season, wave_day, 'off');
  perform private.maybe_depart_recruit(target_season, random());
  return 1;
end;
$func$;

comment on function private.open_recruiting_board(uuid) is
  'On an off day, the commissioner adds one recruiting kid. A game day and a second open the same day add none. A crowded board may then lose one older kid.';

revoke all on function private.open_recruiting_board(uuid) from public, anon, authenticated, service_role;

create or replace function private.award_final_game(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  marked uuid;
  winner_name text;
  winner_id uuid;
  loser_id uuid;
  caps integer;
  rep integer;
begin
  select * into game
  from public.games
  where id = target_game
  for update;

  if not found then
    raise exception 'THAT GAME IS NOT HERE';
  end if;

  if game.is_practice then
    if game.status is distinct from 'final' or game.result is null then
      return;
    end if;
    insert into private.game_awards (game_id)
    values (target_game)
    on conflict do nothing
    returning game_id into marked;
    if marked is null then
      return;
    end if;
    perform private.spend_packed(target_game, game.home_team_id);
    perform private.spend_packed(target_game, game.away_team_id);
    return;
  end if;

  if game.status is distinct from 'final' or game.result is null then
    raise exception 'THE GAME HAS NOT BEEN PLAYED';
  end if;

  insert into private.game_awards (game_id)
  values (target_game)
  on conflict do nothing
  returning game_id into marked;

  if marked is null then
    return;
  end if;

  perform 1
  from public.teams
  where id in (game.home_team_id, game.away_team_id)
  order by id
  for update;

  winner_name := game.result ->> 'winner';
  if winner_name = 'home' then
    winner_id := game.home_team_id;
    loser_id := game.away_team_id;
  elsif winner_name = 'away' then
    winner_id := game.away_team_id;
    loser_id := game.home_team_id;
  elsif winner_name = 'tie' then
    winner_id := null;
    loser_id := null;
  else
    raise exception 'THE BOOKS DO NOT BALANCE';
  end if;

  if winner_id is not null then
    select
      (rules.settings ->> 'win_bottlecaps')::integer,
      (rules.settings ->> 'win_reputation')::integer
    into caps, rep
    from public.game_settings as rules
    where rules.version = game.settings_version;

    if caps is null or rep is null or caps < 0 or rep < 0 then
      raise exception 'THE RULES ARE NOT HERE';
    end if;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, winner_id, 1, 0)
    on conflict (season_id, team_id)
    do update set wins = standing.wins + 1;

    insert into public.standings as standing (season_id, team_id, wins, losses)
    values (game.season_id, loser_id, 0, 1)
    on conflict (season_id, team_id)
    do update set losses = standing.losses + 1;

    update public.teams
    set bottlecaps = bottlecaps + caps,
        reputation = reputation + rep
    where id = winner_id;
  end if;

  perform private.spend_packed(target_game, game.home_team_id);
  perform private.spend_packed(target_game, game.away_team_id);

  update public.players as kid
  set penalty_until_game_id = null,
      penalty_games_left = null
  where kid.penalty_until_game_id is not null
    and (
      kid.penalty_until_game_id = target_game
      or (winner_id is not null and kid.team_id = winner_id)
      or exists (
        select 1
        from jsonb_array_elements(coalesce(game.result -> 'lines', '[]'::jsonb)) as ln
        where nullif(ln ->> 'player_id', '')::uuid = kid.id
          and (
            coalesce((ln ->> 'h')::integer, 0) >= 2
            or coalesce((ln ->> 'rbi')::integer, 0) >= 2
          )
      )
    );

  update public.players as kid
  set penalty_games_left = kid.penalty_games_left - 1
  where kid.team_id in (game.home_team_id, game.away_team_id)
    and kid.penalty_until_game_id is not null
    and kid.penalty_games_left is not null
    and kid.penalty_games_left > 0;

  update public.players as kid
  set penalty_until_game_id = null,
      penalty_games_left = null
  where kid.team_id in (game.home_team_id, game.away_team_id)
    and kid.penalty_games_left is not null
    and kid.penalty_games_left <= 0;

  update public.seasons as seasons
  set status = 'completed'
  where seasons.id = game.season_id
    and seasons.status = 'active'
    and exists (
      select 1
      from public.games as played_game
      where played_game.season_id = seasons.id
        and played_game.is_practice = false
    )
    and not exists (
      select 1
      from public.games as open_game
      where open_game.season_id = seasons.id
        and open_game.is_practice = false
        and open_game.status = 'scheduled'
    );
end;
$func$;

comment on function private.award_final_game(uuid) is
  'Pays a final game once. A win adds the win purse and a win and a loss. A flat stretch ends on a win, a strong line, or the last counted official game.';

revoke all on function private.award_final_game(uuid) from public, anon, authenticated, service_role;

create or replace function private.settle_due_game(target_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  game public.games%rowtype;
  boss uuid;
begin
  select * into game
  from public.games
  where id = target_game;

  if not found or game.is_practice or game.status is distinct from 'scheduled' or game.starts_at > now() then
    return;
  end if;

  perform private.freeze_open_card(target_game);

  select * into game
  from public.games
  where id = target_game
  for update;

  if not found or game.is_practice or game.status is distinct from 'scheduled' or game.starts_at > now() then
    return;
  end if;

  if (
    select count(*)
    from public.lineup_locks as locked
    where locked.game_id = game.id
      and locked.team_id in (game.home_team_id, game.away_team_id)
      and private.card_is_full(locked.card)
  ) is distinct from 2 then
    raise exception 'ASSIGN THE NINE FIRST';
  end if;

  select seasons.commissioner_id
  into boss
  from public.seasons as seasons
  where seasons.id = game.season_id;

  if boss is null then
    raise exception 'THE COMMISSIONER IS NOT HERE';
  end if;

  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', boss)::text, true);

  begin
    perform public.play_game_now(target_game);
    perform private.resolve_tryouts(target_game);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
  exception
    when others then
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '', true);
      raise;
  end;
end;
$func$;

comment on function private.settle_due_game(uuid) is
  'Freezes open cards and plays one due official game when both nines are full. Tryouts then stay or head home. A short side raises ASSIGN THE NINE FIRST.';

revoke all on function private.settle_due_game(uuid) from public, anon, authenticated, service_role;

create or replace function private.process_due_games()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  gid uuid;
begin
  for gid in
    select games.id
    from public.games as games
    where games.status = 'scheduled'
      and games.is_practice = false
      and games.starts_at <= now()
    order by games.starts_at, games.id
  loop
    begin
      perform private.settle_due_game(gid);
    exception
      when others then
        raise warning 'OFFICIAL GAME % SKIPPED: %', gid, sqlerrm;
    end;
  end loop;
  perform private.recruit_for_played_days();
  perform private.recruit_quiet_days();
  perform private.close_due_bids();
end;
$func$;

comment on function private.process_due_games() is
  'Plays due official games, adds that day''s recruits, rolls a quiet day, and closes bids whose day is up.';

revoke all on function private.process_due_games() from public, anon, authenticated, service_role;

alter publication supabase_realtime drop table public.players;
alter publication supabase_realtime add table public.players (
  id,
  season_id,
  team_id,
  given_name,
  family_name,
  nickname,
  sex,
  flavor,
  base_stats,
  tryout_status,
  penalty_until_game_id,
  penalty_games_left,
  experience,
  settings_version,
  created_at,
  reputation_cost,
  bottlecap_cost,
  preference,
  offer
);

alter publication supabase_realtime add table public.recruit_bids (
  id,
  player_id,
  season_id,
  status,
  reputation_bid,
  bottlecap_bid,
  high_team_id,
  opened_at,
  closes_at
);

alter publication supabase_realtime add table public.recruit_offers (
  id,
  bid_id,
  season_id,
  team_id
);
