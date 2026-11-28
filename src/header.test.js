import assert from 'node:assert/strict'
import test from 'node:test'
import { coachMenuBlocks, headerLines, seasonMenuLabel } from './header.js'

test('the header shows reputation, then bottlecaps, and leaves the team and the season off', () => {
  const lines = headerLines({ name: 'WEST SIDE', season: 'SUMMER', bottlecaps: 20, reputation: 10 })
  assert.deepEqual(lines.map((line) => line.role), ['reputation', 'bottlecaps'])
  assert.equal(lines[0].text, '10 REP')
  assert.equal(lines[1].text, '20 BC')
  const packed = JSON.stringify(lines)
  assert.equal(packed.includes('SUMMER'), false)
  assert.equal(packed.includes('WEST SIDE'), false)
})

test('the seasons list leaves the header team spot empty', () => {
  assert.equal(headerLines(null), null)
  assert.equal(headerLines({ season: 'SUMMER', bottlecaps: 20, reputation: 10 }), null)
})

test('a missing purse reads as zero', () => {
  const lines = headerLines({ name: 'WEST SIDE' })
  assert.equal(lines[0].text, '0 REP')
  assert.equal(lines[1].text, '0 BC')
})

test('a high bid sits on the row for that purse', () => {
  const lines = headerLines({
    name: 'WEST SIDE',
    bottlecaps: 3,
    reputation: 2,
    heldBottlecaps: 5,
    heldReputation: 4,
  })
  assert.equal(lines[0].text, '2 REP (4 in bids)')
  assert.equal(lines[1].text, '3 BC (5 in bids)')
  const capsOnly = headerLines({ name: 'WEST SIDE', bottlecaps: 3, reputation: 2, heldBottlecaps: 5, heldReputation: 0 })
  assert.equal(capsOnly[0].text, '2 REP')
  assert.equal(capsOnly[1].text, '3 BC (5 in bids)')
  const idle = headerLines({ name: 'WEST SIDE', bottlecaps: 3, reputation: 2, heldBottlecaps: 0, heldReputation: 0 })
  assert.equal(idle[0].text, '2 REP')
  assert.equal(idle[1].text, '3 BC')
})

test('the coach menu lists a season, and leaves the status off when it is active', () => {
  const blocks = coachMenuBlocks({
    rulesVersion: 3,
    seasonId: 'open',
    seasons: [
      { id: 'open', name: 'SUMMER', status: 'ACTIVE' },
      { id: 'other', name: 'FALL', status: 'FORMING' },
    ],
  })
  assert.deepEqual(blocks.map((block) => block.kind), ['seasons', 'open', 'sign-out'])
  assert.equal(blocks[0].seasons[0].open, true)
  assert.equal(blocks[0].seasons[1].open, false)
  assert.equal(blocks[0].seasons[0].label, 'SUMMER')
  assert.equal(blocks[0].seasons[1].label, 'FALL (forming)')
  assert.equal(seasonMenuLabel({ name: 'WINTER' }), 'WINTER')
  const packed = JSON.stringify(blocks)
  assert.equal(packed.includes('RULES'), false)
  assert.equal(packed.includes('VIEWING'), false)
})

test('an empty season list keeps open and sign out under the empty line', () => {
  const blocks = coachMenuBlocks({ rulesVersion: 1, seasons: [], seasonId: '' })
  assert.deepEqual(blocks.map((block) => block.kind), ['empty', 'open', 'sign-out'])
  assert.equal(blocks[0].text, 'NO SEASONS YET')
  assert.equal(JSON.stringify(blocks).includes('RULES'), false)
})
