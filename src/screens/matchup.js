import { supabase } from '../supabase.js'
import { dayLabel, forecastLine, forecastShown } from '../forecast.js'

const LABELS = [null, 'MOUND', 'CATCHER', 'FIRST', 'SECOND', 'THIRD', 'SHORT', 'LEFT', 'CENTER', 'RIGHT']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function counted(value, one, many) {
  return `${value} ${value === 1 ? one : many}`
}

function linkedItem(row) {
  const linked = Array.isArray(row?.clubhouse_items) ? row.clubhouse_items[0] : row?.clubhouse_items
  return linked || null
}

function slotLine(row) {
  const label = LABELS[Number(row?.slot)] || 'SLOT'
  if (!row?.player_id) return `${label} — EMPTY`
  const name = [row.given_name, row.family_name].filter(Boolean).join(' ') || 'KID'
  const nick = row.nickname ? ` "${row.nickname}"` : ''
  const sex = row.sex === 'M' || row.sex === 'F' ? ` ${row.sex}` : ''
  return `${label} — ${name}${nick}${sex}`
}

function packedLine(item) {
  const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : 'ITEM'
  const games = Number(item?.remaining_games)
  if (!Number.isInteger(games)) return name
  return `${name} - ${counted(games, 'GAME LEFT', 'GAMES LEFT')}`
}

function liveCard(lineups, kids, items) {
  const byId = new Map(kids.map((kid) => [kid.id, kid]))
  const bySlot = new Map(lineups.map((row) => [Number(row.slot), row.player_id]))
  const slots = []
  for (let slot = 1; slot <= 9; slot += 1) {
    const kid = byId.get(bySlot.get(slot)) || null
    slots.push({
      slot,
      player_id: kid?.id ?? null,
      given_name: kid?.given_name ?? null,
      family_name: kid?.family_name ?? null,
      nickname: kid?.nickname ?? null,
      sex: kid?.sex ?? null,
    })
  }
  return {
    slots,
    items: items.map((row) => ({
      item_id: row.item_id,
      name: linkedItem(row)?.name || 'ITEM',
      remaining_games: row.remaining_games,
    })),
  }
}

function cardNodes(card) {
  const slots = Array.isArray(card?.slots) ? card.slots : null
  if (!slots || slots.length !== 9) return [el('p', 'alert', 'THE CARD DID NOT LOAD')]
  const nodes = [...slots]
    .sort((left, right) => Number(left?.slot) - Number(right?.slot))
    .map((row) => el('p', 'card-line', slotLine(row)))
  nodes.push(el('p', 'section', 'PACKED'))
  const items = Array.isArray(card?.items) ? card.items : []
  if (!items.length) nodes.push(el('p', '', 'NO ITEMS PACKED'))
  else for (const item of items) nodes.push(el('p', '', packedLine(item)))
  return nodes
}

