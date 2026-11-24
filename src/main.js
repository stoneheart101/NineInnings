import '@fontsource/vt323'
import './styles.css'
import { drawField } from './field.js'
import { createDesk } from './auth.js'
import { renderSeasons } from './screens/seasons.js'
import { closeDraft } from './screens/draft.js'
import { closeTeam, renderTeam } from './screens/team.js'
import { renderClubhouse } from './screens/clubhouse.js'
import { renderMatchup } from './screens/matchup.js'
import { renderReport } from './screens/report.js'
import { closePopup } from './popup.js'
import { openSeasonPopup } from './open-season.js'
import { routeFromHash } from './router.js'
import { deskMenu, gameIdFromRoute, placeFromRoute, seasonIdFromRoute } from './menu.js'
import { supabase } from './supabase.js'

const field = document.querySelector('#field')
const { prompt, setCoach, setTeam, setTabs } = drawField(field, {
  onSignOut: async () => {
    const { error } = await supabase.auth.signOut()
    if (!error) return ''
    return (error.message || 'COULD NOT SIGN OUT.').toUpperCase()
  },
})

let coachName = ''
let rulesVersion = null
let coachSeasons = null
let seasonsRequest = 0
let rememberedSeasonId = ''
let rememberedTeamId = ''
let drafting = false
let draftingSeasonId = ''
let nextSection = ''
let menuSection = ''
let pickActive = false
let openingActive = false

function openSeasonIdFor(route) {
  const place = placeFromRoute(route)
  if (place === 'list') return ''
  return seasonIdFromRoute(route) || rememberedSeasonId
}

function teamIdFor(route) {
  const openSeasonId = openSeasonIdFor(route)
  if (!openSeasonId || rememberedSeasonId !== openSeasonId) return ''
  return rememberedTeamId
}

function coachDetails() {
  const route = routeFromHash(window.location.hash)
  return {
    rulesVersion,
    seasons: coachSeasons,
    seasonId: openSeasonIdFor(route),
    onPickSeason(season) {
      const current = openSeasonIdFor(routeFromHash(window.location.hash))
      if (season.id !== current) nextSection = 'dashboard'
      go(`/seasons/${season.id}`)
    },
    onOpen() {
      refreshSeasons()
    },
    onOpenSeason({ reopen }) {
      openSeasonPopup({
        onOpened(id) {
          if (id) go(`/seasons/${id}`)
          else renderDesk()
        },
        onBack() {
          reopen?.()
        },
      })
    },
  }
}

function assignDrafting(seasonId, active) {
  const nextId = seasonId || ''
  const next = Boolean(nextId && active)
  if (next === drafting && nextId === draftingSeasonId) return false
  drafting = next
  draftingSeasonId = nextId
  return true
}

function applyTabs() {
  if (!coachName) return
  const route = routeFromHash(window.location.hash)
  const place = placeFromRoute(route)
  const openSeasonId = openSeasonIdFor(route)
  if (place === 'list') menuSection = ''
  const section = place === 'draft' ? 'draft' : place === 'recruiting' ? 'recruiting' : place === 'seasons' ? (nextSection || menuSection || 'dashboard') : ''
  const items = deskMenu({
    openSeasonId,
    teamId: teamIdFor(route),
    place,
    section,
    drafting: openSeasonId !== '' && openSeasonId === draftingSeasonId && drafting,
  })
  setTabs(items.map((item) => ({
    label: item.label,
    on: item.on,
    disabled: item.disabled,
    onClick() {
      if (item.disabled || item.on) return
      if (item.section) nextSection = item.section
      go(item.path)
    },
  })))
}

function onDrafting(seasonId, active) {
  if (!assignDrafting(seasonId, active)) return
  applyTabs()
}

function onDesk(ctx) {
  const seasonId = ctx?.seasonId || ''
  const teamId = ctx?.teamId || ''
  const reported = ctx != null && Object.hasOwn(ctx, 'drafting')
  const draftChanged = reported
    ? assignDrafting(seasonId, ctx.drafting)
    : seasonId !== rememberedSeasonId
      ? assignDrafting(seasonId, false)
      : false
  const reportedSection = ctx != null && Object.hasOwn(ctx, 'section')
  const section = reportedSection ? String(ctx.section || '') : menuSection
  const sectionChanged = section !== menuSection
  if (seasonId === rememberedSeasonId && teamId === rememberedTeamId && !draftChanged && !sectionChanged) return
  rememberedSeasonId = seasonId
  rememberedTeamId = teamId
  if (reportedSection) menuSection = section
  applyTabs()
  setCoach(coachName, coachDetails())
  if (seasonId && Array.isArray(coachSeasons) && !coachSeasons.some((season) => season.id === seasonId)) refreshSeasons()
}

