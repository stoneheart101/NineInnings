import assert from 'node:assert/strict'
import test from 'node:test'
import { routeFromHash } from './router.js'

const GAME = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SEASON = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

test('home field is a team route', () => {
  const team = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  assert.equal(routeFromHash(`#/teams/${team}/field`), `/teams/${team}/field`)
  assert.equal(routeFromHash(`#/teams/${team}/clubhouse`), `/teams/${team}/clubhouse`)
  assert.equal(routeFromHash(`#/teams/${team}/field/extra`), '/')
})

test('the recruiting board is a season route', () => {
  assert.equal(routeFromHash(`#/seasons/${SEASON}/recruiting`), `/seasons/${SEASON}/recruiting`)
  assert.equal(routeFromHash(`#/seasons/${SEASON}`), `/seasons/${SEASON}`)
  assert.equal(routeFromHash(`#/seasons/${SEASON}/recruiting/extra`), '/')
})

test('a finished game keeps a report route beside the matchup', () => {
  assert.equal(routeFromHash(`#/games/${GAME}`), `/games/${GAME}`)
  assert.equal(routeFromHash(`#/games/${GAME}/report`), `/games/${GAME}/report`)
  assert.equal(routeFromHash(`#/games/${GAME}/report/extra`), '/')
})
