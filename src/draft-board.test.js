import assert from 'node:assert/strict'
import test from 'node:test'
import { draftedKids, draftedLine, poolPick } from './draft-board.js'

const KID = {
  id: 'kid-1',
  given_name: 'ADA',
  family_name: 'LOVELACE',
  flavor: 'THROWS HEAT',
  base_stats: {
    contact: 50,
    power: 40,
    eye: 60,
    speed: 55,
    glove: 48,
    arm: 52,
    stamina: 51,
  },
}

test('a drafted club is a count until it is opened', () => {
  assert.equal(draftedLine(4, 10), '4 OF 10')
  assert.equal(draftedKids([KID], false).length, 0)
})

test('an open drafted list is the name and the seven stats', () => {
  const kids = draftedKids([KID], true)
  assert.equal(kids.length, 1)
  assert.equal(kids[0].name, 'ADA LOVELACE')
  assert.deepEqual(Object.keys(kids[0].stats), ['contact', 'power', 'eye', 'speed', 'glove', 'arm', 'stamina'])
  assert.equal(JSON.stringify(kids).includes('THROWS HEAT'), false)
  assert.equal(draftedKids([{ ...KID, home_perk: 'moms_muffins' }], true)[0].home_perk, 'moms_muffins')
  assert.equal(JSON.stringify(kids).includes('flavor'), false)
})

test('the pool card is the pick, and a pick in progress says so', () => {
  assert.deepEqual(poolPick({ myTurn: true, busy: false }), { enabled: true, reason: '' })
  assert.deepEqual(poolPick({ myTurn: true, busy: true }), { enabled: false, reason: 'THAT PICK IS IN PROGRESS' })
  assert.deepEqual(poolPick({ myTurn: false, busy: false }), { enabled: false, reason: '' })
})