async function refreshSeasons() {
  const request = ++seasonsRequest
  const session = await supabase.auth.getSession()
  if (request !== seasonsRequest) return
  const userId = session.data.session?.user?.id
  if (!userId) {
    coachSeasons = []
    if (coachName) setCoach(coachName, coachDetails())
    return
  }
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
  if (request !== seasonsRequest) return
  if (error) return
  coachSeasons = (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    status: String(row.status || '').toUpperCase(),
  }))
  if (coachName) setCoach(coachName, coachDetails())
}

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

async function activeSeasonId() {
  const session = await supabase.auth.getSession()
  const userId = session.data.session?.user?.id
  if (!userId) return ''
  const [seasons, teams] = await Promise.all([
    supabase.from('seasons').select('id').eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('teams').select('season_id').eq('coach_id', userId),
  ])
  if (seasons.error) return ''
  const active = seasons.data || []
  if (!active.length) return ''
  const mine = new Set(teams.error ? [] : (teams.data || []).map((row) => row.season_id))
  return (active.find((row) => mine.has(row.id)) || active[0]).id
}

async function openActiveSeason() {
  prompt.classList.remove('sign-in')
  prompt.replaceChildren()
  setCoach(coachName, coachDetails())
  applyTabs()
  refreshSeasons()
  const id = await activeSeasonId()
  if (!coachName) return
  const route = routeFromHash(window.location.hash)
  if (route !== '/' && route !== '/seasons') {
    renderDesk()
    loadRules()
    return
  }
  if (id) go(`/seasons/${id}`)
  else renderDesk()
  loadRules()
}

function renderDesk() {
  prompt.classList.remove('sign-in')
  closePopup()
  closeDraft()
  closeTeam()
  if (!coachName) {
    setCoach('')
    setTeam(null)
    return
  }
  const route = routeFromHash(window.location.hash)
  setTeam(null)
  setCoach(coachName, coachDetails())
  applyTabs()
  const place = placeFromRoute(route)
  if (place === 'list' || place === 'seasons' || place === 'draft') {
    const section = place === 'draft' ? 'draft' : place === 'recruiting' ? 'recruiting' : nextSection
    nextSection = ''
    if (section) menuSection = section
    renderSeasons(prompt, {
      seasonId: seasonIdFromRoute(route),
      section,
      onOpen: (id) => go(`/seasons/${id}`),
      onOpenDraft: () => go(`/seasons/${seasonIdFromRoute(route)}/draft`),
      onOpenGame: (id) => go(`/games/${id}`),
      onOpenReport: (id) => go(`/games/${id}/report`),
      onLeave: () => {
        setTeam(null)
        go('/seasons')
      },
      setTeam,
      onDesk,
      onDrafting,
    })
    return
  }
  if (place === 'report') {
    renderReport(prompt, { gameId: gameIdFromRoute(route), setTeam, onDesk })
    return
  }
  if (place === 'matchup') {
    renderMatchup(prompt, { gameId: gameIdFromRoute(route), setTeam, onDesk })
    return
  }
  if (place === 'clubhouse') {
    const teamId = route.slice('/teams/'.length, -'/clubhouse'.length)
    renderClubhouse(prompt, { teamId, setTeam, onDesk })
    return
  }
  if (place === 'roster') {
    const teamId = route.slice('/teams/'.length)
    renderTeam(prompt, {
      teamId,
      setTeam,
      onDesk,
    })
  }
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
    const route = routeFromHash(window.location.hash)
    const landing = !pickActive && (route === '/' || route === '/seasons')
    pickActive = true
    if (landing) {
      openingActive = true
      openActiveSeason().finally(() => {
        openingActive = false
      })
      return
    }
    if (openingActive) return
    renderDesk()
    loadRules()
    refreshSeasons()
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
      coachSeasons = null
      seasonsRequest += 1
      rememberedSeasonId = ''
      rememberedTeamId = ''
      drafting = false
      draftingSeasonId = ''
      nextSection = ''
      menuSection = ''
      pickActive = false
      openingActive = false
      closeDraft()
      closeTeam()
      closePopup()
      setTeam(null)
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
