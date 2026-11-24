export function gameKind(game) {
  if (game?.dev) return 'DEV'
  if (game?.is_practice) return 'PRACTICE'
  return 'OFFICIAL'
}

export function playedScore(game) {
  const away = game?.result?.away?.runs
  const home = game?.result?.home?.runs
  if (!Number.isInteger(away) || !Number.isInteger(home)) return ''
  return `${away} TO ${home}`
}

export function narrativeLead(text) {
  if (typeof text !== 'string') return ''
  const part = text.split(/\n\n+/).map((line) => line.trim()).find(Boolean)
  return part || ''
}

export function playedGames(games) {
  return (Array.isArray(games) ? games : [])
    .filter((game) => game?.status === 'final')
    .slice()
    .sort((left, right) => {
      const at = Date.parse(right?.starts_at) - Date.parse(left?.starts_at)
      if (at) return at
      return String(right?.id || '').localeCompare(String(left?.id || ''))
    })
}
