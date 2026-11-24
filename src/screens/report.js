import { supabase } from '../supabase.js'
import { clockLabel } from '../forecast.js'
import { headed, scoreNodes, usedNodes, writeupNode } from '../summary.js'

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
    const matchNodes = []
    if (!Number.isNaN(when.getTime())) matchNodes.push(el('p', 'game-date', clockLabel(when)))
    const matchTitle = el('span', 'game-match')
    matchTitle.append(teamMark(game.away_team_id), document.createTextNode(' VS '), teamMark(game.home_team_id))
    box.append(headed('matchup-card', matchTitle, matchNodes))

    const finished = game.status === 'final' || Boolean(game.result)
    if (!finished) {
      box.append(el('p', '', 'THIS GAME HAS NOT BEEN PLAYED'))
    } else {
      box.append(headed('box-score', 'LINE', scoreNodes(game.result)))
      if (state.usedFailed) box.append(el('p', 'alert', 'THE ITEMS DID NOT LOAD'))
      else {
        const used = usedNodes(state.used, game.result)
        if (used.length) box.append(headed('used-items', 'USED', used))
      }
      const writeup = writeupNode(game.narrative)
      if (writeup) box.append(writeup)
      else box.append(el('p', 'alert', 'THE WRITEUP DID NOT LOAD'))
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

  function teamMark(id) {
    const team = state.teams.find((item) => item.id === id)
    const mine = team?.coach_id === state.userId
    return el('span', mine ? 'mine' : '', sideName(id))
  }

  async function load() {
    const [session, gameRes, usedRes] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('games').select('id, season_id, home_team_id, away_team_id, starts_at, status, is_practice, result, narrative').eq('id', gameId).maybeSingle(),
      supabase.rpc('used_clubhouse_items', { game_id: gameId }),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
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
    const [seasonRes, teamsRes] = await Promise.all([
      supabase.from('seasons').select('id, name').eq('id', state.game.season_id).maybeSingle(),
      supabase.from('teams').select('id, name, coach_id, bottlecaps, reputation').eq('season_id', state.game.season_id).order('created_at', { ascending: true }),
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
    state.loaded = true
    paint()
  }

  paint()
  load()
}
