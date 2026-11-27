// Open chores for an active season. A finished chore is left off the list.

export function openChores({
  active = false,
  nineKnown = false,
  nineFull = false,
  orderKnown = false,
  orderFull = false,
  nextGameId = '',
  locksKnown = false,
  locked = false,
} = {}) {
  if (!active) return []
  const chores = []
  if (nineKnown && !nineFull) {
    chores.push({
      id: 'assign',
      title: 'ASSIGN POSITIONS',
      action: 'ROSTER',
      note: 'THE NINE IS SHORT',
    })
  } else if (nineKnown && nineFull && orderKnown && !orderFull) {
    chores.push({
      id: 'order',
      title: 'ASSIGN BATTING ORDER',
      action: 'ROSTER',
      note: 'THE ORDER IS SHORT',
    })
  }
  if (nextGameId && locksKnown && !locked) {
    chores.push({
      id: 'lock',
      title: 'LOCK THE NEXT GAME',
      action: 'LOCK',
      note: 'THE CARD IS STILL OPEN',
      gameId: nextGameId,
    })
  }
  return chores
}
