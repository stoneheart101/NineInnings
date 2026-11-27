export const SHELF_LINE = 'LASTS THE NEXT GAME. THE NEXT GAME SPENDS IT. ONE COPY CAN BE PACKED.'

export function shelfLine() {
  return SHELF_LINE
}

export function shelfBlurb(item) {
  const blurb = typeof item?.blurb === 'string' ? item.blurb.trim() : ''
  if (item?.id === 'metal_bat' || blurb.includes('SERIES')) return 'ONE BAT FOR THE NEXT GAME'
  return blurb
}

export function alreadyPacked(packed, itemId) {
  return (packed || []).some((row) => row.item_id === itemId)
}

export function itemCost(item) {
  const parts = []
  const caps = Number(item?.bottlecap_cost)
  const rep = Number(item?.reputation_cost)
  if (Number.isFinite(caps) && caps > 0) parts.push(`${caps} BC`)
  if (Number.isFinite(rep) && rep > 0) parts.push(`${rep} REP`)
  return parts.join(' AND ')
}
