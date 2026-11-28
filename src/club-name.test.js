import assert from 'node:assert/strict'
import test from 'node:test'
import { CLUB_NAME_LIMIT, cleanClubName, clubNameOk } from './club-name.js'

test('a season or team name is 1 to 16 characters', () => {
  assert.equal(CLUB_NAME_LIMIT, 16)
  assert.equal(cleanClubName('  west   side '), 'WEST SIDE')
  assert.equal(clubNameOk('WEST SIDE'), true)
  assert.equal(clubNameOk("O'BRIEN"), true)
  assert.equal(clubNameOk('A'.repeat(16)), true)
  assert.equal(clubNameOk('A'.repeat(17)), false)
  assert.equal(clubNameOk(''), false)
  assert.equal(clubNameOk(' WEST'), false)
  assert.equal(clubNameOk('WEST!'), false)
})
