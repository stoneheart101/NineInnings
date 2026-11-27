import assert from 'node:assert/strict'
import test from 'node:test'
import { openChores } from './chores.js'

const open = {
  active: true,
  nineKnown: true,
  nineFull: false,
  nextGameId: 'game-1',
  locksKnown: true,
  locked: false,
}

test('an active coach with both chores sees positions first', () => {
  const chores = openChores(open)
  assert.deepEqual(chores.map((chore) => chore.id), ['assign', 'lock'])
  assert.equal(chores[0].action, 'ROSTER')
  assert.equal(chores[1].action, 'LOCK')
  assert.equal(chores[1].gameId, 'game-1')
})

test('a full nine drops the position chore', () => {
  const chores = openChores({ ...open, nineFull: true })
  assert.deepEqual(chores.map((chore) => chore.id), ['lock'])
})

test('a full nine with no batting order asks for the order before the lock', () => {
  const chores = openChores({ ...open, nineFull: true, orderKnown: true, orderFull: false })
  assert.deepEqual(chores.map((chore) => chore.id), ['order', 'lock'])
  assert.equal(chores[0].title, 'ASSIGN BATTING ORDER')
  assert.equal(chores[0].action, 'ROSTER')
  assert.equal(chores[0].note, 'THE ORDER IS SHORT')
})

test('a short nine stays on positions', () => {
  const chores = openChores({ ...open, orderKnown: true, orderFull: false })
  assert.deepEqual(chores.map((chore) => chore.id), ['assign', 'lock'])
})

test('a filled order drops that chore', () => {
  assert.deepEqual(
    openChores({ ...open, nineFull: true, orderKnown: true, orderFull: true, locked: true }),
    [],
  )
})

test('a locked next game drops the lock chore', () => {
  const chores = openChores({ ...open, locked: true })
  assert.deepEqual(chores.map((chore) => chore.id), ['assign'])
})

test('a coach who is caught up has no chores', () => {
  assert.deepEqual(openChores({ ...open, nineFull: true, locked: true }), [])
  assert.deepEqual(openChores({ ...open, nineFull: true, nextGameId: '' }), [])
})

test('a season that is not active has no chores', () => {
  assert.deepEqual(openChores({ ...open, active: false }), [])
})

test('an unknown nine or an unknown lock stays off the list', () => {
  assert.deepEqual(
    openChores({ ...open, nineKnown: false, nineFull: false }).map((chore) => chore.id),
    ['lock'],
  )
  assert.deepEqual(
    openChores({ ...open, locksKnown: false }).map((chore) => chore.id),
    ['assign'],
  )
})
