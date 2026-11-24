import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'
import { dayLabel, forecastLine, forecastShown } from '../forecast.js'

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

function practiceLine(days) {
  const count = Number(days)
  return `PRACTICE GAMES EVERY ${count === 1 ? '1 DAY' : `${count} DAYS`}`
}

function weeksLine(weeks) {
  const count = Number(weeks)
  return count === 1 ? 'THE SEASON LASTS 1 WEEK' : `THE SEASON LASTS ${count} WEEKS`
}

function roundsLine(rounds) {
  const count = Number(rounds)
  return count === 1 ? 'THE DRAFT HAS 1 ROUND' : `THE DRAFT HAS ${count} ROUNDS`
}

export function renderSeason(host, { seasonId, section, onOpenDraft, onOpenGame, setTeam, onDesk }) {
  const token = String(Math.random())
  host.dataset.paint = token
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
    section: section === 'teams' || section === 'schedule' || section === 'pool' ? section : '',
    loaded: false,
  }

  function paint() {
    if (host.dataset.paint !== token || !host.isConnected) return
    host.replaceChildren()
    if (!state.loaded) return
    const season = !state.missing ? state.season : null
    const myTeam = season ? state.teams.find((team) => team.coach_id === state.userId) : null
    if (myTeam && season) {
      setTeam?.({
        name: myTeam.name,
        season: season.name,
        purse: `${counted(myTeam.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(myTeam.reputation, 'REPUTATION', 'REPUTATION')}`,
      })
    } else {
      setTeam?.(null)
    }
    onDesk?.({ seasonId: season?.id || '', teamId: myTeam?.id || '' })
    const forming = season?.status === 'forming'
    const canStart = Boolean(
      season
      && !state.draftFailed
      && draftComplete(season, state.draft)
      && season.commissioner_id === state.userId,
    )

    if (state.missing || !state.season) {
      const box = el('div', 'choices')
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      host.append(box)
      return
    }

    if (forming && season.commissioner_id === state.userId) {
      const draftNote = state.draftError || (state.teams.length < 2 ? 'NEED AT LEAST TWO TEAMS' : '')
      if (draftNote) host.append(el('p', 'alert', draftNote))
    }
    if (canStart && state.playError) host.append(el('p', 'alert', state.playError))

    if (!state.section) {
      state.section = season.status === 'active' || state.games.length ? 'schedule' : 'teams'
    }
    const box = el('div', 'choices')
    const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
    box.append(
      el('p', 'season-title', season.name),
      el('p', 'season-status', statusLabel(season, state.draftFailed ? null : state.draft)),
      el('p', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
      el('p', '', practiceLine(season.practice_every_days)),
      el('p', '', weeksLine(season.weeks)),
      el('p', '', roundsLine(season.draft_rounds)),
    )
    if (season.commissioner_id === state.userId) {
      box.append(el('p', 'season-role', 'YOU ARE THE COMMISSIONER'))
    }
    if (forming && season.commissioner_id === state.userId) {
      const start = el('button', 'action', 'START THE DRAFT')
      start.type = 'button'
      start.disabled = state.busy
      start.addEventListener('click', onStart)
      box.append(start)
    }
    if (canStart) {
      const play = el('button', 'action', 'PLAY BALL')
      play.type = 'button'
      play.disabled = state.busy
      play.addEventListener('click', onPlay)
      box.append(play)
    }
    box.append(subtabs())
    if (state.section === 'teams') box.append(teamsBlock())
    else if (state.section === 'pool') box.append(poolBlock())
    else box.append(scheduleBlock())

    if (state.error) box.append(el('p', 'alert', state.error))
    host.append(box)
  }

  function subtabs() {
    const row = el('div', 'subtabs')
    for (const [id, label] of [['teams', 'TEAMS'], ['schedule', 'SCHEDULE'], ['pool', 'THE POOL']]) {
      const button = el('button', state.section === id ? 'on' : '', label)
      button.type = 'button'
      button.setAttribute('aria-pressed', state.section === id ? 'true' : 'false')
      button.addEventListener('click', () => {
        if (state.section === id) return
        state.section = id
        paint()
      })
      row.append(button)
    }
    return row
  }

  function teamsBlock() {
    const season = state.season
    const myTeam = state.teams.find((team) => team.coach_id === state.userId)
    const wrap = el('div', 'season-panel')
    if (!state.teams.length) {
      wrap.append(el('p', '', 'NO TEAMS YET'))
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
      wrap.append(list)
    }
    if (season.status === 'forming' && !myTeam) wrap.append(form())
    else if (!myTeam) wrap.append(el('p', '', 'TEAMS JOIN WHILE THE SEASON IS FORMING'))
    return wrap
  }

  function poolBlock() {
    const season = state.season
    const wrap = el('div', 'season-panel')
    if (season.status === 'forming' && season.commissioner_id === state.userId) wrap.append(callForm())
    if (state.kids) {
      const pool = state.kids.filter((kid) => !kid.team_id)
      if (!state.kids.length) {
        wrap.append(el('p', '', 'NO KIDS YET'))
      } else if (!pool.length) {
        wrap.append(el('p', '', 'NO KIDS LEFT'))
      } else {
        wrap.append(el('p', '', counted(pool.length, 'KID', 'KIDS')))
        const list = el('div', 'kid-list')
        for (const kid of pool) list.append(kidCard(kid))
        wrap.append(list)
      }
    }
    return wrap
  }

  function teamMark(id) {
    const team = state.teams.find((item) => item.id === id)
    const mine = team?.coach_id === state.userId
    return el('span', mine ? 'mine' : '', team?.name || 'TEAM')
  }

  function scheduleBlock() {
    const season = state.season
    if (state.gamesFailed && season.status === 'active') {
      return el('p', 'alert', 'THE SCHEDULE DID NOT LOAD')
    }
    const games = state.games || []
    if (!games.length) return el('p', '', 'NO GAMES YET')
    const wrap = el('div', 'schedule')
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
        const match = el('button', 'game-match')
        match.type = 'button'
        match.append(teamMark(game.away_team_id), document.createTextNode(' VS '), teamMark(game.home_team_id))
        match.addEventListener('click', () => onOpenGame?.(game.id))
        block.append(match)
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
    state.section = 'schedule'
    paint()
    const { error } = await supabase.rpc('play_ball', { season_id: seasonId })
    if (host.dataset.paint !== token || !host.isConnected) return
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
    if (host.dataset.paint !== token || !host.isConnected) return
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
    if (host.dataset.paint !== token || !host.isConnected) return
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
