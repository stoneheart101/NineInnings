-- A high bid stays held until this coach is outbid or passes.
-- A bid ends when every other real coach has passed, not when a day runs out.
-- A tryout waits until every coach has offered a look or passed, then picks a team.

alter table public.players
  add column tryout_lean text;

alter table public.players
  add constraint players_tryout_lean check (
    tryout_lean is null or tryout_lean in ('underdog', 'best', 'random')
  );

comment on column public.players.tryout_lean is
  'How a tryout picks among the coaches who offered a look. Null unless the offer is a tryout.';

update public.players
set tryout_lean = case
  when preference = 'underdog' then 'underdog'
  when mod(hashtext(id::text), 2) = 0 then 'best'
  else 'random'
end
where offer = 'tryout'
  and tryout_lean is null;

create function private.stamp_tryout_lean()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
begin
  if new.offer is distinct from 'tryout' then
    new.tryout_lean := null;
  elsif new.tryout_lean is null then
    new.tryout_lean := case floor(pg_catalog.random() * 3)::integer
      when 0 then 'underdog'
      when 1 then 'best'
      else 'random'
    end;
  end if;
  return new;
end;
$func$;

comment on function private.stamp_tryout_lean() is
  'Gives a tryout a lean when it has none, and clears that lean when the kid is no longer a tryout.';

revoke all on function private.stamp_tryout_lean() from public, anon, authenticated, service_role;

create trigger players_tryout_lean
  before insert or update of offer, tryout_lean
  on public.players
  for each row
  execute function private.stamp_tryout_lean();

alter table public.recruit_offers
  add column created_at timestamptz not null default now();

comment on column public.recruit_offers.created_at is
  'When this coach entered. The earliest coach who can pay takes a bid the leader leaves.';

comment on table public.recruit_bids is
  'One standing bid for a priced recruit. The high bid is what the leader has committed. It ends when every other real coach has passed. closes_at stays stored and does not award the kid.';

create table public.recruit_passes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  choice text not null,
  created_at timestamptz not null default now(),
  constraint recruit_passes_choice check (choice in ('pass', 'tryout')),
  constraint recruit_passes_once unique (player_id, team_id)
);

comment on table public.recruit_passes is
  'A coach passed on this kid, or offered a tryout. The kid stays on the board until the other coaches have chosen.';

create index recruit_passes_season_idx on public.recruit_passes (season_id, player_id);

alter table public.recruit_passes enable row level security;

revoke all on table public.recruit_passes from public, anon, authenticated, service_role;

grant select (
  id,
  player_id,
  season_id,
  team_id,
  choice,
  created_at
) on table public.recruit_passes to authenticated;

create policy recruit_passes_select
  on public.recruit_passes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams
      where teams.season_id = recruit_passes.season_id
        and teams.coach_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.seasons
      where seasons.id = recruit_passes.season_id
        and seasons.commissioner_id = (select auth.uid())
    )
  );

