import '@fontsource/vt323'
import './styles.css'
import { drawField } from './field.js'
import { createDesk } from './auth.js'
import { supabase } from './supabase.js'

const field = document.querySelector('#field')
const prompt = drawField(field)
const desk = createDesk(prompt)

const linkType = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type')
if (linkType === 'recovery') desk.expectRecovery()

supabase.auth.onAuthStateChange((event, session) => {
  window.setTimeout(() => {
    desk.onEvent(event, session)
  }, 0)
})

const { data } = await supabase.auth.getSession()
if (window.location.hash) {
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}
if (!data.session) desk.onEvent('INITIAL_SESSION', null)
