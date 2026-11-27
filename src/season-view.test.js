import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardShows, seasonSubtabs, showRecruitingTab } from './season-view.js'

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

test('schedule sits to the left of details', () => {
  assert.deepEqual(
    seasonSubtabs({ pool: true, recruiting: true }).map((tab) => tab[0]),
    ['pool', 'recruiting', 'schedule', 'details'],
  )
  assert.deepEqual(
    seasonSubtabs({ drafting: true, pool: true, recruiting: true }).map((tab) => tab[0]),
    ['pool', 'recruiting', 'draft', 'details'],
  )
  assert.deepEqual(
    seasonSubtabs({ forming: true, pool: true, recruiting: true }).map((tab) => tab[0]),
    ['pool', 'recruiting', 'details'],
  )
  assert.deepEqual(seasonSubtabs({}).map((tab) => tab[1]), ['SCHEDULE', 'DETAILS'])
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
