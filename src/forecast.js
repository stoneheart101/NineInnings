const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function dayLabel(when) {
  return `${DAYS[when.getUTCDay()]} ${MONTHS[when.getUTCMonth()]} ${when.getUTCDate()}`
}

export function forecastSentence(game) {
  const sentence = game?.weather?.sentence
  if (typeof sentence !== 'string') return 'THE FORECAST IS NOT HERE'
  const line = sentence.trim().toUpperCase()
  return line || 'THE FORECAST IS NOT HERE'
}

export function forecastChances(game) {
  const chances = game?.weather?.chances
  if (!Array.isArray(chances)) return ''
  const ranked = []
  chances.forEach((row, index) => {
    const type = typeof row?.type === 'string' ? row.type.trim().toUpperCase() : ''
    const percent = Number(row?.percent)
    if (!type || !Number.isInteger(percent) || percent < 10) return
    ranked.push({ type, percent, index })
  })
  ranked.sort((left, right) => right.percent - left.percent || left.index - right.index)
  if (!ranked.length) return ''
  return ranked.map((row) => `${row.type} ${row.percent}%`).join(' · ')
}

export function forecastLine(game) {
  return forecastChances(game) || forecastSentence(game)
}

export function forecastShown(when, now = new Date()) {
  const day = Math.floor(when.getTime() / 86400000)
  const today = Math.floor(now.getTime() / 86400000)
  return day - today <= 10
}
