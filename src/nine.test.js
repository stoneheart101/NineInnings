import assert from 'node:assert/strict'
import test from 'node:test'
import { filledNine } from './nine.js'

function nine(ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  return ids.map((id, index) => ({ slot: index + 1, player_id: `kid-${id}` }))
}

test('nine different kids fill the card', () => {
  assert.equal(filledNine(nine()), true)
})

test('a short card is open', () => {
  assert.equal(filledNine(nine([1, 2, 3, 4, 5, 6, 7, 8])), false)
  assert.equal(filledNine([]), false)
  assert.equal(filledNine(null), false)
})

test('an empty spot stays empty', () => {
  const rows = nine()
  rows[4] = { slot: 5, player_id: null }
  assert.equal(filledNine(rows), false)
})

test('the same kid does not fill two spots', () => {
  const rows = nine()
  rows[8] = { slot: 9, player_id: 'kid-1' }
  assert.equal(filledNine(rows), false)
})

test('a kid who is not on the team does not count', () => {
  const kids = nine().slice(0, 8).map((row) => ({ id: row.player_id }))
  assert.equal(filledNine(nine(), kids), false)
  assert.equal(filledNine(nine(), nine().map((row) => ({ id: row.player_id }))), true)
})
