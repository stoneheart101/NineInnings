import assert from 'node:assert/strict'
import test from 'node:test'
import { alreadyPacked, shelfBlurb, shelfLine } from './shelf.js'

test('the shelf says an item lasts one game and can be packed once', () => {
  const line = shelfLine('series')
  assert.equal(line.includes('SERIES'), false)
  assert.equal(line.includes('LASTS THE NEXT GAME'), true)
  assert.equal(line.includes('THE NEXT GAME SPENDS IT'), true)
  assert.equal(line.includes('ONE COPY CAN BE PACKED'), true)
  assert.equal(shelfLine('next_game'), line)
})

test('the metal bat card does not talk about a series', () => {
  assert.equal(shelfBlurb({ id: 'metal_bat', blurb: 'ONE BAT FOR A THREE GAME SERIES' }), 'ONE BAT FOR THE NEXT GAME')
  assert.equal(shelfBlurb({ id: 'ice_pops', blurb: 'COLD TREATS FOR A HOT AFTERNOON' }), 'COLD TREATS FOR A HOT AFTERNOON')
})

test('a packed item cannot be bought again', () => {
  assert.equal(alreadyPacked([{ item_id: 'metal_bat' }], 'metal_bat'), true)
  assert.equal(alreadyPacked([{ item_id: 'ice_pops' }], 'metal_bat'), false)
  assert.equal(alreadyPacked([], 'metal_bat'), false)
})
