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

export function showKidPopup({ id, name, stats, onClose }) {
  const title = name || 'KID'
  const open = document.querySelector('.popup')
  if (popupKind() === 'kid' && open?.dataset.kidId === id) {
    const heading = open.querySelector('.card-title')
    if (heading) heading.textContent = title
    open.setAttribute('aria-label', title)
    replacePopupBody(kidDetailBars(stats))
    return
  }
  quietClose = true
  try {
    mountPopup(document.body, {
      title,
      kind: 'kid',
      content: kidDetailBars(stats),
      actions: [{ label: 'CLOSE', onClick() { closePopup() } }],
      onClose() {
        if (quietClose) return
        onClose?.()
      },
    })
    const opened = document.querySelector('.popup')
    if (opened && id) opened.dataset.kidId = id
  } finally {
    quietClose = false
  }
}
