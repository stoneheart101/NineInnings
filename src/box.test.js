import assert from 'node:assert/strict'
import test from 'node:test'
import { boxScore, usedGroups } from './box.js'

const AWAY = 'away-team'
const HOME = 'home-team'

function result() {
  return {
    innings: [
      { inning: 1, away: 0, home: 1 },
      { inning: 9, away: 2, home: null },
    ],
    away: { team_id: AWAY, name: '  VISITORS ', runs: 2, hits: 4, errors: 1 },
    home: { team_id: HOME, name: 'HOME', runs: 1, hits: 3, errors: 0 },
    lines: [
      { team_id: HOME, name: 'Pat', ab: 3, h: 1, r: 1, rbi: 0, bb: 0, k: 1, outs: 0 },
      { team_id: AWAY, name: 'Sam', ab: 4, h: 2, r: 2, rbi: 1, bb: 1, k: 0, outs: 2 },
    ],
  }
}

test('the line score keeps each inning and the totals', () => {
  const box = boxScore(result())
  assert.deepEqual(box.innings, [1, 9])
  assert.deepEqual(box.sides[0], { name: 'VISITORS', marks: ['0', '2'], runs: 2, hits: 4, errors: 1 })
  assert.equal(box.sides[1].marks[1], 'x')
  assert.deepEqual(box.groups.map((group) => group.name), ['VISITORS', 'HOME'])
  assert.deepEqual(box.groups[0].rows[0], {
    name: 'Sam', ab: 4, h: 2, r: 2, rbi: 1, bb: 1, k: 0, outs: 2,
  })
})

test('a line without a team stays in one grid', () => {
  const game = result()
  game.lines[0].team_id = 'other'
  game.lines[1].team_id = 'other'
  const box = boxScore(game)
  assert.equal(box.groups.length, 1)
  assert.equal(box.groups[0].name, 'THE LINE')
  assert.equal(box.groups[0].rows.length, 2)
})

test('a broken line does not become a grid', () => {
  const game = result()
  game.lines[0].h = '1'
  assert.equal(boxScore(game), null)
})

test('used items stay with the team that packed them', () => {
  const groups = usedGroups([
    { team_id: HOME, name: ' ICE POPS ' },
    { team_id: AWAY, name: 'TARP AND CHALK' },
    { team_id: HOME, name: '' },
  ], result())
  assert.deepEqual(groups, [
    { name: 'VISITORS', items: ['TARP AND CHALK'] },
    { name: 'HOME', items: ['ICE POPS', 'ITEM'] },
  ])
})

test('a game with no packed items has no used list', () => {
  assert.deepEqual(usedGroups([], result()), [])
  assert.deepEqual(usedGroups(null, result()), [])
})
