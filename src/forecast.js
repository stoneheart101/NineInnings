const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function dayLabel(when) {
  return `${DAYS[when.getDay()]} ${MONTHS[when.getMonth()]} ${when.getDate()}`
}

export function dayKey(when) {
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const date = String(when.getDate()).padStart(2, '0')
  return `${when.getFullYear()}-${month}-${date}`
}

export function clockLabel(when) {
  return clockLabel12(when)
}

export function clockLabel12(when) {
  const raw = when.getHours()
  const suffix = raw < 12 ? 'AM' : 'PM'
  const hour = raw % 12 || 12
  const minutes = String(when.getMinutes()).padStart(2, '0')
  return `${dayLabel(when)} · ${hour}:${minutes} ${suffix}`
}

function rankedChances(game) {
  const chances = game?.weather?.chances
  if (!Array.isArray(chances)) return []
  const ranked = []
  chances.forEach((row, index) => {
    const type = typeof row?.type === 'string' ? row.type.trim().toUpperCase() : ''
    const percent = Number(row?.percent)
    if (!type || !Number.isInteger(percent) || percent < 10) return
    ranked.push({ type, percent, index })
  })
  ranked.sort((left, right) => right.percent - left.percent || left.index - right.index)
  return ranked
}

function joinWords(parts) {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} AND ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, AND ${parts[parts.length - 1]}`
}

export function forecastWords(game) {
  return joinWords(rankedChances(game).map((row) => row.type))
}

export function weatherReport(game) {
  const sentence = game?.weather?.sentence
  if (typeof sentence !== 'string') return ''
  return sentence.trim().toUpperCase()
}

export function forecastShown(when, now = new Date()) {
  const day = Math.floor(when.getTime() / 86400000)
  const today = Math.floor(now.getTime() / 86400000)
  return day - today <= 10
}
