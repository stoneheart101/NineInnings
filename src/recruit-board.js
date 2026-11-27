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
