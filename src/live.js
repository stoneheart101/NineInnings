const SEASON_READY = new Set(['players', 'draft_state'])

export function seasonChanges(seasonId) {
  const season = `season_id=eq.${seasonId}`
  return [
    { table: 'seasons', filter: `id=eq.${seasonId}` },
    { table: 'teams', filter: season },
    { table: 'players', filter: season },
    { table: 'draft_state', filter: season },
    { table: 'games', filter: season },
    { table: 'standings', filter: season },
  ]
}

export function seasonReadyChanges(seasonId) {
  return seasonChanges(seasonId).filter((row) => SEASON_READY.has(row.table))
}

export function seasonPendingChanges(seasonId) {
  return seasonChanges(seasonId).filter((row) => !SEASON_READY.has(row.table))
}

export function matchupChanges(gameId) {
  return [
    { table: 'games', filter: `id=eq.${gameId}` },
    { table: 'lineup_locks', filter: `game_id=eq.${gameId}` },
  ]
}

export function listChanges() {
  return [
    { table: 'seasons' },
    { table: 'draft_state' },
  ]
}

export function listReadyChanges() {
  return listChanges().filter((row) => row.table === 'draft_state')
}

export function listPendingChanges() {
  return listChanges().filter((row) => row.table !== 'draft_state')
}

export function gameIsFinal(game) {
  return Boolean(game && (game.status === 'final' || game.result))
}

export function bindChanges(channel, changes, onRemote) {
  for (const change of changes) {
    const spec = { event: '*', schema: 'public', table: change.table }
    if (change.filter) spec.filter = change.filter
    channel.on('postgres_changes', spec, onRemote)
  }
  return channel
}
