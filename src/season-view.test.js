import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardShows, showRecruitingTab } from './season-view.js'

test('setup hides the game cards through the draft and a finished draft', () => {
  for (const status of ['forming', 'drafting']) {
    assert.deepEqual(dashboardShows({ status, hasTeam: true }), {
      setup: true,
      next: false,
      play: false,
      played: false,
      outside: false,
    })
  }
})

test('a joined active season shows games and the board', () => {
  assert.deepEqual(dashboardShows({ status: 'active', hasTeam: true }), {
    setup: false,
    next: true,
    play: true,
    played: true,
    outside: false,
  })
  assert.equal(showRecruitingTab({ hasTeam: true, hasRecruits: true }), true)
  assert.equal(showRecruitingTab({ hasTeam: true, hasRecruits: false }), false)
})

test('a season you have not joined hides recruits and games', () => {
  assert.deepEqual(dashboardShows({ status: 'active', hasTeam: false }), {
    setup: false,
    next: false,
    play: false,
    played: false,
    outside: true,
  })
  assert.equal(showRecruitingTab({ hasTeam: false, hasRecruits: true }), false)
})
