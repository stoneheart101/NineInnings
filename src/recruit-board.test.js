import assert from 'node:assert/strict'
import test from 'node:test'
import { compareRecruits } from './recruit-board.js'

test('open bids sit above available kids, then tryouts, then a pass', () => {
  const kids = [
    { id: 'pass', offer: 'price', bidOpen: true, passed: true, created_at: '2026-11-03T00:00:00Z' },
    { id: 'tryout', offer: 'tryout', bidOpen: false, passed: false, created_at: '2026-11-04T00:00:00Z' },
    { id: 'open', offer: 'price', bidOpen: false, passed: false, created_at: '2026-11-02T00:00:00Z' },
    { id: 'bid', offer: 'price', bidOpen: true, passed: false, created_at: '2026-11-01T00:00:00Z' },
  ]
  const ordered = kids.slice().sort(compareRecruits).map((kid) => kid.id)
  assert.deepEqual(ordered, ['bid', 'open', 'tryout', 'pass'])
})

test('the same group keeps the newer kid first', () => {
  const older = { id: 'a', offer: 'price', bidOpen: false, passed: false, created_at: '2026-11-01T00:00:00Z' }
  const newer = { id: 'b', offer: 'price', bidOpen: false, passed: false, created_at: '2026-11-02T00:00:00Z' }
  assert.deepEqual([older, newer].slice().sort(compareRecruits).map((kid) => kid.id), ['b', 'a'])
})
