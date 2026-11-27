import { supabase } from './supabase.js'
import { closePopup, mountPopup } from './popup.js'
import { WHY } from './why.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const FORM_ID = 'open-season-form'

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

export function openSeasonPopup({ onOpened, onBack } = {}) {
  const state = {
    busy: false,
    error: '',
    name: '',
    days: [],
    practice: '1',
    weeks: '8',
    rounds: '10',
  }

  function show() {
    mountPopup(document.body, {
      title: 'OPEN A SEASON',
      kind: 'season',
      actions: [
        { label: 'OPEN', submit: true, form: FORM_ID, disabled: state.busy, reason: state.busy ? WHY.seasonOpening : '' },
        { label: 'BACK', disabled: state.busy, reason: state.busy ? WHY.seasonOpening : '', onClick() { closePopup(); onBack?.() } },
      ],
      content: formNode(),
      focus(box) {
        box.querySelector('[name="season-name"]')?.focus({ preventScroll: true })
      },
    })
  }

  function formNode() {
    const node = document.createElement('form')
    node.id = FORM_ID
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
      nameLabel,
      el('p', '', 'OFFICIAL GAME DAYS'),
      days,
      numberField('practice', 'PRACTICE EVERY', state.practice, 1, 14),
      numberField('weeks', 'WEEKS', state.weeks, 1, 20),
      numberField('rounds', 'DRAFT ROUNDS', state.rounds, 1, 15),
    )
    if (state.error) node.append(el('p', 'alert', state.error))
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
      show()
      return
    }
    if (!officialWeekdays.length) {
      state.error = 'PICK AT LEAST ONE DAY'
      show()
      return
    }
    if (practice == null || weeks == null || rounds == null) {
      state.error = 'CHECK THE PRACTICE DAYS, WEEKS, AND ROUNDS'
      show()
      return
    }

    state.busy = true
    state.error = ''
    show()
    const { data: seasonId, error } = await supabase.rpc('create_season', {
      season_name: seasonName,
      official_weekdays: officialWeekdays,
      practice_every_days: practice,
      weeks,
      draft_rounds: rounds,
    })
    state.busy = false
    if (error) {
      state.error = (error.message || 'THAT SEASON WAS NOT OPENED.').toUpperCase()
      show()
      return
    }
    closePopup()
    onOpened?.(seasonId)
  }

  show()
}
