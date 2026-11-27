export const HOME_PERKS = [
  {
    id: 'short_fence',
    label: 'SHORT FENCE',
    blurb: 'THE PARK PLAYS SMALL. HOME HITTERS GAIN A LITTLE POWER.',
  },
  {
    id: 'fast_grass',
    label: 'FAST GRASS',
    blurb: 'THE INFIELD IS QUICK. HOME RUNNERS GAIN A LITTLE SPEED.',
  },
  {
    id: 'loud_block',
    label: 'LOUD BLOCK',
    blurb: 'THE CROWD HELPS. HOME HITTERS GAIN A LITTLE CONTACT.',
  },
  {
    id: 'high_sun',
    label: 'HIGH SUN',
    blurb: 'THE VISITORS LOSE THE BALL. HOME FIELDERS GAIN A LITTLE GLOVE.',
  },
  {
    id: 'familiar_mound',
    label: 'FAMILIAR MOUND',
    blurb: 'THE PITCHER KNOWS THE HILL. HOME PITCHING HOLDS A LITTLE LONGER.',
  },
]

export function perkById(id) {
  return HOME_PERKS.find((perk) => perk.id === id) || null
}

export function perkLine(id) {
  const perk = perkById(id)
  return perk ? `BRINGS ${perk.label}` : ''
}

export function homeFieldLine(id) {
  const perk = perkById(id)
  return perk ? `HOME FIELD: ${perk.label}` : ''
}

export function perkChoices(kids) {
  const held = new Map()
  for (const kid of kids || []) {
    const perk = perkById(kid?.home_perk)
    if (!perk) continue
    const name = [kid.given_name, kid.family_name].filter(Boolean).join(' ') || 'KID'
    const names = held.get(perk.id) || []
    names.push(name)
    held.set(perk.id, names)
  }
  return HOME_PERKS.filter((perk) => held.has(perk.id)).map((perk) => ({
    id: perk.id,
    label: perk.label,
    blurb: perk.blurb,
    kids: held.get(perk.id),
  }))
}

export function homePerkForGame({
  final = false,
  homeLocked = false,
  lockPerk = null,
  livePerk = null,
  locksKnown = true,
} = {}) {
  if (!locksKnown) return ''
  if (final || homeLocked) return homeFieldLine(lockPerk)
  return homeFieldLine(livePerk)
}
