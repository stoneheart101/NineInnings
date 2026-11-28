import { KID_STATS } from './kid-details.js'

export function nextStatSort(current, stat) {
  return current === stat ? '' : stat
}

export function sortedByStat(kids, stat) {
  const list = Array.isArray(kids) ? kids : []
  if (!stat) return list.slice()
  return list.slice().sort((a, b) => {
    const left = Number.isInteger(a?.base_stats?.[stat]) ? a.base_stats[stat] : -1
    const right = Number.isInteger(b?.base_stats?.[stat]) ? b.base_stats[stat] : -1
    if (left !== right) return right - left
    const family = String(a?.family_name || '').localeCompare(String(b?.family_name || ''))
    if (family) return family
    const given = String(a?.given_name || '').localeCompare(String(b?.given_name || ''))
    if (given) return given
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

export function statSortRow(active, onSort) {
  const row = document.createElement('div')
  row.className = 'sort-row'
  for (const [stat, label] of KID_STATS) {
    const link = document.createElement('button')
    link.type = 'button'
    if (active === stat) link.className = 'on'
    link.textContent = label
    link.setAttribute('aria-pressed', active === stat ? 'true' : 'false')
    link.addEventListener('click', () => onSort(nextStatSort(active, stat)))
    row.append(link)
  }
  return row
}
