import assert from 'node:assert/strict'
import test from 'node:test'
import { actualLine, clockLabel, clockLabel12, dayKey, dayLabel, forecastLine, forecastReport, weatherReport } from './forecast.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

test('the day and the clock use the local zone', () => {
  const when = new Date('2026-11-24T23:30:00.000Z')
  assert.equal(dayLabel(when), `${DAYS[when.getDay()]} ${MONTHS[when.getMonth()]} ${when.getDate()}`)
  assert.equal(clockLabel(when).includes('UTC'), false)
})

test('every clock is the local 12 hour time', () => {
  const afternoon = new Date(2026, 10, 24, 15, 5)
  const morning = new Date(2026, 10, 24, 9, 7)
  const midnight = new Date(2026, 10, 24, 0, 0)
  const noon = new Date(2026, 10, 24, 12, 0)
  for (const when of [afternoon, morning, midnight, noon]) {
    assert.equal(clockLabel(when), clockLabel12(when))
  }
  assert.equal(clockLabel(afternoon).includes('PM'), true)
  assert.equal(clockLabel(morning).includes('AM'), true)
  assert.equal(/ \d{2}:\d{2}$/.test(clockLabel(afternoon)), false)
})

test('a played clock uses the local 12 hour time', () => {
  const afternoon = new Date(2026, 10, 24, 15, 5)
  const morning = new Date(2026, 10, 24, 9, 7)
  const midnight = new Date(2026, 10, 24, 0, 0)
  const noon = new Date(2026, 10, 24, 12, 0)
  assert.equal(clockLabel12(afternoon), `${dayLabel(afternoon)} · 3:05 PM`)
  assert.equal(clockLabel12(morning), `${dayLabel(morning)} · 9:07 AM`)
  assert.equal(clockLabel12(midnight), `${dayLabel(midnight)} · 12:00 AM`)
  assert.equal(clockLabel12(noon), `${dayLabel(noon)} · 12:00 PM`)
})

test('the schedule groups a game by the local calendar day', () => {
  const when = new Date(2026, 10, 24, 18, 5, 0)
  assert.equal(dayKey(when), '2026-11-24')
})

const called = {
  weather: {
    forecast: {
      report: 'From the weather desk. This one looks mostly cloudy and cool, about 58 degrees, with a light breeze blowing in.',
    },
    opening: {
      report: 'Live from the park. Mostly cloudy and cool, 54 degrees, with a light breeze blowing in. It is a little cooler than we called.',
    },
    shift: {
      inning: 4,
      half: 'top',
      report: 'We break in from the top of the fourth. A light rain has started. 54 degrees, with a light breeze blowing in.',
    },
  },
}

const played = {
  weather: {
    sky: 'heavy_rain',
    wind: 'cross',
    heat: 'cold',
    sentence: 'Heavy rain, crosswind, and cold',
    chances: [
      { type: 'CLEAR', percent: 100 },
      { type: 'LIGHT RAIN', percent: 14 },
      { type: 'COLD', percent: 11 },
    ],
  },
}

test('a future game reads the stored forecast as a desk report', () => {
  const line = forecastReport(called)
  assert.equal(line, 'FROM THE WEATHER DESK. THIS ONE LOOKS MOSTLY CLOUDY AND COOL, ABOUT 58 DEGREES, WITH A LIGHT BREEZE BLOWING IN.')
  assert.equal(line.includes('%'), false)
  assert.equal(forecastReport({}), '')
  assert.equal(forecastReport({ weather: { forecast: { report: '  ' } } }), '')
})

test('a played game reads the park report and a top or bottom break-in', () => {
  const line = weatherReport(called)
  assert.equal(line.includes('LIVE FROM THE PARK'), true)
  assert.equal(line.includes('WE BREAK IN FROM THE TOP OF THE FOURTH'), true)
  assert.equal(line.includes('%'), false)
  assert.equal(weatherReport({
    weather: {
      opening: { report: 'Live from the park. Clear and mild, 68 degrees, and the air is still.' },
      shift: null,
    },
  }), 'LIVE FROM THE PARK. CLEAR AND MILD, 68 DEGREES, AND THE AIR IS STILL.')
})

test('a game already played reads a desk report from the stored sky, wind, and heat', () => {
  const line = weatherReport(played)
  assert.equal(line, 'LIVE FROM THE PARK. HEAVY RAIN AND COLD, WITH A STEADY WIND ACROSS THE DIAMOND.')
  assert.equal(line.includes('%'), false)
  assert.equal(line.includes('CLEAR'), false)
  assert.equal(weatherReport({ weather: { sentence: '  ' } }), '')
  assert.equal(weatherReport({}), '')
})

test('a review names the forecast and the park report apart', () => {
  assert.equal(forecastLine(called), forecastReport(called))
  assert.equal(actualLine(called), weatherReport(called))
  assert.equal(forecastLine(played), '')
  assert.equal(actualLine(played), weatherReport(played))
  assert.equal(forecastLine({}), '')
  assert.equal(actualLine({}), '')
})
