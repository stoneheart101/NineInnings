import { supabase } from '../supabase.js'
import { fetchHeld } from '../held-purse.js'
import { clockLabel } from '../forecast.js'
import { headed, reviewNotes, scoreNodes, usedNodes } from '../summary.js'
import { homePerkForGame } from '../home-perk.js'
import { vsSides } from '../played.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function renderReport(prompt, { gameId, setTeam, onDesk }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    game: null,
    season: null,
    teams: [],
    myTeam: null,
    userId: '',
    error: '',
    missing: false,
    loaded: false,
    used: [],
    usedFailed: false,
    locks: [],
    locksFailed: false,
    liveKidPerks: [],
    held: { bottlecaps: 0, reputation: 0 },
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
    const finished = game.status === 'final' || Boolean(game.result)
    const matchNodes = []
    if (!Number.isNaN(when.getTime())) matchNodes.push(el('p', 'game-date', clockLabel(when)))
    if (finished) matchNodes.push(...reviewNotes(game))
    const homeLock = state.locks.find((row) => row.team_id === game.home_team_id)
    const fieldLine = homePerkForGame({
      final: finished,
      homeLocked: Boolean(homeLock),
      lockPerk: homeLock?.home_perk ?? null,
      livePerk: state.teams.find((team) => team.id === game.home_team_id)?.home_perk ?? null,
      lockKidPerks: homeLock?.kid_perks || [],
      liveKidPerks: state.liveKidPerks,
      locksKnown: !state.locksFailed,
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

    if (!finished) {
      box.append(el('p', '', 'THIS GAME HAS NOT BEEN PLAYED'))
    } else {
      box.append(headed('box-score', 'LINE', scoreNodes(game.result)))
      if (state.usedFailed) box.append(el('p', 'alert', 'THE ITEMS DID NOT LOAD'))
      else {
        const used = usedNodes(state.used, game.result)
        if (used.length) box.append(headed('used-items', 'USED', used))
      }
    }
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

  async function load() {
    const [session, gameRes, usedRes, lockRes] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('games').select('id, season_id, home_team_id, away_team_id, starts_at, status, is_practice, weather, result, narrative').eq('id', gameId).maybeSingle(),
      supabase.rpc('used_clubhouse_items', { game_id: gameId }),
      supabase.from('lineup_locks').select('team_id, home_perk, kid_perks').eq('game_id', gameId),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    state.locksFailed = Boolean(lockRes.error)
    state.locks = lockRes.error ? [] : (lockRes.data || [])
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
      supabase.from('seasons').select('id, name').eq('id', state.game.season_id).maybeSingle(),
      supabase.from('teams').select('id, name, coach_id, bottlecaps, reputation, home_perk').eq('season_id', state.game.season_id).order('created_at', { ascending: true }),
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
    state.loaded = true
    paint()
  }

  paint()
  load()
}