export function renderMatchup(prompt, { gameId, onBack, onOpenTeam, onOpenClubhouse, setTabs, setTeam }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    game: null,
    season: null,
    teams: [],
    myTeam: null,
    userId: '',
    locks: [],
    card: null,
    live: null,
    error: '',
    cardError: '',
    missing: false,
    loaded: false,
    busy: false,
    lineupFailed: false,
    itemsFailed: false,
    lockFailed: false,
  }

  function playing() {
    const team = state.myTeam
    const game = state.game
    return Boolean(team && game && (team.id === game.home_team_id || team.id === game.away_team_id))
  }

  function mineLocked() {
    return playing() && state.locks.some((row) => row.team_id === state.myTeam.id)
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const game = state.loaded && !state.missing ? state.game : null
    const mine = playing() ? state.myTeam : null
    if (mine && state.season) {
      setTeam?.({
        name: mine.name,
        season: state.season.name,
        purse: `${counted(mine.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(mine.reputation, 'REPUTATION', 'REPUTATION')}`,
      })
    } else {
      setTeam?.(null)
    }
    if (!state.loaded || state.missing || !game) {
      setTabs?.([{ label: 'SEASONS', onClick: () => onBack?.() }])
    } else {
      const tabs = [{ label: 'SEASON', onClick: () => onBack?.(game.season_id) }]
      if (state.myTeam) {
        tabs.push({ label: 'THE ROSTER', onClick: () => onOpenTeam?.(state.myTeam.id) })
        tabs.push({ label: 'CLUBHOUSE', onClick: () => onOpenClubhouse?.(state.myTeam.id) })
      }
      setTabs?.(tabs)
    }
    prompt.append(el('h2', 'screen-name', 'THE MATCHUP'))
    if (!state.loaded) return

    const box = el('div', 'choices')
    if (state.missing || !game) {
      box.append(el('p', '', 'THAT GAME IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    const when = new Date(game.starts_at)
    if (!Number.isNaN(when.getTime())) box.append(el('p', 'game-date', dayLabel(when)))
    const match = el('p', 'game-match')
    match.append(teamMark(game.away_team_id), document.createTextNode(' VS '), teamMark(game.home_team_id))
    box.append(match)
    if (!Number.isNaN(when.getTime()) && forecastShown(when)) {
      box.append(el('p', 'game-forecast', forecastLine(game)))
    }

    if (playing()) {
      const foeId = state.myTeam.id === game.home_team_id ? game.away_team_id : game.home_team_id
      const foe = state.teams.find((team) => team.id === foeId)
      const foeLocked = state.locks.some((row) => row.team_id === foeId)
      box.append(el('p', 'section', 'YOUR CARD'))
      if (state.card) {
        box.append(el('p', 'season-status', 'THE CARD IS LOCKED'))
        for (const node of cardNodes(state.card)) box.append(node)
      } else if (mineLocked()) {
        box.append(el('p', 'alert', 'THE CARD DID NOT LOAD'))
      } else if (game.status !== 'scheduled') {
        box.append(el('p', '', 'THE GAME HAS ALREADY BEEN PLAYED'))
      } else if (state.lineupFailed) {
        box.append(el('p', 'alert', 'THE LINEUP DID NOT LOAD'))
      } else if (state.itemsFailed) {
        box.append(el('p', 'alert', 'THE ITEMS DID NOT LOAD'))
      } else {
        for (const node of cardNodes(state.live)) box.append(node)
        box.append(el('p', '', 'LOCK COPIES THIS CARD FOR THE GAME'))
        const lock = el('button', '', 'LOCK')
        lock.type = 'button'
        lock.disabled = state.busy
        lock.addEventListener('click', onLock)
        box.append(lock)
      }
      box.append(el('p', '', `${foe?.name || 'TEAM'} IS ${foeLocked ? 'LOCKED' : 'STILL OPEN'}`))
    } else {
      for (const id of [game.away_team_id, game.home_team_id]) {
        const team = state.teams.find((item) => item.id === id)
        const locked = state.locks.some((row) => row.team_id === id)
        box.append(el('p', '', `${team?.name || 'TEAM'} IS ${locked ? 'LOCKED' : 'STILL OPEN'}`))
      }
    }

    if (state.lockFailed) box.append(el('p', 'alert', 'THE LOCKS DID NOT LOAD'))
    if (state.cardError && !state.card && !mineLocked()) box.append(el('p', 'alert', state.cardError))
    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
  }

  function teamMark(id) {
    const team = state.teams.find((item) => item.id === id)
    const mine = team?.coach_id === state.userId
    return el('span', mine ? 'mine' : '', team?.name || 'TEAM')
  }

  async function onLock() {
    if (state.busy) return
    state.busy = true
    state.error = ''
    paint()
    const { data, error } = await supabase.rpc('lock_lineup', { game_id: gameId })
    if (prompt.dataset.paint !== token) return
    state.busy = false
    if (error) {
      state.error = (error.message || 'THE CARD DID NOT LOCK.').toUpperCase()
      paint()
      return
    }
    state.card = data
    if (state.myTeam && !state.locks.some((row) => row.team_id === state.myTeam.id)) {
      state.locks = state.locks.concat([{ game_id: gameId, team_id: state.myTeam.id }])
    }
    paint()
  }

  async function load() {
    const [session, gameRes, lockRes, cardRes] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('games').select('id, season_id, home_team_id, away_team_id, starts_at, status, weather, is_practice').eq('id', gameId).maybeSingle(),
      supabase.from('lineup_locks').select('game_id, team_id, locked_at').eq('game_id', gameId),
      supabase.rpc('own_locked_card', { game_id: gameId }),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    state.lockFailed = Boolean(lockRes.error)
    state.locks = lockRes.error ? [] : (lockRes.data || [])
    state.cardError = cardRes.error ? (cardRes.error.message || 'THE CARD DID NOT LOAD').toUpperCase() : ''
    state.card = cardRes.error ? null : cardRes.data
    if (gameRes.error) {
      state.error = (gameRes.error.message || 'THE GAME DID NOT LOAD.').toUpperCase()
      state.game = null
      state.missing = false
      state.loaded = true
      paint()
      return
    }
    if (!gameRes.data) {
      state.missing = true
      state.game = null
      state.loaded = true
      paint()
      return
    }
    state.game = gameRes.data
    state.missing = false
    const [seasonRes, teamsRes] = await Promise.all([
      supabase.from('seasons').select('id, name').eq('id', state.game.season_id).maybeSingle(),
      supabase.from('teams').select('id, name, coach_id, bottlecaps, reputation, season_id').eq('season_id', state.game.season_id).order('created_at', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    if (seasonRes.error || teamsRes.error) {
      state.error = ((seasonRes.error || teamsRes.error).message || 'THE GAME DID NOT LOAD.').toUpperCase()
      state.loaded = true
      paint()
      return
    }
    state.season = seasonRes.data
    state.teams = teamsRes.data || []
    state.myTeam = state.teams.find((team) => team.coach_id === state.userId) || null
    const showLive = playing() && !state.card && !mineLocked() && state.game.status === 'scheduled'
    if (showLive) {
      const [lineupRes, itemRes, kidRes] = await Promise.all([
        supabase.from('lineups').select('team_id, player_id, slot').eq('team_id', state.myTeam.id),
        supabase.from('team_items').select('id, item_id, remaining_games, bought_at, effect, clubhouse_items(name)').eq('team_id', state.myTeam.id).order('bought_at', { ascending: true }).order('id', { ascending: true }),
        supabase.from('players').select('id, given_name, family_name, nickname, sex, team_id').eq('team_id', state.myTeam.id),
      ])
      if (prompt.dataset.paint !== token) return
      state.lineupFailed = Boolean(lineupRes.error || kidRes.error)
      state.itemsFailed = Boolean(itemRes.error)
      state.live = state.lineupFailed || state.itemsFailed
        ? null
        : liveCard(lineupRes.data || [], kidRes.data || [], itemRes.data || [])
    }
    state.loaded = true
    paint()
  }

  paint()
  load()
}
