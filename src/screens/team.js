import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'
import { closePopup, mountPopup } from '../popup.js'

const STATS = [
  ['contact', 'CONTACT'],
  ['power', 'POWER'],
  ['eye', 'EYE'],
  ['speed', 'SPEED'],
  ['glove', 'GLOVE'],
  ['arm', 'ARM'],
  ['stamina', 'STAMINA'],
]

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

function draftIsOpen(season, draft) {
  if (season?.status !== 'drafting' || !draft) return false
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  return order.length > 0 && Number.isInteger(pickIndex) && pickIndex < order.length
}

let room = null

export function closeTeam() {
  if (!room) return
  const current = room
  room = null
  supabase.removeChannel(current)
}

export function renderTeam(prompt, { teamId, onBack, onOpenSeason, onOpenDraft, onOpenClubhouse, setTabs, setTeam }) {
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
    lineupError: '',
    lineupBusy: false,
    busy: false,
    missing: false,
    mine: false,
    draftOpen: false,
    loaded: false,
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    closePopup()
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
      tabs.push({ label: 'CLUBHOUSE', onClick: () => onOpenClubhouse?.(teamId) })
      tabs.push({
        label: 'THE SEASON',
        onClick() {
          onOpenSeason?.(state.team.season_id)
        },
      })
    }
    setTabs?.(tabs)
    prompt.append(el('h2', 'screen-name', 'THE ROSTER'))
    const box = el('div', 'choices')

    if (!state.loaded) return
    if (state.missing || !state.team) {
      setTeam?.(null)
      box.append(el('p', '', 'THAT TEAM IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }
    if (!state.mine) {
      setTeam?.(null)
      box.append(el('p', '', 'THAT TEAM IS NOT YOURS'))
      prompt.append(box)
      return
    }

    const season = seasonOf(state.team)
    setTeam?.({
      name: state.team.name,
      season: season?.name || 'SEASON',
      purse: `${counted(state.team.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(state.team.reputation, 'REPUTATION', 'REPUTATION')}`,
    })
    const cap = Number(season?.roster_cap)
    if (Number.isInteger(cap) && state.kids.length >= cap) {
      box.append(el('p', 'season-role', 'THE BENCH IS FULL'))
    }
    if (state.error) box.append(el('p', 'alert', state.error))
    if (box.childNodes.length) prompt.append(box)
    prompt.append(lineupBlock())

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
    const pending = state.kids.find((kid) => kid.id === state.confirmKid)
    if (pending) {
      mountPopup(prompt, {
        title: `RELEASE ${kidLabel(pending)}?`,
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
    }
  }

  function kidLabel(kid) {
    const nick = kid.nickname ? ` "${kid.nickname}"` : ''
    return `${kidName(kid)}${nick}`
  }

  function kidCard(kid) {
    const card = el('div', 'kid-card')
    const head = el('div', 'kid-head')
    const title = el('span', 'kid-title')
    title.append(el('span', 'season-name', kidLabel(kid)))
    if (kid.sex === 'M') title.append(el('span', 'sex-m', 'M'))
    else if (kid.sex === 'F') title.append(el('span', 'season-role', 'F'))
    head.append(title)
    const release = el('button', '', 'RELEASE')
    release.type = 'button'
    release.disabled = state.busy
    release.addEventListener('click', () => {
      if (state.busy) return
      state.confirmKid = kid.id
      state.releaseError = ''
      paint()
    })
    head.append(release)
    card.append(head)
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) stats.append(statChip(label, kid.base_stats?.[stat]))
    card.append(stats)
    if (state.releaseError && state.releaseKid === kid.id) {
      card.append(el('p', 'alert', state.releaseError))
    }
    return card
  }

  function lineupBlock() {
    const block = el('div', 'lineup')
    const form = el('form', 'lineup-card')
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      onSaveLineup()
    })
    const head = el('div', 'lineup-head')
    head.append(el('p', 'section', 'LINEUP'))
    const save = el('button', '', 'SAVE THE LINEUP')
    save.type = 'submit'
    save.disabled = state.lineupBusy
    head.append(save)
    form.append(head)
    const box = el('div', 'lineup-box')
    for (const [slot, label] of SLOTS) {
      const row = el('label', 'lineup-slot')
      row.append(document.createTextNode(label))
      const select = document.createElement('select')
      select.dataset.slot = String(slot)
      select.disabled = state.lineupBusy
      fillSelect(select, slot)
      select.addEventListener('change', () => {
        const chosen = select.value
        state.lineup[slot] = chosen
        if (chosen) {
          for (const other of Object.keys(state.lineup)) {
            if (Number(other) !== slot && state.lineup[other] === chosen) state.lineup[other] = ''
          }
        }
        syncLineupOptions(select)
      })
      row.append(select)
      box.append(row)
    }
    form.append(box)
    if (state.lineupError) form.append(el('p', 'alert', state.lineupError))
    block.append(form)
    return block
  }

  function takenElsewhere(slot) {
    const taken = new Set()
    for (const [other, playerId] of Object.entries(state.lineup)) {
      if (Number(other) !== slot && playerId) taken.add(playerId)
    }
    return taken
  }

  function fillSelect(select, slot) {
    const current = state.lineup[slot] || ''
    const taken = takenElsewhere(slot)
    select.replaceChildren()
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = 'EMPTY'
    select.append(empty)
    for (const kid of state.kids) {
      if (taken.has(kid.id) && kid.id !== current) continue
      const option = document.createElement('option')
      option.value = kid.id
      const nickname = kid.nickname ? ` "${kid.nickname}"` : ''
      option.textContent = `${kidName(kid)}${nickname}`
      select.append(option)
    }
    select.value = current && [...select.options].some((option) => option.value === current) ? current : ''
  }

  function syncLineupOptions(skip) {
    const form = prompt.querySelector('form.lineup-card')
    if (!form) return
    for (const select of form.querySelectorAll('select')) {
      if (select === skip) continue
      fillSelect(select, Number(select.dataset.slot))
    }
  }

  function slotsFromForm() {
    const slots = {}
    const form = prompt.querySelector('form.lineup-card')
    for (const [slot] of SLOTS) {
      const select = form?.querySelector(`[data-slot="${slot}"]`)
      const value = select?.value || ''
      state.lineup[slot] = value
      slots[String(slot)] = value || null
    }
    return slots
  }

  async function onSaveLineup() {
    if (state.lineupBusy || !state.team) return
    const slots = slotsFromForm()
    state.lineupBusy = true
    state.lineupError = ''
    paint()
    const { error } = await supabase.rpc('set_lineup', { team_id: state.team.id, slots })
    if (prompt.dataset.paint !== token) return
    state.lineupBusy = false
    if (error) {
      state.lineupError = (error.message || 'THE LINEUP STAYED.').toUpperCase()
      paint()
      return
    }
    state.lineupError = ''
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
        .select('id, name, coach_id, bottlecaps, reputation, season_id, seasons!teams_season_id_fkey(name, roster_cap, status)')
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
      state.draftOpen = false
      state.loaded = true
      paint()
      return
    }
    if (!team.data) {
      state.missing = true
      state.team = null
      state.kids = []
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
      state.kids = []
      state.draftOpen = false
      state.loaded = true
      paint()
      return
    }
    const [kids, draft, lineup] = await Promise.all([
      supabase
        .from('players')
        .select('id, team_id, given_name, family_name, nickname, sex, flavor, base_stats, created_at')
        .eq('team_id', teamId)
        .order('family_name', { ascending: true })
        .order('given_name', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('draft_state')
        .select('pick_index,order')
        .eq('season_id', team.data.season_id)
        .maybeSingle(),
      supabase
        .from('lineups')
        .select('slot, player_id')
        .eq('team_id', teamId)
        .order('slot', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    if (kids.error) {
      state.error = (kids.error.message || 'THE KIDS DID NOT LOAD.').toUpperCase()
      state.kids = []
    } else {
      state.kids = kids.data || []
    }
    const onTeam = new Set(state.kids.map((kid) => kid.id))
    state.lineup = {}
    if (lineup.error) {
      state.lineupError = (lineup.error.message || 'THE LINEUP DID NOT LOAD.').toUpperCase()
    } else {
      state.lineupError = ''
      for (const row of lineup.data || []) {
        if (onTeam.has(row.player_id)) state.lineup[row.slot] = row.player_id
      }
    }
    const season = seasonOf(team.data)
    state.draftOpen = draft.error ? season?.status === 'drafting' : draftIsOpen(season, draft.data)
    state.loaded = true
    listen(team.data.season_id)
    paint()
  }

  paint()
  load()
}
