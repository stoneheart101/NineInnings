const STOPS = [
  [20, [214, 69, 69]],
  [40, [224, 122, 34]],
  [60, [224, 198, 58]],
  [80, [62, 168, 90]],
]

export function statColor(value) {
  const raw = Number(value)
  const n = Number.isFinite(raw) ? Math.max(20, Math.min(80, raw)) : 20
  let index = 1
  while (index < STOPS.length - 1 && n > STOPS[index][0]) index += 1
  const [leftAt, left] = STOPS[index - 1]
  const [rightAt, right] = STOPS[index]
  const span = rightAt - leftAt
  const t = span === 0 ? 0 : (n - leftAt) / span
  const rgb = left.map((channel, channelIndex) => Math.round(channel + (right[channelIndex] - channel) * t))
  return `rgb(${rgb.join(' ')})`
}

export function statChip(label, value) {
  const chip = document.createElement('span')
  chip.className = 'kid-stat'
  chip.append(document.createTextNode(`${label} `))
  const num = document.createElement('span')
  num.className = 'stat-num'
  if (Number.isInteger(value)) {
    num.textContent = String(value)
    num.style.color = statColor(value)
  } else {
    num.textContent = '-'
  }
  chip.append(num)
  return chip
}
