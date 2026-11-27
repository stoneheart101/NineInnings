export function reputationMedian(values) {
  const sorted = (values || []).map(Number).filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function recruitPrice({
  reputationCost,
  bottlecapCost,
  preference,
  strength,
  reputation,
  reputations,
} = {}) {
  const storedRep = Number(reputationCost)
  const storedCaps = Number(bottlecapCost)
  const rate = Number(strength)
  const mine = Number(reputation)
  const field = (reputations || []).map(Number).filter((value) => Number.isFinite(value))
  if (!Number.isInteger(storedRep) || storedRep < 0) return null
  if (!Number.isInteger(storedCaps) || storedCaps < 0) return null
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null
  if (!Number.isFinite(mine)) return null
  const median = reputationMedian(field.length ? field : [mine])
  const top = field.length ? Math.max(...field) : mine
  const leader = mine === top
  const climbing = median != null && mine <= median
  const likesBench = preference === 'underdog'
  let factor = 1
  if (likesBench && !leader) factor *= 1 - rate
  if (climbing) factor *= 1 - rate
  return {
    reputation: Math.max(1, Math.round(storedRep * factor)),
    bottlecaps: storedCaps,
    climbing,
    leader,
    likesBench,
  }
}

export function standingDue(personal, standing) {
  if (!personal) return null
  if (!standing) {
    return { reputation: personal.reputation, bottlecaps: personal.bottlecaps }
  }
  return {
    reputation: Math.max(personal.reputation, standing.reputation),
    bottlecaps: Math.max(personal.bottlecaps, standing.bottlecaps),
  }
}

export function raiseDue(personal, standing, purse) {
  if (!personal || !standing) return null
  if (purse === 'reputation') {
    return {
      reputation: Math.max(personal.reputation, standing.reputation + 1),
      bottlecaps: Math.max(personal.bottlecaps, standing.bottlecaps),
    }
  }
  if (purse === 'bottlecaps') {
    return {
      reputation: Math.max(personal.reputation, standing.reputation),
      bottlecaps: Math.max(personal.bottlecaps, standing.bottlecaps + 1),
    }
  }
  return null
}

export function coverDue(standing, availableReputation) {
  if (!standing) return null
  const unpaid = standing.reputation - availableReputation
  if (unpaid <= 0) return null
  return {
    reputation: availableReputation,
    bottlecaps: standing.bottlecaps + unpaid * 2,
    unpaid,
  }
}
