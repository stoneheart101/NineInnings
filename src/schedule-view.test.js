import assert from 'node:assert/strict'
import test from 'node:test'
import { gameOpens, nextScheduleView, scheduleDays } from './schedule-view.js'

const teams = [
  { id: 'mine', name: 'MINE' },
  { id: 'east', name: 'EAST' },
  { id: 'west', name: 'WEST' },
]

const games = [
  { id: 'mine-game', home_team_id: 'mine', away_team_id: 'east', starts_at: '2026-11-24T18:00:00Z', is_practice: false },
  { id: 'other-game', home_team_id: 'west', away_team_id: 'east', starts_at: '2026-11-25T18:00:00Z', is_practice: false },
  { id: 'practice', home_team_id: 'mine', away_team_id: 'east', starts_at: '2026-11-24T12:00:00Z', is_practice: true },
]

function dayKey(when) {
  return when.toISOString().slice(0, 10)
}

test('my games is a filter, and picking it again returns to all games', () => {
  assert.equal(nextScheduleView('all', 'mine'), 'mine')
  assert.equal(nextScheduleView('mine', 'mine'), 'all')
  assert.equal(nextScheduleView('mine', 'all'), 'all')
  assert.equal(nextScheduleView('all', 'all'), 'all')
})

test('open stays on a game this coach is in', () => {
  assert.equal(gameOpens(games[0], 'mine'), true)
  assert.equal(gameOpens(games[1], 'mine'), false)
  assert.equal(gameOpens(games[1], ''), false)
})

test('all games keeps every official card, and my games keeps this coach', () => {
  const all = scheduleDays({ games, teams, teamId: 'mine', view: 'all', dayKey })
  assert.deepEqual(all.map((day) => day.games.map((game) => game.id)), [['mine-game'], ['other-game']])
  assert.deepEqual(all.map((day) => day.byes.map((team) => team.id)), [['west'], ['mine']])

  const mine = scheduleDays({ games, teams, teamId: 'mine', view: 'mine', dayKey })
  assert.deepEqual(mine.map((day) => day.games.map((game) => game.id)), [['mine-game'], []])
  assert.deepEqual(mine.map((day) => day.byes.map((team) => team.id)), [[], ['mine']])
})
