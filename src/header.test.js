import assert from 'node:assert/strict'
import test from 'node:test'
import { coachMenuBlocks, headerLines } from './header.js'

const VIEWING = 'THIS LIST IS THE SEASON YOU ARE VIEWING. PICK ONE TO SWITCH IT.'

test('the header names the team and the purse and leaves the season off', () => {
  const lines = headerLines({ name: 'WEST SIDE', season: 'SUMMER', bottlecaps: 20, reputation: 10 })
  assert.deepEqual(lines.map((line) => line.role), ['name', 'purse'])
  assert.equal(lines[0].text, 'WEST SIDE')
  assert.equal(lines[1].text, '10 REP · 20 BC')
  assert.equal(JSON.stringify(lines).includes('SUMMER'), false)
})

test('the seasons list leaves the header team spot empty', () => {
  assert.equal(headerLines(null), null)
  assert.equal(headerLines({ season: 'SUMMER', bottlecaps: 20, reputation: 10 }), null)
})

test('a missing purse reads as zero', () => {
  const lines = headerLines({ name: 'WEST SIDE' })
  assert.equal(lines[1].text, '0 REP · 0 BC')
})

test('a high bid stays in the header after the purse', () => {
  const lines = headerLines({
    name: 'WEST SIDE',
    bottlecaps: 3,
    reputation: 2,
    heldBottlecaps: 5,
    heldReputation: 4,
  })
  assert.equal(lines[1].text, '2 REP 3 BC (4 REP 5 BC held in high bid)')
  const idle = headerLines({ name: 'WEST SIDE', bottlecaps: 3, reputation: 2, heldBottlecaps: 0, heldReputation: 0 })
  assert.equal(idle[1].text, '2 REP · 3 BC')
})

test('the coach menu says this list is the season you are viewing and that picking one switches it', () => {
  const blocks = coachMenuBlocks({
    rulesVersion: 3,
    seasonId: 'open',
    seasons: [
      { id: 'open', name: 'SUMMER', status: 'ACTIVE' },
      { id: 'other', name: 'FALL', status: 'FORMING' },
    ],
  })
  assert.deepEqual(blocks.map((block) => block.kind), ['rules', 'note', 'seasons', 'open', 'sign-out'])
  assert.equal(blocks[1].text, VIEWING)
  assert.equal(blocks[2].seasons[0].open, true)
  assert.equal(blocks[2].seasons[1].open, false)
  assert.equal(blocks[2].seasons[0].season.name, 'SUMMER')
  assert.equal(blocks[2].seasons[1].season.status, 'FORMING')
  const openAt = blocks.findIndex((block) => block.kind === 'open')
  const signOutAt = blocks.findIndex((block) => block.kind === 'sign-out')
  const listAt = blocks.findIndex((block) => block.kind === 'seasons')
  assert.equal(listAt < openAt && openAt < signOutAt, true)
})

test('an empty season list keeps open and sign out under the empty line', () => {
  const blocks = coachMenuBlocks({ seasons: [], seasonId: '' })
  assert.deepEqual(blocks.map((block) => block.kind), ['empty', 'open', 'sign-out'])
  assert.equal(blocks[0].text, 'NO SEASONS YET')
  assert.equal(blocks.some((block) => block.text === VIEWING), false)
})
