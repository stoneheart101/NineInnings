export function sameSeasonName(typed, stored) {
  const left = String(typed ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  const right = String(stored ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  return left.length > 0 && left === right
}
