import { supabase } from '../supabase.js'
import { fetchHeld } from '../held-purse.js'
import { closePopup, mountPopup, popupKind } from '../popup.js'
import { alreadyPacked, shelfBlurb, shelfLine } from '../shelf.js'
import { buyReason } from '../why.js'

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

const SHELF_ORDER = ['extra_baseballs', 'ice_pops', 'borrowed_gloves', 'tarp_and_chalk', 'metal_bat']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function counted(value, one, many) {
  return `${value} ${value === 1 ? one : many}`
}

function seasonOf(team) {
  const season = Array.isArray(team?.seasons) ? team.seasons[0] : team?.seasons
  return season || null
}

function linkedItem(row) {
  const linked = Array.isArray(row?.clubhouse_items) ? row.clubhouse_items[0] : row?.clubhouse_items
  return linked || null
}

function needsSlot(item) {
  return item?.effect?.needs_slot === true
}

function costLine(item) {
  const parts = []
  if (item.bottlecap_cost) parts.push(counted(item.bottlecap_cost, 'BOTTLECAP', 'BOTTLECAPS'))
  if (item.reputation_cost) parts.push(counted(item.reputation_cost, 'REPUTATION', 'REPUTATION'))
  return parts.join(' AND ')
}

export function renderClubhouse(prompt, { teamId, setTeam, onDesk }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    team: null,
    userId: '',
    error: '',
    shelf: [],
    packed: [],
    kids: [],
    lineup: {},
    picking: '',
    rosterError: '',
    buyError: '',
    buyItem: '',
    buyBusy: false,
    missing: false,
    mine: false,
    loaded: false,
    held: { bottlecaps: 0, reputation: 0 },
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    if (popupKind() !== 'coach' && popupKind() !== 'season') closePopup()
    prompt.replaceChildren()
    const box = el('div', 'choices')

    if (!state.loaded) return
    if (state.missing || !state.team) {
      setTeam?.(null)
      onDesk?.({ seasonId: '', teamId: '' })
      box.append(el('p', '', 'THAT TEAM IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }
    if (!state.mine) {
      setTeam?.(null)
      onDesk?.({ seasonId: state.team.season_id, teamId: '' })
      box.append(el('p', '', 'THAT TEAM IS NOT YOURS'))
      prompt.append(box)
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
    if (state.error) box.append(el('p', 'alert', state.error))
    if (box.childNodes.length) prompt.append(box)
    prompt.append(shelfBlock())
    if (state.picking) mountBatPopup()
  }

  function orderedShelf() {
    const rank = new Map(SHELF_ORDER.map((id, index) => [id, index]))
    return [...state.shelf].sort((left, right) => {
      const leftRank = rank.has(left.id) ? rank.get(left.id) : SHELF_ORDER.length
      const rightRank = rank.has(right.id) ? rank.get(right.id) : SHELF_ORDER.length
      if (leftRank !== rightRank) return leftRank - rightRank
      return String(left.name).localeCompare(String(right.name))
    })
  }

  function canAfford(item) {
    return Number(state.team?.bottlecaps) >= item.bottlecap_cost && Number(state.team?.reputation) >= item.reputation_cost
  }

  function shelfBlock() {
    const block = el('div', 'clubhouse')
    block.append(el('p', 'section', 'PACKED'))
    if (!state.packed.length) {
      block.append(el('p', '', 'NO ITEMS PACKED'))
    } else {
      const packed = el('div', 'packed-list')
      for (const row of state.packed) packed.append(el('p', '', packedLine(row)))
      block.append(packed)
    }
    block.append(el('p', 'section', 'AVAILABLE'))
    const available = orderedShelf()
    if (!available.length) {
      block.append(el('p', '', 'NONE AVAILABLE'))
    } else {
      const shelf = el('div', 'shelf-list')
      for (const item of available) shelf.append(shelfCard(item))
      block.append(shelf)
    }
    return block
  }

  function packedLine(row) {
    const item = linkedItem(row) || state.shelf.find((entry) => entry.id === row.item_id)
    const name = item?.name || 'ITEM'
    return `${name} - THE NEXT GAME SPENDS IT`
  }

  function buyLabel(item) {
    const price = costLine(item)
    return price ? `BUY FOR ${price}` : 'BUY'
  }

  function shelfCard(item) {
    const card = el('div', 'card kid-card')
    card.dataset.item = item.id
    const head = el('div', 'card-head')
    const title = el('span', 'kid-title')
    title.append(el('span', 'season-name', item.name))
    head.append(title)
    const reason = buyReason({
      busy: state.buyBusy,
      packed: alreadyPacked(state.packed, item.id),
      afford: canAfford(item),
    })
    const buy = el('button', '', buyLabel(item))
    buy.type = 'button'
    buy.disabled = Boolean(reason)
    buy.addEventListener('click', () => {
      if (reason) return
      if (needsSlot(item)) {
        state.picking = item.id
        state.buyError = ''
        paint()
        return
      }
      onBuy(item)
    })
    const actions = el('div', 'card-actions')
    actions.append(buy)
    head.append(actions)
    card.append(head)
    const blurb = shelfBlurb(item)
    if (blurb) card.append(el('span', '', blurb))
    card.append(el('span', '', shelfLine()))
    if (reason) card.append(el('p', 'why', reason))
    if (state.buyError && state.buyItem === item.id) card.append(el('p', 'alert', state.buyError))
    return card
  }

  function kidLabel(kid) {
    const name = [kid.given_name, kid.family_name].filter(Boolean).join(' ') || 'KID'
    const nick = kid.nickname ? ` "${kid.nickname}"` : ''
    return `${name}${nick}`
  }

  function batChoices() {
    const choices = []
    for (const [slot, label] of SLOTS) {
      const playerId = state.lineup[slot]
      if (!playerId) continue
      const kid = state.kids.find((entry) => entry.id === playerId)
      if (!kid) continue
      choices.push({ slot, label: `${kidLabel(kid)} - ${label}` })
    }
    return choices
  }

  function mountBatPopup() {
    const choices = batChoices()
    const item = state.shelf.find((entry) => entry.id === state.picking)
    const list = el('div', 'popup-choices')
    if (!choices.length) list.append(el('p', '', state.rosterError || 'THE LINEUP IS EMPTY'))
    for (const choice of choices) {
      const button = el('button', '', choice.label)
      button.type = 'button'
      button.addEventListener('click', () => {
        if (!item) return
        onBuy(item, choice.slot)
      })
      list.append(button)
    }
    mountPopup(prompt, {
      title: 'WHO GETS THE BAT?',
      content: list,
      actions: [
        {
          label: 'BACK',
          onClick() {
            state.picking = ''
            paint()
          },
        },
      ],
      onClose() {
        state.picking = ''
        paint()
      },
    })
  }

  async function onBuy(item, chosenSlot) {
    if (state.buyBusy || !state.team || !canAfford(item) || alreadyPacked(state.packed, item.id)) return
    const slot = needsSlot(item) ? Number(chosenSlot) : null
    if (needsSlot(item) && (!Number.isInteger(slot) || slot < 1 || slot > 9)) return
    state.picking = ''
    state.buyBusy = true
    state.buyError = ''
    state.buyItem = item.id
    paint()
    const args = { team_id: state.team.id, item_id: item.id }
    if (needsSlot(item)) args.slot = slot
    const { error } = await supabase.rpc('buy_item', args)
    if (prompt.dataset.paint !== token) return
    state.buyBusy = false
    if (error) {
      state.buyError = (error.message || 'THAT ITEM WAS NOT PACKED.').toUpperCase()
      paint()
      return
    }
    state.buyError = ''
    await load()
  }

  async function load() {
    const [session, team] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('teams')
        .select('id, name, coach_id, bottlecaps, reputation, season_id, seasons!teams_season_id_fkey(name, roster_cap, status)')
        .eq('id', teamId)
        .maybeSingle(),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    if (team.error) {
      state.error = (team.error.message || 'THE TEAM DID NOT LOAD.').toUpperCase()
      state.team = null
      state.missing = false
      state.mine = false
      state.loaded = true
      paint()
      return
    }
    if (!team.data) {
      state.missing = true
      state.team = null
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
      state.shelf = []
      state.packed = []
      state.kids = []
      state.lineup = {}
      state.loaded = true
      paint()
      return
    }
    const [shelf, packed, kids, lineup, held] = await Promise.all([
      supabase
        .from('clubhouse_items')
        .select('id, name, blurb, bottlecap_cost, reputation_cost, duration, effect'),
      supabase
        .from('team_items')
        .select('id, item_id, remaining_games, bought_at, effect, clubhouse_items(name, duration)')
        .eq('team_id', teamId)
        .order('bought_at', { ascending: true }),
      supabase
        .from('players')
        .select('id, given_name, family_name, nickname')
        .eq('team_id', teamId),
      supabase
        .from('lineups')
        .select('slot, player_id')
        .eq('team_id', teamId),
      fetchHeld(supabase, teamId),
    ])
    if (prompt.dataset.paint !== token) return
    state.held = held
    if (shelf.error) {
      state.buyError = (shelf.error.message || 'THE AVAILABLE ITEMS DID NOT LOAD.').toUpperCase()
      state.shelf = []
    } else {
      state.shelf = shelf.data || []
    }
    if (packed.error) {
      state.buyError = (packed.error.message || 'THE PACKED ITEMS DID NOT LOAD.').toUpperCase()
      state.packed = []
    } else {
      state.packed = packed.data || []
      if (!shelf.error && !state.buyBusy) state.buyError = ''
    }
    state.lineup = {}
    if (kids.error || lineup.error) {
      state.kids = []
      state.rosterError = 'THE LINEUP DID NOT LOAD.'
    } else {
      state.kids = kids.data || []
      state.rosterError = ''
      const onTeam = new Set(state.kids.map((kid) => kid.id))
      for (const row of lineup.data || []) {
        if (onTeam.has(row.player_id)) state.lineup[row.slot] = row.player_id
      }
    }
    state.loaded = true
    paint()
  }

  paint()
  load()
}
