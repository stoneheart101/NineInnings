function headerPurse(info) {
  const caps = Number(info?.bottlecaps)
  const rep = Number(info?.reputation)
  const shownCaps = Number.isFinite(caps) ? caps : 0
  const shownRep = Number.isFinite(rep) ? rep : 0
  const heldCaps = Number(info?.heldBottlecaps)
  const heldRep = Number(info?.heldReputation)
  const shownHeldCaps = Number.isFinite(heldCaps) ? heldCaps : 0
  const shownHeldRep = Number.isFinite(heldRep) ? heldRep : 0
  if (shownHeldCaps > 0 || shownHeldRep > 0) {
    return `${shownRep} REP ${shownCaps} BC (${shownHeldRep} REP ${shownHeldCaps} BC in bid)`
  }
  return `${shownRep} REP · ${shownCaps} BC`
}

export function headerLines(info) {
  if (!info?.name) return null
  return [
    { role: 'name', text: info.name },
    { role: 'purse', text: headerPurse(info) },
  ]
}

export function seasonMenuLabel(season) {
  const name = season?.name || ''
  const status = String(season?.status || '').trim().toLowerCase()
  return status ? `${name} (${status})` : name
}

export function coachMenuBlocks(details) {
  const blocks = []
  const seasons = details?.seasons
  if (Array.isArray(seasons) && seasons.length) {
    blocks.push({
      kind: 'seasons',
      seasons: seasons.map((season) => ({
        season,
        label: seasonMenuLabel(season),
        open: season.id === details.seasonId,
      })),
    })
  } else if (Array.isArray(seasons)) {
    blocks.push({ kind: 'empty', text: 'NO SEASONS YET' })
  }
  blocks.push({ kind: 'open' })
  blocks.push({ kind: 'sign-out' })
  return blocks
}
