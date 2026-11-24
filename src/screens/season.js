import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'
import { clockLabel, dayKey, dayLabel, forecastChances, forecastShown } from '../forecast.js'
import { draftIsActive } from '../menu.js'
import { gameKind, narrativeLead, playedGames, playedScore } from '../played.js'
import { closeDraft, renderDraft } from './draft.js'

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

function fact(label, value) {
  const row = el('div', 'fact')
  row.append(el('span', 'fact-label', label), el('span', '', value))
  return row
}

function practiceValue(days) {
  const count = Number(days)
  return count === 1 ? 'EVERY DAY' : `EVERY ${count} DAYS`
}

function weeksValue(weeks) {
  const count = Number(weeks)
  return count === 1 ? '1 WEEK' : `${count} WEEKS`
}

function roundsValue(rounds) {
  const count = Number(rounds)
  return count === 1 ? '1 ROUND' : `${count} ROUNDS`
}

function chosenSection(section) {
  if (section === 'dashboard' || section === 'schedule' || section === 'pool' || section === 'draft') return section
  if (section === 'details' || section === 'season' || section === 'teams') return 'details'
  return ''
}

function shownSection(section, draftingNow) {
  if (section === 'schedule' && draftingNow) return 'draft'
  if (section === 'draft' && !draftingNow) return 'schedule'
  return section || 'dashboard'
}

