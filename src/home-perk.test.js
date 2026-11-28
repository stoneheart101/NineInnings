import assert from 'node:assert/strict'
import test from 'node:test'
import { homeFieldLine, homePerkForGame, nameClass, perkChoices, perkHelp, perkLine } from './home-perk.js'

test('a perk names itself on the kid and on the home game', () => {
  assert.equal(perkLine('moms_muffins'), "BRINGS MOM'S MUFFINS")
  assert.equal(perkHelp('moms_muffins'), 'MOM BAKES FOR THE GAME. THE CLUB HOLDS UP A LITTLE LONGER.')
  assert.equal(perkHelp('brothers_van'), 'AN OLDER BROTHER DRIVES THEM OVER. HOME RUNNERS KEEP A LITTLE SPEED.')
  assert.equal(perkHelp('short_fence'), '')
  assert.equal(perkHelp(null), '')
  assert.equal(perkLine('short_fence'), '')
  assert.equal(perkLine(null), '')
  assert.equal(perkLine('not_a_perk'), '')
  assert.equal(nameClass('moms_muffins'), 'season-name home-help')
  assert.equal(nameClass(null), 'season-name')
  assert.equal(nameClass('short_fence', 'card-title'), 'card-title')
  assert.equal(nameClass('moms_muffins', 'card-title'), 'card-title home-help')
  assert.equal(homeFieldLine('familiar_mound'), 'HOME FIELD: FAMILIAR MOUND')
  assert.equal(homeFieldLine('mowed_grass'), 'HOME FIELD: MOWED GRASS')
  assert.equal(homeFieldLine(''), '')
})

test('the roster lists the help kids bring', () => {
  const choices = perkChoices([
    { given_name: 'OTIS', family_name: 'PARK', home_perk: 'brothers_van' },
    { given_name: 'MAYA', family_name: 'CHEN', home_perk: 'moms_muffins' },
    { given_name: 'BEN', family_name: 'COSTA', home_perk: null },
    { given_name: 'NIA', family_name: 'DIAZ', home_perk: 'moms_muffins' },
    { home_perk: 'short_fence' },
    { home_perk: 'nope' },
  ])
  assert.deepEqual(choices.map((perk) => perk.id), ['moms_muffins', 'brothers_van'])
  assert.deepEqual(choices[0].kids, ['MAYA CHEN', 'NIA DIAZ'])
  assert.equal(choices[0].label, "MOM'S MUFFINS")
  assert.deepEqual(perkChoices([]), [])
})

test('a locked home game keeps the perk it was given', () => {
  assert.equal(homePerkForGame({ homeLocked: true, lockPerk: 'high_sun', livePerk: 'fast_grass' }), 'HOME FIELD: HIGH SUN')
  assert.equal(homePerkForGame({ final: true, lockPerk: null, livePerk: 'fast_grass' }), '')
  assert.equal(homePerkForGame({ homeLocked: false, livePerk: 'loud_block' }), 'HOME FIELD: LOUD BLOCK')
  assert.equal(homePerkForGame({ locksKnown: false, livePerk: 'loud_block', lockPerk: 'high_sun' }), '')
  assert.equal(
    homePerkForGame({ homeLocked: true, lockPerk: 'short_fence', lockKidPerks: ['moms_muffins', 'short_fence', 'nope'] }),
    "HOME FIELD: SHORT FENCE, MOM'S MUFFINS",
  )
  assert.equal(
    homePerkForGame({ homeLocked: false, livePerk: null, liveKidPerks: ['sisters_sewing'] }),
    "HOME FIELD: SISTER'S SEWING",
  )
})
