import { closePopup, mountPopup, popupKind, replacePopupBody } from './popup.js'
import { statColor } from './stat-color.js'

let quietClose = false

export const KID_STATS = [
  ['contact', 'CONTACT'],
  ['power', 'POWER'],
  ['eye', 'EYE'],
  ['speed', 'SPEED'],
  ['glove', 'GLOVE'],
  ['arm', 'ARM'],
  ['stamina', 'STAMINA'],
]

export function statBars(stats) {
  return KID_STATS.map(([key, label]) => {
    const raw = stats?.[key]
    const value = Number.isInteger(raw) ? raw : null
    return {
      key,
      label,
      value,
      text: value == null ? '-' : String(value),
      width: value == null ? 0 : Math.max(0, Math.min(100, value)),
    }
  })
}

export function kidDetailBars(stats) {
  const bars = document.createElement('div')
  bars.className = 'stat-bars'
  for (const bar of statBars(stats)) {
    const row = document.createElement('div')
    row.className = 'stat-bar'
    const label = document.createElement('span')
    label.className = 'stat-bar-label'
    label.textContent = bar.label
    const track = document.createElement('span')
    track.className = 'stat-bar-track'
    const fill = document.createElement('span')
    fill.className = 'stat-bar-fill'
    fill.style.width = `${bar.width}%`
    if (bar.value != null) fill.style.background = statColor(bar.value)
    track.append(fill)
    const num = document.createElement('span')
    num.className = 'stat-num'
    num.textContent = bar.text
    if (bar.value != null) num.style.color = statColor(bar.value)
    row.append(label, track, num)
    bars.append(row)
  }
  return bars
}

export function sexWord(sex) {
  if (sex === 'M') return 'MALE'
  if (sex === 'F') return 'FEMALE'
  return ''
}

export function kidDetailBody({ stats, sex, perk, help, position }) {
  const body = document.createElement('div')
  body.className = 'kid-detail'
  const word = sexWord(sex)
  if (word) {
    const line = document.createElement('p')
    line.textContent = word
    body.append(line)
  }
  if (perk) {
    const line = document.createElement('p')
    line.textContent = perk
    body.append(line)
  }
  if (help) {
    const note = document.createElement('p')
    note.textContent = help
    body.append(note)
  }
  body.append(kidDetailBars(stats))
  if (position) body.append(position)
  return body
}

export function detailsButton(onOpen) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'details-link'
  button.textContent = 'DETAILS'
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onOpen()
  })
  button.addEventListener('keydown', (event) => {
    event.stopPropagation()
  })
  return button
}

function markKidTitle(homeHelp) {
  const heading = document.querySelector('.popup.card .card-title')
  if (!heading) return
  heading.classList.toggle('home-help', Boolean(homeHelp))
}

export function showKidPopup({ id, name, stats, sex, perk, help, homeHelp, position, onClose }) {
  const title = name || 'KID'
  const helped = Boolean(homeHelp)
  const body = () => kidDetailBody({ stats, sex, perk, help, position })
  const open = document.querySelector('.popup')
  if (popupKind() === 'kid' && open?.dataset.kidId === id) {
    const heading = open.querySelector('.card-title')
    if (heading) heading.textContent = title
    open.setAttribute('aria-label', title)
    markKidTitle(helped)
    replacePopupBody(body())
    return
  }
  quietClose = true
  try {
    mountPopup(document.body, {
      title,
      kind: 'kid',
      content: body(),
      actions: [{ label: 'CLOSE', onClick() { closePopup() } }],
      onClose() {
        if (quietClose) return
        onClose?.()
      },
    })
    const opened = document.querySelector('.popup')
    if (opened && id) opened.dataset.kidId = id
    markKidTitle(helped)
  } finally {
    quietClose = false
  }
}
