import { usedGroups } from './box.js'
import { forecastReport } from './forecast.js'
import { perkById } from './home-perk.js'

const INNING_NAME = [
  '',
  'FIRST',
  'SECOND',
  'THIRD',
  'FOURTH',
  'FIFTH',
  'SIXTH',
  'SEVENTH',
  'EIGHTH',
  'NINTH',
  'TENTH',
  'ELEVENTH',
  'TWELFTH',
]

const ITEM_BLURB = {
  'EXTRA BASEBALLS': 'A SPARE BALL STAYS IN THE BAG SO PLAY DOES NOT STOP FOR A LOST ONE.',
  'ICE POPS': 'THE KIDS HOLD THEIR STAMINA THROUGH THE HEAT.',
  'BORROWED GLOVES': 'THE FIELDERS GET A SURE HAND ON THE BALL.',
  'TARP AND CHALK': 'WET DIRT DOES NOT SWALLOW THE HOPS OR THE LINES.',
  'METAL BAT': 'ONE LINEUP SPOT GETS A LITTLE MORE POP.',
}

function clean(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function sentences(report) {
  return clean(report)
    .split(/\.\s+/)
    .map((part) => part.replace(/\.$/, '').trim())
    .filter(Boolean)
}

function air(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function sameAir(left, right) {
  if (!left || !right) return false
  return ['sky', 'heat', 'wind', 'wind_speed', 'temp'].every((key) => String(left[key] ?? '') === String(right[key] ?? ''))
}

function firstPitch(forecast, opening) {
  if (!forecast || !opening || sameAir(forecast, opening)) return ''
  const notes = sentences(opening.report).slice(2).filter((note) => note !== 'IT IS ABOUT WHAT WE CALLED')
  if (notes.length) return `AT FIRST PITCH. ${notes.join('. ')}.`
  return 'AT FIRST PITCH THE AIR IS A LITTLE OFF THE CALL.'
}

function skyPhrase(sky) {
  const word = clean(sky)
  if (word === 'CLEAR') return 'CLEAR'
  if (word === 'PARTLY') return 'PARTLY CLOUDY'
  if (word === 'CLOUDY') return 'MOSTLY CLOUDY'
  if (word === 'LIGHT_RAIN') return 'LIGHT RAIN'
  if (word === 'HEAVY_RAIN') return 'HEAVY RAIN'
  if (word === 'FOG') return 'FOGGY'
  return ''
}

function parkLine(weather) {
  const opening = air(weather?.opening)
  const openingReport = clean(opening?.report)
  if (openingReport) return openingReport
  const sky = skyPhrase(weather?.sky)
  const heat = clean(weather?.heat)
  if (!sky || !heat) return clean(weather?.sentence)
  const wind = clean(weather?.wind)
  if (!wind || wind === 'CALM') return `LIVE FROM THE PARK. ${sky} AND ${heat}, AND THE AIR IS STILL.`
  const breeze = clean(weather?.wind_speed) === 'BREEZE'
  const kind = breeze ? 'A LIGHT BREEZE' : 'A STEADY WIND'
  const way = wind === 'IN' ? 'BLOWING IN' : wind === 'OUT' ? 'BLOWING OUT' : wind === 'CROSS' ? 'ACROSS THE DIAMOND' : ''
  if (!way) return clean(weather?.sentence)
  return `LIVE FROM THE PARK. ${sky} AND ${heat}, WITH ${kind} ${way}.`
}

function joinBits(bits) {
  if (bits.length <= 1) return bits[0] || ''
  if (bits.length === 2) return `${bits[0]} AND ${bits[1]}`
  return `${bits.slice(0, -1).join(', ')}, AND ${bits.at(-1)}`
}

function countWord(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function stickLine(kid) {
  const bits = []
  if (kid.h > 0) bits.push(countWord(kid.h, 'HIT', 'HITS'))
  if (kid.rbi > 0) bits.push(countWord(kid.rbi, 'DRIVEN IN', 'DRIVEN IN'))
  if (kid.r > 0) bits.push(countWord(kid.r, 'RUN', 'RUNS'))
  if (!bits.length) return ''
  return `${kid.name} FINISHES WITH ${joinBits(bits)}.`
}

function standouts(rows) {
  return rows
    .map((row) => ({
      name: clean(row?.name),
      h: Number.isInteger(row?.h) ? row.h : 0,
      rbi: Number.isInteger(row?.rbi) ? row.rbi : 0,
      r: Number.isInteger(row?.r) ? row.r : 0,
      team_id: row?.team_id,
    }))
    .filter((row) => row.name && row.h + row.rbi + row.r > 0)
    .sort((left, right) => (right.h * 3 + right.rbi * 2 + right.r) - (left.h * 3 + left.rbi * 2 + left.r) || right.h - left.h || left.name.localeCompare(right.name))
    .slice(0, 2)
}

function highlightLine(result) {
  const lines = Array.isArray(result?.lines) ? result.lines : []
  const chunks = []
  for (const side of [result?.away, result?.home]) {
    const name = clean(side?.name)
    if (!name || !side?.team_id) continue
    const kids = standouts(lines.filter((row) => row?.team_id === side.team_id)).map(stickLine).filter(Boolean)
    if (kids.length) chunks.push(`FOR ${name}, ${kids.join(' ')}`)
  }
  return chunks.join(' ')
}

function advantageLine(result, used, perkIds) {
  const homeName = clean(result?.home?.name) || 'THE HOME CLUB'
  const bits = []
  for (const id of perkIds || []) {
    const perk = perkById(id)
    if (!perk) continue
    bits.push(`THE HOME ADVANTAGE FOR ${homeName} IS ${perk.label}. ${clean(perk.blurb)}`)
  }
  for (const group of usedGroups(used, result)) {
    const team = clean(group.name) || 'A CLUB'
    for (const item of group.items) {
      const name = clean(item)
      if (!name) continue
      const blurb = ITEM_BLURB[name]
      bits.push(blurb ? `${team} PACKED ${name}. ${blurb}` : `${team} PACKED ${name}.`)
    }
  }
  return bits.join(' ')
}

function eventLine(event) {
  const name = clean(event?.name)
  const tag = event?.tag
  if (tag === 'late_fade') return name ? `${name} LOOKS FLAT IN THE LATE GOING.` : 'SOMEBODY LOOKS FLAT IN THE LATE GOING.'
  if (tag === 'awkward_slide') return name ? `HERE COMES ${name}, AND THE SLIDE ARRIVES IN A TANGLE.` : 'HERE COMES A SLIDE, AND IT ARRIVES IN A TANGLE.'
  if (tag === 'fog_lost') return 'THE FOG TAKES ONE AWAY.'
  if (tag === 'rain_misplay') return 'A WET HOP GETS PAST THE GLOVE.'
  if (tag === 'wind_carried') return name ? `${name} PUTS ONE UP AND THE WIND TAKES IT OUT.` : 'SOMEBODY PUTS ONE UP AND THE WIND TAKES IT OUT.'
  if (tag === 'tryout_spark') return name ? `${name} IS OUT THERE PLAYING FOR A PLACE ON THE CLUB.` : 'A KID IS OUT THERE PLAYING FOR A PLACE ON THE CLUB.'
  if (tag === 'penalty_effort') return name ? `${name} PLAYS IT A LITTLE FLAT.` : 'A KID PLAYS IT A LITTLE FLAT.'
  return ''
}

function shiftNews(shift) {
  const change = sentences(shift?.report)[1]
  if (!change) return ''
  if (/DEGREES/.test(change)) return ''
  return `${change}.`
}

function halfCall(half, inning, mark, team, events, shift) {
  const here = (events || []).filter((event) => Number(event?.inning) === inning && event?.half === half)
  const broke = shift && Number(shift.inning) === inning && shift.half === half
  const runs = Number.isInteger(mark) ? mark : null
  if (runs == null) return ''
  if (!runs && !here.length && !broke) return ''
  const name = INNING_NAME[inning] || String(inning)
  const which = half === 'bottom' ? 'BOTTOM' : 'TOP'
  const bits = [`THE ${which} OF THE ${name}.`]
  if (broke) {
    const news = shiftNews(shift)
    bits.push(news ? `WE BREAK IN. ${news}` : 'WE BREAK IN.')
  }
  if (runs > 0) bits.push(runs === 1 ? `${team} SCORES A RUN.` : `${team} SCORES ${runs} RUNS.`)
  for (const event of here) {
    const line = eventLine(event)
    if (line) bits.push(line)
  }
  return bits.join(' ')
}

function rundown(result, shift) {
  const innings = Array.isArray(result?.innings) ? result.innings : []
  const events = Array.isArray(result?.events) ? result.events : []
  const away = clean(result?.away?.name) || 'THE VISITORS'
  const home = clean(result?.home?.name) || 'THE HOME CLUB'
  const parts = []
  for (const inning of innings) {
    const number = Number(inning?.inning)
    if (!number) continue
    const top = halfCall('top', number, inning.away, away, events, shift)
    const bottom = halfCall('bottom', number, inning.home, home, events, shift)
    const line = [top, bottom].filter(Boolean).join(' ')
    if (line) parts.push(line)
  }
  return parts
}

function callLine(result) {
  const awayRuns = result?.away?.runs
  const homeRuns = result?.home?.runs
  if (!Number.isInteger(awayRuns) || !Number.isInteger(homeRuns)) return ''
  const away = clean(result.away?.name) || 'THE VISITORS'
  const home = clean(result.home?.name) || 'THE HOME CLUB'
  const winner = result?.winner
  if (winner === 'home' || (winner !== 'away' && winner !== 'tie' && homeRuns > awayRuns)) {
    return `AND THAT IS YOUR BALLGAME. ${home} TAKES IT AT HOME, ${homeRuns} TO ${awayRuns}.`
  }
  if (winner === 'away' || (winner !== 'tie' && awayRuns > homeRuns)) {
    return `AND THE VISITORS TAKE THIS ONE HOME. ${away} LEAVES WITH IT, ${awayRuns} TO ${homeRuns}.`
  }
  return `AND WE ARE STILL EVEN, ${awayRuns} TO ${homeRuns}.`
}

export function recapParts(game, extras = {}) {
  const result = game?.result
  if (!result || typeof result !== 'object') return []
  const weather = game?.weather
  const forecast = air(weather?.forecast)
  const opening = air(weather?.opening)
  const shift = air(weather?.shift)
  const parts = []
  const called = forecastReport(game)
  if (called) {
    const note = firstPitch(forecast, opening)
    parts.push(note ? `${called} ${note}` : called)
  } else {
    const park = parkLine(weather)
    if (park) parts.push(park)
  }
  const highlights = highlightLine(result)
  if (highlights) parts.push(highlights)
  const advantages = advantageLine(result, extras.used, extras.perkIds)
  if (advantages) parts.push(advantages)
  parts.push(...rundown(result, shift))
  const close = callLine(result)
  if (close) parts.push(close)
  return parts
}

export function recapClose(game) {
  return callLine(game?.result)
}
