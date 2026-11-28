export function nextScheduleView(current, choice) {
  const view = current === 'mine' ? 'mine' : 'all'
  const picked = choice === 'mine' ? 'mine' : 'all'
  if (view === picked && picked !== 'all') return 'all'
  return picked
}

export function gameOpens(game, teamId) {
  if (!teamId || !game) return false
  return game.home_team_id === teamId || game.away_team_id === teamId
}

export function scheduleDays({ games, teams, teamId, view, dayKey }) {
  const mine = view === 'mine'
  const days = new Map()
  for (const game of Array.isArray(games) ? games : []) {
    if (!game || game.is_practice) continue
    const when = new Date(game.starts_at)
    if (Number.isNaN(when.getTime())) continue
    const key = dayKey(when)
    if (!days.has(key)) days.set(key, { when, games: [] })
    days.get(key).games.push(game)
  }
  const rows = []
  for (const day of days.values()) {
    const playing = new Set()
    for (const game of day.games) {
      playing.add(game.home_team_id)
      playing.add(game.away_team_id)
    }
    const cards = mine ? day.games.filter((game) => gameOpens(game, teamId)) : day.games.slice()
    const byes = []
    for (const team of Array.isArray(teams) ? teams : []) {
      if (!team?.id || playing.has(team.id)) continue
      if (mine && team.id !== teamId) continue
      byes.push(team)
    }
    if (mine && !cards.length && !byes.length) continue
    rows.push({ when: day.when, games: cards, byes })
  }
  return rows
}
