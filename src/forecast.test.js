import assert from 'node:assert/strict'
import test from 'node:test'
import { actualLine, clockLabel, clockLabel12, dayKey, dayLabel, forecastLine, forecastShown, forecastWords, weatherReport } from './forecast.js'

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

const sample = {
  weather: {
    sentence: 'Light rain and wind in',
    chances: [
      { type: 'CLEAR', percent: 40 },
      { type: 'LIGHT RAIN', percent: 70 },
      { type: 'FOG', percent: 9 },
      { type: 'WIND IN', percent: 70 },
      { type: 'HOT AND HUMID', percent: 15 },
    ],
  },
}

test('an upcoming forecast is words, highest chance first, with no percents', () => {
  const line = forecastWords(sample)
  assert.equal(line, 'LIGHT RAIN, WIND IN, CLEAR, AND HOT AND HUMID')
  assert.equal(line.includes('%'), false)
  assert.equal(forecastWords({ weather: { chances: [{ type: 'fog', percent: 10 }] } }), 'FOG')
  assert.equal(forecastWords({ weather: { chances: [{ type: 'FOG', percent: 9 }] } }), '')
  assert.equal(forecastWords({ weather: { chances: [{ type: 'COLD', percent: 12 }, { type: 'CLEAR', percent: 80 }] } }), 'CLEAR AND COLD')
  assert.equal(forecastWords({}), '')
})

test('a finished game reads the stored weather sentence', () => {
  assert.equal(weatherReport(sample), 'LIGHT RAIN AND WIND IN')
  assert.equal(weatherReport(sample).includes('%'), false)
  assert.equal(weatherReport({ weather: { sentence: '  ' } }), '')
  assert.equal(weatherReport({ weather: { chances: sample.weather.chances } }), '')
  assert.equal(weatherReport({}), '')
})

test('a review names the forecast and the actual weather apart', () => {
  assert.equal(forecastLine(sample), 'FORECAST · LIGHT RAIN, WIND IN, CLEAR, AND HOT AND HUMID')
  assert.equal(actualLine(sample), 'ACTUAL · LIGHT RAIN AND WIND IN')
  assert.equal(forecastLine({}), '')
  assert.equal(actualLine({}), '')
  assert.equal(forecastLine({ weather: { sentence: 'Clear' } }), '')
  assert.equal(actualLine({ weather: { chances: sample.weather.chances } }), '')
})

test('a forecast shows through the tenth day and stays off after that', () => {
  const now = new Date('2026-11-27T15:00:00.000Z')
  assert.equal(forecastShown(new Date('2026-12-07T15:00:00.000Z'), now), true)
  assert.equal(forecastShown(new Date('2026-12-08T15:00:00.000Z'), now), false)
})
