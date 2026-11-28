import { boxCsv, boxScore, csvFileName, usedGroups } from './box.js'
import { recapMarks, recapParts, recapPieces } from './recap.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function cell(className, text) {
  return el('span', className, text)
}

export function scoreTone(teamId, myTeamId, awayId, homeId) {
  if (!myTeamId || (myTeamId !== awayId && myTeamId !== homeId)) return ''
  if (teamId && teamId === myTeamId) return 'recap-mine'
  if (teamId && (teamId === awayId || teamId === homeId)) return 'recap-foe'
  return ''
}

export function scoreNumberClass(value) {
  return String(value) === '0' ? 'score-n score-zero' : 'score-n'
}

function nameClass(teamId, myTeamId, awayId, homeId) {
  const tone = scoreTone(teamId, myTeamId, awayId, homeId)
  return tone ? `score-name ${tone}` : 'score-name'
}

function lineGrid(box, myTeamId, awayId, homeId) {
  const node = el('div', 'score-grid')
  node.style.setProperty('--score-cols', String(box.innings.length + 3))
  node.append(cell('score-h', ''))
  for (const inning of box.innings) node.append(cell('score-h', String(inning)))
  for (const label of ['R', 'H', 'E']) node.append(cell('score-h', label))
  for (const side of box.sides) {
    node.append(cell(nameClass(side.team_id, myTeamId, awayId, homeId), side.name))
    for (const mark of side.marks) node.append(cell(scoreNumberClass(mark), mark))
    node.append(cell(scoreNumberClass(side.runs), String(side.runs)))
    node.append(cell(scoreNumberClass(side.hits), String(side.hits)))
    node.append(cell(scoreNumberClass(side.errors), String(side.errors)))
  }
  return node
}

function statGrid(rows, myTeamId, awayId, homeId) {
  const node = el('div', 'stat-grid')
  node.append(cell('score-h', ''))
  for (const label of ['AB', 'H', 'R', 'RBI', 'BB', 'K', 'OUTS']) node.append(cell('score-h', label))
  for (const row of rows) {
    node.append(cell(nameClass(row.team_id, myTeamId, awayId, homeId), row.name))
    for (const key of ['ab', 'h', 'r', 'rbi', 'bb', 'k', 'outs']) node.append(cell(scoreNumberClass(row[key]), String(row[key])))
  }
  return node
}

export function headed(className, title, nodes, action) {
  const card = el('div', `card ${className}`)
  const titled = typeof title === 'string' ? title.trim() : title
  if (titled || action) {
    const head = el('div', 'card-head')
    if (typeof title === 'string') head.append(el('span', 'card-title', title))
    else if (title) {
      const titleNode = el('span', 'card-title')
      titleNode.append(title)
      head.append(titleNode)
    }
    if (action) {
      const actions = el('div', 'card-actions')
      actions.append(action)
      head.append(actions)
    }
    card.append(head)
  }
  for (const node of nodes) if (node) card.append(node)
  return card
}

function dayCopy(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const parts = text.split(/\n\n+/).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const block = el('div', 'day-copy')
  for (const part of parts) block.append(el('p', '', part))
  return block
}

function painted(text, marks) {
  const node = el('p', '')
  for (const piece of recapPieces(text, marks)) {
    if (!piece.tone) node.append(document.createTextNode(piece.text))
    else node.append(el('span', piece.tone === 'mine' ? 'recap-mine' : 'recap-foe', piece.text))
  }
  return node
}

export function sidedTitle(first, second, myTeamId) {
  const title = el('span', 'game-match')
  const playing = myTeamId && (myTeamId === first?.id || myTeamId === second?.id)
  const name = (side) => {
    if (!playing) return document.createTextNode(side?.name || 'TEAM')
    return el('span', side?.id === myTeamId ? 'recap-mine' : 'recap-foe', side?.name || 'TEAM')
  }
  title.append(name(first), document.createTextNode(' VS '), name(second))
  return title
}

export function reviewNotes(game, extras) {
  const parts = recapParts(game, extras)
  if (parts.length) {
    const marks = recapMarks(game, extras?.myTeamId)
    const block = el('div', 'day-copy')
    for (const part of parts) block.append(painted(part, marks))
    return [block]
  }
  const day = dayCopy(game?.narrative)
  if (day) return [day]
  return [el('p', 'alert', 'THE WRITEUP DID NOT LOAD')]
}

export function scoreNodes(result, myTeamId = '') {
  const box = boxScore(result)
  if (!box) return [el('p', 'alert', 'THE LINE DID NOT LOAD')]
  const awayId = result?.away?.team_id || ''
  const homeId = result?.home?.team_id || ''
  const nodes = [lineGrid(box, myTeamId, awayId, homeId)]
  for (const group of box.groups) {
    const tone = scoreTone(group.team_id, myTeamId, awayId, homeId)
    nodes.push(el('p', tone ? `section ${tone}` : 'section', group.name))
    nodes.push(statGrid(group.rows, myTeamId, awayId, homeId))
  }
  nodes.push(exportRow(result))
  return nodes
}

function saveCsv(text, name) {
  const file = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = el('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportRow(result) {
  const row = el('div', 'box-export')
  const button = el('button', '', 'EXPORT')
  button.type = 'button'
  button.addEventListener('click', () => saveCsv(boxCsv(result), csvFileName(result)))
  row.append(button)
  return row
}

export function usedNodes(items, result) {
  const groups = usedGroups(items, result)
  const nodes = []
  for (const group of groups) {
    nodes.push(el('p', 'section', group.name))
    for (const name of group.items) nodes.push(el('p', '', name))
  }
  return nodes
}
