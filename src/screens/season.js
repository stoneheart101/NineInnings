import { supabase } from '../supabase.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const STATS = [
  ['contact', 'CONTACT'],
  ['power', 'POWER'],
  ['eye', 'EYE'],
  ['speed', 'SPEED'],
  ['glove', 'GLOVE'],
  ['arm', 'ARM'],
  ['stamina', 'STAMINA'],
]

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function counted(value, one, many) {
  return `${value} ${value === 1 ? one : many}`
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function whole(value, min, max) {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  if (number < min || number > max) return null
  return number
}

function coachName(team) {
  const profile = Array.isArray(team.profiles) ? team.profiles[0] : team.profiles
  return profile?.coach_name || 'COACH'
}

export function renderSeason(prompt, { seasonId, onBack, onOpenDraft }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    season: null,
    teams: [],
    userId: '',
    error: '',
    missing: false,
    busy: false,
    name: '',
    kids: null,
    count: '',
    draftError: '',
    loaded: false,
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const box = el('div', 'choices')
    box.dataset.keys = 'on'

    const back = el('button', '', '1- BACK')
    back.type = 'button'
    back.addEventListener('click', onBack)
    box.append(back)

    if (!state.loaded) {
      prompt.append(box)
      return
    }
    if (state.missing || !state.season) {
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    const season = state.season
    const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
    const practice = season.practice_every_days === 1
      ? 'EVERY 1 DAY'
      : `EVERY ${season.practice_every_days} DAYS`
    const weeks = season.weeks === 1 ? '1 WEEK' : `${season.weeks} WEEKS`
    const rounds = season.draft_rounds === 1 ? '1 ROUND' : `${season.draft_rounds} ROUNDS`
    box.append(
      el('p', 'season-title', season.name),
      el('p', 'season-status', season.status.toUpperCase()),
      el('p', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
      el('p', '', `${practice} · ${weeks} · ${rounds}`),
    )
    if (season.commissioner_id === state.userId) {
      box.append(el('p', 'season-role', 'YOU ARE THE COMMISSIONER'))
    }

    box.append(el('p', '', 'TEAMS'))
    if (!state.teams.length) {
      box.append(el('p', '', 'NO TEAMS YET'))
    } else {
      const list = el('div', 'team-list')
      for (const team of state.teams) {
        const card = el('div', 'team-card')
        card.append(el('span', 'season-name', team.name), el('span', '', coachName(team)))
        if (team.coach_id === state.userId) {
          card.append(el('span', 'season-role', `YOUR TEAM · ${counted(team.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(team.reputation, 'REPUTATION', 'REPUTATION')}`))
        }
        list.append(card)
      }
      box.append(list)
    }

    const mine = state.teams.some((team) => team.coach_id === state.userId)
    const forming = season.status === 'forming'
    let nextKey = 2
    if (forming && !mine) {
      box.append(form(nextKey))
      nextKey += 1
    } else if (!mine) {
      box.append(el('p', '', 'TEAMS JOIN WHILE THE SEASON IS FORMING'))
    }
    if (forming && season.commissioner_id === state.userId) {
      box.append(callForm(nextKey))
      nextKey += 1
      box.append(startButton(nextKey))
      const draftNote = state.draftError || (state.teams.length < 2 ? 'NEED AT LEAST TWO TEAMS' : '')
      if (draftNote) box.append(el('p', 'alert', draftNote))
    }
    if (season.status === 'drafting') {
      const open = el('button', '', `${nextKey}- THE DRAFT`)
      open.type = 'button'
      open.addEventListener('click', () => onOpenDraft?.())
      box.append(open)
    }
    if (state.kids) {
      box.append(el('p', '', state.kids.length ? counted(state.kids.length, 'KID', 'KIDS') : 'NO KIDS YET'))
      if (state.kids.length) {
        const list = el('div', 'kid-list')
        for (const kid of state.kids) list.append(kidCard(kid))
        box.append(list)
      }
    }

    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
  }

  function form(key) {
    const node = document.createElement('form')
    node.className = 'name-team'
    const name = document.createElement('input')
    name.name = 'team-name'
    name.required = true
    name.maxLength = 40
    name.autocomplete = 'off'
    name.spellcheck = false
    name.value = state.name
    const nameLabel = el('label')
    nameLabel.append(el('span', '', 'NAME'), name)

    const save = el('button', '', `${key}- NAME THE TEAM`)
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'NAME YOUR TEAM'), nameLabel, save)
    node.addEventListener('submit', onSubmit)
    return node
  }

  function startButton(key) {
    const button = el('button', '', `${key}- START THE DRAFT`)
    button.type = 'button'
    button.disabled = state.busy
    button.addEventListener('click', onStart)
    return button
  }

  function callForm(key) {
    const node = document.createElement('form')
    node.className = 'call-kids'
    const count = document.createElement('input')
    count.className = 'num'
    count.name = 'kid-count'
    count.type = 'number'
    count.inputMode = 'numeric'
    count.required = true
    count.min = '1'
    count.max = '40'
    count.step = '1'
    count.value = state.count
    const countLabel = el('label')
    countLabel.append(el('span', '', 'HOW MANY'), count)
    const save = el('button', '', `${key}- CALL THE KIDS`)
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'CALL THE KIDS'), el('p', '', '1 TO 40 AT A TIME'), countLabel, save)
    node.addEventListener('submit', onCall)
    return node
  }

  function kidCard(kid) {
    const card = el('div', 'kid-card')
    const name = [kid.given_name, kid.family_name].filter(Boolean).join(' ')
    card.append(el('span', 'season-name', name || 'KID'))
    if (kid.nickname) card.append(el('span', '', `"${kid.nickname}"`))
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) {
      const value = kid.base_stats?.[stat]
      stats.append(el('span', 'kid-stat', `${label} ${Number.isInteger(value) ? value : '-'}`))
    }
    card.append(stats)
    return card
  }

  async function onStart() {
    if (state.busy) return
    state.busy = true
    state.draftError = ''
    paint()
    const { error } = await supabase.rpc('start_draft', { season_id: seasonId })
    if (prompt.dataset.paint !== token) return
    state.busy = false
    if (error) {
      state.draftError = (error.message || 'THE DRAFT DID NOT START.').toUpperCase()
      paint()
      return
    }
    onOpenDraft?.()
  }

  async function onCall(event) {
    event.preventDefault()
    if (state.busy) return
    const data = new FormData(event.currentTarget)
    const raw = String(data.get('kid-count') || '')
    state.count = raw
    const kidCount = whole(raw, 1, 40)
    if (kidCount == null) {
      state.error = 'CALL BETWEEN 1 AND 40 KIDS'
      paint()
      return
    }
    state.busy = true
    state.error = ''
    const button = event.currentTarget.querySelector('button')
    if (button) button.disabled = true
    const { error } = await supabase.rpc('call_kids', {
      season_id: seasonId,
      kid_count: kidCount,
    })
    state.busy = false
    if (error) {
      state.error = (error.message || 'THE KIDS DID NOT COME.').toUpperCase()
      paint()
      return
    }
    state.count = ''
    await load()
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (state.busy) return
    const data = new FormData(event.currentTarget)
    const teamName = cleanName(String(data.get('team-name') || ''))
    state.name = teamName
    if (!/^[A-Z0-9][A-Z0-9 .'-]{0,39}$/.test(teamName)) {
      state.error = "USE 1 TO 40 LETTERS, NUMBERS, SPACES, OR . ' -"
      paint()
      return
    }
    state.busy = true
    state.error = ''
    const button = event.currentTarget.querySelector('button')
    if (button) button.disabled = true
    const { error } = await supabase.rpc('create_team', {
      season_id: seasonId,
      team_name: teamName,
    })
    state.busy = false
    if (error) {
      state.error = (error.message || 'THAT TEAM WAS NOT NAMED.').toUpperCase()
      paint()
      return
    }
    state.name = ''
    await load()
  }

  async function load() {
    const [session, season, teams, kids] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('seasons')
        .select('id, name, commissioner_id, status, official_weekdays, practice_every_days, weeks, draft_rounds')
        .eq('id', seasonId)
        .maybeSingle(),
      supabase
        .from('teams')
        .select('id, name, coach_id, bottlecaps, reputation, profiles!teams_coach_id_fkey(coach_name)')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true }),
      supabase
        .from('players')
        .select('id, given_name, family_name, nickname, flavor, base_stats, created_at')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    state.kids = null
    if (season.error || teams.error) {
      state.error = ((season.error || teams.error).message || 'THE SEASON DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.missing = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
    } else {
      state.missing = false
      state.season = season.data
      state.teams = teams.data || []
      if (kids.error) {
        state.error = (kids.error.message || 'THE KIDS DID NOT LOAD.').toUpperCase()
      } else {
        state.kids = kids.data || []
      }
    }
    state.loaded = true
    paint()
  }

  paint()
  load()
}
