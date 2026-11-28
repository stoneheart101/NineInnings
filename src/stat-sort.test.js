import assert from 'node:assert/strict'
import test from 'node:test'
import { nextStatSort, sortedByStat } from './stat-sort.js'

const kids = [
  { id: 'a', given_name: 'ANN', family_name: 'ZEE', base_stats: { contact: 40, power: 80 } },
  { id: 'b', given_name: 'BO', family_name: 'AYE', base_stats: { contact: 70, power: 20 } },
  { id: 'c', given_name: 'CY', family_name: 'AYE', base_stats: { contact: 70 } },
  { id: 'd', given_name: 'DEE', family_name: 'LOW', base_stats: { contact: 10.5 } },
]

test('a stat sort starts at the highest number and a second pick of that stat clears it', () => {
  assert.equal(nextStatSort('', 'contact'), 'contact')
  assert.equal(nextStatSort('contact', 'power'), 'power')
  assert.equal(nextStatSort('contact', 'contact'), '')
})

test('an empty stat keeps the list order, and a stat puts the best first', () => {
  assert.deepEqual(sortedByStat(kids, '').map((kid) => kid.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(sortedByStat(kids, 'contact').map((kid) => kid.id), ['b', 'c', 'a', 'd'])
  assert.deepEqual(sortedByStat(kids, 'power').map((kid) => kid.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(kids.map((kid) => kid.id), ['a', 'b', 'c', 'd'])
})
