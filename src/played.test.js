import assert from 'node:assert/strict'
import test from 'node:test'
import { gameKind, narrativeLead, playedGames, playedScore } from './played.js'

test('a played game is named by kind', () => {
  assert.equal(gameKind({ dev: true, is_practice: true }), 'DEV')
  assert.equal(gameKind({ dev: false, is_practice: true }), 'PRACTICE')
  assert.equal(gameKind({ dev: false, is_practice: false }), 'OFFICIAL')
  assert.equal(gameKind({}), 'OFFICIAL')
})

test('the score line is away to home', () => {
  assert.equal(playedScore({ result: { away: { runs: 1 }, home: { runs: 0 } } }), '1 TO 0')
  assert.equal(playedScore({ result: { away: { runs: 4 } } }), '')
  assert.equal(playedScore(null), '')
})

test('the summary lead is the first paragraph', () => {
  assert.equal(narrativeLead('ONE LINE.\n\nTWO.'), 'ONE LINE.')
  assert.equal(narrativeLead('   '), '')
  assert.equal(narrativeLead(null), '')
})

test('history keeps finals and puts the newest first', () => {
  const games = playedGames([
    { id: 'a', status: 'scheduled', starts_at: '2026-11-24T23:00:00Z' },
    { id: 'b', status: 'final', starts_at: '2026-11-20T23:00:00Z' },
    { id: 'c', status: 'final', starts_at: '2026-11-22T23:00:00Z' },
    { id: 'd', status: 'final', starts_at: '2026-11-22T23:00:00Z' },
  ])
  assert.deepEqual(games.map((game) => game.id), ['d', 'c', 'b'])
})
