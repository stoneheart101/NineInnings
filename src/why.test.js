import assert from 'node:assert/strict'
import test from 'node:test'
import { WHY, buyReason, deleteReason } from './why.js'

test('a purchase says why it is closed', () => {
  assert.equal(buyReason({ busy: true, packed: true, afford: false }), WHY.purchase)
  assert.equal(buyReason({ busy: false, packed: true, afford: false }), WHY.alreadyPacked)
  assert.equal(buyReason({ busy: false, packed: false, afford: false }), WHY.cannotAfford)
  assert.equal(buyReason({ busy: false, packed: false, afford: true }), '')
})

test('deleting a season says why the button is closed', () => {
  assert.equal(deleteReason({ busy: true, named: false }), WHY.seasonDeleting)
  assert.equal(deleteReason({ busy: false, named: false }), WHY.typeSeasonName)
  assert.equal(deleteReason({ busy: false, named: true }), '')
})
