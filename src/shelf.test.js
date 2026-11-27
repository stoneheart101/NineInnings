import assert from 'node:assert/strict'
import test from 'node:test'
import { alreadyPacked, AVAILABLE_NOTE, itemCost, shelfBlurb } from './shelf.js'

test('available items are bought for the next game only', () => {
  assert.equal(AVAILABLE_NOTE, 'BOUGHT FOR AND USED IN THE NEXT GAME ONLY (OFFICIAL OR PRACTICE)')
})

test('the metal bat card does not talk about a series', () => {
  assert.equal(shelfBlurb({ id: 'metal_bat', blurb: 'ONE BAT FOR A THREE GAME SERIES' }), 'ONE BAT FOR THE NEXT GAME')
  assert.equal(shelfBlurb({ id: 'ice_pops', blurb: 'COLD TREATS FOR A HOT AFTERNOON' }), 'COLD TREATS FOR A HOT AFTERNOON')
})

test('a clubhouse cost is abbreviated', () => {
  assert.equal(itemCost({ bottlecap_cost: 5, reputation_cost: 2 }), '5 BC AND 2 REP')
  assert.equal(itemCost({ bottlecap_cost: 1, reputation_cost: 0 }), '1 BC')
  assert.equal(itemCost({ bottlecap_cost: 0, reputation_cost: 4 }), '4 REP')
  assert.equal(itemCost(null), '')
})

test('a packed item cannot be bought again', () => {
  assert.equal(alreadyPacked([{ item_id: 'metal_bat' }], 'metal_bat'), true)
  assert.equal(alreadyPacked([{ item_id: 'ice_pops' }], 'metal_bat'), false)
  assert.equal(alreadyPacked([], 'metal_bat'), false)
})
