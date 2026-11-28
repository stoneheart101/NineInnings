import assert from 'node:assert/strict'
import test from 'node:test'
import { forfeitCall, forfeitSide } from './forfeit.js'

const result = {
  away: { name: 'Goonies' },
  home: { name: 'River Rats' },
}

test('a forfeit names the club that could not field nine', () => {
  assert.equal(forfeitSide({ forfeit: 'away' }), 'away')
  assert.equal(forfeitSide({ forfeit: 'home' }), 'home')
  assert.equal(forfeitSide({ forfeit: 'both' }), 'both')
  assert.equal(forfeitSide({ forfeit: 'yes' }), '')
  assert.equal(forfeitSide(null), '')
  assert.equal(
    forfeitCall({ ...result, forfeit: 'away' }),
    'GOONIES FORFEITS. RIVER RATS TAKES THE GAME, AND NOBODY EARNS A THING.',
  )
  assert.equal(
    forfeitCall({ ...result, forfeit: 'home' }),
    'RIVER RATS FORFEITS. GOONIES TAKES THE GAME, AND NOBODY EARNS A THING.',
  )
  assert.equal(
    forfeitCall({ ...result, forfeit: 'both' }),
    'GOONIES AND RIVER RATS BOTH FORFEIT. IT IS A TIE, AND NOBODY EARNS A THING.',
  )
  assert.equal(forfeitCall(result), '')
})
