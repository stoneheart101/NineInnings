import assert from 'node:assert/strict'
import test from 'node:test'
import { rankStandings } from './standings.js'

test('wins come first, then reputation', () => {
  const rows = rankStandings([
    { team_id: 'b', name: 'BEARS', wins: 1, losses: 0, reputation: 20 },
    { team_id: 'a', name: 'ACES', wins: 3, losses: 0, reputation: 4 },
    { team_id: 'c', name: 'CUBS', wins: 3, losses: 4, reputation: 9 },
    { team_id: 'd', name: 'DOGS', wins: 1, losses: 2, reputation: 20 },
  ])
  assert.deepEqual(rows.map((row) => row.name), ['CUBS', 'ACES', 'BEARS', 'DOGS'])
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3, 4])
  assert.equal(rows[0].losses, 4)
  assert.equal(rows[2].reputation, 20)
  assert.equal(rows[0].bottlecaps, 0)
})

test('bottlecaps ride along and do not change the order', () => {
  const rows = rankStandings([
    { team_id: 'a', name: 'ACES', wins: 1, losses: 0, reputation: 4, bottlecaps: 90 },
    { team_id: 'b', name: 'BEARS', wins: 3, losses: 1, reputation: 2, bottlecaps: 1 },
  ])
  assert.deepEqual(rows.map((row) => row.name), ['BEARS', 'ACES'])
  assert.equal(rows[0].bottlecaps, 1)
  assert.equal(rows[1].bottlecaps, 90)
})

test('a blank list and a row with no team stay empty', () => {
  assert.deepEqual(rankStandings(null), [])
  assert.deepEqual(rankStandings([{ name: 'GHOST', wins: 4 }]), [])
})
