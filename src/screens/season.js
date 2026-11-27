import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'
import { clockLabel, clockLabel12, dayKey, dayLabel, forecastShown, forecastWords, weatherReport } from '../forecast.js'
import { practiceGate } from '../practice-wait.js'
import { draftIsActive } from '../menu.js'
import { gameKind, narrativeLead, playedGames, playedScore } from '../played.js'
import { rankStandings } from '../standings.js'
import { closeDraft, renderDraft } from './draft.js'
import { closePopup, mountPopup } from '../popup.js'
import { sameSeasonName } from '../season-name.js'
import { nextOfficial } from '../next-game.js'
import { draftComplete as draftIsComplete, setupRows, shouldAutoStart } from '../setup.js'
import { dashboardShows, showRecruitingTab } from '../season-view.js'
import { bindChanges, seasonPendingChanges, seasonReadyChanges } from '../live.js'
import { openChores } from '../chores.js'
import { filledNine } from '../nine.js'
import { WHY, deleteReason, scrimmageReason } from '../why.js'
import { coverDue, raiseDue, recruitPrice, standingDue } from '../recruit-price.js'

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

function coachName(team) {
  const profile = Array.isArray(team.profiles) ? team.profiles[0] : team.profiles
  return profile?.coach_name || 'COACH'
}

function draftComplete(season, draft) {
  return season?.status === 'drafting' && draftIsComplete(draft)
}

const SEASON_COLUMNS = 'id, name, commissioner_id, status, official_weekdays, practice_every_days, weeks, draft_rounds, roster_cap'

let seasonRoom = null
let seasonPendingRoom = null

export function closeSeason() {
  for (const current of [seasonRoom, seasonPendingRoom]) {
    if (current) supabase.removeChannel(current)
  }
  seasonRoom = null
  seasonPendingRoom = null
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
  if (section === 'dashboard' || section === 'schedule' || section === 'pool' || section === 'draft' || section === 'recruiting') return section
  if (section === 'details' || section === 'season' || section === 'teams') return 'details'
  return ''
}

function shownSection(section, draftingNow) {
  if (section === 'schedule' && draftingNow) return 'draft'
  if (section === 'draft' && !draftingNow) return 'schedule'
  return section || 'dashboard'
}

