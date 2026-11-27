import assert from 'node:assert/strict'
import test from 'node:test'
import { heldPurse } from './held-purse.js'

test('the header hold is the open bids this team leads', () => {
  const bids = [
    { status: 'open', high_team_id: 'west', reputation_bid: 4, bottlecap_bid: 5 },
    { status: 'open', high_team_id: 'west', reputation_bid: 1, bottlecap_bid: 2 },
    { status: 'open', high_team_id: 'east', reputation_bid: 9, bottlecap_bid: 9 },
    { status: 'closed', high_team_id: 'west', reputation_bid: 8, bottlecap_bid: 8 },
  ]
  assert.deepEqual(heldPurse(bids, 'west'), { reputation: 5, bottlecaps: 7 })
  assert.deepEqual(heldPurse(bids, 'east'), { reputation: 9, bottlecaps: 9 })
  assert.deepEqual(heldPurse(bids, ''), { reputation: 0, bottlecaps: 0 })
})
