import { supabase } from '../supabase.js'
import { closeSeason, renderSeason } from './season.js'
import { draftIsActive } from '../menu.js'
import { bindChanges, listPendingChanges, listReadyChanges } from '../live.js'

let listRoom = null
let listPendingRoom = null

export function closeSeasonList() {
  for (const current of [listRoom, listPendingRoom]) {
    if (current) supabase.removeChannel(current)
  }
  listRoom = null
  listPendingRoom = null
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function practiceLine(days) {
  const count = Number(days)
  return `PRACTICE GAMES EVERY ${count === 1 ? '1 DAY' : `${count} DAYS`}`
}

function weeksLine(weeks) {
  const count = Number(weeks)
  return count === 1 ? 'THE SEASON LASTS 1 WEEK' : `THE SEASON LASTS ${count} WEEKS`
}

function roundsLine(rounds) {
  const count = Number(rounds)
  return count === 1 ? 'THE DRAFT HAS 1 ROUND' : `THE DRAFT HAS ${count} ROUNDS`
}

function statusLabel(season, draft) {
  if (season?.status !== 'drafting' || !draft) return season.status.toUpperCase()
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  const complete = order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
  return complete ? 'THE DRAFT IS COMPLETE' : season.status.toUpperCase()
}

function openOnKey(event, onOpen) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onOpen()
}

export function renderSeasons(prompt, { seasonId, section, onOpen, onOpenDraft, onOpenGame, onOpenReport, onOpenTeam, onLeave, setTeam, onDesk, onDrafting }) {
  closeSeasonList()
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    seasons: [],
    userId: '',
    error: '',
    loaded: false,
    drafts: {},
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    const previous = prompt.querySelector(':scope > .season-detail')
    const keep = previous && previous.dataset.keep === token && previous.dataset.season === seasonId ? previous : null
    if (state.loaded) {
      const season = state.seasons.find((item) => item.id === seasonId)
      onDrafting?.(seasonId || '', season ? draftIsActive(season, state.drafts[seasonId]) : false)
    }
    prompt.replaceChildren()

    const box = el('div', 'choices')
    if (state.loaded && !state.seasons.length && !seasonId) {
      box.append(el('p', '', 'NO SEASONS YET'))
    } else if (state.seasons.length && !seasonId) {
      box.append(seasonCards())
    }
    if (state.error) box.append(el('p', 'alert', state.error))
    if (box.childNodes.length) prompt.append(box)
    if (!seasonId) {
      closeSeason()
      return
    }
    if (keep) {
      prompt.append(keep)
      return
    }
    const detail = el('div', 'season-detail')
    detail.dataset.keep = token
    detail.dataset.season = seasonId
    prompt.append(detail)
    renderSeason(detail, {
      seasonId,
      section,
      onOpenDraft,
      onOpenGame,
      onOpenReport,
      onOpenTeam,
      onLeave,
      setTeam,
      onDesk,
    })
  }

  function seasonCards() {
    const list = el('div', 'season-list')
    for (const season of state.seasons) {
      const card = el('div', 'card season-card')
      card.tabIndex = 0
      card.setAttribute('role', 'link')
      const openSeason = () => onOpen(season.id)
      card.addEventListener('click', openSeason)
      card.addEventListener('keydown', (event) => openOnKey(event, openSeason))
      const head = el('div', 'card-head')
      head.append(el('span', 'card-title', season.name))
      const open = el('button', '', 'OPEN')
      open.type = 'button'
      open.addEventListener('click', (event) => {
        event.stopPropagation()
        openSeason()
      })
      const actions = el('div', 'card-actions')
      actions.append(open)
      head.append(actions)
      const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
      card.append(
        head,
        el('span', 'season-status', statusLabel(season, state.drafts[season.id])),
        el('span', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
        el('span', '', practiceLine(season.practice_every_days)),
        el('span', '', weeksLine(season.weeks)),
        el('span', '', roundsLine(season.draft_rounds)),
      )
      if (season.commissioner_id === state.userId) {
        card.append(el('span', 'season-role', 'YOU ARE THE COMMISSIONER'))
      }
      list.append(card)
    }
    return list
  }

  async function load() {
    const session = await supabase.auth.getSession()
    const userId = session.data.session?.user?.id ?? ''
    const [seasons, drafts] = await Promise.all([
      supabase
        .from('seasons')
        .select('id, name, commissioner_id, status, official_weekdays, practice_every_days, weeks, draft_rounds')
        .order('created_at', { ascending: false }),
      supabase
        .from('draft_state')
        .select('season_id, pick_index, order'),
    ])
    state.userId = userId
    state.drafts = {}
    if (!drafts.error) {
      for (const row of drafts.data || []) state.drafts[row.season_id] = row
    }
    if (seasons.error) {
      state.error = (seasons.error.message || 'THE SEASONS DID NOT LOAD.').toUpperCase()
      state.seasons = []
    } else {
      state.seasons = seasons.data || []
    }
    state.loaded = true
    paint()
  }

  function retire(channel) {
    supabase.removeChannel(channel)
    if (listRoom === channel) listRoom = null
    if (listPendingRoom === channel) listPendingRoom = null
  }

  function onRemote() {
    if (prompt.dataset.paint !== token) {
      retire(ready)
      retire(pending)
      return
    }
    load()
  }

  const ready = supabase.channel('seasons-list')
  bindChanges(ready, listReadyChanges(), onRemote)
  listRoom = ready.subscribe()
  const pending = supabase.channel('seasons-list-pending')
  bindChanges(pending, listPendingChanges(), onRemote)
  listPendingRoom = pending.subscribe()

  paint()
  load()
}
