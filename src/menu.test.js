import assert from 'node:assert/strict'
import test from 'node:test'
import { deskMenu, draftIsActive, gameIdFromRoute, placeFromRoute, seasonIdFromRoute, teamTabs } from './menu.js'

const SEASON = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TEAM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

test('the seasons list sends every tab to the list, with SEASON showing', () => {
  const menu = deskMenu({ place: 'list' })
  assert.deepEqual(menu.map((item) => item.label), ['DASHBOARD', 'SEASON', 'TEAM'])
  assert.deepEqual(menu.map((item) => item.path), ['/seasons', '/seasons', '/seasons'])
  assert.deepEqual(menu.map((item) => item.on), [false, true, false])
  assert.equal(menu[0].section, 'dashboard')
  assert.equal(menu[2].section, '')
})

test('the open season lands on DASHBOARD', () => {
  const menu = deskMenu({ openSeasonId: SEASON, place: 'seasons', section: 'dashboard' })
  assert.equal(menu[0].path, `/seasons/${SEASON}`)
  assert.equal(menu[0].on, true)
  assert.equal(menu[1].on, false)
  assert.equal(menu[1].section, 'recruiting')
  const fresh = deskMenu({ openSeasonId: SEASON, place: 'seasons' })
  assert.equal(fresh[0].on, true)
  assert.equal(fresh[1].on, false)
})

test('an open season with no team lands TEAM on DETAILS', () => {
  const menu = deskMenu({ openSeasonId: SEASON, place: 'seasons', section: 'schedule' })
  assert.equal(menu[0].on, false)
  assert.equal(menu[1].on, true)
  assert.equal(menu[1].section, 'recruiting')
  assert.equal(menu[2].path, `/seasons/${SEASON}`)
  assert.equal(menu[2].section, 'details')
  assert.equal(menu[2].on, false)
})

test('TEAM opens the roster, and the clubhouse is a subtab', () => {
  const menu = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'roster' })
  assert.equal(menu[2].label, 'TEAM')
  assert.equal(menu[2].path, `/teams/${TEAM}`)
  assert.equal(menu[2].section, '')
  assert.equal(menu[2].on, true)
  assert.equal(menu[0].on, false)
  assert.equal(menu[1].on, false)
  const club = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'clubhouse' })
  assert.equal(club[2].on, true)
  assert.equal(club[2].path, `/teams/${TEAM}`)
  assert.deepEqual(teamTabs(TEAM).map((tab) => tab.label), ['ROSTER', 'HOME FIELD', 'CLUBHOUSE'])
  assert.equal(teamTabs(TEAM)[0].path, `/teams/${TEAM}`)
  assert.equal(teamTabs(TEAM)[1].path, `/teams/${TEAM}/field`)
  assert.equal(teamTabs(TEAM)[2].path, `/teams/${TEAM}/clubhouse`)
  const field = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'field' })
  assert.equal(field[2].on, true)
  assert.equal(field[2].path, `/teams/${TEAM}`)
})

test('a forming season opens DETAILS from the SEASON tab', () => {
  const menu = deskMenu({ openSeasonId: SEASON, place: 'seasons', section: 'details', forming: true })
  assert.equal(menu[1].section, 'details')
  assert.equal(menu[1].on, true)
  assert.equal(menu[0].on, false)
})

test('an active draft puts DRAFT on the SEASON tab', () => {
  const menu = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place: 'draft', drafting: true })
  assert.equal(menu[1].on, true)
  assert.equal(menu[1].section, 'draft')
  assert.equal(menu[1].path, `/seasons/${SEASON}`)
  assert.equal(menu[0].on, false)
  const inside = deskMenu({ openSeasonId: SEASON, place: 'seasons', section: 'pool', drafting: true })
  assert.equal(inside[1].section, 'draft')
  assert.equal(inside[1].on, true)
  const idle = deskMenu({ openSeasonId: SEASON, place: 'seasons', section: 'details', drafting: false })
  assert.equal(idle[1].section, 'recruiting')
  assert.equal(idle[1].on, true)
})

test('a draft is active only while picks are still being made', () => {
  const season = { status: 'drafting' }
  assert.equal(draftIsActive({ status: 'forming' }, null), false)
  assert.equal(draftIsActive({ status: 'active' }, { order: ['a'], pick_index: 0 }), false)
  assert.equal(draftIsActive(season, null), true)
  assert.equal(draftIsActive(season, { order: ['a', 'b'], pick_index: 1 }), true)
  assert.equal(draftIsActive(season, { order: ['a', 'b'], pick_index: 2 }), false)
})

test('the recruiting route keeps the season tab on and names that season', () => {
  const menu = deskMenu({ openSeasonId: SEASON, place: 'recruiting', seasonName: 'SUMMER BLOCK' })
  assert.equal(menu[0].on, false)
  assert.equal(menu[1].on, true)
  assert.equal(menu[1].label, 'SUMMER BLOCK')
  assert.equal(menu[1].shrink, true)
  assert.equal(menu[1].section, 'recruiting')
  const unnamed = deskMenu({ openSeasonId: SEASON, place: 'recruiting' })
  assert.equal(unnamed[1].label, 'SEASON')
  assert.equal(unnamed[1].shrink, false)
})

test('a game leaves the three tabs up and DASHBOARD returns to that season', () => {
  for (const place of ['matchup', 'report']) {
    const menu = deskMenu({ openSeasonId: SEASON, teamId: TEAM, place })
    assert.deepEqual(menu.map((item) => item.on), [false, false, false])
    assert.equal(menu[0].path, `/seasons/${SEASON}`)
    assert.equal(menu[0].section, 'dashboard')
    assert.equal(menu[2].path, `/teams/${TEAM}`)
    assert.equal(menu[2].label, 'TEAM')
  }
})

test('routes name the place and the season', () => {
  assert.equal(placeFromRoute('/'), 'list')
  assert.equal(placeFromRoute('/seasons'), 'list')
  assert.equal(placeFromRoute(`/seasons/${SEASON}`), 'seasons')
  assert.equal(placeFromRoute(`/seasons/${SEASON}/draft`), 'draft')
  assert.equal(placeFromRoute(`/seasons/${SEASON}/recruiting`), 'recruiting')
  assert.equal(placeFromRoute(`/teams/${TEAM}`), 'roster')
  assert.equal(placeFromRoute(`/teams/${TEAM}/clubhouse`), 'clubhouse')
  assert.equal(placeFromRoute(`/teams/${TEAM}/field`), 'field')
  assert.equal(placeFromRoute(`/games/${TEAM}`), 'matchup')
  assert.equal(placeFromRoute(`/games/${TEAM}/report`), 'report')
  assert.equal(gameIdFromRoute(`/games/${TEAM}`), TEAM)
  assert.equal(gameIdFromRoute(`/games/${TEAM}/report`), TEAM)
  assert.equal(gameIdFromRoute(`/seasons/${SEASON}`), '')
  assert.equal(seasonIdFromRoute(`/seasons/${SEASON}`), SEASON)
  assert.equal(seasonIdFromRoute(`/seasons/${SEASON}/draft`), SEASON)
  assert.equal(seasonIdFromRoute(`/seasons/${SEASON}/recruiting`), SEASON)
  assert.equal(seasonIdFromRoute(`/teams/${TEAM}`), '')
})
