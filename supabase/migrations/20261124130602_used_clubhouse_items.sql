create function private.used_clubhouse_items(target_game uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $func$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'team_id', packed.team_id,
          'name', packed.name
        )
        order by packed.side_ord, packed.item_ord
      )
      from (
        select
          locks.team_id,
          case locks.team_id
            when games.away_team_id then 0
            when games.home_team_id then 1
            else 2
          end as side_ord,
          items.ord as item_ord,
          coalesce(nullif(btrim(items.item ->> 'name'), ''), 'ITEM') as name
        from public.games as games
        join public.lineup_locks as locks
          on locks.game_id = games.id
        cross join lateral jsonb_array_elements(locks.card -> 'items')
          with ordinality as items(item, ord)
        where games.id = target_game
          and games.status = 'final'
          and jsonb_typeof(locks.card -> 'items') = 'array'
          and (select auth.uid()) is not null
      ) as packed
    ),
    '[]'::jsonb
  );
$func$;

comment on function private.used_clubhouse_items(uuid) is
  'Item names packed on the cards of one final game. A game that is not final, or a caller who is not signed in, returns an empty list. The nine stays unread.';

revoke all on function private.used_clubhouse_items(uuid) from public, anon, authenticated, service_role;
grant execute on function private.used_clubhouse_items(uuid) to authenticated;

create function public.used_clubhouse_items(game_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $func$
  select private.used_clubhouse_items(game_id);
$func$;

comment on function public.used_clubhouse_items(uuid) is
  'Signed-in coach reads the clubhouse item names used in one final game.';

revoke all on function public.used_clubhouse_items(uuid) from public, anon, service_role;
grant execute on function public.used_clubhouse_items(uuid) to authenticated;
