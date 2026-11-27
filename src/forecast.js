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

function clean(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toUpperCase()
}

function skyWords(sky) {
  if (sky === 'clear') return 'CLEAR'
  if (sky === 'partly') return 'PARTLY CLOUDY'
  if (sky === 'cloudy') return 'MOSTLY CLOUDY'
  if (sky === 'light_rain') return 'LIGHT RAIN'
  if (sky === 'heavy_rain') return 'HEAVY RAIN'
  if (sky === 'fog') return 'FOG'
  return ''
}

function heatWords(heat) {
  if (heat === 'cold') return 'COLD'
  if (heat === 'cool') return 'COOL'
  if (heat === 'mild') return 'MILD'
  if (heat === 'warm') return 'WARM'
  if (heat === 'hot') return 'HOT'
  return ''
}

function windWords(wind, speed) {
  if (wind === 'calm' || !wind) return 'AND THE AIR IS STILL'
  const breeze = speed === 'breeze'
  const kind = breeze ? 'A LIGHT BREEZE' : 'A STEADY WIND'
  if (wind === 'in') return `WITH ${kind} BLOWING IN`
  if (wind === 'out') return `WITH ${kind} BLOWING OUT`
  if (wind === 'cross') return `WITH ${kind} ACROSS THE DIAMOND`
  return ''
}

function legacyDesk(weather) {
  if (!weather || typeof weather !== 'object') return ''
  const sky = skyWords(weather.sky)
  const heat = heatWords(weather.heat)
  const wind = windWords(weather.wind, weather.wind_speed)
  if (!sky || !heat || !wind) return clean(weather.sentence)
  return `LIVE FROM THE PARK. ${sky} AND ${heat}, ${wind}.`
}

export function forecastReport(game) {
  return clean(game?.weather?.forecast?.report)
}

export function weatherReport(game) {
  const opening = clean(game?.weather?.opening?.report)
  if (opening) {
    const shift = clean(game?.weather?.shift?.report)
    return shift ? `${opening} ${shift}` : opening
  }
  return legacyDesk(game?.weather)
}

export function forecastLine(game) {
  return forecastReport(game)
}

export function actualLine(game) {
  return weatherReport(game)
}
