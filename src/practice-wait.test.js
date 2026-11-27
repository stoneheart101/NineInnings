import assert from 'node:assert/strict'
import test from 'node:test'
import { dayLabel } from './forecast.js'
import { neighborhoodPlayLabel, practiceGate, practiceRate, practiceWaitLabel } from './practice-wait.js'

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

test('the neighborhood link names the practice rate', () => {
  assert.equal(practiceRate(1), '1 PER DAY')
  assert.equal(practiceRate(2), '1 PER 2 DAYS')
  assert.equal(practiceRate(0), '')
  assert.equal(neighborhoodPlayLabel(1), 'PLAY A GAME VS THE NEIGHBORHOOD RABBLE (1 PER DAY)')
  assert.equal(neighborhoodPlayLabel(3), 'PLAY A GAME VS THE NEIGHBORHOOD RABBLE (1 PER 3 DAYS)')
  assert.equal(neighborhoodPlayLabel(null), 'PLAY A GAME VS THE NEIGHBORHOOD RABBLE')
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
