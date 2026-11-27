import assert from 'node:assert/strict'
import test from 'node:test'
import {
  gameIsFinal,
  listChanges,
  listPendingChanges,
  listReadyChanges,
  matchupChanges,
  seasonChanges,
  seasonPendingChanges,
  seasonReadyChanges,
} from './live.js'

test('an open season listens for the tables another coach can change', () => {
  const tables = seasonChanges('season-1').map((row) => `${row.table}:${row.filter}`)
  assert.deepEqual(tables, [
    'seasons:id=eq.season-1',
    'teams:season_id=eq.season-1',
    'players:season_id=eq.season-1',
    'draft_state:season_id=eq.season-1',
    'games:season_id=eq.season-1',
    'standings:season_id=eq.season-1',
  ])
  assert.deepEqual(seasonReadyChanges('season-1').map((row) => row.table), ['players', 'draft_state'])
  const pending = seasonPendingChanges('season-1').map((row) => row.table)
  assert.deepEqual(pending, ['seasons', 'teams', 'games', 'standings'])
  assert.equal(pending.includes('players'), false)
})

test('a matchup listens for the lock and stops when the game is final', () => {
  assert.deepEqual(matchupChanges('game-1').map((row) => row.table), ['games', 'lineup_locks'])
  assert.equal(matchupChanges('game-1')[1].filter, 'game_id=eq.game-1')
  assert.equal(JSON.stringify(matchupChanges('game-1')).includes('card'), false)
  assert.equal(gameIsFinal({ status: 'scheduled', result: null }), false)
  assert.equal(gameIsFinal({ status: 'final', result: { winner: 'home' } }), true)
  assert.equal(gameIsFinal({ status: 'scheduled', result: { winner: 'tie' } }), true)
})

test('the season list listens for a season appearing or changing', () => {
  assert.deepEqual(listChanges().map((row) => row.table), ['seasons', 'draft_state'])
  assert.deepEqual(listReadyChanges().map((row) => row.table), ['draft_state'])
  assert.deepEqual(listPendingChanges().map((row) => row.table), ['seasons'])
})