create function private.settle_recruit(target_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  kid public.players;
  bid public.recruit_bids;
  held public.recruit_offers;
  open_season public.seasons;
  clubs integer;
  answered integer;
  remaining integer;
  last_team uuid;
  on_team integer;
  flat_games integer;
  chosen uuid;
  interested integer;
begin
  select * into kid
  from public.players
  where id = target_player
  for update;

  if kid.id is null or kid.team_id is not null or kid.offer is null then
    return;
  end if;

  select * into open_season
  from public.seasons
  where id = kid.season_id;

  if open_season.id is null or open_season.status is distinct from 'active' then
    return;
  end if;

  select count(*) into clubs
  from public.teams
  where season_id = kid.season_id
    and practice = false;

  if clubs < 1 then
    return;
  end if;

  if kid.offer = 'tryout' then
    select count(*) into answered
    from public.recruit_passes as picks
    join public.teams as clubs_row on clubs_row.id = picks.team_id
    where picks.player_id = kid.id
      and clubs_row.season_id = kid.season_id
      and clubs_row.practice = false;

    if answered < clubs then
      return;
    end if;

    select count(*) into interested
    from public.recruit_passes
    where player_id = kid.id
      and choice = 'tryout';

    if interested = 0 then
      delete from public.recruit_passes
      where player_id = kid.id;

      update public.players
      set offer = 'price'
      where id = kid.id
        and team_id is null
        and offer = 'tryout';
      return;
    end if;

    perform 1
    from public.teams
    where id in (
      select team_id
      from public.recruit_passes
      where player_id = kid.id
        and choice = 'tryout'
    )
    order by id
    for update;

    select picks.team_id into chosen
    from public.recruit_passes as picks
    join public.teams as clubs_row on clubs_row.id = picks.team_id
    where picks.player_id = kid.id
      and picks.choice = 'tryout'
      and clubs_row.practice = false
      and (
        select count(*)
        from public.players as roster
        where roster.team_id = clubs_row.id
      ) < open_season.roster_cap
    order by
      case coalesce(kid.tryout_lean, 'best')
        when 'underdog' then clubs_row.reputation
        when 'best' then -clubs_row.reputation
        else 0
      end,
      case
        when coalesce(kid.tryout_lean, 'best') = 'random' then pg_catalog.random()
        else 0::double precision
      end,
      picks.created_at,
      clubs_row.id
    limit 1;

    if chosen is null then
      return;
    end if;

    update public.players
    set team_id = chosen,
        tryout_status = 'playing'
    where id = kid.id
      and team_id is null
      and offer = 'tryout';

    delete from public.recruit_passes
    where player_id = kid.id;
    return;
  end if;

  if kid.offer is distinct from 'price' then
    return;
  end if;

  select * into bid
  from public.recruit_bids
  where player_id = kid.id
    and status = 'open'
  for update;

  select count(*) into answered
  from public.recruit_passes as picks
  join public.teams as clubs_row on clubs_row.id = picks.team_id
  where picks.player_id = kid.id
    and picks.choice = 'pass'
    and clubs_row.season_id = kid.season_id
    and clubs_row.practice = false;

  remaining := clubs - answered;

  if remaining <= 0 then
    if bid.id is not null then
      perform 1
      from public.teams
      where id = bid.high_team_id
      for update;

      perform private.refund_recruit_offer(bid.id, bid.high_team_id);

      update public.recruit_bids
      set status = 'closed'
      where id = bid.id;
    end if;

    delete from public.recruit_passes
    where player_id = kid.id;
    return;
  end if;

  if bid.id is null or remaining <> 1 then
    return;
  end if;

  select clubs_row.id into last_team
  from public.teams as clubs_row
  where clubs_row.season_id = kid.season_id
    and clubs_row.practice = false
    and not exists (
      select 1
      from public.recruit_passes as picks
      where picks.player_id = kid.id
        and picks.team_id = clubs_row.id
        and picks.choice = 'pass'
    );

  if last_team is distinct from bid.high_team_id then
    return;
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
    return;
  end if;

  select count(*) into on_team
  from public.players
  where team_id = bid.high_team_id;

  if on_team >= open_season.roster_cap then
    return;
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
      penalty_until_game_id = case
        when held.covered and flat_games > 0 then gen_random_uuid()
        else penalty_until_game_id
      end,
      penalty_games_left = case
        when held.covered and flat_games > 0 then flat_games
        else penalty_games_left
      end
  where id = kid.id;

  update public.recruit_bids
  set status = 'closed'
  where id = bid.id;

  delete from public.recruit_passes
  where player_id = kid.id;
end;
$func$;

comment on function private.settle_recruit(uuid) is
  'Awards a priced kid when one coach remains and leads the bid. A tryout joins the preferred club once every coach has chosen. A full roster waits.';

revoke all on function private.settle_recruit(uuid) from public, anon, authenticated, service_role;

create function private.settle_open_recruits()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  kid_id uuid;
begin
  for kid_id in
    select players.id
    from public.players as players
    where players.team_id is null
      and players.offer is not null
      and (
        players.offer = 'tryout'
        or exists (
          select 1
          from public.recruit_bids as bid
          where bid.player_id = players.id
            and bid.status = 'open'
        )
      )
    order by players.id
  loop
    begin
      perform private.settle_recruit(kid_id);
    exception
      when others then
        raise warning 'RECRUIT % SKIPPED: %', kid_id, sqlerrm;
    end;
  end loop;
end;
$func$;

comment on function private.settle_open_recruits() is
  'Settles tryouts and open bids whose coaches have already chosen. A bid does not end because its clock ran out.';

revoke all on function private.settle_open_recruits() from public, anon, authenticated, service_role;

create function private.pass_recruit(target_player uuid)
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
  prior text;
  next_team uuid;
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
     or (
       bid.id is not null
       and (
         teams.id = bid.high_team_id
         or exists (
           select 1
           from public.recruit_offers
           where recruit_offers.bid_id = bid.id
             and recruit_offers.team_id = teams.id
         )
       )
     )
  order by teams.id
  for update;

  select * into club
  from public.teams
  where teams.id = club.id;

  if club.id is null then
    raise exception 'YOU ARE NOT IN THIS SEASON';
  end if;

  select choice into prior
  from public.recruit_passes
  where player_id = kid.id
    and team_id = club.id;

  if prior = 'pass' then
    perform private.settle_recruit(kid.id);
    return;
  end if;
  if prior is not null then
    raise exception 'YOU ALREADY CHOSE';
  end if;

  insert into public.recruit_passes (player_id, season_id, team_id, choice)
  values (kid.id, kid.season_id, club.id, 'pass');

  if kid.offer = 'tryout' then
    perform private.settle_recruit(kid.id);
    return;
  end if;

  if kid.offer is distinct from 'price' then
    raise exception 'THAT KID IS NOT ON THE BOARD';
  end if;

  if bid.id is not null and bid.high_team_id = club.id then
    perform private.refund_recruit_offer(bid.id, club.id);

    select offers.team_id into next_team
    from public.recruit_offers as offers
    join public.teams as clubs_row on clubs_row.id = offers.team_id
    where offers.bid_id = bid.id
      and offers.team_id <> club.id
      and clubs_row.practice = false
      and not exists (
        select 1
        from public.recruit_passes as passed
        where passed.player_id = kid.id
          and passed.team_id = offers.team_id
          and passed.choice = 'pass'
      )
      and clubs_row.reputation >= bid.reputation_bid
      and clubs_row.bottlecaps >= bid.bottlecap_bid
      and (
        select count(*)
        from public.players as roster
        where roster.team_id = clubs_row.id
      ) < open_season.roster_cap
    order by offers.created_at, offers.id
    limit 1;

    if next_team is null then
      update public.recruit_bids
      set status = 'closed'
      where id = bid.id;
    else
      update public.teams
      set reputation = reputation - bid.reputation_bid,
          bottlecaps = bottlecaps - bid.bottlecap_bid
      where id = next_team
        and reputation >= bid.reputation_bid
        and bottlecaps >= bid.bottlecap_bid;

      if not found then
        update public.recruit_bids
        set status = 'closed'
        where id = bid.id;
      else
        update public.recruit_offers
        set reputation_offered = bid.reputation_bid,
            bottlecaps_offered = bid.bottlecap_bid,
            covered = false
        where bid_id = bid.id
          and team_id = next_team;

        update public.recruit_bids
        set high_team_id = next_team
        where id = bid.id;
      end if;
    end if;
  end if;

  perform private.settle_recruit(kid.id);
end;
$func$;

comment on function private.pass_recruit(uuid) is
  'This coach leaves the kid. A leading bid is refunded and offered to the earliest coach still in who can pay it.';

revoke all on function private.pass_recruit(uuid) from public, anon, authenticated, service_role;

create function public.pass_recruit(player_id uuid)
returns void
language sql
security definer
set search_path = ''
as $func$
  select private.pass_recruit(player_id);
$func$;

comment on function public.pass_recruit(uuid) is
  'The signed-in coach passes on a recruit.';

revoke all on function public.pass_recruit(uuid) from public, anon, service_role;
grant execute on function public.pass_recruit(uuid) to authenticated;

create or replace function private.enter_recruit_bid(target_player uuid)
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

  if exists (
    select 1
    from public.recruit_passes
    where player_id = kid.id
      and team_id = club.id
      and choice = 'pass'
  ) then
    raise exception 'YOU PASSED ON THIS KID';
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
      perform private.settle_recruit(kid.id);
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
  perform private.settle_recruit(kid.id);
end;
$func$;

comment on function private.enter_recruit_bid(uuid) is
  'Opens a bid at this coach price, or joins an open bid without spending when the coach can pay it as it stands. A pass blocks another entry. The bid settles when every other coach has passed.';


create or replace function private.raise_recruit_bid(target_player uuid, purse text)
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

  if exists (
    select 1
    from public.recruit_passes
    where player_id = kid.id
      and team_id = club.id
      and choice = 'pass'
  ) then
    raise exception 'YOU PASSED ON THIS KID';
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
    perform private.settle_recruit(kid.id);
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
  perform private.settle_recruit(kid.id);
end;
$func$;

comment on function private.raise_recruit_bid(uuid, text) is
  'Raises the open bid by one reputation or one bottlecap. A new leader pays the new commitment. The previous leader is refunded.';


create or replace function private.cover_recruit_bid(target_player uuid)
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

  if exists (
    select 1
    from public.recruit_passes
    where player_id = kid.id
      and team_id = club.id
      and choice = 'pass'
  ) then
    raise exception 'YOU PASSED ON THIS KID';
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
  perform private.settle_recruit(kid.id);
end;
$func$;

comment on function private.cover_recruit_bid(uuid) is
  'Takes the lead by paying two bottlecaps for each reputation point the coach is short. Reputation does not rise. The offer is marked covered.';


create or replace function private.join_tryout(target_player uuid)
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
  prior text;
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

  select choice into prior
  from public.recruit_passes
  where player_id = kid.id
    and team_id = club.id;

  if prior = 'tryout' then
    perform private.settle_recruit(kid.id);
    return;
  end if;
  if prior is not null then
    raise exception 'YOU ALREADY CHOSE';
  end if;

  select count(*) into on_team
  from public.players
  where team_id = club.id;

  if on_team >= open_season.roster_cap then
    raise exception 'RELEASE SOMEONE FIRST';
  end if;

  insert into public.recruit_passes (player_id, season_id, team_id, choice)
  values (kid.id, kid.season_id, club.id, 'tryout');

  perform private.settle_recruit(kid.id);
end;
$func$;

comment on function private.join_tryout(uuid) is
  'Records a tryout offer. The kid picks a team once every coach has chosen, and the purse is not charged.';

comment on function public.join_tryout(uuid) is
  'The signed-in coach offers a tryout. The kid joins after every coach has chosen.';

create or replace function private.close_due_bids()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
begin
  perform private.settle_open_recruits();
end;
$func$;

comment on function private.close_due_bids() is
  'Settles recruits whose coaches have chosen. A bid stays open when other coaches have not passed.';

comment on function private.process_due_games() is
  'Plays due official games, adds that day''s recruits, rolls a quiet day, and settles recruits whose coaches have chosen.';

alter publication supabase_realtime add table public.recruit_passes (
  id,
  player_id,
  season_id,
  team_id,
  choice,
  created_at
);
