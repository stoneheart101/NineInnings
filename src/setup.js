export function draftComplete(draft) {
  if (!draft) return false
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  return order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
}

function clockName(teams, id) {
  return teams.find((team) => team.id === id)?.name || 'THE NEXT CLUB'
}

function picksLeft(draft, teamId) {
  const order = Array.isArray(draft?.order) ? draft.order : []
  const pickIndex = Number(draft?.pick_index)
  const start = Number.isInteger(pickIndex) ? pickIndex : 0
  if (!teamId) return 0
  return order.slice(start).filter((id) => id === teamId).length
}

export function setupRows({
  status = '',
  commissioner = false,
  hasTeam = false,
  teamId = '',
  teamCount = 0,
  draft = null,
  teams = [],
  startError = '',
} = {}) {
  const active = status === 'active' || status === 'completed'
  const forming = status === 'forming'
  const drafting = status === 'drafting'
  const complete = draftComplete(draft)
  const order = Array.isArray(draft?.order) ? draft.order : []
  const pickIndex = Number(draft?.pick_index)
  const clockId = Number.isInteger(pickIndex) ? order[pickIndex] : ''
  const waiting = clockId ? `WAITING ON ${clockName(teams, clockId)}` : 'WAITING ON THE DRAFT'
  const mineLeft = picksLeft(draft, teamId)
  const rows = []

  const name = {
    id: 'name',
    title: 'NAME YOUR TEAM',
    done: Boolean(hasTeam),
    note: '',
    action: '',
  }
  if (!hasTeam && forming) name.action = 'name'
  else if (!hasTeam) name.note = 'TEAMS JOIN WHILE THE SEASON IS FORMING'
  rows.push(name)

  if (commissioner) {
    rows.push({
      id: 'teams',
      title: 'TWO TEAMS',
      done: teamCount >= 2,
      note: teamCount >= 2 ? '' : 'NEED AT LEAST TWO TEAMS',
      action: '',
    })
  }

  const draftRow = {
    id: 'draft',
    title: 'START THE DRAFT',
    done: !forming,
    note: '',
    action: '',
  }
  if (forming && commissioner && teamCount >= 2) draftRow.action = 'start'
  else if (forming && !commissioner) draftRow.note = 'WAITING ON THE COMMISSIONER'
  else if (forming && commissioner) draftRow.note = 'NEED AT LEAST TWO TEAMS'
  rows.push(draftRow)

  const pick = {
    id: 'pick',
    title: 'MAKE YOUR PICK',
    done: false,
    note: '',
    action: '',
  }
  if (!hasTeam) {
    pick.note = forming ? 'WAITING ON THE DRAFT' : 'TEAMS JOIN WHILE THE SEASON IS FORMING'
  } else if (active) {
    pick.done = true
  } else if (forming) {
    pick.note = 'WAITING ON THE DRAFT'
  } else if (drafting && complete) {
    pick.done = true
  } else if (drafting && clockId && clockId === teamId) {
    pick.action = 'pick'
  } else if (drafting && mineLeft > 0) {
    pick.note = waiting
  } else if (drafting && order.length && mineLeft === 0) {
    pick.done = true
  } else {
    pick.note = 'WAITING ON THE DRAFT'
  }
  rows.push(pick)

  const play = {
    id: 'play',
    title: 'PLAY BALL',
    done: active,
    note: '',
    action: '',
  }
  if (!active) {
    const error = String(startError || '').trim()
    if (complete && drafting && error) {
      play.note = error
      if (commissioner) play.action = 'play'
    } else if (complete && drafting && commissioner) {
      play.note = 'STARTING THE SEASON'
    } else if (complete && drafting) {
      play.note = 'WAITING ON THE COMMISSIONER'
    } else {
      play.note = 'WAITING ON THE DRAFT'
    }
  }
  rows.push(play)

  let markedNext = false
  return rows.map((row) => {
    let mark = 'LATER'
    if (row.done) mark = 'DONE'
    else if (!markedNext) {
      mark = 'NEXT'
      markedNext = true
    }
    return {
      id: row.id,
      title: row.title,
      mark,
      note: row.note,
      action: row.action,
    }
  })
}

export function shouldAutoStart({
  status = '',
  commissioner = false,
  draft = null,
  startError = '',
  playError = '',
} = {}) {
  if (!commissioner || status !== 'drafting' || !draftComplete(draft)) return false
  if (String(startError || '').trim() || String(playError || '').trim()) return false
  return true
}
