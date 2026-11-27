import assert from 'node:assert/strict'
import test from 'node:test'
import { homeFieldLine, homePerkForGame, perkChoices, perkLine } from './home-perk.js'

test('a perk names itself on the kid and on the home game', () => {
  assert.equal(perkLine('short_fence'), 'BRINGS SHORT FENCE')
  assert.equal(perkLine(null), '')
  assert.equal(perkLine('not_a_perk'), '')
  assert.equal(homeFieldLine('familiar_mound'), 'HOME FIELD: FAMILIAR MOUND')
  assert.equal(homeFieldLine(''), '')
})

test('the roster lists the perks kids bring', () => {
  const choices = perkChoices([
    { given_name: 'OTIS', family_name: 'PARK', home_perk: 'fast_grass' },
    { given_name: 'MAYA', family_name: 'CHEN', home_perk: 'short_fence' },
    { given_name: 'BEN', family_name: 'COSTA', home_perk: null },
    { given_name: 'NIA', family_name: 'DIAZ', home_perk: 'short_fence' },
    { home_perk: 'nope' },
  ])
  assert.deepEqual(choices.map((perk) => perk.id), ['short_fence', 'fast_grass'])
  assert.deepEqual(choices[0].kids, ['MAYA CHEN', 'NIA DIAZ'])
  assert.equal(choices[0].label, 'SHORT FENCE')
  assert.deepEqual(perkChoices([]), [])
})

test('a locked home game keeps the perk it was given', () => {
  assert.equal(homePerkForGame({ homeLocked: true, lockPerk: 'high_sun', livePerk: 'fast_grass' }), 'HOME FIELD: HIGH SUN')
  assert.equal(homePerkForGame({ final: true, lockPerk: null, livePerk: 'fast_grass' }), '')
  assert.equal(homePerkForGame({ homeLocked: false, livePerk: 'loud_block' }), 'HOME FIELD: LOUD BLOCK')
  assert.equal(homePerkForGame({ locksKnown: false, livePerk: 'loud_block', lockPerk: 'high_sun' }), '')
  assert.equal(
    homePerkForGame({ homeLocked: true, lockPerk: 'short_fence', lockKidPerks: ['fast_grass', 'short_fence', 'nope'] }),
    'HOME FIELD: SHORT FENCE, FAST GRASS',
  )
  assert.equal(
    homePerkForGame({ homeLocked: false, livePerk: null, liveKidPerks: ['loud_block'] }),
    'HOME FIELD: LOUD BLOCK',
  )
})
