import { supabase } from '../supabase.js'
import { fetchHeld } from '../held-purse.js'
import { statChip } from '../stat-color.js'
import { closePopup, mountPopup, popupKind } from '../popup.js'
import { WHY } from '../why.js'
import { hideToast, showToast } from '../toast.js'
import { teamTabRow } from '../team-tabs.js'
import { nameClass, perkLine } from '../home-perk.js'
import { KID_STATS, detailsButton, showKidPopup } from '../kid-details.js'
import { sortedByStat, statSortRow } from '../stat-sort.js'

const SLOTS = [
  [1, 'MOUND'],
  [2, 'CATCHER'],
  [3, 'FIRST'],
  [4, 'SECOND'],
  [5, 'THIRD'],
  [6, 'SHORT'],
  [7, 'LEFT'],
  [8, 'CENTER'],
  [9, 'RIGHT'],
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
  hideToast()
  if (!room) return
  const current = room
  room = null
  supabase.removeChannel(current)
}

export function renderTeam(prompt, { teamId, setTeam, onDesk, onOpen }) {
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
    confirmKid: '',
    lineup: {},
    order: {},
    lineupError: '',
    lineupKid: '',
    lineupBusy: false,
    busy: false,
    missing: false,
    mine: false,
    loaded: false,
    held: { bottlecaps: 0, reputation: 0 },
    detailId: '',
    sort: '',
  }

  function dropped() {
    if (prompt.dataset.paint === token) return false
    hideToast(token)
    return true
  }

  function holdPickers() {
    prompt.querySelectorAll('.card-pickers select, .kid-card button').forEach((control) => {
      control.disabled = true
    })
    document.querySelectorAll('.popup .lineup-slot select').forEach((control) => {
      control.disabled = true
    })
    showToast(WHY.rosterChange, token)
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    if (state.busy || state.lineupBusy) showToast(WHY.rosterChange, token)
    else hideToast(token)
    if (popupKind() !== 'coach' && popupKind() !== 'season' && popupKind() !== 'kid') closePopup()
    prompt.replaceChildren()
    const box = el('div', 'choices')

    if (!state.loaded) return
    if (state.missing || !state.team) {
      setTeam?.(null)
      onDesk?.({ seasonId: '', teamId: '' })
      box.append(el('p', '', 'THAT TEAM IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      state.detailId = ''
      if (popupKind() === 'kid') closePopup()
      return
    }
    if (!state.mine) {
      setTeam?.(null)
      onDesk?.({ seasonId: state.team.season_id, teamId: '' })
      box.append(el('p', '', 'THAT TEAM IS NOT YOURS'))
      prompt.append(box)
      state.detailId = ''
      if (popupKind() === 'kid') closePopup()
      return
    }

    onDesk?.({ seasonId: state.team.season_id, teamId: state.team.id })
    const season = seasonOf(state.team)
    setTeam?.({
      name: state.team.name,
      season: season?.name || 'SEASON',
      bottlecaps: state.team.bottlecaps,
      reputation: state.team.reputation,
      heldBottlecaps: state.held?.bottlecaps || 0,
      heldReputation: state.held?.reputation || 0,
    })
    prompt.append(teamTabRow('roster', onOpen))
    const cap = Number(season?.roster_cap)
    if (Number.isInteger(cap) && state.kids.length >= cap) {
      box.append(el('p', 'season-role', 'THE BENCH IS FULL'))
    }
    if (state.error) box.append(el('p', 'alert', state.error))
    if (state.lineupError && !state.lineupKid) box.append(el('p', 'alert', state.lineupError))
    if (box.childNodes.length) prompt.append(box)

    const board = el('div', 'choices')
    if (!state.kids.length) {
      board.append(el('p', '', 'NO KIDS YET'))
    } else {
      board.append(el('p', '', counted(state.kids.length, 'KID', 'KIDS')))
      board.append(statSortRow(state.sort, (sort) => {
        state.sort = sort
        paint()
      }))
      const list = el('div', 'kid-list')
      const kids = state.sort ? sortedByStat(state.kids, state.sort) : state.kids
      for (const kid of kids) list.append(kidCard(kid))
      board.append(list)
    }
    prompt.append(board)
    const pending = state.kids.find((kid) => kid.id === state.confirmKid)
    if (pending) {
      mountPopup(prompt, {
        title: `RELEASE ${kidLabel(pending)}?`,
        note: pending.tryout_status === 'playing' && pending.offer === 'tryout'
          ? 'THIS KID WILL LEAVE THE TEAM AND GO BACK ON THE BOARD FOR A BID'
          : 'THIS KID WILL BE REMOVED FROM THE TEAM AND PLACED BACK IN THE POOL',
        actions: [
          { label: 'RELEASE', onClick: () => onRelease(pending.id) },
          {
            label: 'BACK',
            onClick() {
              state.confirmKid = ''
              paint()
            },
          },
        ],
        onClose() {
          state.confirmKid = ''
          paint()
        },
      })
    } else {
      presentKid()
    }
  }

  function presentKid() {
    const kid = state.kids.find((item) => item.id === state.detailId)
    if (!kid) {
      state.detailId = ''
      if (popupKind() === 'kid') closePopup()
      return
    }
    showKidPopup({
      id: kid.id,
      name: kidLabel(kid),
      stats: kid.base_stats,
      sex: kid.sex,
      perk: perkLine(kid.home_perk),
      homeHelp: Boolean(perkLine(kid.home_perk)),
      position: detailPosition(kid),
      onClose() { state.detailId = '' },
    })
  }

  function detailPosition(kid) {
    const spot = el('div')
    spot.append(positionPicker(kid))
    if (state.lineupError && state.lineupKid === kid.id) {
      spot.append(el('p', 'alert', state.lineupError))
    }
    return spot
  }

  function kidLabel(kid) {
    const nick = kid.nickname ? ` "${kid.nickname}"` : ''
    return `${kidName(kid)}${nick}`
  }

  function kidCard(kid) {
    const card = el('div', 'card kid-card')
    const head = el('div', 'card-head')
    const title = el('span', 'kid-title')
    title.append(el('span', nameClass(kid.home_perk), kidLabel(kid)))
    if (kid.sex === 'M') title.append(el('span', 'sex-m', 'M'))
    else if (kid.sex === 'F') title.append(el('span', 'season-role', 'F'))
    if (kid.tryout_status === 'playing') title.append(el('span', 'tryout-mark', 'TRYOUT'))
    head.append(title)
    const release = el('button', '', 'RELEASE')
    release.type = 'button'
    release.disabled = state.busy || state.lineupBusy
    release.addEventListener('click', () => {
      if (state.busy || state.lineupBusy) return
      state.confirmKid = kid.id
      state.releaseError = ''
      paint()
    })
    const actions = el('div', 'card-actions')
    actions.append(release, detailsButton(() => {
      state.detailId = kid.id
      presentKid()
    }))
    head.append(actions)
    card.append(head)
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const brought = perkLine(kid.home_perk)
    if (brought) card.append(el('span', '', brought))
    if (kid.penalty_until_game_id) card.append(el('p', '', 'PLAYING FLAT'))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of KID_STATS) stats.append(statChip(label, kid.base_stats?.[stat]))
    card.append(stats)
    card.append(pickers(kid))
    if (state.lineupError && state.lineupKid === kid.id) {
      card.append(el('p', 'alert', state.lineupError))
    }
    if (state.releaseError && state.releaseKid === kid.id) {
      card.append(el('p', 'alert', state.releaseError))
    }
    return card
  }

  function slotFor(playerId) {
    for (const [slot, id] of Object.entries(state.lineup)) {
      if (id === playerId) return Number(slot)
    }
    return 0
  }

  function orderFor(playerId) {
    for (const [spot, id] of Object.entries(state.order)) {
      if (id === playerId) return Number(spot)
    }
    return 0
  }

  function pickers(kid) {
    const row = el('div', 'card-pickers')
    row.append(positionPicker(kid))
    if (slotFor(kid.id) > 0) row.append(orderPicker(kid))
    return row
  }

  function positionPicker(kid) {
    const row = el('label', 'lineup-slot card-foot')
    const select = document.createElement('select')
    select.dataset.player = kid.id
    select.disabled = state.busy || state.lineupBusy
    const bench = document.createElement('option')
    bench.value = ''
    bench.textContent = 'BENCH'
    select.append(bench)
    for (const [slot, label] of SLOTS) {
      const option = document.createElement('option')
      option.value = String(slot)
      option.textContent = label
      const holder = state.lineup[slot]
      if (holder && holder !== kid.id) option.className = 'taken'
      select.append(option)
    }
    const current = slotFor(kid.id)
    select.value = current ? String(current) : ''
    select.classList.toggle('bench', current === 0)
    select.addEventListener('change', () => {
      if (state.lineupBusy || state.busy) return
      const chosen = select.value
      // Replacing the selects inside this event also changes the next kid.
      setTimeout(() => {
        if (prompt.dataset.paint !== token || state.lineupBusy || state.busy) return
        onPosition(kid.id, chosen)
      }, 0)
    })
    row.append(select)
    return row
  }

  function orderPicker(kid) {
    const row = el('label', 'lineup-slot card-foot')
    const select = document.createElement('select')
    select.dataset.player = kid.id
    select.dataset.order = 'batting'
    const playing = slotFor(kid.id) > 0
    select.disabled = state.busy || state.lineupBusy || !playing
    const open = document.createElement('option')
    open.value = ''
    open.textContent = 'ORDER'
    select.append(open)
    for (let spot = 1; spot <= 9; spot += 1) {
      const option = document.createElement('option')
      option.value = String(spot)
      option.textContent = String(spot)
      const holder = state.order[spot]
      if (holder && holder !== kid.id) option.className = 'taken'
      select.append(option)
    }
    const current = playing ? orderFor(kid.id) : 0
    select.value = current ? String(current) : ''
    select.classList.toggle('bench', current === 0)
    select.addEventListener('change', () => {
      if (state.lineupBusy || state.busy || !playing) return
      const chosen = select.value
      setTimeout(() => {
        if (prompt.dataset.paint !== token || state.lineupBusy || state.busy) return
        onOrder(kid.id, chosen)
      }, 0)
    })
    row.append(select)
    return row
  }

  function slotsFromLineup(lineup) {
    const slots = {}
    for (const [slot] of SLOTS) slots[String(slot)] = null
    for (const [slot, playerId] of Object.entries(lineup)) {
      const number = Number(slot)
      if (number >= 1 && number <= 9 && playerId) slots[String(number)] = playerId
    }
    return slots
  }

  async function onPosition(playerId, raw) {
    if (state.lineupBusy || state.busy || !state.team) return
    const slot = raw === '' ? 0 : Number(raw)
    if (raw !== '' && (!Number.isInteger(slot) || slot < 1 || slot > 9)) return
    const previous = slotFor(playerId)
    if (previous === slot) return
    const slots = slotsFromLineup(state.lineup)
    const occupant = slot ? slots[String(slot)] : null
    for (const key of Object.keys(slots)) {
      if (slots[key] === playerId) slots[key] = null
    }
    if (slot) slots[String(slot)] = playerId
    if (occupant && occupant !== playerId && previous) slots[String(previous)] = occupant
    state.lineup = {}
    for (const [key, id] of Object.entries(slots)) {
      if (id) state.lineup[Number(key)] = id
    }
    const still = new Set(Object.values(state.lineup))
    const kept = {}
    for (const [spot, id] of Object.entries(state.order)) {
      if (still.has(id)) kept[Number(spot)] = id
    }
    state.order = kept
    state.lineupBusy = true
    state.lineupError = ''
    state.lineupKid = playerId
    holdPickers()
    const { error } = await supabase.rpc('set_lineup', { team_id: state.team.id, slots })
    if (dropped()) return
    state.lineupBusy = false
    if (error) {
      const message = (error.message || 'THE LINEUP STAYED.').toUpperCase()
      await load()
      if (dropped()) return
      state.lineupError = message
      state.lineupKid = playerId
      paint()
      return
    }
    state.lineupError = ''
    state.lineupKid = ''
    await load()
  }

  function ordersFrom(order) {
    const orders = {}
    for (let spot = 1; spot <= 9; spot += 1) orders[String(spot)] = null
    for (const [spot, playerId] of Object.entries(order)) {
      const number = Number(spot)
      if (number >= 1 && number <= 9 && playerId) orders[String(number)] = playerId
    }
    return orders
  }

  async function onOrder(playerId, raw) {
    if (state.lineupBusy || state.busy || !state.team) return
    if (!slotFor(playerId)) return
    const spot = raw === '' ? 0 : Number(raw)
    if (raw !== '' && (!Number.isInteger(spot) || spot < 1 || spot > 9)) return
    const previous = orderFor(playerId)
    if (previous === spot) return
    const orders = ordersFrom(state.order)
    const occupant = spot ? orders[String(spot)] : null
    for (const key of Object.keys(orders)) {
      if (orders[key] === playerId) orders[key] = null
    }
    if (spot) orders[String(spot)] = playerId
    if (occupant && occupant !== playerId && previous) orders[String(previous)] = occupant
    state.order = {}
    for (const [key, id] of Object.entries(orders)) {
      if (id) state.order[Number(key)] = id
    }
    state.lineupBusy = true
    state.lineupError = ''
    state.lineupKid = playerId
    holdPickers()
    const { error } = await supabase.rpc('set_batting_order', { team_id: state.team.id, orders })
    if (dropped()) return
    state.lineupBusy = false
    if (error) {
      const message = (error.message || 'THE ORDER STAYED.').toUpperCase()
      await load()
      if (dropped()) return
      state.lineupError = message
      state.lineupKid = playerId
      paint()
      return
    }
    state.lineupError = ''
    state.lineupKid = ''
    await load()
  }

  async function onRelease(playerId) {
    if (state.busy) return
    state.confirmKid = ''
    state.busy = true
    state.releaseError = ''
    state.releaseKid = playerId
    paint()
    const { error } = await supabase.rpc('release_player', { player_id: playerId })
    if (dropped()) return
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
          supabase.removeChannel(channel)
          if (room === channel) room = null
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
    const [kids, lineup, held] = await Promise.all([
      supabase
        .from('players')
        .select('id, team_id, given_name, family_name, nickname, sex, flavor, base_stats, tryout_status, offer, penalty_until_game_id, home_perk, created_at')
        .eq('team_id', teamId)
        .order('family_name', { ascending: true })
        .order('given_name', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('lineups')
        .select('slot, player_id, batting_order')
        .eq('team_id', teamId)
        .order('slot', { ascending: true }),
      fetchHeld(supabase, teamId),
    ])
    if (prompt.dataset.paint !== token) return
    state.held = held
    if (kids.error) {
      state.error = (kids.error.message || 'THE KIDS DID NOT LOAD.').toUpperCase()
      state.kids = []
    } else {
      state.kids = kids.data || []
    }
    const onTeam = new Set(state.kids.map((kid) => kid.id))
    state.lineup = {}
    state.order = {}
    if (lineup.error) {
      state.lineupError = (lineup.error.message || 'THE LINEUP DID NOT LOAD.').toUpperCase()
    } else {
      state.lineupError = ''
      for (const row of lineup.data || []) {
        if (!onTeam.has(row.player_id)) continue
        state.lineup[row.slot] = row.player_id
        const spot = Number(row.batting_order)
        if (Number.isInteger(spot) && spot >= 1 && spot <= 9) state.order[spot] = row.player_id
      }
    }
    state.loaded = true
    listen(team.data.season_id)
    paint()
  }

  paint()
  load()
}
