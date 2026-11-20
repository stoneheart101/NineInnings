import { supabase } from './supabase.js'

const COACH_NAME = /^[A-Z0-9][A-Z0-9 .'-]{0,23}$/

function redirectTo() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}

function explain(error) {
  if (!error) return ''
  const code = error.code || ''
  const message = error.message || 'SOMETHING WENT WRONG.'
  if (code === 'email_address_not_authorized' || /not authorized/i.test(message)) {
    return 'MAIL IS NOT SET UP FOR THAT ADDRESS YET. SAVE A CUSTOM SMTP SENDER ON THE PROJECT FIRST.'
  }
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(message)) {
    return 'THE MAIL LIMIT FOR THIS PROJECT HAS BEEN REACHED. TRY AGAIN LATER.'
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
    factorId: '',
    challengeId: '',
    qr: '',
    secret: '',
    recovering: false,
  }

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

  async function needsFactor() {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error) throw error
    return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
  }

  async function settle(session) {
    if (!session) {
      setMode('menu')
      return
    }
    if (state.recovering) {
      setMode('recovery')
      return
    }
    if (await needsFactor()) {
      await beginChallenge()
      return
    }
    const profile = await profileFor(session.user.id)
    if (!profile?.coach_name) {
      setMode('coach')
      return
    }
    setMode('home', { coachName: profile.coach_name })
  }

  async function beginChallenge() {
    const listed = await supabase.auth.mfa.listFactors()
    if (listed.error) throw listed.error
    const factor = listed.data.totp.find((item) => item.status === 'verified')
    if (!factor) {
      setMode('home')
      return
    }
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challenge.error) throw challenge.error
    setMode('mfa', { factorId: factor.id, challengeId: challenge.data.id })
  }

  async function onEvent(event, session) {
    try {
      if (event === 'PASSWORD_RECOVERY') {
        state.recovering = true
        setMode('recovery')
        return
      }
      if (event === 'SIGNED_OUT') {
        state.recovering = false
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

  function menuButton(label, mode) {
    const button = el('button', '', label)
    button.type = 'button'
    button.addEventListener('click', () => setMode(mode))
    return button
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
      box.append(
        menuButton('1- SIGN IN', 'signin'),
        menuButton('2- NEW ACCOUNT', 'signup'),
        menuButton('3- FORGOT PASSWORD', 'forgot'),
        el('p', '', 'WHICH?'),
      )
      return box
    },
    signin() {
      const email = field('sign-email', 'EMAIL', 'email', { autocomplete: 'username' })
      const password = field('sign-password', 'PASSWORD', 'password', {
        autocomplete: 'current-password',
        minLength: 8,
      })
      return form(async (data) => {
        const result = await supabase.auth.signInWithPassword({
          email: String(data.get('sign-email')).trim(),
          password: String(data.get('sign-password')),
        })
        if (result.error) {
          state.error = explain(result.error)
          return
        }
        await settle(result.data.session)
      }, el('p', '', 'SIGN IN'), email.wrap, password.wrap, actions(['ENTER'], ['BACK', () => setMode('menu')]))
    },
    signup() {
      const email = field('new-email', 'EMAIL', 'email', { autocomplete: 'username' })
      const password = field('new-password', 'PASSWORD', 'password', {
        autocomplete: 'new-password',
        minLength: 8,
      })
      return form(async (data) => {
        const result = await supabase.auth.signUp({
          email: String(data.get('new-email')).trim(),
          password: String(data.get('new-password')),
          options: { emailRedirectTo: redirectTo() },
        })
        if (result.error) {
          state.error = explain(result.error)
          return
        }
        if (result.data.session) {
          await settle(result.data.session)
          return
        }
        setMode('check-mail', {
          notice: 'CHECK THAT INBOX FOR THE CONFIRMATION LINK.',
        })
      }, el('p', '', 'NEW ACCOUNT'), email.wrap, password.wrap, actions(['ENTER'], ['BACK', () => setMode('menu')]))
    },
    forgot() {
      const email = field('reset-email', 'EMAIL', 'email', { autocomplete: 'username' })
      return form(async (data) => {
        const result = await supabase.auth.resetPasswordForEmail(String(data.get('reset-email')).trim(), {
          redirectTo: redirectTo(),
        })
        if (result.error) {
          state.error = explain(result.error)
          return
        }
        state.notice = 'IF AN ACCOUNT USES THAT ADDRESS, CHECK THE MAIL FOR A RESET LINK.'
        state.error = ''
      }, el('p', '', 'FORGOT PASSWORD'), email.wrap, actions(['SEND'], ['BACK', () => setMode('menu')]))
    },
    'check-mail'() {
      const box = el('div', '')
      box.append(el('p', '', 'CHECK YOUR MAIL'), actions(['BACK', () => setMode('menu')]))
      return box
    },
    recovery() {
      const password = field('recovery-password', 'NEW PASSWORD', 'password', {
        autocomplete: 'new-password',
        minLength: 8,
      })
      const again = field('recovery-again', 'AGAIN', 'password', {
        autocomplete: 'new-password',
        minLength: 8,
      })
      return form(async (data) => {
        const next = String(data.get('recovery-password'))
        if (next !== String(data.get('recovery-again'))) {
          state.error = 'THOSE PASSWORDS DO NOT MATCH.'
          return
        }
        const result = await supabase.auth.updateUser({ password: next })
        if (result.error) {
          state.error = explain(result.error)
          return
        }
        state.recovering = false
        await settle(result.data.user ? (await supabase.auth.getSession()).data.session : null)
      }, el('p', '', 'CHOOSE A NEW PASSWORD'), password.wrap, again.wrap, actions(['SAVE']))
    },
    mfa() {
      const code = field('mfa-code', 'CODE', 'text', {
        autocomplete: 'one-time-code',
        inputMode: 'numeric',
        pattern: '[0-9]{6}',
        maxLength: 6,
      })
      return form(async (data) => {
        const result = await supabase.auth.mfa.verify({
          factorId: state.factorId,
          challengeId: state.challengeId,
          code: String(data.get('mfa-code')).trim(),
        })
        if (result.error) {
          state.error = explain(result.error)
          await beginChallenge()
          state.error = explain(result.error)
          return
        }
        await settle(result.data.session ?? (await supabase.auth.getSession()).data.session)
      }, el('p', '', 'AUTHENTICATOR CODE'), code.wrap, actions(['ENTER']))
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
          state.error = 'THAT NAME WAS NOT SAVED. SIGN IN WITH THE AUTHENTICATOR CODE FIRST.'
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
        menuButton('2- CHANGE PASSWORD', 'password'),
        menuButton('3- AUTHENTICATOR', 'authenticator'),
        el('p', '', 'WHICH?'),
      )
      return box
    },
    password() {
      const password = field('change-password', 'NEW PASSWORD', 'password', {
        autocomplete: 'new-password',
        minLength: 8,
      })
      const again = field('change-again', 'AGAIN', 'password', {
        autocomplete: 'new-password',
        minLength: 8,
      })
      return form(async (data) => {
        const next = String(data.get('change-password'))
        if (next !== String(data.get('change-again'))) {
          state.error = 'THOSE PASSWORDS DO NOT MATCH.'
          return
        }
        const result = await supabase.auth.updateUser({ password: next })
        if (result.error) {
          state.error = explain(result.error)
          return
        }
        setMode('home', { notice: 'PASSWORD CHANGED.' })
      }, el('p', '', 'CHANGE PASSWORD'), password.wrap, again.wrap, actions(['SAVE'], ['BACK', () => setMode('home')]))
    },
    authenticator() {
      const box = el('div', 'choices')
      box.append(el('p', '', 'AUTHENTICATOR'), actions(
        ['ADD', () => enroll()],
        ['REMOVE', () => removeFactor()],
        ['BACK', () => setMode('home')],
      ))
      return box
    },
    enroll() {
      const box = el('div', '')
      box.append(el('p', '', 'SCAN THIS, OR TYPE THE SECRET'))
      if (state.qr.startsWith('data:image/')) {
        const image = document.createElement('img')
        image.className = 'qr'
        image.alt = 'Authenticator QR code'
        image.src = state.qr
        box.append(image)
      }
      box.append(el('p', 'secret', state.secret))
      const code = field('enroll-code', 'CODE', 'text', {
        autocomplete: 'one-time-code',
        inputMode: 'numeric',
        pattern: '[0-9]{6}',
        maxLength: 6,
      })
      box.append(form(async (data) => {
        const challenge = await supabase.auth.mfa.challenge({ factorId: state.factorId })
        if (challenge.error) {
          state.error = explain(challenge.error)
          return
        }
        const result = await supabase.auth.mfa.verify({
          factorId: state.factorId,
          challengeId: challenge.data.id,
          code: String(data.get('enroll-code')).trim(),
        })
        if (result.error) {
          state.error = explain(result.error)
          return
        }
        setMode('home', { notice: 'AUTHENTICATOR ADDED. THE NEXT SIGN-IN WILL ASK FOR A CODE.' })
      }, code.wrap, actions(['VERIFY'], ['CANCEL', cancelEnroll])))
      return box
    },
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
    state.recovering = false
    setMode('menu')
  }

  async function enroll() {
    state.busy = true
    paint()
    const result = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Nine Innings',
    })
    state.busy = false
    if (result.error) {
      setMode('authenticator', { error: explain(result.error) })
      return
    }
    setMode('enroll', {
      factorId: result.data.id,
      qr: result.data.totp?.qr_code || '',
      secret: result.data.totp?.secret || '',
    })
  }

  async function cancelEnroll() {
    if (state.factorId) {
      await supabase.auth.mfa.unenroll({ factorId: state.factorId })
    }
    setMode('home')
  }

  async function removeFactor() {
    const listed = await supabase.auth.mfa.listFactors()
    if (listed.error) {
      setMode('authenticator', { error: explain(listed.error) })
      return
    }
    const factor = listed.data.totp.find((item) => item.status === 'verified')
    if (!factor) {
      setMode('authenticator', { notice: 'NO AUTHENTICATOR IS ENROLLED.' })
      return
    }
    const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    if (removed.error) {
      setMode('authenticator', { error: explain(removed.error) })
      return
    }
    await supabase.auth.refreshSession()
    setMode('home', { notice: 'AUTHENTICATOR REMOVED.' })
  }

  document.addEventListener('keydown', (event) => {
    if (state.mode !== 'menu' && state.mode !== 'home') return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    const choice = { 1: 0, 2: 1, 3: 2 }[event.key]
    if (choice == null) return
    const button = prompt.querySelectorAll('button')[choice]
    button?.click()
  })

  return {
    onEvent,
    paint,
    expectRecovery() {
      state.recovering = true
    },
  }
}
