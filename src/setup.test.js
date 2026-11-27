import assert from 'node:assert/strict'
import test from 'node:test'
import { draftComplete, setupRows, shouldAutoStart } from './setup.js'

const WEST = { id: 'west', name: 'WEST SIDE' }
const EAST = { id: 'east', name: 'EAST SIDE' }

function marks(rows) {
  return rows.map((row) => `${row.title}:${row.mark}`)
}

test('a forming coach names a team before anything else', () => {
  const rows = setupRows({
    status: 'forming',
    commissioner: false,
    hasTeam: false,
    teamCount: 1,
    teams: [EAST],
  })
  assert.deepEqual(rows.map((row) => row.title), ['NAME YOUR TEAM', 'START THE DRAFT', 'MAKE YOUR PICK', 'PLAY BALL'])
  assert.equal(rows.filter((row) => row.mark === 'NEXT').length, 1)
  assert.equal(rows[0].mark, 'NEXT')
  assert.equal(rows[0].action, 'name')
  assert.equal(rows[1].note, 'WAITING ON THE COMMISSIONER')
  assert.equal(rows[1].action, '')
  assert.equal(rows[2].note, 'WAITING ON THE DRAFT')
  assert.equal(rows[3].note, 'WAITING ON THE DRAFT')
})

test('a commissioner can start the draft before naming a team', () => {
  const rows = setupRows({
    status: 'forming',
    commissioner: true,
    hasTeam: false,
    teamCount: 2,
    teams: [WEST, EAST],
  })
  assert.equal(rows[0].title, 'NAME YOUR TEAM')
  assert.equal(rows[0].mark, 'NEXT')
  assert.equal(rows[0].action, 'name')
  assert.equal(rows[1].title, 'TWO TEAMS')
  assert.equal(rows[1].mark, 'DONE')
  assert.equal(rows[2].title, 'START THE DRAFT')
  assert.equal(rows[2].mark, 'LATER')
  assert.equal(rows[2].action, 'start')
})

test('one team leaves the draft waiting on a second club', () => {
  const rows = setupRows({
    status: 'forming',
    commissioner: true,
    hasTeam: true,
    teamId: 'west',
    teamCount: 1,
    teams: [WEST],
  })
  assert.equal(rows[0].mark, 'DONE')
  assert.equal(rows[1].mark, 'NEXT')
  assert.equal(rows[1].note, 'NEED AT LEAST TWO TEAMS')
  assert.equal(rows[1].action, '')
  assert.equal(rows[2].action, '')
  assert.equal(rows[2].note, 'NEED AT LEAST TWO TEAMS')
})

test('two teams make starting the draft the next step', () => {
  const rows = setupRows({
    status: 'forming',
    commissioner: true,
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
  })
  assert.deepEqual(marks(rows).slice(0, 3), ['NAME YOUR TEAM:DONE', 'TWO TEAMS:DONE', 'START THE DRAFT:NEXT'])
  assert.equal(rows[2].action, 'start')
})

test('a coach who is not on the clock waits and names that club', () => {
  const rows = setupRows({
    status: 'drafting',
    commissioner: false,
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 0, order: ['east', 'west'] },
  })
  const pick = rows.find((row) => row.id === 'pick')
  assert.equal(pick.mark, 'NEXT')
  assert.equal(pick.note, 'WAITING ON EAST SIDE')
  assert.equal(pick.action, '')
  assert.equal(rows.find((row) => row.id === 'play').note, 'WAITING ON THE DRAFT')
})

test('the coach on the clock gets the pick', () => {
  const rows = setupRows({
    status: 'drafting',
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 1, order: ['east', 'west'] },
  })
  const pick = rows.find((row) => row.id === 'pick')
  assert.equal(pick.mark, 'NEXT')
  assert.equal(pick.action, 'pick')
  assert.equal(pick.note, '')
})

test('a coach whose picks are done waits on the rest of the draft', () => {
  const rows = setupRows({
    status: 'drafting',
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 1, order: ['west', 'east'] },
  })
  const pick = rows.find((row) => row.id === 'pick')
  const play = rows.find((row) => row.id === 'play')
  assert.equal(pick.mark, 'DONE')
  assert.equal(play.mark, 'NEXT')
  assert.equal(play.note, 'WAITING ON THE DRAFT')
  assert.equal(play.action, '')
})

test('a finished draft starts on its own until that fails', () => {
  const quiet = setupRows({
    status: 'drafting',
    commissioner: true,
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 2, order: ['west', 'east'] },
  })
  const play = quiet.find((row) => row.id === 'play')
  assert.equal(play.mark, 'NEXT')
  assert.equal(play.note, 'STARTING THE SEASON')
  assert.equal(play.action, '')

  const waiting = setupRows({
    status: 'drafting',
    commissioner: false,
    hasTeam: true,
    teamId: 'east',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 2, order: ['west', 'east'] },
  })
  assert.equal(waiting.find((row) => row.id === 'play').note, 'WAITING ON THE COMMISSIONER')

  const failed = setupRows({
    status: 'drafting',
    commissioner: true,
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 2, order: ['west', 'east'] },
    startError: 'NEED AT LEAST TWO TEAMS',
  })
  const retry = failed.find((row) => row.id === 'play')
  assert.equal(retry.note, 'NEED AT LEAST TWO TEAMS')
  assert.equal(retry.action, 'play')
  assert.equal(draftComplete({ pick_index: 2, order: ['west', 'east'] }), true)
  assert.equal(draftComplete({ pick_index: 1, order: ['west', 'east'] }), false)
})

test('an active season has every setup row done', () => {
  const rows = setupRows({
    status: 'active',
    commissioner: true,
    hasTeam: true,
    teamId: 'west',
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 2, order: ['west', 'east'] },
  })
  assert.equal(rows.some((row) => row.mark === 'NEXT'), false)
  assert.equal(rows.every((row) => row.mark === 'DONE'), true)
})

test('a coach who missed the forming window cannot name a team', () => {
  const rows = setupRows({
    status: 'drafting',
    hasTeam: false,
    teamCount: 2,
    teams: [WEST, EAST],
    draft: { pick_index: 0, order: ['west', 'east'] },
  })
  assert.equal(rows[0].mark, 'NEXT')
  assert.equal(rows[0].action, '')
  assert.equal(rows[0].note, 'TEAMS JOIN WHILE THE SEASON IS FORMING')
})

test('the commissioner opens play ball once, and a stored failure stops that', () => {
  const draft = { pick_index: 2, order: ['west', 'east'] }
  assert.equal(shouldAutoStart({ status: 'drafting', commissioner: true, draft }), true)
  assert.equal(shouldAutoStart({ status: 'drafting', commissioner: false, draft }), false)
  assert.equal(shouldAutoStart({
    status: 'drafting',
    commissioner: true,
    draft,
    startError: 'THE RULES ARE NOT HERE',
  }), false)
  assert.equal(shouldAutoStart({
    status: 'drafting',
    commissioner: true,
    draft,
    playError: 'NEED AT LEAST TWO TEAMS',
  }), false)
  assert.equal(shouldAutoStart({ status: 'active', commissioner: true, draft }), false)
})
