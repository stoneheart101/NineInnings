function shownAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function purseLine(amount, held, unit) {
  const line = `${shownAmount(amount)} ${unit}`
  const tied = shownAmount(held)
  if (tied <= 0) return line
  return `${line} (${tied} in bids)`
}

export function headerLines(info) {
  if (!info?.name) return null
  return [
    { role: 'reputation', text: purseLine(info.reputation, info.heldReputation, 'REP') },
    { role: 'bottlecaps', text: purseLine(info.bottlecaps, info.heldBottlecaps, 'BC') },
  ]
}

export function seasonMenuLabel(season) {
  const name = season?.name || ''
  const status = String(season?.status || '').trim().toLowerCase()
  if (!status || status === 'active') return name
  return `${name} (${status})`
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
