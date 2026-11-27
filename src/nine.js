// Slots 1 through 9, each with a different kid. Empty spots have no row,
// or a row whose player is missing. BENCH is the absence of a slot.

export function filledNine(rows, kids) {
  const allowed = kids == null
    ? null
    : new Set(kids.map((kid) => kid?.id).filter(Boolean))
  const slots = new Set()
  const players = new Set()
  for (const row of rows || []) {
    const slot = Number(row?.slot)
    const id = row?.player_id
    if (typeof id !== 'string' || !id) continue
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) continue
    if (allowed && !allowed.has(id)) continue
    if (players.has(id) || slots.has(slot)) continue
    players.add(id)
    slots.add(slot)
  }
  return slots.size === 9
}