export function renderSeason(host, { seasonId, section, onOpenDraft, onOpenGame, setTeam, onDesk }) {
  const token = String(Math.random())
  host.dataset.paint = token
  const next = { ready: false, failed: false, game: null }
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
    draftClosed: false,
    games: [],
    gamesFailed: false,
    playError: '',
    section: chosenSection(section),
    loaded: false,
  }

  host.setNext = (info) => {
    if (host.dataset.paint !== token) return
    next.ready = Boolean(info?.ready)
    next.failed = Boolean(info?.failed)
    next.game = info?.game || null
    if (state.loaded && state.section === 'dashboard') paint()
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
        bottlecaps: myTeam.bottlecaps,
        reputation: myTeam.reputation,
      })
    } else {
      setTeam?.(null)
    }
    if (!state.section) state.section = 'dashboard'
    const draftingNow = draftIsActive(season, state.draftFailed ? null : state.draft) && !state.draftClosed
    const visible = shownSection(state.section, draftingNow)
    onDesk?.({
      seasonId: season?.id || '',
      teamId: myTeam?.id || '',
      drafting: draftingNow,
      section: visible,
    })
    if (state.missing || !state.season) {
      const box = el('div', 'choices')
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      host.append(box)
      return
    }

    const box = el('div', 'choices')
    if (visible === 'dashboard') {
      closeDraft()
      const announcement = nextGameNode()
      if (announcement) box.append(announcement)
      box.append(historyBlock())
    } else {
      box.append(subtabs(visible, draftingNow))
      if (visible === 'details') box.append(detailsBlock())
      else if (visible === 'pool') box.append(poolBlock())
      else if (visible === 'draft') box.append(draftBlock())
      else box.append(scheduleBlock())
      if (visible !== 'draft') closeDraft()
    }

    if (state.error) box.append(el('p', 'alert', state.error))
    host.append(box)
  }

  function seasonBlock() {
    const season = state.season
    const forming = season.status === 'forming'
    const canStart = Boolean(
      !state.draftFailed
      && draftComplete(season, state.draft)
      && season.commissioner_id === state.userId,
    )
    const card = el('div', 'card season-facts')
    const head = el('div', 'card-head')
    head.append(el('span', 'card-title', season.name))
    const actions = el('div', 'card-actions')
    const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
    const facts = el('div', 'facts')
    facts.append(
      fact('OFFICIAL DAYS', days.join(' ') || 'NONE'),
      fact('PRACTICE', practiceValue(season.practice_every_days)),
      fact('WEEKS', weeksValue(season.weeks)),
      fact('DRAFT', roundsValue(season.draft_rounds)),
    )
    if (season.commissioner_id === state.userId) facts.append(fact('COMMISSIONER', 'YOU'))
    if (forming && season.commissioner_id === state.userId) {
      const start = el('button', 'action', 'START THE DRAFT')
      start.type = 'button'
      start.disabled = state.busy
      start.addEventListener('click', onStart)
      actions.append(start)
    }
    if (canStart) {
      const play = el('button', 'action', 'PLAY BALL')
      play.type = 'button'
      play.disabled = state.busy
      play.addEventListener('click', onPlay)
      actions.append(play)
    }
    if (actions.childNodes.length) head.append(actions)
    card.append(
      head,
      el('p', 'season-status', statusLabel(season, state.draftFailed ? null : state.draft)),
      facts,
    )
    if (forming && season.commissioner_id === state.userId) {
      const draftNote = state.draftError || (state.teams.length < 2 ? 'NEED AT LEAST TWO TEAMS' : '')
      if (draftNote) card.append(el('p', 'alert', draftNote))
    }
    if (canStart && state.playError) card.append(el('p', 'alert', state.playError))
    return card
  }

  function detailsBlock() {
    const wrap = el('div', 'details')
    wrap.append(seasonBlock(), teamsBlock())
    return wrap
  }

  function linkCard(className, onOpen) {
    const card = el('div', `card ${className}`)
    card.tabIndex = 0
    card.setAttribute('role', 'link')
    card.addEventListener('click', () => onOpen())
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    })
    return card
  }

  function cardAction(label, onOpen) {
    const button = el('button', '', label)
    button.type = 'button'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onOpen()
    })
    const actions = el('div', 'card-actions')
    actions.append(button)
    return actions
  }

  function nextGameNode() {
    if (!next.ready) return null
    if (next.failed) return el('p', 'alert', 'THE NEXT GAME DID NOT LOAD')
    const game = next.game
    if (!game) return null
    const when = new Date(game.starts_at)
    if (Number.isNaN(when.getTime())) return null
    const open = () => onOpenGame?.(game.id)
    const card = linkCard('next-game', open)
    const head = el('div', 'card-head')
    const foe = game.opponent || 'TEAM'
    head.append(el('span', 'card-title', `NEXT GAME VS ${foe}`), cardAction('OPEN', open))
    card.append(head, el('p', 'game-date', clockLabel(when)))
    if (forecastShown(when)) {
      const chances = forecastChances(game)
      if (chances) card.append(el('p', 'game-forecast', chances))
    }
    return card
  }

  function sideName(game, side) {
    const id = side === 'home' ? game.home_team_id : game.away_team_id
    const team = state.teams.find((item) => item.id === id)
    if (team?.name) return { name: team.name, mine: team.coach_id === state.userId }
    const named = game.result?.[side]?.name
    const name = typeof named === 'string' && named.trim() ? named.trim() : 'TEAM'
    return { name, mine: false }
  }

  function matchTitle(game) {
    const title = el('span', 'card-title game-match')
    const away = sideName(game, 'away')
    const home = sideName(game, 'home')
    title.append(el('span', away.mine ? 'mine' : '', away.name), document.createTextNode(' VS '), el('span', home.mine ? 'mine' : '', home.name))
    return title
  }

  function historyBlock() {
    const wrap = el('div', 'played-list')
    wrap.append(el('p', 'section', 'PLAYED'))
    if (state.gamesFailed) {
      wrap.append(el('p', 'alert', 'THE GAMES DID NOT LOAD'))
      return wrap
    }
    const games = playedGames(state.games)
    if (!games.length) {
      wrap.append(el('p', '', 'NO GAMES PLAYED YET'))
      return wrap
    }
    for (const game of games) wrap.append(playedCard(game))
    return wrap
  }

  function playedCard(game) {
    const open = () => onOpenGame?.(game.id)
    const card = linkCard('played-card', open)
    if (game?.dev || game?.is_practice) card.classList.add('scrimmage')
    const head = el('div', 'card-head')
    head.append(matchTitle(game), cardAction('REVIEW', open))
    const when = new Date(game.starts_at)
    const bits = [playedScore(game), gameKind(game)]
    if (!Number.isNaN(when.getTime())) bits.push(clockLabel(when))
    const detail = bits.filter(Boolean).join(' · ')
    card.append(head, el('p', '', detail))
    const lead = narrativeLead(game.narrative)
    if (lead) card.append(el('p', '', lead))
    return card
  }

  function subtabs(visible, draftingNow) {
    const row = el('div', 'subtabs')
    const tabs = [[draftingNow ? 'draft' : 'schedule', draftingNow ? 'DRAFT' : 'SCHEDULE'], ['pool', 'THE POOL'], ['details', 'DETAILS']]
    for (const [id, label] of tabs) {
      const button = el('button', visible === id ? 'on' : '', label)
      button.type = 'button'
      button.setAttribute('aria-pressed', visible === id ? 'true' : 'false')
      button.addEventListener('click', () => {
        if (state.section === id) return
        state.section = id
        paint()
      })
      row.append(button)
    }
    return row
  }

  function draftBlock() {
    const node = el('div', 'draft-host')
    renderDraft(node, {
      seasonId,
      setTeam,
      heading: false,
      onDesk: (ctx) => {
        if (ctx?.draftKnown && ctx.drafting === false && !state.draftClosed) {
          state.draftClosed = true
          state.section = 'schedule'
          window.setTimeout(() => {
            if (host.dataset.paint === token) paint()
          }, 0)
        }
        onDesk?.({ ...ctx, section: state.draftClosed ? 'schedule' : 'draft' })
      },
    })
    return node
  }

  function teamsBlock() {
    const season = state.season
    const myTeam = state.teams.find((team) => team.coach_id === state.userId)
    const wrap = el('div', 'season-panel')
    wrap.append(el('p', 'section', 'TEAMS'))
    if (!state.teams.length) {
      wrap.append(el('p', '', 'NO TEAMS YET'))
    } else {
      const list = el('div', 'team-list')
      for (const team of state.teams) {
        const card = el('div', 'card team-card')
        const head = el('div', 'card-head')
        head.append(el('span', 'card-title', team.name))
        card.append(head, el('span', '', coachName(team)))
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
    const games = (state.games || []).filter((game) => !game.is_practice)
    if (!games.length) return el('p', '', 'NO GAMES YET')
    const wrap = el('div', 'schedule')
    const days = new Map()
    for (const game of games) {
      const when = new Date(game.starts_at)
      if (Number.isNaN(when.getTime())) continue
      const key = dayKey(when)
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
        const open = () => onOpenGame?.(game.id)
        const card = linkCard('game-box', open)
        const head = el('div', 'card-head')
        const title = el('span', 'card-title game-match')
        title.append(teamMark(game.away_team_id), document.createTextNode(' VS '), teamMark(game.home_team_id))
        head.append(title, cardAction('OPEN', open))
        card.append(head)
        if (forecastShown(day.when)) {
          const chances = forecastChances(game)
          if (chances) card.append(el('p', 'game-forecast', chances))
        }
        block.append(card)
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
    const card = el('div', 'card kid-card')
    const head = el('div', 'card-head')
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
    if (host.dataset.paint !== token || !host.isConnected) return
    state.busy = false
    if (error) {
      state.playError = (error.message || 'PLAY BALL DID NOT START.').toUpperCase()
      state.section = 'details'
      paint()
      return
    }
    state.section = 'dashboard'
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
        .select('id, home_team_id, away_team_id, starts_at, status, weather, is_practice, dev, result, narrative')
        .eq('season_id', seasonId)
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
