import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'

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

function kidName(kid) {
  return [kid.given_name, kid.family_name].filter(Boolean).join(' ') || 'KID'
}

let room = null

export function closeDraft() {
  if (!room) return
  const current = room
  room = null
  supabase.removeChannel(current)
}

export function renderDraft(prompt, { seasonId, onBack, setTabs }) {
  closeDraft()
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    season: null,
    teams: [],
    kids: [],
    draft: null,
    userId: '',
    error: '',
    pickError: '',
    pickKid: '',
    busy: false,
    more: false,
    sort: '',
    missing: false,
    loaded: false,
  }

  function teamName(id) {
    return state.teams.find((team) => team.id === id)?.name || 'TEAM'
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    setTabs?.([{ label: 'BACK', onClick: onBack }])
    const box = el('div', 'choices')

    if (!state.loaded) return
    if (state.missing || !state.season) {
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    box.append(el('p', 'season-title', state.season.name), el('p', 'season-status', 'THE DRAFT'))
    const order = Array.isArray(state.draft?.order) ? state.draft.order : []
    const pickIndex = Number(state.draft?.pick_index)
    const clock = Number.isInteger(pickIndex) ? order[pickIndex] : undefined
    if (!state.draft) {
      box.append(el('p', '', 'THE DRAFT HAS NOT STARTED'))
    } else if (clock) {
      box.append(el('p', 'season-role', `ON THE CLOCK: ${teamName(clock)}`))
    } else if (order.length) {
      box.append(el('p', 'season-role', 'THE DRAFT IS COMPLETE'))
    }
    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
    if (clock && order.length) prompt.append(orderMore(order, pickIndex))
    if (state.draft) prompt.append(board(order, clock))
  }

  function orderMore(order, pickIndex) {
    const node = el('div', 'choices')
    const more = el('button', '', state.more ? 'LESS...' : 'MORE...')
    more.type = 'button'
    more.addEventListener('click', () => {
      state.more = !state.more
      paint()
    })
    node.append(more)
    if (!state.more) return node
    const rounds = Number(state.draft.rounds) || 0
    const perRound = rounds > 0 && order.length % rounds === 0 ? order.length / rounds : 0
    if (!perRound) node.append(orderList(order, 0, pickIndex))
    else {
      for (let round = 0; round < rounds; round += 1) {
        node.append(el('p', '', `ROUND ${round + 1}`))
        node.append(orderList(order.slice(round * perRound, (round + 1) * perRound), round * perRound, pickIndex))
      }
    }
    return node
  }

  function orderList(ids, start, pickIndex) {
    const list = el('div', 'draft-list')
    ids.forEach((id, index) => {
      const pick = start + index
      const row = el('div', 'draft-pick')
      row.append(el('span', 'season-name', `${pick + 1} ${teamName(id)}`))
      if (pick === pickIndex) {
        row.classList.add('on-clock')
        row.append(el('span', 'season-role', 'ON THE CLOCK'))
      }
      list.append(row)
    })
    return list
  }

  function board(order, clock) {
    const node = el('div', 'choices')
    const mine = state.teams.find((team) => team.coach_id === state.userId)
    const myTurn = Boolean(clock && mine && mine.id === clock)
    const seen = []
    for (const id of order) {
      if (id && !seen.includes(id)) seen.push(id)
    }

    node.append(el('p', '', 'DRAFTED'))
    const roster = el('div', 'draft-roster')
    for (const id of seen) {
      const card = el('div', 'team-card')
      card.append(el('span', 'season-name', teamName(id)))
      const drafted = state.kids.filter((kid) => kid.team_id === id)
      if (!drafted.length) card.append(el('span', '', 'NO KIDS YET'))
      else for (const kid of drafted) card.append(el('span', '', kidName(kid)))
      roster.append(card)
    }
    node.append(roster)

    node.append(el('p', '', 'THE POOL'))
    if (myTurn) node.append(el('p', 'season-role', 'YOUR PICK'))
    const pool = sortedPool(state.kids.filter((kid) => !kid.team_id))
    if (myTurn && pool.length) node.append(sortRow())
    const poolList = el('div', 'draft-pool')
    if (!pool.length) poolList.append(el('p', '', 'NO KIDS LEFT'))
    else for (const kid of pool) poolList.append(kidCard(kid, myTurn))
    if (state.pickError && !pool.some((kid) => kid.id === state.pickKid)) {
      poolList.prepend(el('p', 'alert', state.pickError))
    }
    node.append(poolList)
    return node
  }

  function sortedPool(pool) {
    if (!state.sort) return pool
    const stat = state.sort
    return pool.slice().sort((a, b) => {
      const left = Number.isInteger(a.base_stats?.[stat]) ? a.base_stats[stat] : -1
      const right = Number.isInteger(b.base_stats?.[stat]) ? b.base_stats[stat] : -1
      if (left !== right) return right - left
      return (a.family_name || '').localeCompare(b.family_name || '')
        || (a.given_name || '').localeCompare(b.given_name || '')
        || String(a.id).localeCompare(String(b.id))
    })
  }

  function sortRow() {
    const row = el('div', 'sort-row')
    for (const [stat, label] of STATS) {
      const link = el('button', state.sort === stat ? 'on' : '', label)
      link.type = 'button'
      link.addEventListener('click', () => {
        state.sort = stat
        paint()
      })
      row.append(link)
    }
    return row
  }

  function kidCard(kid, myTurn) {
    const card = el('div', 'kid-card')
    const head = el('div', 'kid-head')
    const title = el('span', 'kid-title')
    const nick = kid.nickname ? ` "${kid.nickname}"` : ''
    title.append(el('span', 'season-name', `${kidName(kid)}${nick}`))
    if (kid.sex === 'M' || kid.sex === 'F') title.append(el('span', 'season-role', kid.sex))
    head.append(title)
    if (myTurn) {
      const pick = el('button', '', 'PICK')
      pick.type = 'button'
      pick.disabled = state.busy
      pick.addEventListener('click', () => onPick(kid.id))
      head.append(pick)
    }
    card.append(head)
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) stats.append(statChip(label, kid.base_stats?.[stat]))
    card.append(stats)
    if (state.pickError && state.pickKid === kid.id) card.append(el('p', 'alert', state.pickError))
    return card
  }

  async function onPick(playerId) {
    if (state.busy) return
    state.busy = true
    state.pickError = ''
    state.pickKid = playerId
    paint()
    const { error } = await supabase.rpc('draft_pick', {
      season_id: seasonId,
      player_id: playerId,
    })
    if (prompt.dataset.paint !== token) return
    state.busy = false
    if (error) {
      state.pickError = (error.message || 'THAT PICK DID NOT LAND.').toUpperCase()
      paint()
      return
    }
    state.pickError = ''
    await load()
  }

  async function load() {
    const [session, season, teams, draft, kids] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('seasons')
        .select('id, name, status, roster_cap')
        .eq('id', seasonId)
        .maybeSingle(),
      supabase
        .from('teams')
        .select('id, name, coach_id')
        .eq('season_id', seasonId)
        .order('name', { ascending: true }),
      supabase
        .from('draft_state')
        .select('season_id, pick_index, order, rounds')
        .eq('season_id', seasonId)
        .maybeSingle(),
      supabase
        .from('players')
        .select('id, team_id, given_name, family_name, nickname, sex, flavor, base_stats, created_at')
        .eq('season_id', seasonId)
        .order('family_name', { ascending: true })
        .order('given_name', { ascending: true })
        .order('id', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    const failed = season.error || teams.error || draft.error || kids.error
    if (failed) {
      state.error = (failed.message || 'THE DRAFT DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.kids = []
      state.draft = null
      state.missing = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
      state.kids = []
      state.draft = null
    } else {
      state.missing = false
      state.userId = session.data.session?.user?.id ?? ''
      state.season = season.data
      state.teams = teams.data || []
      state.kids = kids.data || []
      state.draft = draft.data
      state.error = ''
    }
    state.loaded = true
    paint()
  }

  function onRemote() {
    if (prompt.dataset.paint !== token) {
      closeDraft()
      return
    }
    load()
  }

  const channel = supabase.channel(`draft:${seasonId}`)
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'draft_state', filter: `season_id=eq.${seasonId}` },
    onRemote,
  )
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'players', filter: `season_id=eq.${seasonId}` },
    onRemote,
  )
  room = channel.subscribe()

  paint()
  load()
}
