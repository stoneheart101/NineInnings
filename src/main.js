import '@fontsource/vt323'
import './styles.css'
import { drawField } from './field.js'
import { createDesk } from './auth.js'
import { mountBackendTest } from './backend-test.js'
import { supabase } from './supabase.js'

const field = document.querySelector('#field')
const prompt = drawField(field)
const desk = createDesk(prompt)
mountBackendTest(field)

const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const queryParams = new URLSearchParams(window.location.search)
const oauthError = hashParams.get('error_description') || queryParams.get('error_description') || hashParams.get('error') || queryParams.get('error') || ''
if (oauthError) desk.note(oauthError.replace(/\+/g, ' ').toUpperCase())

supabase.auth.onAuthStateChange((event, session) => {
  window.setTimeout(() => {
    desk.onEvent(event, session)
  }, 0)
})

const { data } = await supabase.auth.getSession()
if (window.location.hash || oauthError) {
  const url = new URL(window.location.href)
  url.hash = ''
  url.searchParams.delete('error')
  url.searchParams.delete('error_code')
  url.searchParams.delete('error_description')
  const search = url.searchParams.toString()
  history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}`)
}
if (!data.session) desk.onEvent('INITIAL_SESSION', null)
