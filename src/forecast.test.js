import assert from 'node:assert/strict'
import test from 'node:test'
import { clockLabel, dayKey, dayLabel } from './forecast.js'

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

test('the schedule groups a game by the local calendar day', () => {
  const when = new Date(2026, 10, 24, 18, 5, 0)
  assert.equal(dayKey(when), '2026-11-24')
})
