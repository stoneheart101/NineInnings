import assert from 'node:assert/strict'
import test from 'node:test'
import { dayLabel } from './forecast.js'
import { practiceGate, practiceWaitLabel } from './practice-wait.js'

const NOW = Date.parse('2026-11-23T18:00:00.000Z')

test('the wait names the next local day', () => {
  const when = new Date('2026-11-25T15:00:00.000Z')
  assert.equal(practiceWaitLabel(when), `PRACTICE AGAIN ${dayLabel(when)}`)
})

test('practice stays shut until the season is active', () => {
  const gate = practiceGate({ status: 'forming', everyDays: 2, lastPractice: null, now: NOW })
  assert.equal(gate.open, false)
  assert.equal(gate.note, 'PRACTICE STARTS WHEN THE SEASON DOES')
})

test('the first practice in an active season is open', () => {
  const gate = practiceGate({ status: 'active', everyDays: 2, lastPractice: null, now: NOW })
  assert.equal(gate.open, true)
  assert.equal(gate.note, '')
})

test('a second practice inside the gap waits', () => {
  const gate = practiceGate({
    status: 'active',
    everyDays: 2,
    lastPractice: '2026-11-23T15:00:00.000Z',
    now: NOW,
  })
  assert.equal(gate.open, false)
  const ready = new Date(Date.parse('2026-11-23T15:00:00.000Z') + 2 * 24 * 60 * 60 * 1000)
  assert.equal(gate.note, `PRACTICE AGAIN ${dayLabel(ready)}`)
})

test('a practice after the gap is open', () => {
  const gate = practiceGate({
    status: 'active',
    everyDays: 2,
    lastPractice: '2026-11-20T15:00:00.000Z',
    now: NOW,
  })
  assert.equal(gate.open, true)
  assert.equal(gate.note, '')
})
