const STAT_KEYS = ['contact', 'power', 'eye', 'speed', 'glove', 'arm', 'stamina']

export function draftedLine(count, rounds) {
  const kids = Number(count)
  const total = Number(rounds)
  return `${Number.isFinite(kids) ? kids : 0} OF ${Number.isFinite(total) ? total : 0}`
}

export function draftedKids(kids, open) {
  if (!open) return []
  return (kids || []).map((kid) => {
    const stats = {}
    for (const key of STAT_KEYS) stats[key] = kid?.base_stats?.[key]
    const name = [kid?.given_name, kid?.family_name].filter(Boolean).join(' ') || 'KID'
    return { id: kid?.id, name, stats }
  })
}

export function poolPick({ myTurn = false, busy = false } = {}) {
  if (!myTurn) return { enabled: false, reason: '' }
  if (busy) return { enabled: false, reason: 'THAT PICK IS IN PROGRESS' }
  return { enabled: true, reason: '' }
}
