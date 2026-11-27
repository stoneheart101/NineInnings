export function recruitRank(kid) {
  if (kid?.passed) return 3
  if (kid?.offer === 'tryout') return 2
  if (kid?.bidOpen) return 0
  return 1
}

export function compareRecruits(left, right) {
  const rank = recruitRank(left) - recruitRank(right)
  if (rank) return rank
  const at = Date.parse(right?.created_at) - Date.parse(left?.created_at)
  if (at) return at
  return String(right?.id || '').localeCompare(String(left?.id || ''))
}

export function leaveLabel({ inBid, leading }) {
  if (!inBid) return 'PASS'
  if (leading) return ''
  return 'STOP BIDDING'
}

export function highBidNote(leading) {
  return leading ? 'YOU HAVE THE HIGH BID' : ''
}

export function coachesWaiting(teamIds, passes, playerId) {
  const answered = new Set()
  for (const row of passes || []) {
    if (row?.player_id === playerId && row.team_id) answered.add(row.team_id)
  }
  const seen = new Set()
  let left = 0
  for (const id of teamIds || []) {
    if (!id || seen.has(id) || answered.has(id)) continue
    seen.add(id)
    left += 1
  }
  return left
}

export function tryoutWaitLine(count) {
  const left = Number(count)
  const shown = Number.isFinite(left) && left > 0 ? Math.floor(left) : 0
  return `TRYOUT IS WAITING FOR ${shown} ${shown === 1 ? 'COACH' : 'COACHES'}`
}
