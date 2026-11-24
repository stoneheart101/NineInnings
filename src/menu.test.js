import assert from 'node:assert/strict'
import test from 'node:test'
import { deskMenu, placeFromRoute, seasonIdFromRoute } from './menu.js'

const SEASON = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TEAM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

test('the seasons list sends every tab to the list, with SEASONS showing', () => {
  const menu = deskMenu({ place: 'list' })
  assert.deepEqual(menu.map((item) => item.label), ['SEASONS', 'DRAFT', 'ROSTER', 'CLUBHOUSE'])
  assert.deepEqual(menu.map((item) => item.path), ['/seasons', '/seasons', '/seasons', '/seasons'])
  assert.deepEqual(menu.map((item) => item.on), [true, false, false, false])
  assert.equal(menu[2].section, '')
})

test('an open season with no team keeps DRAFT on that season and lands ROSTER and CLUBHOUSE on TEAMS', () => {
  const menu = deskMenu({ openSeasonId: SEASON, place: 'seasons' })
  assert.equal(menu[0].path, `/seasons/${SEASON}`)
  assert.equal(menu[0].on, true)
  assert.equal(menu[1].path, `/seasons/${SEASON}/draft`)
  assert.equal(menu[1].on, false)
  assert.equal(menu[2].path, `/seasons/${SEASON}`)
  assert.equal(menu[2].section, 'teams')
  assert.equal(menu[3].path, `/seasons/${SEASON}`)
  assert.equal(menu[3].section, 'teams')
})

test('your team in the open season is where ROSTER and CLUBHOUSE go', () => {
  const menu = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'roster' })
  assert.equal(menu[2].path, `/teams/${TEAM}`)
  assert.equal(menu[2].section, '')
  assert.equal(menu[2].on, true)
  assert.equal(menu[3].path, `/teams/${TEAM}/clubhouse`)
  assert.equal(menu[3].on, false)
  assert.equal(menu[1].on, false)
})

test('DRAFT stays available and is the tab that shows on the draft', () => {
  const menu = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'draft' })
  assert.equal(menu[1].on, true)
  assert.equal(menu[1].path, `/seasons/${SEASON}/draft`)
  assert.equal(menu[0].on, false)
})

test('a game leaves the four tabs up and SEASONS returns to that season', () => {
  const menu = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'matchup' })
  assert.deepEqual(menu.map((item) => item.on), [false, false, false, false])
  assert.equal(menu[0].path, `/seasons/${SEASON}`)
  assert.equal(menu[2].path, `/teams/${TEAM}`)
})

test('routes name the place and the season', () => {
  assert.equal(placeFromRoute('/'), 'list')
  assert.equal(placeFromRoute('/seasons'), 'list')
  assert.equal(placeFromRoute(`/seasons/${SEASON}`), 'seasons')
  assert.equal(placeFromRoute(`/seasons/${SEASON}/draft`), 'draft')
  assert.equal(placeFromRoute(`/teams/${TEAM}`), 'roster')
  assert.equal(placeFromRoute(`/teams/${TEAM}/clubhouse`), 'clubhouse')
  assert.equal(placeFromRoute(`/games/${TEAM}`), 'matchup')
  assert.equal(seasonIdFromRoute(`/seasons/${SEASON}`), SEASON)
  assert.equal(seasonIdFromRoute(`/seasons/${SEASON}/draft`), SEASON)
  assert.equal(seasonIdFromRoute(`/teams/${TEAM}`), '')
})
