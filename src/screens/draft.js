import { supabase } from '../supabase.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

let room = null

export function closeDraft() {
  if (!room) return
  const current = room
  room = null
  supabase.removeChannel(current)
}

export function renderDraft(prompt, { seasonId, onBack }) {
  closeDraft()
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    season: null,
    teams: [],
    draft: null,
    error: '',
    missing: false,
    loaded: false,
  }

  function teamName(id) {
    return state.teams.find((team) => team.id === id)?.name || 'TEAM'
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const box = el('div', 'choices')
    box.dataset.keys = 'on'
    const back = el('button', '', '1- BACK')
    back.type = 'button'
    back.addEventListener('click', onBack)
    box.append(back)

    if (!state.loaded) {
      prompt.append(box)
      return
    }
    if (state.missing || !state.season) {
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    box.append(el('p', 'season-title', state.season.name), el('p', 'season-status', 'THE DRAFT'))
    if (!state.draft) {
      box.append(el('p', '', 'THE DRAFT HAS NOT STARTED'))
    } else {
      const order = Array.isArray(state.draft.order) ? state.draft.order : []
      const rounds = Number(state.draft.rounds) || 0
      const perRound = rounds > 0 && order.length % rounds === 0 ? order.length / rounds : 0
      const clock = order[state.draft.pick_index]
      if (clock) box.append(el('p', 'season-role', `ON THE CLOCK: ${teamName(clock)}`))
      else if (order.length) box.append(el('p', 'season-role', 'THE DRAFT IS COMPLETE'))

      if (!perRound) {
        box.append(orderList(order, 0))
      } else {
        for (let round = 0; round < rounds; round += 1) {
          box.append(el('p', '', `ROUND ${round + 1}`))
          box.append(orderList(order.slice(round * perRound, (round + 1) * perRound), round * perRound))
        }
      }
    }
    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
  }

  function orderList(ids, start) {
    const list = el('div', 'draft-list')
    ids.forEach((id, index) => {
      const pick = start + index
      const row = el('div', 'draft-pick')
      row.append(el('span', 'season-name', `${pick + 1} ${teamName(id)}`))
      if (pick === state.draft.pick_index) {
        row.classList.add('on-clock')
        row.append(el('span', 'season-role', 'ON THE CLOCK'))
      }
      list.append(row)
    })
    return list
  }

  async function load() {
    const [season, teams, draft] = await Promise.all([
      supabase
        .from('seasons')
        .select('id, name, status')
        .eq('id', seasonId)
        .maybeSingle(),
      supabase
        .from('teams')
        .select('id, name')
        .eq('season_id', seasonId)
        .order('name', { ascending: true }),
      supabase
        .from('draft_state')
        .select('season_id, pick_index, order, rounds')
        .eq('season_id', seasonId)
        .maybeSingle(),
    ])
    if (prompt.dataset.paint !== token) return
    if (season.error || teams.error || draft.error) {
      state.error = ((season.error || teams.error || draft.error).message || 'THE DRAFT DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.draft = null
      state.missing = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
      state.draft = null
    } else {
      state.missing = false
      state.season = season.data
      state.teams = teams.data || []
      state.draft = draft.data
      state.error = ''
    }
    state.loaded = true
    paint()
  }

  room = supabase
    .channel(`draft:${seasonId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'draft_state',
        filter: `season_id=eq.${seasonId}`,
      },
      () => {
        if (prompt.dataset.paint !== token) {
          closeDraft()
          return
        }
        load()
      },
    )
    .subscribe()

  paint()
  load()
}
