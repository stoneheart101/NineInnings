import { supabase } from '../supabase.js'

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

function durationLabel(duration) {
  return duration === 'series' ? 'THREE GAME SERIES' : 'NEXT GAME'
}

function costLine(item) {
  const parts = []
  if (item.bottlecap_cost) parts.push(counted(item.bottlecap_cost, 'BOTTLECAP', 'BOTTLECAPS'))
  if (item.reputation_cost) parts.push(counted(item.reputation_cost, 'REPUTATION', 'REPUTATION'))
  return parts.join(' · ')
}

function slotLabel(slot) {
  const found = SLOTS.find(([number]) => number === Number(slot))
  return found ? found[1] : ''
}

function draftIsOpen(season, draft) {
  if (season?.status !== 'drafting' || !draft) return false
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  return order.length > 0 && Number.isInteger(pickIndex) && pickIndex < order.length
}

export function renderClubhouse(prompt, { teamId, onBack, onOpenSeason, onOpenDraft, onOpenRoster, setTabs }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    team: null,
    userId: '',
    error: '',
    shelf: [],
    packed: [],
    batSlot: '',
    buyError: '',
    buyItem: '',
    buyBusy: false,
    missing: false,
    mine: false,
    draftOpen: false,
    loaded: false,
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const tabs = [{ label: 'BACK', onClick: onBack }]
    if (state.loaded && state.mine && state.team) {
      if (state.draftOpen) {
        tabs.push({
          label: 'THE DRAFT',
          onClick() {
            onOpenDraft?.(state.team.season_id)
          },
        })
      }
      tabs.push({ label: 'THE ROSTER', onClick: () => onOpenRoster?.() })
      tabs.push({
        label: 'THE SEASON',
        onClick() {
          onOpenSeason?.(state.team.season_id)
        },
      })
    }
    setTabs?.(tabs)
    prompt.append(el('h2', 'screen-name', 'CLUBHOUSE'))
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
    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
    prompt.append(shelfBlock())
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
      const packed = el('div', 'shelf-list')
      for (const row of state.packed) packed.append(packedCard(row))
      block.append(packed)
    }
    block.append(el('p', 'section', 'THE SHELF'))
    const shelf = el('div', 'shelf-list')
    for (const item of orderedShelf()) shelf.append(shelfCard(item))
    block.append(shelf)
    return block
  }

  function packedCard(row) {
    const card = el('div', 'shelf-card')
    const item = linkedItem(row) || state.shelf.find((entry) => entry.id === row.item_id)
    card.append(el('span', 'season-name', item?.name || 'ITEM'))
    const games = Number(row.remaining_games)
    if (Number.isInteger(games)) card.append(el('span', '', counted(games, 'GAME LEFT', 'GAMES LEFT')))
    const slot = row.effect?.slot
    if (Number.isInteger(slot) && slotLabel(slot)) card.append(el('span', '', slotLabel(slot)))
    return card
  }

  function shelfCard(item) {
    const card = el('div', 'shelf-card')
    card.dataset.item = item.id
    card.append(el('span', 'season-name', item.name))
    if (item.blurb) card.append(el('span', '', item.blurb))
    card.append(el('span', '', `${costLine(item)} · ${durationLabel(item.duration)}`))
    const buyRow = el('div', 'shelf-buy')
    if (needsSlot(item)) {
      const slotSelect = document.createElement('select')
      slotSelect.dataset.bat = item.id
      slotSelect.disabled = state.buyBusy || !canAfford(item)
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = 'SLOT'
      slotSelect.append(blank)
      for (const [slot, label] of SLOTS) {
        const option = document.createElement('option')
        option.value = String(slot)
        option.textContent = label
        slotSelect.append(option)
      }
      slotSelect.value = state.batSlot
      slotSelect.addEventListener('change', () => {
        state.batSlot = slotSelect.value
        const buy = card.querySelector('button')
        if (buy) buy.disabled = state.buyBusy || !canAfford(item) || !state.batSlot
      })
      buyRow.append(slotSelect)
    }
    const buy = el('button', '', 'BUY')
    buy.type = 'button'
    buy.disabled = state.buyBusy || !canAfford(item) || (needsSlot(item) && !state.batSlot)
    buy.addEventListener('click', () => onBuy(item))
    buyRow.append(buy)
    card.append(buyRow)
    if (state.buyError && state.buyItem === item.id) card.append(el('p', 'alert', state.buyError))
    return card
  }

  async function onBuy(item) {
    if (state.buyBusy || !state.team || !canAfford(item)) return
    const slot = needsSlot(item) ? Number(state.batSlot) : null
    if (needsSlot(item) && (!Number.isInteger(slot) || slot < 1 || slot > 9)) return
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
      state.buyError = (error.message || 'THAT ITEM STAYED ON THE SHELF.').toUpperCase()
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
      state.draftOpen = false
      state.loaded = true
      paint()
      return
    }
    if (!team.data) {
      state.missing = true
      state.team = null
      state.mine = false
      state.draftOpen = false
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
      state.draftOpen = false
      state.shelf = []
      state.packed = []
      state.loaded = true
      paint()
      return
    }
    const [draft, shelf, packed] = await Promise.all([
      supabase
        .from('draft_state')
        .select('pick_index,order')
        .eq('season_id', team.data.season_id)
        .maybeSingle(),
      supabase
        .from('clubhouse_items')
        .select('id, name, blurb, bottlecap_cost, reputation_cost, duration, effect'),
      supabase
        .from('team_items')
        .select('id, item_id, remaining_games, bought_at, effect, clubhouse_items(name, duration)')
        .eq('team_id', teamId)
        .order('bought_at', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    if (shelf.error) {
      state.buyError = (shelf.error.message || 'THE SHELF DID NOT LOAD.').toUpperCase()
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
    const season = seasonOf(team.data)
    state.draftOpen = draft.error ? season?.status === 'drafting' : draftIsOpen(season, draft.data)
    state.loaded = true
    paint()
  }

  paint()
  load()
}
