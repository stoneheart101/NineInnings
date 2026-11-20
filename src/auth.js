import { supabase } from './supabase.js'

const COACH_NAME = /^[A-Z0-9][A-Z0-9 .'-]{0,23}$/

function redirectTo() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}

function explain(error) {
  if (!error) return ''
  const message = error.message || 'SOMETHING WENT WRONG.'
  if (/provider is not enabled/i.test(message)) {
    return 'GOOGLE SIGN-IN IS NOT TURNED ON FOR THIS PROJECT.'
  }
  return message.toUpperCase()
}

function normalizeCoach(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function field(id, label, type, options = {}) {
  const wrap = document.createElement('label')
  wrap.htmlFor = id
  wrap.append(el('span', '', label))
  const input = document.createElement('input')
  input.id = id
  input.name = id
  input.type = type
  input.required = true
  input.autocomplete = options.autocomplete || 'off'
  input.spellcheck = false
  if (options.minLength) input.minLength = options.minLength
  if (options.maxLength) input.maxLength = options.maxLength
  if (options.inputMode) input.inputMode = options.inputMode
  if (options.pattern) input.pattern = options.pattern
  wrap.append(input)
  return { wrap, input }
}

export function createDesk(prompt) {
  const state = {
    mode: 'boot',
    busy: false,
    error: '',
    notice: '',
    coachName: '',
  }
  let pendingError = ''

  function paint() {
    prompt.replaceChildren()
    const view = views[state.mode] || views.menu
    prompt.append(view())
    if (state.error) prompt.append(el('p', 'alert', state.error))
    if (state.notice) prompt.append(el('p', 'alert', state.notice))
  }

  function setMode(mode, extra = {}) {
    Object.assign(state, { error: '', notice: '', ...extra, mode })
    paint()
  }

  async function profileFor(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, coach_name')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  async function settle(session) {
    if (!session) {
      const error = pendingError || (state.mode === 'menu' || state.mode === 'boot' ? state.error : '')
      pendingError = ''
      setMode('menu', { error })
      return
    }
    pendingError = ''
    const profile = await profileFor(session.user.id)
    if (!profile?.coach_name) {
      setMode('coach')
      return
    }
    setMode('home', { coachName: profile.coach_name })
  }

  async function onEvent(event, session) {
    try {
      if (event === 'SIGNED_OUT') {
        setMode('menu')
        return
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        await settle(session)
      }
    } catch (error) {
      setMode(state.mode === 'boot' ? 'menu' : state.mode, { error: explain(error) })
    }
  }

  function form(onSubmit, ...nodes) {
    const node = document.createElement('form')
    node.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (state.busy) return
      state.busy = true
      state.error = ''
      state.notice = ''
      const submit = node.querySelector('button[type="submit"]')
      if (submit) submit.disabled = true
      try {
        await onSubmit(new FormData(node))
      } catch (error) {
        state.error = explain(error)
        state.notice = ''
      } finally {
        state.busy = false
        paint()
      }
    })
    node.append(...nodes)
    return node
  }

  function actions(...pairs) {
    const row = el('div', 'row')
    for (const [label, handler] of pairs) {
      const button = el('button', '', label)
      button.type = handler ? 'button' : 'submit'
      if (handler) button.addEventListener('click', handler)
      if (!handler) button.disabled = state.busy
      row.append(button)
    }
    return row
  }

  const views = {
    boot() {
      return el('p', '', 'READY')
    },
    menu() {
      const box = el('div', 'choices')
      const button = el('button', '', '1- SIGN IN WITH GOOGLE')
      button.type = 'button'
      button.disabled = state.busy
      button.addEventListener('click', () => {
        signInWithGoogle()
      })
      box.append(button, el('p', '', 'WHICH?'))
      return box
    },
    coach() {
      const name = field('coach-name', 'COACH NAME', 'text', {
        autocomplete: 'nickname',
        maxLength: 24,
      })
      return form(async (data) => {
        const coachName = normalizeCoach(String(data.get('coach-name')))
        if (!COACH_NAME.test(coachName)) {
          state.error = "USE 1 TO 24 LETTERS, NUMBERS, SPACES, OR . ' -"
          return
        }
        const user = (await supabase.auth.getUser()).data.user
        if (!user) {
          setMode('menu')
          return
        }
        const result = await supabase
          .from('profiles')
          .update({ coach_name: coachName })
          .eq('id', user.id)
          .select('id, coach_name')
        if (result.error) {
          state.error = result.error.code === '23505' ? 'THAT COACH NAME IS TAKEN.' : explain(result.error)
          return
        }
        if (!result.data?.length) {
          state.error = 'THAT NAME WAS NOT SAVED.'
          return
        }
        setMode('home', { coachName })
      }, el('p', '', 'ENTER COACH NAME'), name.wrap, actions(['SAVE'], ['SIGN OUT', signOut]))
    },
    home() {
      const box = el('div', 'choices')
      const signOutButton = el('button', '', '1- SIGN OUT')
      signOutButton.type = 'button'
      signOutButton.addEventListener('click', () => {
        signOut()
      })
      box.append(
        el('p', '', `COACH: ${state.coachName}`),
        signOutButton,
        el('p', '', 'WHICH?'),
      )
      return box
    },
  }

  async function signInWithGoogle() {
    state.busy = true
    state.error = ''
    paint()
    const result = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo() },
    })
    if (result.error) {
      state.busy = false
      setMode('menu', { error: explain(result.error) })
    }
  }

  async function signOut() {
    state.busy = true
    const { error } = await supabase.auth.signOut()
    state.busy = false
    if (error) {
      state.error = explain(error)
      paint()
      return
    }
    setMode('menu')
  }

  document.addEventListener('keydown', (event) => {
    if (state.mode !== 'menu' && state.mode !== 'home') return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    const choice = { 1: 0 }[event.key]
    if (choice == null) return
    const button = prompt.querySelectorAll('button')[choice]
    button?.click()
  })

  return {
    onEvent,
    paint,
    note(message) {
      pendingError = message
    },
  }
}
