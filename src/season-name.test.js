import assert from 'node:assert/strict'
import test from 'node:test'
import { sameSeasonName } from './season-name.js'

test('the typed season name matches after spaces and case', () => {
  assert.equal(sameSeasonName('  summer   ball ', 'SUMMER BALL'), true)
  assert.equal(sameSeasonName('SUMMER BALL', 'SUMMER BALL'), true)
})

test('a different name or a blank name does not match', () => {
  assert.equal(sameSeasonName('SUMMER', 'SUMMER BALL'), false)
  assert.equal(sameSeasonName('   ', 'SUMMER BALL'), false)
  assert.equal(sameSeasonName('SUMMER BALL', ''), false)
})
