import { supabase } from '../supabase.js'

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

function kidName(kid) {
  return [kid.given_name, kid.family_name].filter(Boolean).join(' ') || 'KID'
}

function seasonOf(team) {
  const season = Array.isArray(team?.seasons) ? team.seasons[0] : team?.seasons
  return season || null
}

let room = null

export function closeTeam() {
  if (!room) return
  const current = room
  room = null
  supabase.removeChannel(current)
}

export function renderTeam(prompt, { teamId, onBack, onOpenSeason, setTabs }) {
  closeTeam()
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    team: null,
    kids: [],
    userId: '',
    error: '',
    releaseError: '',
    releaseKid: '',
    busy: false,
    missing: false,
    mine: false,
    loaded: false,
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const tabs = [{ label: 'BACK', onClick: onBack }]
    if (state.loaded && state.mine && state.team) {
      tabs.push({
        label: 'THE SEASON',
        onClick() {
          onOpenSeason?.(state.team.season_id)
        },
      })
    }
    setTabs?.(tabs)
    const box = el('div', 'choices')

    if (!state.loaded) return
    if (state.missing || !state.team) {
      box.append(el('p', '', 'THAT TEAM IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }
    if (!state.mine) {
      box.append(el('p', '', 'THAT TEAM IS NOT YOURS'))
      prompt.append(box)
      return
    }

    const season = seasonOf(state.team)
    box.append(
      el('p', 'season-title', state.team.name),
      el('p', 'season-status', season?.name || 'SEASON'),
      el('p', '', `${counted(state.team.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(state.team.reputation, 'REPUTATION', 'REPUTATION')}`),
    )
    const cap = Number(season?.roster_cap)
    if (Number.isInteger(cap) && state.kids.length >= cap) {
      box.append(el('p', 'season-role', 'THE BENCH IS FULL'))
    }
    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)

    const board = el('div', 'choices')
    if (!state.kids.length) {
      board.append(el('p', '', 'NO KIDS YET'))
    } else {
      board.append(el('p', '', counted(state.kids.length, 'KID', 'KIDS')))
      const list = el('div', 'kid-list')
      for (const kid of state.kids) list.append(kidCard(kid))
      board.append(list)
    }
    prompt.append(board)
  }

  function kidCard(kid) {
    const card = el('div', 'kid-card')
    card.append(el('span', 'season-name', kidName(kid)))
    if (kid.nickname) card.append(el('span', '', `"${kid.nickname}"`))
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) {
      const value = kid.base_stats?.[stat]
      stats.append(el('span', 'kid-stat', `${label} ${Number.isInteger(value) ? value : '-'}`))
    }
    card.append(stats)
    const release = el('button', '', 'RELEASE')
    release.type = 'button'
    release.disabled = state.busy
    release.addEventListener('click', () => onRelease(kid.id))
    card.append(release)
    if (state.releaseError && state.releaseKid === kid.id) {
      card.append(el('p', 'alert', state.releaseError))
    }
    return card
  }

  async function onRelease(playerId) {
    if (state.busy) return
    state.busy = true
    state.releaseError = ''
    state.releaseKid = playerId
    paint()
    const { error } = await supabase.rpc('release_player', { player_id: playerId })
    if (prompt.dataset.paint !== token) return
    state.busy = false
    if (error) {
      state.releaseError = (error.message || 'THAT KID STAYED.').toUpperCase()
      paint()
      return
    }
    state.releaseError = ''
    await load()
  }

  function listen(seasonId) {
    if (room || !seasonId) return
    const channel = supabase.channel(`team:${teamId}`)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players', filter: `season_id=eq.${seasonId}` },
      () => {
        if (prompt.dataset.paint !== token) {
          closeTeam()
          return
        }
        load()
      },
    )
    room = channel.subscribe()
  }

  async function load() {
    const [session, team] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('teams')
        .select('id, name, coach_id, bottlecaps, reputation, season_id, seasons!teams_season_id_fkey(name, roster_cap)')
        .eq('id', teamId)
        .maybeSingle(),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    if (team.error) {
      state.error = (team.error.message || 'THE TEAM DID NOT LOAD.').toUpperCase()
      state.team = null
      state.kids = []
      state.missing = false
      state.mine = false
      state.loaded = true
      paint()
      return
    }
    if (!team.data) {
      state.missing = true
      state.team = null
      state.kids = []
      state.mine = false
      state.error = ''
      state.loaded = true
      paint()
      return
    }
    state.missing = false
    state.team = team.data
    state.mine = team.data.coach_id === state.userId
    state.error = ''
    if (!state.mine) {
      state.kids = []
      state.loaded = true
      paint()
      return
    }
    const kids = await supabase
      .from('players')
      .select('id, team_id, given_name, family_name, nickname, flavor, base_stats, created_at')
      .eq('team_id', teamId)
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true })
      .order('id', { ascending: true })
    if (prompt.dataset.paint !== token) return
    if (kids.error) {
      state.error = (kids.error.message || 'THE KIDS DID NOT LOAD.').toUpperCase()
      state.kids = []
    } else {
      state.kids = kids.data || []
    }
    state.loaded = true
    listen(team.data.season_id)
    paint()
  }

  paint()
  load()
}
