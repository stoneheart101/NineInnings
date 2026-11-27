import { boxScore, usedGroups } from './box.js'
import { actualLine, forecastLine } from './forecast.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function cell(className, text) {
  return el('span', className, text)
}

function lineGrid(box) {
  const node = el('div', 'score-grid')
  node.style.setProperty('--score-cols', String(box.innings.length + 3))
  node.append(cell('score-h', ''))
  for (const inning of box.innings) node.append(cell('score-h', String(inning)))
  for (const label of ['R', 'H', 'E']) node.append(cell('score-h', label))
  for (const side of box.sides) {
    node.append(cell('score-name', side.name))
    for (const mark of side.marks) node.append(cell('score-n', mark))
    node.append(cell('score-n', String(side.runs)))
    node.append(cell('score-n', String(side.hits)))
    node.append(cell('score-n', String(side.errors)))
  }
  return node
}

function statGrid(rows) {
  const node = el('div', 'stat-grid')
  node.append(cell('score-h', ''))
  for (const label of ['AB', 'H', 'R', 'RBI', 'BB', 'K', 'OUTS']) node.append(cell('score-h', label))
  for (const row of rows) {
    node.append(cell('score-name', row.name))
    for (const key of ['ab', 'h', 'r', 'rbi', 'bb', 'k', 'outs']) node.append(cell('score-n', String(row[key])))
  }
  return node
}

export function headed(className, title, nodes, action) {
  const card = el('div', `card ${className}`)
  const head = el('div', 'card-head')
  if (typeof title === 'string') head.append(el('span', 'card-title', title))
  else {
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

export function reviewNotes(game) {
  const nodes = []
  const forecast = forecastLine(game)
  const actual = actualLine(game)
  if (forecast) nodes.push(el('p', 'game-forecast', forecast))
  if (actual) nodes.push(el('p', 'game-forecast', actual))
  const day = dayCopy(game?.narrative)
  if (day) nodes.push(day)
  else nodes.push(el('p', 'alert', 'THE WRITEUP DID NOT LOAD'))
  return nodes
}

export function scoreNodes(result) {
  const box = boxScore(result)
  if (!box) return [el('p', 'alert', 'THE LINE DID NOT LOAD')]
  const nodes = [lineGrid(box)]
  for (const group of box.groups) {
    nodes.push(el('p', 'section', group.name))
    nodes.push(statGrid(group.rows))
  }
  return nodes
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
