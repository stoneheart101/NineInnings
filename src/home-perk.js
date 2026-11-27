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

export const KID_PERKS = [
  {
    id: 'moms_muffins',
    label: "MOM'S MUFFINS",
    blurb: 'MOM BAKES FOR THE GAME. THE CLUB HOLDS UP A LITTLE LONGER.',
  },
  {
    id: 'brothers_van',
    label: "BROTHER'S VAN",
    blurb: 'AN OLDER BROTHER DRIVES THEM OVER. HOME RUNNERS KEEP A LITTLE SPEED.',
  },
  {
    id: 'sisters_sewing',
    label: "SISTER'S SEWING",
    blurb: 'A SISTER MENDS THE MITTS. HOME FIELDERS GAIN A LITTLE GLOVE.',
  },
  {
    id: 'careful_raking',
    label: 'CAREFUL RAKING',
    blurb: 'THE KID RAKES THE MOUND THE SAME WAY. HOME PITCHING KEEPS A LITTLE COMMAND.',
  },
  {
    id: 'mowed_grass',
    label: 'MOWED GRASS',
    blurb: 'THE KID MOWS THE GRASS SHORT. THE BALL RUNS A LITTLE FARTHER.',
  },
]

export function perkById(id) {
  return HOME_PERKS.find((perk) => perk.id === id) || KID_PERKS.find((perk) => perk.id === id) || null
}

export function perkLine(id) {
  const perk = KID_PERKS.find((row) => row.id === id)
  return perk ? `BRINGS ${perk.label}` : ''
}

export function nameClass(id, base = 'season-name') {
  return perkLine(id) ? `${base} home-help` : base
}

export function homeFieldNames(ids) {
  const wanted = new Set()
  for (const id of ids || []) {
    if (perkById(id)) wanted.add(id)
  }
  const coach = HOME_PERKS.filter((perk) => wanted.has(perk.id)).map((perk) => perk.label)
  const brought = KID_PERKS.filter((perk) => wanted.has(perk.id)).map((perk) => perk.label)
  return [...coach, ...brought]
}

export function homeFieldLine(id) {
  const names = homeFieldNames([id])
  return names.length ? `HOME FIELD: ${names[0]}` : ''
}

export function homeFieldsLine(ids) {
  const names = homeFieldNames(ids)
  return names.length ? `HOME FIELD: ${names.join(', ')}` : ''
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
  return KID_PERKS.filter((perk) => held.has(perk.id)).map((perk) => ({
    id: perk.id,
    label: perk.label,
    blurb: perk.blurb,
    kids: held.get(perk.id),
  }))
}

export function homePerkIdsForGame({
  final = false,
  homeLocked = false,
  lockPerk = null,
  livePerk = null,
  lockKidPerks = null,
  liveKidPerks = null,
  locksKnown = true,
} = {}) {
  if (!locksKnown) return []
  const frozen = final || homeLocked
  const chosen = frozen ? lockPerk : livePerk
  const extras = frozen ? lockKidPerks : liveKidPerks
  const wanted = new Set()
  for (const id of [chosen, ...(extras || [])]) {
    if (perkById(id)) wanted.add(id)
  }
  return [
    ...HOME_PERKS.filter((perk) => wanted.has(perk.id)).map((perk) => perk.id),
    ...KID_PERKS.filter((perk) => wanted.has(perk.id)).map((perk) => perk.id),
  ]
}

export function homePerkForGame(args) {
  return homeFieldsLine(homePerkIdsForGame(args))
}
