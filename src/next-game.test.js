import assert from 'node:assert/strict'
import test from 'node:test'
import { lockStatus, nextOfficial } from './next-game.js'

const MINE = 'mine'
const OTHER = 'other'
const teams = [{ id: OTHER, name: 'WEST SIDE' }]

test('the next game is the earliest scheduled official game for this team', () => {
  const games = [
    { id: 'later', home_team_id: MINE, away_team_id: OTHER, starts_at: '2026-11-30T20:00:00Z', status: 'scheduled', is_practice: false },
    { id: 'practice', home_team_id: MINE, away_team_id: OTHER, starts_at: '2026-11-20T20:00:00Z', status: 'scheduled', is_practice: true },
    { id: 'final', home_team_id: MINE, away_team_id: OTHER, starts_at: '2026-11-18T20:00:00Z', status: 'final', is_practice: false },
    { id: 'soon', home_team_id: OTHER, away_team_id: MINE, starts_at: '2026-11-25T20:00:00Z', status: 'scheduled', is_practice: false },
    { id: 'stranger', home_team_id: 'a', away_team_id: 'b', starts_at: '2026-11-19T20:00:00Z', status: 'scheduled', is_practice: false },
  ]
  const next = nextOfficial(games, MINE, teams)
  assert.equal(next.id, 'soon')
  assert.equal(next.opponent, 'WEST SIDE')
})

test('a coach with no team in this season has no next game', () => {
  const games = [
    { id: 'soon', home_team_id: OTHER, away_team_id: 'b', starts_at: '2026-11-25T20:00:00Z', status: 'scheduled', is_practice: false },
  ]
  assert.equal(nextOfficial(games, '', teams), null)
  assert.equal(nextOfficial([], MINE, teams), null)
})

test('the next game says who still has to lock', () => {
  assert.equal(lockStatus({ locked: false, foeLocked: false }), 'YOU HAVE NOT LOCKED')
  assert.equal(lockStatus({ locked: false, foeLocked: true }), 'YOU HAVE NOT LOCKED')
  assert.equal(lockStatus({ locked: true, foeLocked: false }), 'WAITING ON THE OTHER COACH')
  assert.equal(lockStatus({ locked: true, foeLocked: true }), '')
  assert.equal(lockStatus({ locked: false, foeLocked: false, known: false }), '')
})

test('a hidden opponent is still named TEAM', () => {
  const games = [
    { id: 'soon', home_team_id: MINE, away_team_id: 'hidden', starts_at: '2026-11-25T20:00:00Z', status: 'scheduled', is_practice: false },
  ]
  assert.equal(nextOfficial(games, MINE, teams).opponent, 'TEAM')
})
