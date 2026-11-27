// Slots 1 through 9, each with a different kid. Empty spots have no row,
// or a row whose player is missing. BENCH is the absence of a slot.
// The batting order is a second set of spots on those same kids.

function filledSpots(rows, kids, key) {
  const allowed = kids == null
    ? null
    : new Set(kids.map((kid) => kid?.id).filter(Boolean))
  const spots = new Set()
  const players = new Set()
  for (const row of rows || []) {
    const spot = Number(row?.[key])
    const id = row?.player_id
    if (typeof id !== 'string' || !id) continue
    if (!Number.isInteger(spot) || spot < 1 || spot > 9) continue
    if (allowed && !allowed.has(id)) continue
    if (players.has(id) || spots.has(spot)) continue
    players.add(id)
    spots.add(spot)
  }
  return spots.size === 9
}

export function filledNine(rows, kids) {
  return filledSpots(rows, kids, 'slot')
}

export function filledOrder(rows, kids) {
  return filledSpots(rows, kids, 'batting_order')
}
