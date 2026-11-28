// The signed-in menu is DASHBOARD, SEASON, and TEAM on every screen.
export function draftIsActive(season, draft) {
  if (season?.status !== 'drafting') return false
  if (!draft) return true
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  const complete = order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
  return !complete
}

export function deskMenu({ openSeasonId = '', teamId = '', place = 'list', drafting = false, forming = false, section = '', seasonName = '' } = {}) {
  const seasonPath = openSeasonId ? `/seasons/${openSeasonId}` : '/seasons'
  const joined = openSeasonId ? { path: seasonPath, section: 'details' } : { path: '/seasons', section: '' }
  const inSeason = place === 'seasons' || place === 'draft' || place === 'recruiting'
  const shown = place === 'draft' ? 'draft' : place === 'recruiting' ? 'recruiting' : section
  const onDashboard = place === 'seasons' && (shown === 'dashboard' || shown === '')
  const onSeason = place === 'list' || place === 'draft' || (inSeason && !onDashboard && shown !== '')
  const seasonSection = forming ? 'details' : drafting ? 'draft' : 'recruiting'
  const named = String(seasonName || '').trim()
  return [
    {
      id: 'dashboard',
      label: 'DASHBOARD',
      path: seasonPath,
      section: 'dashboard',
      on: onDashboard,
    },
    {
      id: 'seasons',
      label: named || 'SEASON',
      shrink: Boolean(named),
      path: seasonPath,
      section: seasonSection,
      on: onSeason,
    },
    {
      id: 'team',
      label: 'TEAM',
      ...(teamId ? { path: `/teams/${teamId}`, section: '' } : joined),
      on: place === 'roster' || place === 'clubhouse' || place === 'field',
    },
  ]
}

export function teamTabs(teamId = '') {
  const id = teamId || ''
  return [
    { id: 'roster', label: 'ROSTER', path: id ? `/teams/${id}` : '' },
    { id: 'field', label: 'HOME FIELD', path: id ? `/teams/${id}/field` : '' },
    { id: 'clubhouse', label: 'CLUBHOUSE', path: id ? `/teams/${id}/clubhouse` : '' },
  ]
}

export function placeFromRoute(route) {
  if (route === '/' || route === '/seasons') return 'list'
  if (typeof route !== 'string') return 'list'
  if (/^\/seasons\/[^/]+\/draft$/.test(route)) return 'draft'
  if (/^\/seasons\/[^/]+\/recruiting$/.test(route)) return 'recruiting'
  if (route.startsWith('/seasons/')) return 'seasons'
  if (/^\/teams\/[^/]+\/clubhouse$/.test(route)) return 'clubhouse'
  if (/^\/teams\/[^/]+\/field$/.test(route)) return 'field'
  if (route.startsWith('/teams/')) return 'roster'
  if (/^\/games\/[^/]+\/report$/.test(route)) return 'report'
  if (route.startsWith('/games/')) return 'matchup'
  return 'list'
}

export function gameIdFromRoute(route) {
  if (typeof route !== 'string') return ''
  const match = route.match(/^\/games\/([^/]+)(?:\/report)?$/)
  return match ? match[1] : ''
}

export function seasonIdFromRoute(route) {
  if (typeof route !== 'string') return ''
  const match = route.match(/^\/seasons\/([^/]+)(?:\/draft|\/recruiting)?$/)
  return match ? match[1] : ''
}
