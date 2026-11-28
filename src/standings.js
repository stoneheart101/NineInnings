function count(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.trunc(number))
}

function named(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'TEAM'
}

// Wins first, then reputation. A matching record keeps a stable name order.
export function rankStandings(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.team_id)
    .map((row) => ({
      teamId: String(row.team_id),
      name: named(row.name),
      wins: count(row.wins),
      losses: count(row.losses),
      reputation: count(row.reputation),
      bottlecaps: count(row.bottlecaps),
    }))
  list.sort((left, right) => {
    if (right.wins !== left.wins) return right.wins - left.wins
    if (right.reputation !== left.reputation) return right.reputation - left.reputation
    const name = left.name.localeCompare(right.name)
    if (name) return name
    return left.teamId.localeCompare(right.teamId)
  })
  return list.map((row, index) => ({ ...row, rank: index + 1 }))
}
