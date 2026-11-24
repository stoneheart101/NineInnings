import assert from 'node:assert/strict'
import test from 'node:test'
import { routeFromHash } from './router.js'

const GAME = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

test('a finished game keeps a report route beside the matchup', () => {
  assert.equal(routeFromHash(`#/games/${GAME}`), `/games/${GAME}`)
  assert.equal(routeFromHash(`#/games/${GAME}/report`), `/games/${GAME}/report`)
  assert.equal(routeFromHash(`#/games/${GAME}/report/extra`), '/')
})
