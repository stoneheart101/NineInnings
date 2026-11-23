import '@fontsource/vt323'
import './styles.css'
import { drawField } from './field.js'
import { createDesk } from './auth.js'
import { renderHome } from './screens/home.js'
import { renderSeasons } from './screens/seasons.js'
import { renderSeason } from './screens/season.js'
import { routeFromHash } from './router.js'
import { supabase } from './supabase.js'

const field = document.querySelector('#field')
const prompt = drawField(field)

// The home desk keeps the field. Any other signed-in route is real work.
function syncLayout() {
  const route = coachName ? routeFromHash(window.location.hash) : null
  field.classList.toggle('working', route != null && route !== '/')
}

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
  syncLayout()
  if (!coachName) return
  const route = routeFromHash(window.location.hash)
  if (route === '/seasons') {
    renderSeasons(prompt, {
      onBack: () => go('/'),
      onOpen: (id) => go(`/seasons/${id}`),
    })
    return
  }
  if (typeof route === 'string' && route.startsWith('/seasons/')) {
    renderSeason(prompt, {
      seasonId: route.slice('/seasons/'.length),
      onBack: () => go('/seasons'),
    })
    return
  }
  renderHome(prompt, {
    coachName,
    rulesVersion,
    onSeasons: () => go('/seasons'),
    onOpenSeason: (id) => go(`/seasons/${id}`),
    onSignOut: async () => {
      const { error } = await supabase.auth.signOut()
      if (!error) return
      const alert = document.createElement('p')
      alert.className = 'alert'
      alert.textContent = (error.message || 'COULD NOT SIGN OUT.').toUpperCase()
      prompt.append(alert)
    },
  })
}

function go(path) {
  const next = `#${path}`
  if (window.location.hash === next) renderDesk()
  else window.location.hash = next
}

const desk = createDesk(prompt, {
  onNamed(name) {
    coachName = name
    if (routeFromHash(window.location.hash) == null) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
    }
    renderDesk()
    loadRules()
  },
})

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (document.querySelector('dialog[open]')) return
  pressKey(event, prompt.querySelector('[data-keys]'))
})

function pressKey(event, box) {
  if (!box) return
  const index = Number(event.key) - 1
  if (!Number.isInteger(index) || index < 0) return
  const button = box.querySelectorAll('button')[index]
  if (!button) return
  event.preventDefault()
  button.click()
}

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
      syncLayout()
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