export function renderSeason(host, { seasonId, section, onOpenDraft, onOpenGame, onOpenReport, onOpenTeam, onLeave, setTeam, onDesk }) {
  closeSeason()
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
    draftError: '',
    draft: null,
    draftFailed: false,
    draftClosed: false,
    games: [],
    gamesFailed: false,
    standings: [],
    standingsFailed: false,
    scrimmageBusy: false,
    scrimmageError: '',
    scrimmageKind: '',
    lineup: [],
    lineupFailed: false,
    locks: [],
    locksFailed: false,
    boardAsked: false,
    boardError: '',
    bids: [],
    offers: [],
    bidsFailed: false,
    strengths: {},
    strengthFailed: false,
    bidBusy: false,
    bidError: '',
    bidKid: '',
    coverKid: '',
    playError: '',
    playAsked: false,
    confirmDelete: false,
    deleteTyped: '',
    deleteError: '',
    section: chosenSection(section),
    loaded: false,
  }

  function paint() {
    if (host.dataset.paint !== token || !host.isConnected) return
    const keptDraft = host.querySelector('.draft-host')
    if (keptDraft) keptDraft.remove()
    host.replaceChildren()
    if (!state.loaded) {
      if (keptDraft) closeDraft()
      return
    }
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
    const visible = keptSection(state.section, draftingNow)
    state.section = visible
    onDesk?.({
      seasonId: season?.id || '',
      teamId: myTeam?.id || '',
      drafting: draftingNow,
      forming: Boolean(season && season.status === 'forming'),
      section: visible,
    })
    if (state.missing || !state.season) {
      if (keptDraft) closeDraft()
      const box = el('div', 'choices')
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      host.append(box)
      return
    }

    const box = el('div', visible === 'dashboard' ? 'choices dashboard' : 'choices')
    if (visible === 'dashboard') {
      closeDraft()
      const shown = dashboardShows({ status: season.status, hasTeam: Boolean(myTeam) })
      if (shown.setup) box.append(setupBlock())
      else if (shown.outside) box.append(el('p', '', 'YOU ARE NOT IN THIS SEASON'))
      else {
        const chores = choreBlock()
        if (chores) box.append(chores)
        const recruits = recruitNote()
        if (recruits) box.append(recruits)
        const bids = bidBlock()
        if (bids) box.append(bids)
        if (shown.next) box.append(futureBlock())
        if (shown.play) {
          const play = playCards()
          if (play) box.append(play)
        }
        if (shown.played) box.append(historyBlock())
      }
      if (state.boardError && !recruitShown()) box.append(el('p', 'alert', state.boardError))
    } else {
      box.append(subtabs(visible, draftingNow))
      if (visible === 'details') box.append(detailsBlock())
      else if (visible === 'pool') box.append(poolBlock())
      else if (visible === 'draft') box.append(keptDraft || draftBlock())
      else if (visible === 'recruiting') box.append(recruitingBlock())
      else box.append(scheduleBlock())
      if (visible !== 'draft') closeDraft()
    }

    if (state.error) box.append(el('p', 'alert', state.error))
    host.append(box)
    if (state.confirmDelete && season && season.commissioner_id === state.userId) deletePopup(season)
    const covering = state.coverKid && (state.kids || []).find((kid) => kid.id === state.coverKid)
    if (covering) coverPopup(covering)
  }

  function seasonBlock() {
    const season = state.season
    const forming = season.status === 'forming'
    const canStart = Boolean(
      !state.draftFailed
      && draftComplete(season, state.draft)
      && season.commissioner_id === state.userId,
    )
    const card = el('div', 'card')
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
    if (forming && season.commissioner_id === state.userId) actions.append(seasonAction('START THE DRAFT', onStart))
    if (canStart) actions.append(seasonAction('PLAY BALL', onPlay))
    if (season.commissioner_id === state.userId) {
      actions.append(seasonAction('DELETE SEASON', () => {
        state.confirmDelete = true
        state.deleteTyped = ''
        state.deleteError = ''
        paint()
      }))
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
    if (state.busy) card.append(el('p', 'why', WHY.inProgress))
    return card
  }

  function seasonAction(label, onClick) {
    const button = el('button', '', label)
    button.type = 'button'
    button.disabled = state.busy
    button.addEventListener('click', onClick)
    return button
  }

  function setupBlock() {
    const season = state.season
    const team = myTeam()
    const rows = setupRows({
      status: season.status,
      commissioner: season.commissioner_id === state.userId,
      hasTeam: Boolean(team),
      teamId: team?.id || '',
      teamCount: state.teams.length,
      draft: state.draftFailed ? null : state.draft,
      teams: state.teams,
      startError: season.start_error || state.playError || '',
    })
    const wrap = el('div', 'setup-list')
    wrap.append(el('p', 'section', 'SET UP'))
    for (const row of rows) {
      const card = el('div', 'card')
      const head = el('div', 'card-head')
      head.append(el('span', 'card-title', row.title), el('span', 'season-role', row.mark))
      const actions = el('div', 'card-actions')
      if (row.action === 'start') actions.append(seasonAction('START THE DRAFT', onStart))
      if (row.action === 'pick') {
        const open = el('button', '', 'OPEN THE DRAFT')
        open.type = 'button'
        open.addEventListener('click', () => {
          state.section = 'draft'
          paint()
        })
        actions.append(open)
      }
      if (row.action === 'play') actions.append(seasonAction('PLAY BALL', onPlay))
      if (actions.childNodes.length) head.append(actions)
      card.append(head)
      if (row.note) card.append(el('p', '', row.note))
      if (row.action === 'name') card.append(form())
      if (row.id === 'draft' && state.draftError) card.append(el('p', 'alert', state.draftError))
      if (state.busy && (row.action === 'start' || row.action === 'play')) {
        card.append(el('p', 'why', WHY.inProgress))
      }
      wrap.append(card)
    }
    return wrap
  }

  function detailsBlock() {
    const wrap = el('div', 'details')
    const table = standingsBlock()
    wrap.append(el('p', 'section', 'CURRENT SEASON'))
    wrap.append(seasonBlock())
    if (table) wrap.append(table)
    wrap.append(teamsBlock())
    return wrap
  }

  function standingsBlock() {
    const status = state.season?.status
    const started = status === 'active' || status === 'completed'
    if (!started && !state.standings.length && !state.standingsFailed) return null
    const card = el('div', 'card standings')
    const head = el('div', 'card-head')
    head.append(el('span', 'card-title', 'STANDINGS'))
    card.append(head)
    if (state.standingsFailed) {
      card.append(el('p', 'alert', 'THE STANDINGS DID NOT LOAD'))
      return card
    }
    const byId = new Map(state.teams.map((team) => [team.id, team]))
    const rows = rankStandings(state.standings.map((row) => {
      const team = byId.get(row.team_id)
      if (!team) return null
      return {
        team_id: team.id,
        name: team.name,
        wins: row.wins,
        losses: row.losses,
        reputation: team.reputation,
      }
    }).filter(Boolean))
    if (!rows.length) {
      card.append(el('p', '', 'STANDINGS OPEN ON PLAY BALL'))
      return card
    }
    card.append(standingsGrid(rows))
    return card
  }

  function standingsGrid(rows) {
    const node = el('div', 'standings-grid')
    for (const label of ['', '', 'W', 'L', 'REP']) node.append(el('span', 'score-h', label))
    for (const row of rows) {
      node.append(el('span', 'score-n', String(row.rank)))
      node.append(el('span', 'score-name', row.name))
      node.append(el('span', 'score-n', String(row.wins)))
      node.append(el('span', 'score-n', String(row.losses)))
      node.append(el('span', 'score-n', String(row.reputation)))
    }
    return node
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

  function futureBlock() {
    const wrap = el('div', 'played-list')
    wrap.append(el('p', 'section', 'CURRENT'))
    const team = myTeam()
    if (!team) {
      wrap.append(el('p', '', 'NO GAME COMING'))
      return wrap
    }
    if (state.gamesFailed) {
      wrap.append(el('p', 'alert', 'THE NEXT GAME DID NOT LOAD'))
      return wrap
    }
    const game = nextOfficial(state.games, team.id, state.teams)
    wrap.append(game ? nextGameNode(game) : el('p', '', 'NO GAME COMING'))
    return wrap
  }

  function choreBlock() {
    const season = state.season
    const team = myTeam()
    if (!team || season?.status !== 'active') return null
    const known = state.kids != null && !state.lineupFailed
    const full = known && filledNine(
      state.lineup,
      state.kids.filter((kid) => kid.team_id === team.id),
    )
    const game = state.gamesFailed ? null : nextOfficial(state.games, team.id, state.teams)
    const locked = Boolean(game && state.locks.some((row) => row.game_id === game.id && row.team_id === team.id))
    const chores = openChores({
      active: true,
      nineKnown: known,
      nineFull: full,
      nextGameId: game?.id || '',
      locksKnown: !state.locksFailed && !state.gamesFailed,
      locked,
    })
    const locksMissed = Boolean(game && state.locksFailed)
    if (!chores.length && !locksMissed) return null
    const wrap = el('div', 'played-list')
    if (chores.length) wrap.append(el('p', 'section', 'TODOS'))
    for (const chore of chores) {
      const open = chore.id === 'assign'
        ? () => onOpenTeam?.(team.id)
        : () => onOpenGame?.(chore.gameId)
      const card = linkCard('', open)
      const head = el('div', 'card-head')
      head.append(el('span', 'card-title', chore.title), cardAction(chore.action, open))
      card.append(head, el('p', '', chore.note))
      wrap.append(card)
    }
    if (locksMissed) wrap.append(el('p', 'alert', 'THE LOCKS DID NOT LOAD'))
    return wrap
  }

  function recruitNote() {
    if (!state.kids) return null
    const waiting = state.kids.filter((kid) => !kid.team_id && kid.offer)
    if (!waiting.length) return null
    const wrap = el('div', 'played-list')
    wrap.append(el('p', 'section', 'RECRUITS!'))
    const row = el('div', 'recruit-note')
    row.append(el('p', '', counted(waiting.length, 'KID IS ON THE RECRUITING BOARD', 'KIDS ARE ON THE RECRUITING BOARD')))
    const open = el('button', '', 'OPEN')
    open.type = 'button'
    open.addEventListener('click', () => {
      if (state.section === 'recruiting') return
      state.section = 'recruiting'
      paint()
      maybeOpenBoard()
    })
    row.append(open)
    wrap.append(row)
    return wrap
  }

  function nextGameNode(game) {
    const when = new Date(game.starts_at)
    if (Number.isNaN(when.getTime())) return null
    const open = () => onOpenGame?.(game.id)
    const card = linkCard('next-game', open)
    const head = el('div', 'card-head')
    const foe = game.opponent || 'TEAM'
    head.append(el('span', 'card-title', `NEXT GAME VS ${foe}`), cardAction('OPEN', open))
    card.append(head, el('p', 'game-date', clockLabel(when)))
    if (forecastShown(when)) {
      const words = forecastWords(game)
      if (words) card.append(el('p', 'game-forecast', words))
    }
    return card
  }

  function myTeam() {
    return state.teams.find((team) => team.coach_id === state.userId) || null
  }

  function lastPracticeAt(teamId) {
    let best = null
    for (const game of state.games) {
      if (!game?.is_practice || game.dev) continue
      if (game.home_team_id !== teamId && game.away_team_id !== teamId) continue
      const at = Date.parse(game.starts_at)
      if (Number.isNaN(at)) continue
      if (best == null || at > best) best = at
    }
    return best
  }

  function playButton(label, onPlay, disabled) {
    const button = el('button', '', label)
    button.type = 'button'
    button.disabled = disabled
    button.addEventListener('click', onPlay)
    const actions = el('div', 'card-actions')
    actions.append(button)
    return actions
  }

  function playCards() {
    const team = myTeam()
    if (!team) return null
    const season = state.season
    const gate = state.gamesFailed
      ? { note: 'THE LAST PRACTICE DID NOT LOAD', open: false }
      : practiceGate({
        status: season?.status,
        everyDays: season?.practice_every_days,
        lastPractice: lastPracticeAt(team.id),
        now: Date.now(),
      })
    const busy = state.scrimmageBusy
    const known = state.kids != null && !state.lineupFailed
    const full = known && filledNine(
      state.lineup,
      state.kids.filter((kid) => kid.team_id === team.id),
    )
    const wrap = el('div', 'play-cards')
    if (state.lineupFailed) wrap.append(el('p', 'alert', 'THE LINEUP DID NOT LOAD'))
    const practice = el('div', 'card')
    const practiceHead = el('div', 'card-head')
    practiceHead.append(
      el('span', 'card-title', 'PLAY A GAME VS THE NEIGHBORHOOD RABBLE'),
      playButton('PLAY', () => startScrimmage('start_practice', 'practice', !gate.open || !full), !gate.open || busy || !full),
    )
    practice.append(practiceHead)
    if (gate.note) practice.append(el('p', state.gamesFailed ? 'alert' : '', gate.note))
    const practiceWhy = scrimmageReason({ busy, open: gate.open, full, known })
    if (practiceWhy) practice.append(el('p', 'why', practiceWhy))
    if (state.scrimmageKind === 'practice' && state.scrimmageError) practice.append(el('p', 'alert', state.scrimmageError))
    const dev = el('div', 'card')
    const devHead = el('div', 'card-head')
    const devActive = season?.status === 'active'
    devHead.append(
      el('span', 'card-title', 'PLAY A DEV GAME'),
      playButton('PLAY', () => startScrimmage('start_dev_game', 'dev', !devActive || !full), !devActive || busy || !full),
    )
    dev.append(devHead, el('p', '', 'DOES NOT START THE PRACTICE WAIT'))
    if (!devActive) dev.append(el('p', '', 'PRACTICE STARTS WHEN THE SEASON DOES'))
    const devWhy = scrimmageReason({ busy, open: devActive, full, known })
    if (devWhy) dev.append(el('p', 'why', devWhy))
    if (state.scrimmageKind === 'dev' && state.scrimmageError) dev.append(el('p', 'alert', state.scrimmageError))
    wrap.append(practice, dev)
    return wrap
  }

  async function startScrimmage(rpc, kind, refused) {
    const team = myTeam()
    if (refused || state.scrimmageBusy || !team) return
    state.scrimmageBusy = true
    state.scrimmageKind = kind
    state.scrimmageError = ''
    paint()
    const { data, error } = await supabase.rpc(rpc, { team_id: team.id })
    if (host.dataset.paint !== token || !host.isConnected) return
    state.scrimmageBusy = false
    if (error || !data) {
      state.scrimmageError = (error?.message || 'THAT GAME DID NOT START.').toUpperCase()
      paint()
      return
    }
    onOpenReport?.(data)
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
    const open = () => (onOpenReport || onOpenGame)?.(game.id)
    const card = linkCard('played-card', open)
    if (game?.dev || game?.is_practice) card.classList.add('scrimmage')
    const head = el('div', 'card-head')
    head.append(matchTitle(game), cardAction('REVIEW', open))
    const when = new Date(game.starts_at)
    const bits = [playedScore(game), gameKind(game)]
    if (!Number.isNaN(when.getTime())) bits.push(clockLabel12(when))
    const detail = bits.filter(Boolean).join(' · ')
    card.append(head, el('p', '', detail))
    const lead = narrativeLead(game.narrative)
    if (lead) card.append(el('p', '', lead))
    return card
  }

  function poolKids() {
    return (state.kids || []).filter((kid) => !kid.team_id && !kid.offer)
  }

  function poolShown() {
    return poolKids().length > 0
  }

  function recruitShown() {
    return showRecruitingTab({
      hasTeam: Boolean(myTeam()),
      hasRecruits: (state.kids || []).some((kid) => !kid.team_id && kid.offer),
    })
  }

  function keptSection(section, draftingNow) {
    const forming = state.season?.status === 'forming'
    const idle = forming ? 'details' : draftingNow ? 'draft' : 'schedule'
    let next = shownSection(section, draftingNow)
    if (forming && (next === 'schedule' || next === 'draft')) next = 'details'
    if (next === 'pool' && !poolShown()) next = idle
    if (next === 'recruiting' && !recruitShown()) next = idle
    return next
  }

  function comingShown() {
    if (!myTeam()) return false
    if (state.gamesFailed) return true
    return Boolean(nextOfficial(state.games, myTeam().id, state.teams))
  }

  function playedShown() {
    if (state.gamesFailed) return true
    return playedGames(state.games).length > 0
  }

  function subtabs(visible, draftingNow) {
    const row = el('div', 'subtabs')
    const forming = state.season?.status === 'forming'
    const tabs = [['details', 'DETAILS']]
    if (!forming) tabs.unshift([draftingNow ? 'draft' : 'schedule', draftingNow ? 'DRAFT' : 'SCHEDULE'])
    if (recruitShown()) tabs.splice(forming ? 0 : 1, 0, ['recruiting', 'RECRUITING'])
    if (poolShown()) tabs.splice(forming ? 0 : 1, 0, ['pool', 'THE POOL'])
    for (const [id, label] of tabs) {
      const button = el('button', visible === id ? 'on' : '', label)
      button.type = 'button'
      button.setAttribute('aria-pressed', visible === id ? 'true' : 'false')
      button.addEventListener('click', () => {
        if (state.section === id) return
        state.section = id
        paint()
        if (id === 'recruiting') maybeOpenBoard()
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
        onDesk?.({
          ...ctx,
          section: state.draftClosed ? 'schedule' : 'draft',
          forming: state.season?.status === 'forming',
        })
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
    if (season.status !== 'forming' && !myTeam) wrap.append(el('p', '', 'TEAMS JOIN WHILE THE SEASON IS FORMING'))
    return wrap
  }

  function poolBlock() {
    const wrap = el('div', 'season-panel')
    if (state.kids) {
      const pool = state.kids.filter((kid) => !kid.team_id && !kid.offer)
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

  function recruitingBlock() {
    const wrap = el('div', 'season-panel')
    wrap.append(el('p', 'section', 'RECRUITS'))
    if (state.boardError) wrap.append(el('p', 'alert', state.boardError))
    if (!state.kids) {
      wrap.append(el('p', 'alert', 'THE BOARD DID NOT LOAD'))
      return wrap
    }
    const board = state.kids.filter((kid) => !kid.team_id && kid.offer)
    if (!board.length) {
      wrap.append(el('p', '', 'THE BOARD IS QUIET'))
      return wrap
    }
    const list = el('div', 'recruiting-list')
    const ordered = board.slice().sort((left, right) => {
      const at = Date.parse(right?.created_at) - Date.parse(left?.created_at)
      if (at) return at
      return String(right?.id || '').localeCompare(String(left?.id || ''))
    })
    for (const kid of ordered) list.append(kidCard(kid))
    wrap.append(list)
    return wrap
  }

  async function maybeOpenBoard() {
    const season = state.season
    const commissioner = season && season.commissioner_id === state.userId && season.status === 'active'
    if (!state.boardAsked && commissioner) {
      state.boardAsked = true
      const { data, error } = await supabase.rpc('open_recruiting_board', { season_id: seasonId })
      if (host.dataset.paint !== token || !host.isConnected) return
      if (error) state.boardError = (error.message || 'THE BOARD DID NOT OPEN.').toUpperCase()
      else if (Number(data) > 0) {
        await load()
        return
      }
    }
    paint()
  }

  function teamMark(id) {
    const team = state.teams.find((item) => item.id === id)
    const mine = team?.coach_id === state.userId
    return el('span', mine ? 'mine' : '', team?.name || 'TEAM')
  }

  function scheduleBlock() {
    const season = state.season
    if (!myTeam()) return el('p', '', 'YOU ARE NOT IN THIS SEASON')
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
        const when = new Date(game.starts_at)
        if (!Number.isNaN(when.getTime())) card.append(el('p', 'game-date', clockLabel(when)))
        if (forecastShown(day.when)) {
          const played = game.status === 'final' || Boolean(game.result)
          const words = played ? weatherReport(game) : forecastWords(game)
          if (words) card.append(el('p', 'game-forecast', words))
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
    node.append(nameLabel, save)
    if (state.busy) node.append(el('p', 'why', WHY.nameSaving))
    node.addEventListener('submit', onSubmit)
    return node
  }

  function reputations() {
    return state.teams.map((team) => Number(team.reputation) || 0)
  }

  function coachPrice(kid) {
    const team = myTeam()
    if (!team || kid?.offer !== 'price') return null
    const strength = Number(state.strengths[kid.settings_version])
    if (!Number.isFinite(strength)) return null
    return recruitPrice({
      reputationCost: kid.reputation_cost,
      bottlecapCost: kid.bottlecap_cost,
      preference: kid.preference,
      strength,
      reputation: Number(team.reputation) || 0,
      reputations: reputations(),
    })
  }

  function openBid(kid) {
    return (state.bids || []).find((bid) => bid.player_id === kid.id && bid.status === 'open') || null
  }

  function offerFor(bid, teamId) {
    if (!bid || !teamId) return null
    return (state.offers || []).find((row) => row.bid_id === bid.id && row.team_id === teamId) || null
  }

  function rosterFull() {
    const team = myTeam()
    const cap = Number(state.season?.roster_cap)
    if (!team || !Number.isInteger(cap) || !state.kids) return false
    return state.kids.filter((kid) => kid.team_id === team.id).length >= cap
  }

  function canPay(team, due) {
    if (!team || !due) return false
    return Number(team.reputation) >= due.reputation && Number(team.bottlecaps) >= due.bottlecaps
  }

  function bidButton(label, onOpen) {
    const button = el('button', '', label)
    button.type = 'button'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onOpen()
    })
    return button
  }

  function kidName(kid) {
    const nick = kid.nickname ? ` "${kid.nickname}"` : ''
    const name = [kid.given_name, kid.family_name].filter(Boolean).join(' ')
    return `${name || 'KID'}${nick}`
  }

  function highBidLine(bid) {
    return `HIGH BID ${counted(Number(bid.reputation_bid) || 0, 'REPUTATION', 'REPUTATION')} · ${counted(Number(bid.bottlecap_bid) || 0, 'BOTTLECAP', 'BOTTLECAPS')}`
  }

  function recruitReason(kid) {
    if (state.bidBusy) return 'THAT BID IS IN PROGRESS'
    if (rosterFull()) return 'RELEASE SOMEONE FIRST'
    if (kid.offer === 'tryout') return ''
    const team = myTeam()
    const price = coachPrice(kid)
    if (!price || !team) return 'THE PRICE DID NOT LOAD'
    const bid = openBid(kid)
    if (offerFor(bid, team.id)) return ''
    const standing = bid
      ? { reputation: Number(bid.reputation_bid) || 0, bottlecaps: Number(bid.bottlecap_bid) || 0 }
      : null
    if (!canPay(team, standingDue(price, standing))) return 'CANNOT AFFORD THIS KID'
    return ''
  }

  function bidBlock() {
    const team = myTeam()
    if (!team || !state.kids || state.season?.status !== 'active') return null
    const mine = (state.offers || []).filter((row) => row.team_id === team.id)
    const open = []
    for (const row of mine) {
      const bid = (state.bids || []).find((item) => item.id === row.bid_id && item.status === 'open')
      const kid = bid && state.kids.find((item) => item.id === bid.player_id)
      if (bid && kid) open.push({ bid, kid })
    }
    if (!open.length && !state.bidsFailed) return null
    const wrap = el('div', 'played-list')
    wrap.append(el('p', 'section', 'BIDS'))
    if (state.bidsFailed) {
      wrap.append(el('p', 'alert', 'THE BIDS DID NOT LOAD'))
      return wrap
    }
    for (const item of open) wrap.append(bidCard(item.bid, item.kid))
    return wrap
  }

  function bidCard(bid, kid) {
    const card = el('div', 'card')
    const head = el('div', 'card-head')
    head.append(el('span', 'card-title', kidName(kid)))
    const team = myTeam()
    const price = coachPrice(kid)
    const standing = {
      reputation: Number(bid.reputation_bid) || 0,
      bottlecaps: Number(bid.bottlecap_bid) || 0,
    }
    const leader = bid.high_team_id === team?.id
    const repDue = price ? raiseDue(price, standing, 'reputation') : null
    const capDue = price ? raiseDue(price, standing, 'bottlecaps') : null
    const cover = !leader ? coverDue(standing, Number(team?.reputation) || 0) : null
    const full = rosterFull()
    const actions = el('div', 'card-actions')
    const repButton = bidButton('RAISE REPUTATION', () => onBid('raise', kid.id, 'reputation'))
    const capButton = bidButton('RAISE BOTTLECAPS', () => onBid('raise', kid.id, 'bottlecaps'))
    const repClosed = state.bidBusy || full || !repDue || !canPay(team, repDue) || (leader && repDue.bottlecaps !== standing.bottlecaps)
    const capClosed = state.bidBusy || full || !capDue || !canPay(team, capDue) || (leader && capDue.reputation !== standing.reputation)
    repButton.disabled = repClosed
    capButton.disabled = capClosed
    actions.append(repButton, capButton)
    const coverClosed = !cover || full || state.bidBusy || !canPay(team, cover)
    if (!coverClosed) {
      actions.append(bidButton('COVER WITH BOTTLECAPS', () => {
        state.coverKid = kid.id
        state.bidError = ''
        state.bidKid = ''
        paint()
      }))
    }
    head.append(actions)
    card.append(head, el('p', '', highBidLine(bid)))
    if (!price) card.append(el('p', 'alert', 'THE PRICE DID NOT LOAD'))
    else if (state.bidBusy) card.append(el('p', 'why', 'THAT BID IS IN PROGRESS'))
    else if (full) card.append(el('p', 'why', 'RELEASE SOMEONE FIRST'))
    else {
      if (repClosed) card.append(el('p', 'why', 'CANNOT PAY THE REPUTATION'))
      if (capClosed || (cover && coverClosed)) card.append(el('p', 'why', 'CANNOT PAY THE BOTTLECAPS'))
    }
    if (state.bidError && state.bidKid === kid.id) card.append(el('p', 'alert', state.bidError))
    return card
  }

  async function onBid(kind, playerId, purse) {
    if (state.bidBusy) return
    state.bidBusy = true
    state.bidError = ''
    state.bidKid = playerId
    state.coverKid = ''
    paint()
    const args = { player_id: playerId }
    const call = kind === 'enter'
      ? supabase.rpc('enter_recruit_bid', args)
      : kind === 'join'
        ? supabase.rpc('join_tryout', args)
        : kind === 'cover'
          ? supabase.rpc('cover_recruit_bid', args)
          : supabase.rpc('raise_recruit_bid', { ...args, purse })
    const { error } = await call
    if (host.dataset.paint !== token || !host.isConnected) return
    state.bidBusy = false
    if (error) {
      state.bidError = (error.message || 'THAT BID DID NOT LAND.').toUpperCase()
      state.coverKid = ''
      paint()
      return
    }
    state.bidError = ''
    state.bidKid = ''
    await load()
  }

  function coverPopup(kid) {
    mountPopup(host, {
      title: 'COVER WITH BOTTLECAPS',
      note: `${kidName(kid)} MAY PLAY FLAT UNTIL THE TEAM WINS, REPUTATION RISES, OR THIS KID HAS A STRONG GAME.`,
      actions: [
        {
          label: 'COVER',
          disabled: state.bidBusy,
          reason: state.bidBusy ? 'THAT BID IS IN PROGRESS' : '',
          onClick: () => onBid('cover', kid.id),
        },
        {
          label: 'BACK',
          onClick() {
            state.coverKid = ''
            closePopup()
          },
        },
      ],
      onClose() {
        state.coverKid = ''
      },
    })
  }

  function kidCard(kid) {
    const card = el('div', kid.offer === 'tryout' ? 'card kid-card tryout' : 'card kid-card')
    const head = el('div', 'card-head')
    const title = el('span', 'kid-title')
    title.append(el('span', 'season-name', kidName(kid)))
    if (kid.sex === 'M') title.append(el('span', 'sex-m', 'M'))
    else if (kid.sex === 'F') title.append(el('span', 'season-role', 'F'))
    if (kid.offer === 'tryout') title.append(el('span', 'tryout-mark', 'TRYOUT'))
    head.append(title)
    if (kid.offer && myTeam()) {
      const actions = el('div', 'card-actions')
      const bid = openBid(kid)
      const joined = offerFor(bid, myTeam().id)
      if (kid.offer === 'tryout') {
        const button = bidButton('JOIN', () => onBid('join', kid.id))
        const reason = recruitReason(kid)
        button.disabled = Boolean(reason)
        actions.append(button)
        head.append(actions)
        card.append(head)
        if (reason) card.append(el('p', 'why', reason))
      } else if (!joined) {
        const button = bidButton('ENTER', () => onBid('enter', kid.id))
        const reason = recruitReason(kid)
        button.disabled = Boolean(reason)
        actions.append(button)
        head.append(actions)
        card.append(head)
        if (reason) card.append(el('p', 'why', reason))
      } else {
        card.append(head)
      }
    } else {
      card.append(head)
    }
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    if (kid.offer === 'tryout') {
      card.append(el('p', '', 'A TRYOUT JOINS NOW'))
    } else if (kid.offer) {
      if (state.bidsFailed) card.append(el('p', 'alert', 'THE BIDS DID NOT LOAD'))
      else if (state.strengthFailed || !coachPrice(kid)) card.append(el('p', 'alert', 'THE PRICE DID NOT LOAD'))
      else {
        const price = coachPrice(kid)
        card.append(fact('REPUTATION', counted(price.reputation, 'REPUTATION', 'REPUTATION')))
        card.append(fact('BOTTLECAPS', counted(price.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')))
        if (price.climbing) card.append(el('p', '', 'THIS BREAK IS FOR CLUBS THAT ARE STILL CLIMBING'))
        if (price.likesBench) card.append(el('p', '', 'LIKES A CLUB THAT IS NOT IN FIRST'))
        const bid = openBid(kid)
        if (bid) {
          card.append(el('p', '', 'BIDDING'))
          card.append(el('p', '', highBidLine(bid)))
          if (offerFor(bid, myTeam()?.id)) card.append(el('p', '', 'YOU ARE IN THIS BID'))
        }
      }
    }
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) stats.append(statChip(label, kid.base_stats?.[stat]))
    card.append(stats)
    return card
  }

  function deletePopup(season) {
    const form = document.createElement('form')
    form.id = 'delete-season'
    form.className = 'open-season'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      onDelete(season)
    })
    const name = document.createElement('input')
    name.name = 'season-name'
    name.required = true
    name.maxLength = 40
    name.autocomplete = 'off'
    name.spellcheck = false
    name.value = state.deleteTyped
    const nameLabel = el('label')
    nameLabel.append(el('span', '', 'SEASON NAME'), name)
    form.append(nameLabel)
    if (state.deleteError) form.append(el('p', 'alert', state.deleteError))
    mountPopup(host, {
      title: 'DELETE THIS SEASON',
      note: `TYPE ${season.name}. THE TEAMS, GAMES, AND KIDS GO WITH IT.`,
      actions: [
        {
          label: 'DELETE',
          submit: true,
          form: 'delete-season',
          disabled: state.busy || !sameSeasonName(state.deleteTyped, season.name),
          reason: deleteReason({
            busy: state.busy,
            named: sameSeasonName(state.deleteTyped, season.name),
          }),
        },
        {
          label: 'BACK',
          onClick() {
            state.confirmDelete = false
            state.deleteError = ''
            closePopup()
          },
        },
      ],
      content: form,
      onClose() {
        state.confirmDelete = false
      },
      focus(box) {
        const input = box.querySelector('input')
        const del = box.querySelector('.card-actions button')
        const sync = () => {
          state.deleteTyped = input.value
          const named = sameSeasonName(input.value, season.name)
          if (del) del.disabled = state.busy || !named
          const reason = deleteReason({ busy: state.busy, named })
          const note = box.querySelector('.why')
          if (note) {
            note.hidden = !reason
            note.textContent = reason
          }
        }
        input.addEventListener('input', sync)
        sync()
        input.focus()
      },
    })
    state.confirmDelete = true
  }

  async function onDelete(season) {
    if (state.busy || !sameSeasonName(state.deleteTyped, season?.name)) return
    state.busy = true
    state.deleteError = ''
    state.confirmDelete = true
    paint()
    const { error } = await supabase.rpc('delete_season', {
      season_id: seasonId,
      season_name: cleanName(state.deleteTyped),
    })
    if (host.dataset.paint !== token || !host.isConnected) return
    state.busy = false
    if (error) {
      state.deleteError = (error.message || 'THE SEASON WAS NOT DELETED.').toUpperCase()
      state.confirmDelete = true
      paint()
      return
    }
    state.confirmDelete = false
    closePopup()
    onLeave?.()
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
    paint()
    const { error } = await supabase.rpc('create_team', {
      season_id: seasonId,
      team_name: teamName,
    })
    if (host.dataset.paint !== token || !host.isConnected) return
    state.busy = false
    if (error) {
      state.error = (error.message || 'THAT TEAM WAS NOT NAMED.').toUpperCase()
      paint()
      return
    }
    state.name = ''
    await load()
  }

  async function seasonRow() {
    const withError = await supabase
      .from('seasons')
      .select(`${SEASON_COLUMNS}, start_error`)
      .eq('id', seasonId)
      .maybeSingle()
    if (!withError.error) return withError
    const message = withError.error.message || ''
    if (/start_error/i.test(message)) {
      return supabase.from('seasons').select(SEASON_COLUMNS).eq('id', seasonId).maybeSingle()
    }
    return withError
  }

  async function maybeStartSeason() {
    const season = state.season
    if (state.playAsked || state.busy || !season) return
    if (!shouldAutoStart({
      status: season.status,
      commissioner: season.commissioner_id === state.userId,
      draft: state.draftFailed ? null : state.draft,
      startError: season.start_error || '',
      playError: state.playError,
    })) return
    state.playAsked = true
    state.busy = true
    paint()
    const { error } = await supabase.rpc('play_ball', { season_id: seasonId })
    if (host.dataset.paint !== token || !host.isConnected) return
    state.busy = false
    if (error) {
      const message = (error.message || 'PLAY BALL DID NOT START.').toUpperCase()
      if (message.includes('ALREADY STARTED')) {
        state.playError = ''
        await load()
        return
      }
      state.playError = message
      paint()
      return
    }
    state.playError = ''
    state.section = 'dashboard'
    await load()
  }

  let pull = 0

  async function loadStrengths(kids, ticket) {
    const versions = [...new Set(
      (kids || []).filter((kid) => kid.offer === 'price').map((kid) => kid.settings_version),
    )]
    if (!versions.length) {
      if (ticket !== pull) return
      state.strengths = {}
      state.strengthFailed = false
      return
    }
    const rows = await Promise.all(versions.map(async (version) => {
      const { data, error } = await supabase.rpc('recruiting_strength', { settings_version: version })
      return { version, data, error }
    }))
    if (ticket !== pull) return
    if (rows.some((row) => row.error || !Number.isFinite(Number(row.data)))) {
      state.strengthFailed = true
      state.strengths = {}
      return
    }
    state.strengthFailed = false
    state.strengths = Object.fromEntries(rows.map((row) => [row.version, Number(row.data)]))
  }

  async function load() {
    const mine = ++pull
    const [session, season, teams, kids, draft, games, standings, lineup, locks, bids, offers] = await Promise.all([
      supabase.auth.getSession(),
      seasonRow(),
      supabase
        .from('teams')
        .select('id, name, coach_id, bottlecaps, reputation, profiles!teams_coach_id_fkey(coach_name)')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true }),
      supabase
        .from('players')
        .select('id, team_id, given_name, family_name, nickname, sex, flavor, base_stats, offer, reputation_cost, bottlecap_cost, preference, settings_version, created_at')
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
      supabase
        .from('standings')
        .select('team_id, wins, losses')
        .eq('season_id', seasonId),
      supabase.from('lineups').select('team_id, player_id, slot'),
      supabase.from('lineup_locks').select('game_id, team_id'),
      supabase
        .from('recruit_bids')
        .select('id, player_id, status, reputation_bid, bottlecap_bid, high_team_id, closes_at')
        .eq('season_id', seasonId)
        .eq('status', 'open'),
      supabase
        .from('recruit_offers')
        .select('id, bid_id, season_id, team_id')
        .eq('season_id', seasonId),
    ])
    if (mine !== pull || host.dataset.paint !== token || !host.isConnected) return
    state.userId = session.data.session?.user?.id ?? ''
    state.kids = null
    state.lineupFailed = false
    state.lineup = []
    state.locksFailed = false
    state.locks = []
    state.bidsFailed = Boolean(bids.error || offers.error)
    state.bids = bids.error ? [] : (bids.data || [])
    state.offers = offers.error ? [] : (offers.data || [])
    state.draftFailed = Boolean(draft.error)
    state.draft = draft.error ? null : draft.data
    state.gamesFailed = Boolean(games.error)
    state.games = games.error ? [] : (games.data || [])
    state.standingsFailed = Boolean(standings.error)
    state.standings = standings.error ? [] : (standings.data || [])
    if (season.error || teams.error) {
      state.error = ((season.error || teams.error).message || 'THE SEASON DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.games = []
      state.gamesFailed = false
      state.standings = []
      state.standingsFailed = false
      state.missing = false
      state.draft = null
      state.draftFailed = false
      state.bids = []
      state.offers = []
      state.bidsFailed = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
      state.games = []
      state.gamesFailed = false
      state.standings = []
      state.standingsFailed = false
      state.draft = null
      state.draftFailed = false
      state.bids = []
      state.offers = []
      state.bidsFailed = false
    } else {
      state.missing = false
      state.season = season.data
      state.teams = teams.data || []
      const mineId = state.teams.find((team) => team.coach_id === state.userId)?.id || ''
      state.lineupFailed = Boolean(lineup.error)
      state.lineup = lineup.error ? [] : (lineup.data || []).filter((row) => row.team_id === mineId)
      state.locksFailed = Boolean(locks.error)
      state.locks = locks.error ? [] : (locks.data || [])
      if (kids.error) {
        state.error = (kids.error.message || 'THE KIDS DID NOT LOAD.').toUpperCase()
        state.strengths = {}
        state.strengthFailed = false
      } else {
        state.kids = kids.data || []
        await loadStrengths(state.kids, mine)
      }
    }
    if (mine !== pull || host.dataset.paint !== token || !host.isConnected) return
    state.loaded = true
    await maybeOpenBoard()
    if (mine !== pull || host.dataset.paint !== token || !host.isConnected) return
    await maybeStartSeason()
  }

  function retire(channel) {
    supabase.removeChannel(channel)
    if (seasonRoom === channel) seasonRoom = null
    if (seasonPendingRoom === channel) seasonPendingRoom = null
  }

  function onRemote() {
    if (host.dataset.paint !== token || !host.isConnected) {
      retire(ready)
      retire(pending)
      return
    }
    load()
  }

  // Players and the draft are already published. The other tables stay on a
  // second channel so a missing publication does not drop those picks.
  const ready = supabase.channel(`season:${seasonId}`)
  bindChanges(ready, seasonReadyChanges(seasonId), onRemote)
  seasonRoom = ready.subscribe()
  const pending = supabase.channel(`season-pending:${seasonId}`)
  bindChanges(pending, seasonPendingChanges(seasonId), onRemote)
  seasonPendingRoom = pending.subscribe()

  paint()
  load()
}
