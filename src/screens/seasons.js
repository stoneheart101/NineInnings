import { supabase } from '../supabase.js'

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

function statusLabel(season, draft) {
  if (season?.status !== 'drafting' || !draft) return season.status.toUpperCase()
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  const complete = order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
  return complete ? 'THE DRAFT IS COMPLETE' : season.status.toUpperCase()
}

export function renderSeasons(prompt, { onBack, onOpen, setTabs }) {
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
    drafts: {},
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const showForm = state.loaded && (state.seasons.length === 0 || state.opening)
    const tabs = [{ label: 'HOME', onClick: onBack }]
    if (state.loaded && !showForm) {
      tabs.push({
        label: 'OPEN A SEASON',
        onClick() {
          state.opening = true
          state.error = ''
          paint()
          prompt.querySelector('[name="season-name"]')?.focus()
        },
      })
    }
    setTabs?.(tabs)

    const box = el('div', 'choices')
    box.append(el('h2', 'screen-name', 'SEASONS'))

    if (state.loaded && !state.seasons.length) {
      box.append(el('p', '', 'NO SEASONS YET'))
    } else if (state.seasons.length) {
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
        const practice = season.practice_every_days === 1
          ? 'EVERY 1 DAY'
          : `EVERY ${season.practice_every_days} DAYS`
        const weeks = season.weeks === 1 ? '1 WEEK' : `${season.weeks} WEEKS`
        const rounds = season.draft_rounds === 1 ? '1 ROUND' : `${season.draft_rounds} ROUNDS`
        card.append(
          el('span', 'season-name', season.name),
          el('span', 'season-status', statusLabel(season, state.drafts[season.id])),
          el('span', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
          el('span', '', `${practice} · ${weeks} · ${rounds}`),
        )
        if (season.commissioner_id === state.userId) {
          card.append(el('span', 'season-role', 'YOU ARE THE COMMISSIONER'))
        }
        list.append(card)
      }
      box.append(list)
    }

    if (showForm) box.append(form())

    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
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
