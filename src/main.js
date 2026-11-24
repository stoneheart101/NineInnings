import '@fontsource/vt323'
import './styles.css'
import { drawField } from './field.js'
import { createDesk } from './auth.js'
import { renderSeasons } from './screens/seasons.js'
import { closeDraft, renderDraft } from './screens/draft.js'
import { closeTeam, renderTeam } from './screens/team.js'
import { renderClubhouse } from './screens/clubhouse.js'
import { renderMatchup } from './screens/matchup.js'
import { closePopup } from './popup.js'
import { routeFromHash } from './router.js'
import { deskMenu, placeFromRoute, seasonIdFromRoute } from './menu.js'
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
let coachTeams = null
let teamsRequest = 0
let rememberedSeasonId = ''
let rememberedTeamId = ''
let drafting = false
let draftingSeasonId = ''
let nextSection = ''
let holdHeader = false
let pickActive = false
let openingActive = false

function counted(value, one, many) {
  const count = Number(value) || 0
  return `${count} ${count === 1 ? one : many}`
}

function menuTeam(row) {
  const season = Array.isArray(row.seasons) ? row.seasons[0] : row.seasons
  return {
    id: row.id,
    name: row.name,
    seasonId: row.season_id,
    season: season?.name || 'SEASON',
    bottlecaps: row.bottlecaps,
    reputation: row.reputation,
    purse: `${counted(row.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(row.reputation, 'REPUTATION', 'REPUTATION')}`,
  }
}

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
  return {
    rulesVersion,
    teams: coachTeams,
    teamId: teamIdFor(routeFromHash(window.location.hash)),
    onPickTeam(team) {
      rememberedSeasonId = team.seasonId
      rememberedTeamId = team.id
      holdHeader = true
      setTeam({
        name: team.name,
        season: team.season,
        bottlecaps: team.bottlecaps,
        reputation: team.reputation,
      })
      go(`/seasons/${team.seasonId}`)
    },
    onOpen() {
      refreshTeams()
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
  const items = deskMenu({
    openSeasonId,
    teamId: teamIdFor(route),
    place,
    drafting: openSeasonId !== '' && openSeasonId === draftingSeasonId && drafting,
  })
  setTabs(items.map((item) => ({
    label: item.label,
    on: item.on,
    disabled: item.disabled,
    onClick() {
      if (item.disabled) return
      if (item.on && !item.section) return
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
  if (seasonId === rememberedSeasonId && teamId === rememberedTeamId && !draftChanged) return
  rememberedSeasonId = seasonId
  rememberedTeamId = teamId
  applyTabs()
  setCoach(coachName, coachDetails())
  if (teamId && Array.isArray(coachTeams) && !coachTeams.some((team) => team.id === teamId)) refreshTeams()
}

async function refreshTeams() {
  const request = ++teamsRequest
  const session = await supabase.auth.getSession()
  if (request !== teamsRequest) return
  const userId = session.data.session?.user?.id
  if (!userId) {
    coachTeams = []
    if (coachName) setCoach(coachName, coachDetails())
    return
  }
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, bottlecaps, reputation, season_id, seasons!teams_season_id_fkey(name)')
    .eq('coach_id', userId)
    .order('created_at', { ascending: false })
  if (request !== teamsRequest) return
  if (error) return
  coachTeams = (data || []).map(menuTeam)
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
  refreshTeams()
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
  if (!holdHeader) setTeam(null)
  holdHeader = false
  setCoach(coachName, coachDetails())
  applyTabs()
  const place = placeFromRoute(route)
  if (place === 'list' || place === 'seasons') {
    const section = nextSection
    nextSection = ''
    renderSeasons(prompt, {
      seasonId: seasonIdFromRoute(route),
      section,
      onOpen: (id) => go(`/seasons/${id}`),
      onOpenDraft: () => go(`/seasons/${seasonIdFromRoute(route)}/draft`),
      onOpenGame: (id) => go(`/games/${id}`),
      setTeam,
      onDesk,
      onDrafting,
    })
    return
  }
  if (place === 'draft') {
    const seasonId = seasonIdFromRoute(route)
    renderDraft(prompt, { seasonId, setTeam, onDesk })
    return
  }
  if (place === 'matchup') {
    const gameId = route.slice('/games/'.length)
    renderMatchup(prompt, { gameId, setTeam, onDesk })
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
      onOpenGame: (id) => go(`/games/${id}`),
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
    refreshTeams()
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
      coachTeams = null
      teamsRequest += 1
      rememberedSeasonId = ''
      rememberedTeamId = ''
      drafting = false
      draftingSeasonId = ''
      nextSection = ''
      holdHeader = false
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
