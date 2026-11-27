import assert from 'node:assert/strict'
import test from 'node:test'
import { statColor } from './stat-color.js'

test('visible stats use the full color range from 20 to 80', () => {
  assert.equal(statColor(20), 'rgb(214 69 69)')
  assert.equal(statColor(0), 'rgb(214 69 69)')
  assert.equal(statColor(80), 'rgb(62 168 90)')
  assert.equal(statColor(100), 'rgb(62 168 90)')
  assert.equal(statColor(50), 'rgb(224 160 46)')
  assert.equal(statColor(Number.NaN), 'rgb(214 69 69)')
})
