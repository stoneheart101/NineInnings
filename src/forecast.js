const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function dayLabel(when) {
  return `${DAYS[when.getUTCDay()]} ${MONTHS[when.getUTCMonth()]} ${when.getUTCDate()}`
}

function forecastSentence(game) {
  const sentence = game?.weather?.sentence
  if (typeof sentence !== 'string') return 'THE FORECAST IS NOT HERE'
  const line = sentence.trim().toUpperCase()
  return line || 'THE FORECAST IS NOT HERE'
}

export function forecastLine(game) {
  const chances = game?.weather?.chances
  if (Array.isArray(chances)) {
    const parts = []
    for (const row of chances) {
      const type = typeof row?.type === 'string' ? row.type.trim().toUpperCase() : ''
      const percent = Number(row?.percent)
      if (!type || !Number.isInteger(percent) || percent < 10) continue
      parts.push(`${type} ${percent}%`)
    }
    if (parts.length) return parts.join(' · ')
  }
  return forecastSentence(game)
}

export function forecastShown(when, now = new Date()) {
  const day = Math.floor(when.getTime() / 86400000)
  const today = Math.floor(now.getTime() / 86400000)
  return day - today <= 10
}
