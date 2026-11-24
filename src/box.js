function whole(value) {
  return Number.isInteger(value) ? value : null
}

function sideOk(side) {
  return Boolean(side)
    && typeof side.name === 'string'
    && side.name.trim()
    && whole(side.runs) != null
    && whole(side.hits) != null
    && whole(side.errors) != null
}

function lineOk(row) {
  return Boolean(row)
    && typeof row.name === 'string'
    && row.name.trim()
    && ['ab', 'h', 'r', 'rbi', 'bb', 'k', 'outs'].every((key) => whole(row[key]) != null)
}

function kid(row) {
  return {
    name: row.name.trim(),
    ab: row.ab,
    h: row.h,
    r: row.r,
    rbi: row.rbi,
    bb: row.bb,
    k: row.k,
    outs: row.outs,
  }
}

export function boxScore(result) {
  const innings = Array.isArray(result?.innings) ? result.innings : null
  const lines = Array.isArray(result?.lines) ? result.lines : null
  const away = result?.away
  const home = result?.home
  const inningsOk = Boolean(innings?.length) && innings.every((inn) => {
    const homeMark = inn?.home
    return whole(inn?.inning) != null
      && whole(inn?.away) != null
      && (homeMark == null || whole(homeMark) != null)
  })
  if (!inningsOk || !lines || !sideOk(away) || !sideOk(home) || lines.some((row) => !lineOk(row))) {
    return null
  }
  const side = (row, key) => ({
    name: row.name.trim(),
    marks: innings.map((inn) => (inn[key] == null ? 'x' : String(inn[key]))),
    runs: row.runs,
    hits: row.hits,
    errors: row.errors,
  })
  const groups = [
    { name: away.name.trim(), rows: lines.filter((row) => row.team_id === away.team_id).map(kid) },
    { name: home.name.trim(), rows: lines.filter((row) => row.team_id === home.team_id).map(kid) },
  ]
  const placed = groups[0].rows.length + groups[1].rows.length
  const shown = placed || !lines.length
    ? groups.filter((group) => group.rows.length)
    : [{ name: 'THE LINE', rows: lines.map(kid) }]
  return {
    innings: innings.map((inn) => inn.inning),
    sides: [side(away, 'away'), side(home, 'home')],
    groups: shown,
  }
}

function itemName(item) {
  return typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : 'ITEM'
}

export function usedGroups(items, result) {
  if (!Array.isArray(items) || !items.length) return []
  const buckets = new Map()
  const order = []
  for (const item of items) {
    const id = typeof item?.team_id === 'string' ? item.team_id : ''
    if (!buckets.has(id)) {
      buckets.set(id, [])
      order.push(id)
    }
    buckets.get(id).push(itemName(item))
  }
  const away = result?.away?.team_id
  const home = result?.home?.team_id
  const rank = (id) => (id && id === away ? 0 : id && id === home ? 1 : 2)
  const label = (id) => {
    if (id && id === away && typeof result?.away?.name === 'string' && result.away.name.trim()) return result.away.name.trim()
    if (id && id === home && typeof result?.home?.name === 'string' && result.home.name.trim()) return result.home.name.trim()
    return 'TEAM'
  }
  return order
    .map((id, index) => ({ id, index }))
    .sort((left, right) => rank(left.id) - rank(right.id) || left.index - right.index)
    .map(({ id }) => ({ name: label(id), items: buckets.get(id) }))
}
