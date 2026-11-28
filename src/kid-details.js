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

export function perkDetail(perk, help) {
  const name = typeof perk === 'string' ? perk.trim() : ''
  const note = typeof help === 'string' ? help.trim() : ''
  if (name && note) return `${name} -${note}`
  return name || note
}

const COUNTING = ['ab', 'h', 'r', 'rbi', 'bb', 'k', 'outs']

function sameKid(left, right) {
  const id = String(right || '').trim().toLowerCase()
  return Boolean(id) && String(left || '').trim().toLowerCase() === id
}

export function careerFromGames(games, playerId) {
  const totals = { g: 0, ab: 0, h: 0, r: 0, rbi: 0, bb: 0, k: 0, outs: 0 }
  for (const game of games || []) {
    const lines = game?.result?.lines
    if (!Array.isArray(lines)) continue
    let played = false
    for (const row of lines) {
      if (!sameKid(row?.player_id, playerId)) continue
      played = true
      for (const key of COUNTING) {
        const n = row?.[key]
        if (Number.isInteger(n) && n > 0) totals[key] += n
      }
    }
    if (played) totals.g += 1
  }
  return totals.g ? totals : null
}

export function slashLine(value) {
  if (!Number.isFinite(value)) return '-'
  const text = value.toFixed(3)
  return text.startsWith('0.') ? text.slice(1) : text
}

export function battingAverage(hits, atBats) {
  if (!atBats) return '-'
  return slashLine(hits / atBats)
}

export function onBaseAverage(hits, walks, atBats) {
  const chances = atBats + walks
  if (!chances) return '-'
  return slashLine((hits + walks) / chances)
}

export function inningsPitched(outs) {
  const n = Number.isInteger(outs) && outs > 0 ? outs : 0
  if (!n) return ''
  const full = Math.floor(n / 3)
  const rest = n % 3
  return rest ? `${full}.${rest}` : String(full)
}

export const NO_GAMES_YET = 'HAS NOT PLAYED ANY GAMES YET'
export const GAMES_DID_NOT_LOAD = 'THE GAMES DID NOT LOAD'

export function careerRows(totals) {
  if (!totals) return []
  const rows = [
    ['G', totals.g],
    ['AB', totals.ab],
    ['H', totals.h],
    ['R', totals.r],
    ['RBI', totals.rbi],
    ['BB', totals.bb],
    ['K', totals.k],
    ['AVG', battingAverage(totals.h, totals.ab)],
    ['OBP', onBaseAverage(totals.h, totals.bb, totals.ab)],
  ]
  const pitched = inningsPitched(totals.outs)
  if (pitched) rows.push(['IP', pitched])
  return rows.map(([label, value]) => ({ label, value: String(value) }))
}

function factRow(label, value) {
  const row = document.createElement('p')
  row.className = 'fact'
  const name = document.createElement('span')
  name.className = 'fact-label'
  name.textContent = label
  const number = document.createElement('span')
  number.textContent = value
  row.append(name, number)
  return row
}

export function kidDetailBody({ stats, sex, perk, help, position, played, playedFailed }) {
  const body = document.createElement('div')
  body.className = 'kid-detail'
  const word = sexWord(sex)
  if (word) {
    const line = document.createElement('p')
    line.textContent = word
    body.append(line)
  }
  const brought = perkDetail(perk, help)
  if (brought) {
    const line = document.createElement('p')
    line.textContent = brought
    body.append(line)
  }
  if (playedFailed) {
    const line = document.createElement('p')
    line.className = 'alert'
    line.textContent = GAMES_DID_NOT_LOAD
    body.append(line)
  } else if (!played) {
    const line = document.createElement('p')
    line.textContent = NO_GAMES_YET
    body.append(line)
  } else {
    const list = document.createElement('div')
    list.className = 'facts'
    for (const row of careerRows(played)) list.append(factRow(row.label, row.value))
    body.append(list)
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

export function showKidPopup({ id, name, stats, sex, perk, help, homeHelp, position, games, gamesFailed, onClose }) {
  const title = name || 'KID'
  const helped = Boolean(homeHelp)
  const playedFailed = Boolean(gamesFailed)
  const played = playedFailed ? null : careerFromGames(games, id)
  const body = () => kidDetailBody({ stats, sex, perk, help, position, played, playedFailed })
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
