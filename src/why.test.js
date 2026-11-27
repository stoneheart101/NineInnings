import assert from 'node:assert/strict'
import test from 'node:test'
import { WHY, buyReason, deleteReason, lockReason, scrimmageReason } from './why.js'

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

test('a short card says why lock is closed', () => {
  assert.equal(lockReason({ busy: true, full: false, order: false }), WHY.cardLocking)
  assert.equal(lockReason({ busy: false, full: false, order: false }), WHY.assignNine)
  assert.equal(lockReason({ busy: false, full: true, order: false }), WHY.assignOrder)
  assert.equal(lockReason({ busy: false, full: true, order: true }), '')
})

test('a short nine says why a neighborhood game is closed', () => {
  assert.equal(scrimmageReason({ busy: true, open: true, full: true, order: true, known: true }), WHY.gameStarting)
  assert.equal(scrimmageReason({ busy: false, open: true, full: false, order: false, known: true }), WHY.assignNine)
  assert.equal(scrimmageReason({ busy: false, open: false, full: false, order: true, known: true }), WHY.assignNine)
  assert.equal(scrimmageReason({ busy: false, open: true, full: true, order: false, known: true }), WHY.assignOrder)
  assert.equal(scrimmageReason({ busy: false, open: true, full: false, order: false, known: false }), '')
  assert.equal(scrimmageReason({ busy: false, open: true, full: true, order: true, known: true }), '')
})
