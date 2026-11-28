import { forfeitCall } from './forfeit.js'

export function vsSides(away, home, mineId) {
  const left = away || { id: '', name: '' }
  const right = home || { id: '', name: '' }
  if (mineId && right.id === mineId && left.id !== mineId) return [right, left]
  return [left, right]
}

export function gameKind(game) {
  if (game?.dev) return 'DEV'
  if (game?.is_practice) return 'PRACTICE'
  return 'OFFICIAL'
}

export function playedScore(game) {
  if (forfeitCall(game?.result)) return 'FORFEIT'
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

export function historyPage(games, expanded) {
  const all = Array.isArray(games) ? games : []
  if (expanded || all.length <= 2) return { shown: all.slice(), more: false }
  return { shown: all.slice(0, 2), more: true }
}
