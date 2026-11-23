import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
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

function draftIsOpen(season, draft) {
  if (season?.status !== 'drafting' || !draft) return false
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  return order.length > 0 && Number.isInteger(pickIndex) && pickIndex < order.length
}

function draftComplete(season, draft) {
  if (season?.status !== 'drafting' || !draft) return false
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  return order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
}

function statusLabel(season, draft) {
  if (draftComplete(season, draft)) return 'THE DRAFT IS COMPLETE'
  return season.status.toUpperCase()
}

function dayLabel(when) {
  return `${DAYS[when.getUTCDay()]} ${MONTHS[when.getUTCMonth()]} ${when.getUTCDate()}`
}

function forecastSentence(game) {
  const sentence = game?.weather?.sentence
  if (typeof sentence !== 'string') return 'THE FORECAST IS NOT HERE'
  const line = sentence.trim().toUpperCase()
  return line || 'THE FORECAST IS NOT HERE'
}

function forecastLine(game) {
  const chances = game?.weather?.chances
  if (Array.isArray(chances)) {
    const parts = []
    for (const row of chances) {
      const type = typeof row?.type === 'string' ? row.type.trim().toUpperCase() : ''
      const percent = Number(row?.percent)
      if (!type || !Number.isInteger(percent)) continue
      parts.push(`${type} ${percent}%`)
    }
    if (parts.length) return parts.join(' · ')
  }
  return forecastSentence(game)
}

function forecastShown(when, now = new Date()) {
  const day = Math.floor(when.getTime() / 86400000)
  const today = Math.floor(now.getTime() / 86400000)
  return day - today <= 10
}

