export const WHY = {
  inProgress: 'THAT IS IN PROGRESS',
  gameStarting: 'THAT GAME IS STARTING',
  nameSaving: 'THE NAME IS SAVING',
  typeSeasonName: 'TYPE THE SEASON NAME',
  seasonDeleting: 'THE SEASON IS DELETING',
  cardLocking: 'THE CARD IS LOCKING',
  assignNine: 'ASSIGN THE NINE FIRST',
  rosterChange: 'A ROSTER CHANGE IS IN PROGRESS',
  purchase: 'THAT PURCHASE IS IN PROGRESS',
  cannotAfford: 'YOU CANNOT AFFORD THAT',
  alreadyPacked: 'ONE IS ALREADY PACKED',
  pick: 'THAT PICK IS IN PROGRESS',
  signingOut: 'SIGNING OUT',
  seasonOpening: 'THE SEASON IS OPENING',
  signingIn: 'SIGNING IN',
  coachName: 'SAVING THE COACH NAME',
}

export function buyReason({ busy = false, packed = false, afford = false } = {}) {
  if (busy) return WHY.purchase
  if (packed) return WHY.alreadyPacked
  if (!afford) return WHY.cannotAfford
  return ''
}

export function deleteReason({ busy = false, named = false } = {}) {
  if (busy) return WHY.seasonDeleting
  if (!named) return WHY.typeSeasonName
  return ''
}

export function lockReason({ busy = false, full = false } = {}) {
  if (busy) return WHY.cardLocking
  if (!full) return WHY.assignNine
  return ''
}

export function scrimmageReason({ busy = false, open = false, full = false, known = false } = {}) {
  if (busy && open) return WHY.gameStarting
  if (known && !full) return WHY.assignNine
  return ''
}
