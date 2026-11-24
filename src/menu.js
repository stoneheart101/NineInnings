// The signed-in menu is the same four tabs on every screen.
export function draftIsActive(season, draft) {
  if (season?.status !== 'drafting') return false
  if (!draft) return true
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  const complete = order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
  return !complete
}

export function deskMenu({ openSeasonId = '', teamId = '', place = 'list', drafting = false } = {}) {
  const seasonPath = openSeasonId ? `/seasons/${openSeasonId}` : '/seasons'
  const joined = openSeasonId ? { path: seasonPath, section: 'details' } : { path: '/seasons', section: '' }
  return [
    { id: 'seasons', label: 'SEASON', path: seasonPath, section: '', on: place === 'list' || place === 'seasons' },
    {
      id: 'draft',
      label: 'DRAFT',
      path: openSeasonId ? `/seasons/${openSeasonId}/draft` : '/seasons',
      section: '',
      on: place === 'draft',
      disabled: !openSeasonId || !drafting,
    },
    {
      id: 'roster',
      label: 'ROSTER',
      ...(teamId ? { path: `/teams/${teamId}`, section: '' } : joined),
      on: place === 'roster',
    },
    {
      id: 'clubhouse',
      label: 'CLUBHOUSE',
      ...(teamId ? { path: `/teams/${teamId}/clubhouse`, section: '' } : joined),
      on: place === 'clubhouse',
    },
  ]
}

export function placeFromRoute(route) {
  if (route === '/' || route === '/seasons') return 'list'
  if (typeof route !== 'string') return 'list'
  if (/^\/seasons\/[^/]+\/draft$/.test(route)) return 'draft'
  if (route.startsWith('/seasons/')) return 'seasons'
  if (/^\/teams\/[^/]+\/clubhouse$/.test(route)) return 'clubhouse'
  if (route.startsWith('/teams/')) return 'roster'
  if (route.startsWith('/games/')) return 'matchup'
  return 'list'
}

export function seasonIdFromRoute(route) {
  if (typeof route !== 'string') return ''
  const match = route.match(/^\/seasons\/([^/]+)(?:\/draft)?$/)
  return match ? match[1] : ''
}
