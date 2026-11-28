// The next-game card names one open lock. This coach comes first.
export function lockStatus({ locked = false, foeLocked = false, known = true } = {}) {
  if (!known) return ''
  if (!locked) return 'YOU HAVE NOT LOCKED'
  if (!foeLocked) return 'WAITING ON THE OTHER COACH'
  return ''
}

export function nextOfficial(games, teamId, teams) {
  if (!teamId) return null
  let best = null
  let bestAt = Infinity
  for (const game of games || []) {
    if (!game || game.is_practice || game.status !== 'scheduled') continue
    if (game.home_team_id !== teamId && game.away_team_id !== teamId) continue
    const at = Date.parse(game.starts_at)
    if (Number.isNaN(at) || at >= bestAt) continue
    best = game
    bestAt = at
  }
  if (!best) return null
  const opponentId = best.home_team_id === teamId ? best.away_team_id : best.home_team_id
  const foe = (teams || []).find((team) => team.id === opponentId)
  return { ...best, opponent: foe?.name || 'TEAM' }
}
