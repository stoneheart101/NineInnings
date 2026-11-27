import assert from 'node:assert/strict'
import test from 'node:test'
import { coachesWaiting, compareRecruits, leaveLabel, tryoutWaitLine } from './recruit-board.js'

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

test('a coach who has not bid can pass, and a leader has no leave button', () => {
  assert.equal(leaveLabel({ inBid: false, leading: false }), 'PASS')
  assert.equal(leaveLabel({ inBid: true, leading: true }), '')
  assert.equal(leaveLabel({ inBid: true, leading: false }), 'STOP BIDDING')
})

test('a tryout waits on the coaches who have not chosen', () => {
  const teams = ['west', 'east', 'south']
  const passes = [
    { player_id: 'kid', team_id: 'west', choice: 'tryout' },
    { player_id: 'other', team_id: 'east', choice: 'pass' },
  ]
  assert.equal(coachesWaiting(teams, passes, 'kid'), 2)
  assert.equal(tryoutWaitLine(2), 'TRYOUT IS WAITING FOR 2 COACHES')
  assert.equal(tryoutWaitLine(1), 'TRYOUT IS WAITING FOR 1 COACH')
})
