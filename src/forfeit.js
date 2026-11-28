function clean(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function forfeitSide(result) {
  const side = result?.forfeit
  if (side === 'home' || side === 'away' || side === 'both') return side
  return ''
}

export function forfeitCall(result) {
  const side = forfeitSide(result)
  if (!side) return ''
  const away = clean(result?.away?.name) || 'THE VISITORS'
  const home = clean(result?.home?.name) || 'THE HOME CLUB'
  if (side === 'both') return `${away} AND ${home} BOTH FORFEIT. IT IS A TIE, AND NOBODY EARNS A THING.`
  if (side === 'away') return `${away} FORFEITS. ${home} TAKES THE GAME, AND NOBODY EARNS A THING.`
  return `${home} FORFEITS. ${away} TAKES THE GAME, AND NOBODY EARNS A THING.`
}
