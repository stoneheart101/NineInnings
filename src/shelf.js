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
