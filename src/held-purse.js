export function heldPurse(bids, teamId) {
  const held = { bottlecaps: 0, reputation: 0 }
  if (!teamId) return held
  for (const bid of bids || []) {
    if (bid?.status !== 'open' || bid.high_team_id !== teamId) continue
    const caps = Number(bid.bottlecap_bid)
    const rep = Number(bid.reputation_bid)
    if (Number.isFinite(caps)) held.bottlecaps += caps
    if (Number.isFinite(rep)) held.reputation += rep
  }
  return held
}

export async function fetchHeld(client, teamId) {
  if (!teamId || !client) return { bottlecaps: 0, reputation: 0 }
  const { data, error } = await client
    .from('recruit_bids')
    .select('reputation_bid, bottlecap_bid, high_team_id, status')
    .eq('high_team_id', teamId)
    .eq('status', 'open')
  if (error) return { bottlecaps: 0, reputation: 0 }
  return heldPurse(data, teamId)
}
