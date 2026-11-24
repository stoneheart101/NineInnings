import assert from 'node:assert/strict'
import test from 'node:test'
import { clockLabel, clockLabel12, dayKey, dayLabel } from './forecast.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

test('the day and the clock use the local zone', () => {
  const when = new Date('2026-11-24T23:30:00.000Z')
  const hours = String(when.getHours()).padStart(2, '0')
  const minutes = String(when.getMinutes()).padStart(2, '0')
  assert.equal(dayLabel(when), `${DAYS[when.getDay()]} ${MONTHS[when.getMonth()]} ${when.getDate()}`)
  assert.equal(clockLabel(when), `${dayLabel(when)} · ${hours}:${minutes}`)
  assert.equal(clockLabel(when).includes('UTC'), false)
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
