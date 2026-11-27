import assert from 'node:assert/strict'
import test from 'node:test'
import { coverDue, raiseDue, recruitPrice, reputationMedian, standingDue } from './recruit-price.js'

const field = [20, 10, 12, 10]

test('the median averages the two middle reputations', () => {
  assert.equal(reputationMedian([10, 20, 12]), 12)
  assert.equal(reputationMedian(field), 11)
  assert.equal(reputationMedian([]), null)
})

test('a bottom-half team pays less reputation and the same bottlecaps', () => {
  const low = recruitPrice({
    reputationCost: 10,
    bottlecapCost: 5,
    preference: null,
    strength: 0.4,
    reputation: 10,
    reputations: field,
  })
  const high = recruitPrice({
    reputationCost: 10,
    bottlecapCost: 5,
    preference: null,
    strength: 0.4,
    reputation: 20,
    reputations: field,
  })
  assert.equal(low.climbing, true)
  assert.equal(low.reputation, 6)
  assert.equal(low.bottlecaps, 5)
  assert.equal(high.climbing, false)
  assert.equal(high.reputation, 10)
  assert.equal(high.bottlecaps, 5)
})

test('a leader pays the full preference price and a non-leader pays less', () => {
  const leader = recruitPrice({
    reputationCost: 10,
    bottlecapCost: 5,
    preference: 'underdog',
    strength: 0.4,
    reputation: 20,
    reputations: field,
  })
  const other = recruitPrice({
    reputationCost: 10,
    bottlecapCost: 5,
    preference: 'underdog',
    strength: 0.4,
    reputation: 12,
    reputations: field,
  })
  assert.equal(leader.leader, true)
  assert.equal(leader.likesBench, true)
  assert.equal(leader.reputation, 10)
  assert.equal(other.leader, false)
  assert.equal(other.climbing, false)
  assert.equal(other.reputation, 6)
})

test('both breaks stack once, and a tied field still climbs', () => {
  const both = recruitPrice({
    reputationCost: 10,
    bottlecapCost: 5,
    preference: 'underdog',
    strength: 0.4,
    reputation: 10,
    reputations: field,
  })
  const tied = recruitPrice({
    reputationCost: 10,
    bottlecapCost: 5,
    preference: 'underdog',
    strength: 0.4,
    reputation: 10,
    reputations: [10, 10],
  })
  assert.equal(both.reputation, 4)
  assert.equal(tied.leader, true)
  assert.equal(tied.climbing, true)
  assert.equal(tied.reputation, 6)
})

test('the price stays at least one reputation', () => {
  const price = recruitPrice({
    reputationCost: 1,
    bottlecapCost: 1,
    preference: 'underdog',
    strength: 1,
    reputation: 1,
    reputations: [4, 1],
  })
  assert.equal(price.reputation, 1)
})

test('entering meets the standing bid and the coach price', () => {
  const personal = { reputation: 10, bottlecaps: 5 }
  assert.deepEqual(standingDue(personal, null), personal)
  assert.deepEqual(standingDue(personal, { reputation: 6, bottlecaps: 5 }), personal)
  assert.deepEqual(standingDue({ reputation: 6, bottlecaps: 5 }, { reputation: 10, bottlecaps: 8 }), {
    reputation: 10,
    bottlecaps: 8,
  })
})

test('a raise moves one side of the standing bid', () => {
  const personal = { reputation: 6, bottlecaps: 5 }
  const standing = { reputation: 6, bottlecaps: 5 }
  assert.deepEqual(raiseDue(personal, standing, 'reputation'), { reputation: 7, bottlecaps: 5 })
  assert.deepEqual(raiseDue(personal, standing, 'bottlecaps'), { reputation: 6, bottlecaps: 6 })
  assert.equal(raiseDue(personal, standing, 'both'), null)
})

test('covering short reputation spends two bottlecaps a point and no extra reputation', () => {
  const due = coverDue({ reputation: 10, bottlecaps: 5 }, 7)
  assert.deepEqual(due, { reputation: 7, bottlecaps: 11, unpaid: 3 })
  assert.equal(coverDue({ reputation: 10, bottlecaps: 5 }, 10), null)
})
