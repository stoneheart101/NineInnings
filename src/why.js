export const WHY = {
  inProgress: 'THAT IS IN PROGRESS',
  gameStarting: 'THAT GAME IS STARTING',
  nameSaving: 'THE NAME IS SAVING',
  typeSeasonName: 'TYPE THE SEASON NAME',
  seasonDeleting: 'THE SEASON IS DELETING',
  cardLocking: 'THE CARD IS LOCKING',
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
