import assert from 'node:assert/strict'
import test from 'node:test'
import { KID_STATS, sexWord, statBars } from './kid-details.js'

test('details name a kid male or female', () => {
  assert.equal(sexWord('M'), 'MALE')
  assert.equal(sexWord('F'), 'FEMALE')
  assert.equal(sexWord(null), '')
  assert.equal(sexWord('X'), '')
})

test('the seven bars use the card order and the same integers', () => {
  const bars = statBars({
    contact: 50,
    power: 80,
    eye: 20,
    speed: 1,
    glove: 100,
    arm: 44,
    stamina: 63,
  })
  assert.deepEqual(bars.map((bar) => [bar.key, bar.label]), KID_STATS)
  assert.deepEqual(bars.map((bar) => bar.text), ['50', '80', '20', '1', '100', '44', '63'])
  assert.deepEqual(bars.map((bar) => bar.width), [50, 80, 20, 1, 100, 44, 63])
  assert.deepEqual(bars.map((bar) => bar.value), [50, 80, 20, 1, 100, 44, 63])
})

test('a missing stat is a dash and an empty bar', () => {
  for (const bar of statBars(null)) {
    assert.equal(bar.value, null)
    assert.equal(bar.text, '-')
    assert.equal(bar.width, 0)
  }
  const mixed = statBars({ contact: null, power: 12.5, eye: '80', speed: 0 })
  assert.equal(mixed[0].text, '-')
  assert.equal(mixed[0].width, 0)
  assert.equal(mixed[1].text, '-')
  assert.equal(mixed[2].text, '-')
  assert.equal(mixed[3].text, '0')
  assert.equal(mixed[3].width, 0)
  assert.equal(mixed[4].text, '-')
})

test('a bar width stays inside 0 to 100 and the number stays the integer', () => {
  const bars = statBars({ contact: -4, power: 140, eye: 100 })
  assert.equal(bars[0].text, '-4')
  assert.equal(bars[0].width, 0)
  assert.equal(bars[0].value, -4)
  assert.equal(bars[1].text, '140')
  assert.equal(bars[1].width, 100)
  assert.equal(bars[1].value, 140)
  assert.equal(bars[2].text, '100')
  assert.equal(bars[2].width, 100)
})
