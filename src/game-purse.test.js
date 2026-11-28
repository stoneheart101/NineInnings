import assert from 'node:assert/strict'
import test from 'node:test'
import { placeLine, purseText, rewardLine, rewardVersions, rewardsReady, sideOf } from './game-purse.js'

const purse = {
  home_win: { reputation: 2, bottlecaps: 10 },
  away_win: { reputation: 4, bottlecaps: 6 },
  loss: { reputation: 0, bottlecaps: 0 },
  tie: { reputation: 0, bottlecaps: 0 },
}

test('a purse names reputation then bottlecaps, and a zero purse is nothing', () => {
  assert.equal(purseText({ reputation: 2, bottlecaps: 10 }), '2 REP · 10 BC')
  assert.equal(purseText({ reputation: 4, bottlecaps: 0 }), '4 REP')
  assert.equal(purseText({ reputation: 0, bottlecaps: 6 }), '6 BC')
  assert.equal(purseText({ reputation: 0, bottlecaps: 0 }), 'NOTHING')
  assert.equal(purseText({ reputation: -1, bottlecaps: 2 }), '')
  assert.equal(purseText(null), '')
})

test('the schedule reads one settings version per official game', () => {
  assert.deepEqual(rewardVersions([
    { is_practice: false, settings_version: 1 },
    { is_practice: true, settings_version: 2 },
    { is_practice: false, settings_version: 1 },
    { is_practice: false, settings_version: 3 },
  ]), [1, 3])
  assert.equal(rewardsReady(purse), true)
  assert.equal(rewardsReady({ home_win: purse.home_win }), false)
})

test('a home game names your field and the home win', () => {
  const game = { home_team_id: 'mine', away_team_id: 'foe' }
  assert.equal(sideOf(game, 'mine'), 'home')
  assert.equal(placeLine('GOONIES', true), 'AT YOUR FIELD')
  assert.equal(
    rewardLine(purse, 'home'),
    'WIN 2 REP · 10 BC · LOSS NOTHING · TIE NOTHING',
  )
})

test('an away game names the host and the away win', () => {
  const game = { home_team_id: 'foe', away_team_id: 'mine' }
  assert.equal(sideOf(game, 'mine'), 'away')
  assert.equal(placeLine('GOONIES', false), 'AT GOONIES')
  assert.equal(placeLine('  ', false), 'AT TEAM')
  assert.equal(
    rewardLine(purse, 'away'),
    'WIN 4 REP · 6 BC · LOSS NOTHING · TIE NOTHING',
  )
})

test('a game this coach is not in shows both wins', () => {
  assert.equal(sideOf({ home_team_id: 'a', away_team_id: 'b' }, 'mine'), 'out')
  assert.equal(
    rewardLine(purse, 'out'),
    'HOME WIN 2 REP · 10 BC · AWAY WIN 4 REP · 6 BC · LOSS NOTHING · TIE NOTHING',
  )
  assert.equal(rewardLine(null, 'home'), 'THE REWARD DID NOT LOAD')
})