export function renderSeason(prompt, { seasonId, onBack, onOpenDraft, onOpenTeam, onOpenClubhouse, setTabs }) {
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
    draft: null,
    draftFailed: false,
    games: [],
    gamesFailed: false,
    playError: '',
    loaded: false,
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const season = state.loaded && !state.missing ? state.season : null
    const myTeam = season ? state.teams.find((team) => team.coach_id === state.userId) : null
    const forming = season?.status === 'forming'
    const draftOpen = season?.status === 'drafting' && (state.draftFailed || draftIsOpen(season, state.draft))
    const tabs = [{ label: 'SEASONS', onClick: onBack }]
    if (draftOpen) {
      tabs.push({ label: 'THE DRAFT', onClick: () => onOpenDraft?.() })
    }
    if (myTeam) {
      tabs.push({ label: 'THE ROSTER', onClick: () => onOpenTeam?.(myTeam.id) })
      tabs.push({ label: 'CLUBHOUSE', onClick: () => onOpenClubhouse?.(myTeam.id) })
    }
    if (forming && season.commissioner_id === state.userId) {
      tabs.push({ label: 'START THE DRAFT', disabled: state.busy, onClick: onStart })
    }
    const canStart = Boolean(
      season
      && !state.draftFailed
      && draftComplete(season, state.draft)
      && season.commissioner_id === state.userId,
    )
    if (canStart) {
      tabs.push({ label: 'PLAY BALL', disabled: state.busy, onClick: onPlay })
    }
    setTabs?.(tabs)
    prompt.append(el('h2', 'screen-name', 'SEASON'))

    if (!state.loaded) return
    if (state.missing || !state.season) {
      const box = el('div', 'choices')
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    if (forming && season.commissioner_id === state.userId) {
      const draftNote = state.draftError || (state.teams.length < 2 ? 'NEED AT LEAST TWO TEAMS' : '')
      if (draftNote) prompt.append(el('p', 'alert', draftNote))
    }
    if (canStart && state.playError) prompt.append(el('p', 'alert', state.playError))

    const box = el('div', 'choices')
    const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
    const practice = season.practice_every_days === 1
      ? 'EVERY 1 DAY'
      : `EVERY ${season.practice_every_days} DAYS`
    const weeks = season.weeks === 1 ? '1 WEEK' : `${season.weeks} WEEKS`
    const rounds = season.draft_rounds === 1 ? '1 ROUND' : `${season.draft_rounds} ROUNDS`
    box.append(
      el('p', 'season-title', season.name),
      el('p', 'season-status', statusLabel(season, state.draftFailed ? null : state.draft)),
      el('p', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
      el('p', '', `${practice} · ${weeks} · ${rounds}`),
    )
    if (season.commissioner_id === state.userId) {
      box.append(el('p', 'season-role', 'YOU ARE THE COMMISSIONER'))
    }
    const schedule = scheduleBlock(season)
    if (schedule) box.append(schedule)

    box.append(el('p', 'section', 'TEAMS'))
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

    if (forming && !myTeam) {
      box.append(form())
    } else if (!myTeam) {
      box.append(el('p', '', 'TEAMS JOIN WHILE THE SEASON IS FORMING'))
    }
    if (forming && season.commissioner_id === state.userId) {
      box.append(callForm())
    }
    if (state.kids) {
      const pool = state.kids.filter((kid) => !kid.team_id)
      box.append(el('p', 'section', 'THE POOL'))
      if (!state.kids.length) {
        box.append(el('p', '', 'NO KIDS YET'))
      } else if (!pool.length) {
        box.append(el('p', '', 'NO KIDS LEFT'))
      } else {
        box.append(el('p', '', counted(pool.length, 'KID', 'KIDS')))
        const list = el('div', 'kid-list')
        for (const kid of pool) list.append(kidCard(kid))
        box.append(list)
      }
    }

    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
  }

  function teamName(id) {
    return state.teams.find((team) => team.id === id)?.name || 'TEAM'
  }

  function scheduleBlock(season) {
    if (state.gamesFailed && season.status === 'active') {
      return el('p', 'alert', 'THE SCHEDULE DID NOT LOAD')
    }
    const games = state.games || []
    if (!games.length) {
      if (season.status === 'active') return el('p', '', 'NO GAMES YET')
      return null
    }
    const wrap = el('div', 'schedule')
    wrap.append(el('p', 'section', 'THE SCHEDULE'))
    const days = new Map()
    for (const game of games) {
      const when = new Date(game.starts_at)
      if (Number.isNaN(when.getTime())) continue
      const key = when.toISOString().slice(0, 10)
      if (!days.has(key)) days.set(key, { when, games: [] })
      days.get(key).games.push(game)
    }
    for (const day of days.values()) {
      const block = el('div', 'game-day')
      const playing = new Set()
      block.append(el('p', 'game-date', dayLabel(day.when)))
      for (const game of day.games) {
        playing.add(game.home_team_id)
        playing.add(game.away_team_id)
        block.append(el('p', 'game-match', `${teamName(game.away_team_id)} VS ${teamName(game.home_team_id)}`))
        if (forecastShown(day.when)) {
          block.append(el('p', 'game-forecast', forecastLine(game)))
        }
      }
      for (const team of state.teams) {
        if (!playing.has(team.id)) block.append(el('p', 'game-bye', `${team.name} HAS A BYE`))
      }
      wrap.append(block)
    }
    return wrap
  }

  function form() {
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

    const save = el('button', '', 'NAME THE TEAM')
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'NAME YOUR TEAM'), nameLabel, save)
    node.addEventListener('submit', onSubmit)
    return node
  }

  function callForm() {
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
    const save = el('button', '', 'CALL THE KIDS')
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'CALL THE KIDS'), el('p', '', '1 TO 40 AT A TIME'), countLabel, save)
    node.addEventListener('submit', onCall)
    return node
  }

  function kidCard(kid) {
    const card = el('div', 'kid-card')
    const head = el('div', 'kid-head')
    const title = el('span', 'kid-title')
    const nick = kid.nickname ? ` "${kid.nickname}"` : ''
    const name = [kid.given_name, kid.family_name].filter(Boolean).join(' ')
    title.append(el('span', 'season-name', `${name || 'KID'}${nick}`))
    if (kid.sex === 'M') title.append(el('span', 'sex-m', 'M'))
    else if (kid.sex === 'F') title.append(el('span', 'season-role', 'F'))
    head.append(title)
    card.append(head)
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) stats.append(statChip(label, kid.base_stats?.[stat]))
    card.append(stats)
    return card
  }

  async function onPlay() {
    if (state.busy) return
    state.busy = true
    state.playError = ''
    paint()
    const { error } = await supabase.rpc('play_ball', { season_id: seasonId })
    if (prompt.dataset.paint !== token) return
    state.busy = false
    if (error) {
      state.playError = (error.message || 'PLAY BALL DID NOT START.').toUpperCase()
      paint()
      return
    }
    await load()
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
    const [session, season, teams, kids, draft, games] = await Promise.all([
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
        .select('id, team_id, given_name, family_name, nickname, sex, flavor, base_stats, created_at')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('draft_state')
        .select('pick_index,order')
        .eq('season_id', seasonId)
        .maybeSingle(),
      supabase
        .from('games')
        .select('id, home_team_id, away_team_id, starts_at, status, weather, is_practice')
        .eq('season_id', seasonId)
        .eq('is_practice', false)
        .order('starts_at', { ascending: true })
        .order('id', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    state.kids = null
    state.draftFailed = Boolean(draft.error)
    state.draft = draft.error ? null : draft.data
    state.gamesFailed = Boolean(games.error)
    state.games = games.error ? [] : (games.data || [])
    if (season.error || teams.error) {
      state.error = ((season.error || teams.error).message || 'THE SEASON DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.games = []
      state.gamesFailed = false
      state.missing = false
      state.draft = null
      state.draftFailed = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
      state.games = []
      state.gamesFailed = false
      state.draft = null
      state.draftFailed = false
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
