import { supabase } from '../supabase.js'
import { fetchHeld } from '../held-purse.js'
import { clockLabel, forecastReport } from '../forecast.js'
import { headed, reviewNotes, scoreNodes, usedNodes } from '../summary.js'
import { bindChanges, gameIsFinal, matchupChanges } from '../live.js'
import { filledNine, filledOrder } from '../nine.js'
import { WHY, lockReason } from '../why.js'
import { homePerkForGame } from '../home-perk.js'
import { vsSides } from '../played.js'

const LABELS = [null, 'MOUND', 'CATCHER', 'FIRST', 'SECOND', 'THIRD', 'SHORT', 'LEFT', 'CENTER', 'RIGHT']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
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
  return typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : 'ITEM'
}

let matchRoom = null

export function closeMatchup() {
  if (!matchRoom) return
  const current = matchRoom
  matchRoom = null
  supabase.removeChannel(current)
}

function liveCard(lineups, kids, items) {
  const byId = new Map(kids.map((kid) => [kid.id, kid]))
  const bySlot = new Map(lineups.map((row) => [Number(row.slot), row]))
  const slots = []
  for (let slot = 1; slot <= 9; slot += 1) {
    const lined = bySlot.get(slot)
    const kid = byId.get(lined?.player_id) || null
    slots.push({
      slot,
      batting_order: lined?.batting_order ?? null,
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

export function renderMatchup(prompt, { gameId, setTeam, onDesk }) {
  closeMatchup()
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
    used: [],
    usedFailed: false,
    lockFailed: false,
    liveKidPerks: [],
    nextGameId: null,
    nextFailed: false,
    held: { bottlecaps: 0, reputation: 0 },
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
    const mine = state.myTeam
    if (state.loaded && mine && state.season) {
      setTeam?.({
        name: mine.name,
        season: state.season.name,
        bottlecaps: mine.bottlecaps,
        reputation: mine.reputation,
        heldBottlecaps: state.held?.bottlecaps || 0,
        heldReputation: state.held?.reputation || 0,
      })
    } else if (state.loaded) {
      setTeam?.(null)
    }
    if (state.loaded) {
      onDesk?.({
        seasonId: state.season?.id || state.game?.season_id || '',
        teamId: mine?.id || '',
      })
    }
    if (!state.loaded) return

    const box = el('div', 'choices')
    if (state.missing || !game) {
      box.append(el('p', '', 'THAT GAME IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    const when = new Date(game.starts_at)
    const summary = game.status === 'final' || Boolean(game.result)
    const matchNodes = []
    if (!Number.isNaN(when.getTime())) matchNodes.push(el('p', 'game-date', clockLabel(when)))
    if (summary) matchNodes.push(...reviewNotes(game))
    else {
      const words = forecastReport(game)
      if (words) matchNodes.push(el('p', 'game-forecast', words))
    }
    const homeLock = state.locks.find((row) => row.team_id === game.home_team_id)
    const fieldLine = homePerkForGame({
      final: summary,
      homeLocked: Boolean(homeLock),
      lockPerk: homeLock?.home_perk ?? null,
      livePerk: state.teams.find((team) => team.id === game.home_team_id)?.home_perk ?? null,
      lockKidPerks: homeLock?.kid_perks || [],
      liveKidPerks: state.liveKidPerks,
      locksKnown: !state.lockFailed,
    })
    if (fieldLine) matchNodes.push(el('p', '', fieldLine))
    const matchTitle = el('span', 'game-match')
    const [first, second] = vsSides(
      { id: game.away_team_id, name: sideName(game.away_team_id) },
      { id: game.home_team_id, name: sideName(game.home_team_id) },
      state.myTeam?.id || '',
    )
    matchTitle.append(document.createTextNode(`${first.name} VS ${second.name}`))
    box.append(headed('matchup-card', matchTitle, matchNodes))

    if (summary) {
      box.append(headed('box-score', 'LINE', scoreNodes(game.result)))
      if (state.usedFailed) box.append(el('p', 'alert', 'THE ITEMS DID NOT LOAD'))
      else {
        const used = usedNodes(state.used, game.result)
        if (used.length) box.append(headed('used-items', 'USED', used))
      }
    }
    if (!game.is_practice && playing()) {
      const foeId = state.myTeam.id === game.home_team_id ? game.away_team_id : game.home_team_id
      const foe = state.teams.find((team) => team.id === foeId)
      const foeLocked = state.locks.some((row) => row.team_id === foeId)
      const mineNodes = []
      let lock = null
      if (state.card) {
        mineNodes.push(el('p', 'season-status', 'THE CARD IS LOCKED'))
        mineNodes.push(...cardNodes(state.card))
      } else if (mineLocked()) {
        mineNodes.push(el('p', 'alert', 'THE CARD DID NOT LOAD'))
      } else if (game.status !== 'scheduled') {
        mineNodes.push(el('p', '', 'THE GAME HAS ALREADY BEEN PLAYED'))
      } else if (state.lineupFailed) {
        mineNodes.push(el('p', 'alert', 'THE LINEUP DID NOT LOAD'))
      } else if (state.itemsFailed) {
        mineNodes.push(el('p', 'alert', 'THE ITEMS DID NOT LOAD'))
      } else if (state.nextFailed || state.nextGameId !== game.id) {
        mineNodes.push(...cardNodes(state.live))
        mineNodes.push(el('p', state.nextFailed ? 'alert' : '', state.nextFailed ? 'THE NEXT GAME DID NOT LOAD' : 'LOCK THE NEXT GAME FIRST'))
      } else {
        mineNodes.push(...cardNodes(state.live))
        mineNodes.push(el('p', '', 'LOCK COPIES THIS CARD FOR THE GAME'))
        const full = filledNine(state.live?.slots)
        const order = filledOrder(state.live?.slots)
        lock = el('button', 'action', 'LOCK')
        lock.type = 'button'
        lock.disabled = state.busy || !full || !order
        lock.addEventListener('click', onLock)
        const reason = lockReason({ busy: state.busy, full, order })
        if (reason) mineNodes.push(el('p', 'why', reason))
      }
      box.append(headed('side-box', 'YOUR CARD', mineNodes, lock))
      box.append(headed('side-box', foe?.name || 'TEAM', [
        el('p', '', foeLocked ? 'LOCKED' : 'STILL OPEN'),
      ]))
    } else if (!game.is_practice) {
      for (const id of [game.away_team_id, game.home_team_id]) {
        const team = state.teams.find((item) => item.id === id)
        const locked = state.locks.some((row) => row.team_id === id)
        box.append(headed('side-box', team?.name || 'TEAM', [
          el('p', '', locked ? 'LOCKED' : 'STILL OPEN'),
        ]))
      }
    }

    if (state.lockFailed) box.append(el('p', 'alert', 'THE LOCKS DID NOT LOAD'))
    if (state.cardError && !state.card && !mineLocked()) box.append(el('p', 'alert', state.cardError))
    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
  }

  function sideName(id) {
    const team = state.teams.find((item) => item.id === id)
    if (team?.name) return team.name
    const result = state.game?.result
    if (result?.away?.team_id === id && result.away.name) return result.away.name
    if (result?.home?.team_id === id && result.home.name) return result.home.name
    return 'TEAM'
  }

  function armClock() {
    const game = state.game
    if (!game || game.is_practice || game.status !== 'scheduled') return
    const when = Date.parse(game.starts_at)
    if (Number.isNaN(when)) return
    const remaining = when - Date.now()
    if (remaining > 16 * 60 * 1000) return
    let tries = 0
    const pull = async () => {
      if (prompt.dataset.paint !== token) return
      const { data, error } = await supabase.from('games').select('status, result, narrative').eq('id', gameId).maybeSingle()
      if (prompt.dataset.paint !== token) return
      if (!error && data?.status === 'final') {
        const usedRes = await supabase.rpc('used_clubhouse_items', { game_id: gameId })
        if (prompt.dataset.paint !== token) return
        state.usedFailed = Boolean(usedRes.error)
        state.used = usedRes.error || !Array.isArray(usedRes.data) ? [] : usedRes.data
        if (state.myTeam) {
          const purse = await supabase.from('teams').select('bottlecaps, reputation').eq('id', state.myTeam.id).maybeSingle()
          if (prompt.dataset.paint !== token) return
          if (!purse.error && purse.data) {
            state.myTeam = { ...state.myTeam, ...purse.data }
            state.held = await fetchHeld(supabase, state.myTeam.id)
            if (prompt.dataset.paint !== token) return
          }
        }
        state.game = {
          ...state.game,
          status: data.status,
          result: data.result,
          narrative: data.narrative,
        }
        paint()
        return
      }
      tries += 1
      if (tries >= 20) return
      window.setTimeout(pull, 60000)
    }
    window.setTimeout(pull, remaining > 0 ? remaining : 15000)
  }

  function earlierId(rows) {
    let best = null
    for (const row of rows) {
      if (!row?.id) continue
      const at = Date.parse(row.starts_at)
      if (Number.isNaN(at)) continue
      if (!best || at < best.at) best = { id: row.id, at }
    }
    return best?.id ?? null
  }

  async function nextScheduled(teamId) {
    const [homeRes, awayRes] = await Promise.all([
      supabase.from('games').select('id, starts_at').eq('status', 'scheduled').eq('home_team_id', teamId).order('starts_at', { ascending: true }).limit(1),
      supabase.from('games').select('id, starts_at').eq('status', 'scheduled').eq('away_team_id', teamId).order('starts_at', { ascending: true }).limit(1),
    ])
    if (homeRes.error || awayRes.error) return { id: null, failed: true }
    return {
      id: earlierId([...(homeRes.data || []), ...(awayRes.data || [])]),
      failed: false,
    }
  }

  async function onLock() {
    if (state.busy) return
    if (state.nextFailed || state.nextGameId !== state.game?.id) {
      state.error = state.nextFailed ? 'THE NEXT GAME DID NOT LOAD' : 'LOCK THE NEXT GAME FIRST'
      paint()
      return
    }
    if (!filledNine(state.live?.slots)) {
      state.error = WHY.assignNine
      paint()
      return
    }
    if (!filledOrder(state.live?.slots)) {
      state.error = WHY.assignOrder
      paint()
      return
    }
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
      state.locks = state.locks.concat([{
        game_id: gameId,
        team_id: state.myTeam.id,
        home_perk: state.myTeam.id === state.game?.home_team_id ? state.myTeam.home_perk ?? null : null,
        kid_perks: state.myTeam.id === state.game?.home_team_id ? state.liveKidPerks : [],
      }])
    }
    paint()
  }

  async function load() {
    const [session, gameRes, lockRes, cardRes, usedRes] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('games').select('id, season_id, home_team_id, away_team_id, starts_at, status, weather, is_practice, result, narrative').eq('id', gameId).maybeSingle(),
      supabase.from('lineup_locks').select('game_id, team_id, locked_at, home_perk, kid_perks').eq('game_id', gameId),
      supabase.rpc('own_locked_card', { game_id: gameId }),
      supabase.rpc('used_clubhouse_items', { game_id: gameId }),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    state.lockFailed = Boolean(lockRes.error)
    state.locks = lockRes.error ? [] : (lockRes.data || [])
    state.cardError = cardRes.error ? (cardRes.error.message || 'THE CARD DID NOT LOAD').toUpperCase() : ''
    state.card = cardRes.error ? null : cardRes.data
    state.usedFailed = Boolean(usedRes.error)
    state.used = usedRes.error || !Array.isArray(usedRes.data) ? [] : usedRes.data
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
    const [seasonRes, teamsRes, perkRes] = await Promise.all([
      supabase.from('seasons').select('id, name, commissioner_id').eq('id', state.game.season_id).maybeSingle(),
      supabase.from('teams').select('id, name, coach_id, bottlecaps, reputation, home_perk, season_id').eq('season_id', state.game.season_id).order('created_at', { ascending: true }),
      supabase.from('players').select('home_perk').eq('team_id', state.game.home_team_id).not('home_perk', 'is', null),
    ])
    if (prompt.dataset.paint !== token) return
    state.liveKidPerks = perkRes.error ? [] : (perkRes.data || []).map((row) => row.home_perk).filter(Boolean)
    if (seasonRes.error || teamsRes.error) {
      state.error = ((seasonRes.error || teamsRes.error).message || 'THE GAME DID NOT LOAD.').toUpperCase()
      state.loaded = true
      paint()
      return
    }
    state.season = seasonRes.data
    state.teams = teamsRes.data || []
    state.myTeam = state.teams.find((team) => team.coach_id === state.userId) || null
    state.held = await fetchHeld(supabase, state.myTeam?.id)
    if (prompt.dataset.paint !== token) return
    const showLive = playing() && !state.card && !mineLocked() && state.game.status === 'scheduled'
    if (showLive) {
      const [lineupRes, itemRes, kidRes, next] = await Promise.all([
        supabase.from('lineups').select('team_id, player_id, slot, batting_order').eq('team_id', state.myTeam.id),
        supabase.from('team_items').select('id, item_id, remaining_games, bought_at, effect, clubhouse_items(name)').eq('team_id', state.myTeam.id).order('bought_at', { ascending: true }).order('id', { ascending: true }),
        supabase.from('players').select('id, given_name, family_name, nickname, sex, team_id').eq('team_id', state.myTeam.id),
        nextScheduled(state.myTeam.id),
      ])
      if (prompt.dataset.paint !== token) return
      state.lineupFailed = Boolean(lineupRes.error || kidRes.error)
      state.itemsFailed = Boolean(itemRes.error)
      state.nextFailed = next.failed
      state.nextGameId = next.id
      state.live = state.lineupFailed || state.itemsFailed
        ? null
        : liveCard(lineupRes.data || [], kidRes.data || [], itemRes.data || [])
    }
    state.loaded = true
    paint()
    armClock()
  }

  function onRemote() {
    if (prompt.dataset.paint !== token) {
      supabase.removeChannel(channel)
      if (matchRoom === channel) matchRoom = null
      return
    }
    if (gameIsFinal(state.game)) return
    load()
  }

  const channel = supabase.channel(`matchup:${gameId}`)
  bindChanges(channel, matchupChanges(gameId), onRemote)
  matchRoom = channel.subscribe()

  paint()
  load()
}
