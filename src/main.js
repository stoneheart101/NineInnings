import '@fontsource/vt323'
import './styles.css'
import { drawField } from './field.js'
import { createDesk } from './auth.js'
import { renderHome } from './screens/home.js'
import { renderSeasons } from './screens/seasons.js'
import { renderSeason } from './screens/season.js'
import { closeDraft, renderDraft } from './screens/draft.js'
import { closeTeam, renderTeam } from './screens/team.js'
import { renderClubhouse } from './screens/clubhouse.js'
import { routeFromHash } from './router.js'
import { supabase } from './supabase.js'

const field = document.querySelector('#field')
const { prompt, setCoach, setTabs } = drawField(field, {
  onSignOut: async () => {
    const { error } = await supabase.auth.signOut()
    if (!error) return ''
    return (error.message || 'COULD NOT SIGN OUT.').toUpperCase()
  },
})

let coachName = ''
let rulesVersion = null

async function loadRules() {
  const { data, error } = await supabase
    .from('game_settings')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const next = error || data?.version == null ? null : data.version
  if (next === rulesVersion) return
  rulesVersion = next
  renderDesk()
}

function renderDesk() {
  setCoach(coachName)
  closeDraft()
  closeTeam()
  if (!coachName) return
  const route = routeFromHash(window.location.hash)
  if (route === '/seasons') {
    renderSeasons(prompt, {
      onBack: () => go('/'),
      onOpen: (id) => go(`/seasons/${id}`),
      setTabs,
    })
    return
  }
  if (typeof route === 'string' && route.endsWith('/draft')) {
    const seasonId = route.slice('/seasons/'.length, -'/draft'.length)
    renderDraft(prompt, {
      seasonId,
      onBack: () => go(`/seasons/${seasonId}`),
      setTabs,
    })
    return
  }
  if (typeof route === 'string' && route.startsWith('/seasons/')) {
    const seasonId = route.slice('/seasons/'.length)
    renderSeason(prompt, {
      seasonId,
      onBack: () => go('/seasons'),
      onOpenDraft: () => go(`/seasons/${seasonId}/draft`),
      onOpenTeam: (id) => go(`/teams/${id}`),
      onOpenClubhouse: (id) => go(`/teams/${id}/clubhouse`),
      setTabs,
    })
    return
  }
  if (typeof route === 'string' && route.startsWith('/teams/') && route.endsWith('/clubhouse')) {
    const teamId = route.slice('/teams/'.length, -'/clubhouse'.length)
    renderClubhouse(prompt, {
      teamId,
      onBack: () => go('/'),
      onOpenSeason: (id) => go(`/seasons/${id}`),
      onOpenDraft: (id) => go(`/seasons/${id}/draft`),
      onOpenRoster: () => go(`/teams/${teamId}`),
      setTabs,
    })
    return
  }
  if (typeof route === 'string' && route.startsWith('/teams/')) {
    const teamId = route.slice('/teams/'.length)
    renderTeam(prompt, {
      teamId,
      onBack: () => go('/'),
      onOpenSeason: (id) => go(`/seasons/${id}`),
      onOpenDraft: (id) => go(`/seasons/${id}/draft`),
      onOpenClubhouse: () => go(`/teams/${teamId}/clubhouse`),
      setTabs,
    })
    return
  }
  renderHome(prompt, {
    rulesVersion,
    onSeasons: () => go('/seasons'),
    onOpenTeam: (id) => go(`/teams/${id}`),
    setTabs,
  })
}

function go(path) {
  const next = `#${path}`
  if (window.location.hash === next) renderDesk()
  else window.location.hash = next
}

const desk = createDesk(prompt, {
  setTabs,
  onNamed(name) {
    coachName = name
    if (routeFromHash(window.location.hash) == null) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
    }
    renderDesk()
    loadRules()
  },
})

window.addEventListener('hashchange', () => {
  renderDesk()
})

const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const queryParams = new URLSearchParams(window.location.search)
const oauthError = hashParams.get('error_description') || queryParams.get('error_description') || hashParams.get('error') || queryParams.get('error') || ''
if (oauthError && routeFromHash(window.location.hash) == null) {
  desk.note(oauthError.replace(/\+/g, ' ').toUpperCase())
}

supabase.auth.onAuthStateChange((event, session) => {
  window.setTimeout(() => {
    if (event === 'SIGNED_OUT') {
      coachName = ''
      rulesVersion = null
      closeDraft()
      closeTeam()
      setCoach('')
    }
    desk.onEvent(event, session)
  }, 0)
})

const { data } = await supabase.auth.getSession()
{
  const url = new URL(window.location.href)
  const route = routeFromHash(url.hash)
  url.searchParams.delete('error')
  url.searchParams.delete('error_code')
  url.searchParams.delete('error_description')
  if (route == null || url.hash === '' || url.hash === '#') url.hash = '#/'
  const search = url.searchParams.toString()
  const next = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== current) history.replaceState(null, '', next)
}
if (!data.session) desk.onEvent('INITIAL_SESSION', null)
