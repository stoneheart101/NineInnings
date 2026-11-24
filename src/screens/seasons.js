import { supabase } from '../supabase.js'
import { renderSeason } from './season.js'
import { draftIsActive } from '../menu.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function whole(value, min, max) {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  if (number < min || number > max) return null
  return number
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
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

export function renderSeasons(prompt, { seasonId, section, onOpen, onOpenDraft, onOpenGame, setTeam, onDesk, onDrafting }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    seasons: [],
    userId: '',
    error: '',
    busy: false,
    name: '',
    days: [],
    practice: '1',
    weeks: '8',
    rounds: '10',
    loaded: false,
    opening: false,
    focusName: false,
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
    box.append(el('h2', 'screen-name', 'SEASONS'))
    if (state.loaded && !state.seasons.length) {
      box.append(el('p', '', 'NO SEASONS YET'))
    } else if (state.seasons.length) {
      box.append(seasonId ? seasonRow() : seasonCards())
    }
    if (state.loaded && !seasonId) {
      const control = openControl()
      if (control) box.append(control)
      if (state.error) box.append(el('p', 'alert', state.error))
    } else if (state.error && !state.opening) {
      box.append(el('p', 'alert', state.error))
    }
    prompt.append(box)
    if (!seasonId) {
      if (state.focusName) {
        state.focusName = false
        prompt.querySelector('[name="season-name"]')?.focus()
      }
      return
    }
    if (keep) {
      prompt.append(keep)
      mountOpen(keep.querySelector('.open-season-slot'))
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
      setTeam,
      onDesk,
      onOpenSlot: mountOpen,
    })
  }

  function openControl() {
    if (!state.loaded) return null
    if (!state.seasons.length || state.opening) return form()
    const open = el('button', '', 'OPEN A SEASON')
    open.type = 'button'
    open.addEventListener('click', () => {
      state.opening = true
      state.error = ''
      state.focusName = true
      paint()
    })
    return open
  }

  function mountOpen(slot) {
    if (!slot) return
    slot.replaceChildren()
    const control = openControl()
    if (control) slot.append(control)
    if (state.error && state.opening) slot.append(el('p', 'alert', state.error))
    if (state.focusName) {
      state.focusName = false
      slot.querySelector('[name="season-name"]')?.focus()
    }
  }

  function seasonCards() {
    const list = el('div', 'season-list')
    for (const season of state.seasons) {
      const card = el('div', 'season-card')
      card.tabIndex = 0
      card.setAttribute('role', 'link')
      card.addEventListener('click', () => onOpen(season.id))
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen(season.id)
      })
      const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
      card.append(
        el('span', 'season-name', season.name),
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

  function seasonRow() {
    const row = el('div', 'season-row')
    for (const season of state.seasons) {
      const open = season.id === seasonId
      const button = el('button', open ? 'season-chip on' : 'season-chip', season.name)
      button.type = 'button'
      if (open) button.setAttribute('aria-current', 'true')
      button.addEventListener('click', () => {
        if (!open) onOpen(season.id)
      })
      row.append(button)
    }
    return row
  }

  function form() {
    const node = document.createElement('form')
    node.className = 'open-season'
    const name = document.createElement('input')
    name.name = 'season-name'
    name.required = true
    name.maxLength = 40
    name.autocomplete = 'off'
    name.spellcheck = false
    name.value = state.name
    const nameLabel = el('label')
    nameLabel.append(el('span', '', 'NAME'), name)

    const days = el('div', 'days')
    DAYS.forEach((label, index) => {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.name = 'day'
      input.value = String(index)
      input.checked = state.days.includes(index)
      const dayLabel = el('label')
      dayLabel.append(input, el('span', '', label))
      days.append(dayLabel)
    })

    node.append(
      el('p', '', 'OPEN A SEASON'),
      nameLabel,
      el('p', '', 'OFFICIAL GAME DAYS'),
      days,
      numberField('practice', 'PRACTICE EVERY', state.practice, 1, 14),
      numberField('weeks', 'WEEKS', state.weeks, 1, 20),
      numberField('rounds', 'DRAFT ROUNDS', state.rounds, 1, 15),
    )

    const open = el('button', '', 'OPEN')
    open.type = 'submit'
    open.disabled = state.busy
    node.append(open)
    node.addEventListener('submit', onSubmit)
    return node
  }

  function numberField(name, label, value, min, max) {
    const input = document.createElement('input')
    input.className = 'num'
    input.name = name
    input.type = 'number'
    input.inputMode = 'numeric'
    input.required = true
    input.min = String(min)
    input.max = String(max)
    input.value = value
    const wrap = el('label')
    wrap.append(el('span', '', label), input)
    return wrap
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (state.busy) return
    const data = new FormData(event.currentTarget)
    const seasonName = cleanName(String(data.get('season-name') || ''))
    const officialWeekdays = data.getAll('day').map(Number)
    const practice = whole(String(data.get('practice') || ''), 1, 14)
    const weeks = whole(String(data.get('weeks') || ''), 1, 20)
    const rounds = whole(String(data.get('rounds') || ''), 1, 15)
    state.name = seasonName
    state.days = officialWeekdays
    state.practice = String(data.get('practice') || '')
    state.weeks = String(data.get('weeks') || '')
    state.rounds = String(data.get('rounds') || '')
    if (!/^[A-Z0-9][A-Z0-9 .'-]{0,39}$/.test(seasonName)) {
      state.error = "USE 1 TO 40 LETTERS, NUMBERS, SPACES, OR . ' -"
      paint()
      return
    }
    if (!officialWeekdays.length) {
      state.error = 'PICK AT LEAST ONE DAY'
      paint()
      return
    }
    if (practice == null || weeks == null || rounds == null) {
      state.error = 'CHECK THE PRACTICE DAYS, WEEKS, AND ROUNDS'
      paint()
      return
    }

    state.busy = true
    state.error = ''
    const button = event.currentTarget.querySelector('button')
    if (button) button.disabled = true
    const { error } = await supabase.rpc('create_season', {
      season_name: seasonName,
      official_weekdays: officialWeekdays,
      practice_every_days: practice,
      weeks,
      draft_rounds: rounds,
    })
    state.busy = false
    if (error) {
      state.error = (error.message || 'THAT SEASON WAS NOT OPENED.').toUpperCase()
      paint()
      return
    }
    state.name = ''
    state.days = []
    state.practice = '1'
    state.weeks = '8'
    state.rounds = '10'
    state.opening = false
    await load()
  }

  async function load() {
    const [session, seasons, drafts] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('seasons')
        .select('id, name, commissioner_id, status, official_weekdays, practice_every_days, weeks, draft_rounds')
        .order('created_at', { ascending: false }),
      supabase
        .from('draft_state')
        .select('season_id, pick_index, order'),
    ])
    state.userId = session.data.session?.user?.id ?? ''
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

  paint()
  load()
}
