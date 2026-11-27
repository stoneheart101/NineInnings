function headerPurse(info) {
  const caps = Number(info?.bottlecaps)
  const rep = Number(info?.reputation)
  return `${Number.isFinite(caps) ? caps : 0} BC · ${Number.isFinite(rep) ? rep : 0} REP`
}

export function headerLines(info) {
  if (!info?.name) return null
  return [
    { role: 'name', text: info.name },
    { role: 'purse', text: headerPurse(info) },
  ]
}

export function coachMenuBlocks(details) {
  const blocks = []
  if (details?.rulesVersion != null) blocks.push({ kind: 'rules', text: `RULES v${details.rulesVersion}` })
  const seasons = details?.seasons
  if (Array.isArray(seasons) && seasons.length) {
    blocks.push({ kind: 'note', text: 'THIS LIST IS THE SEASON YOU ARE VIEWING. PICK ONE TO SWITCH IT.' })
    blocks.push({
      kind: 'seasons',
      seasons: seasons.map((season) => ({
        season,
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
