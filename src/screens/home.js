import { supabase } from '../supabase.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function counted(value, one, many) {
  return `${value} ${value === 1 ? one : many}`
}

function seasonName(team) {
  const season = Array.isArray(team.seasons) ? team.seasons[0] : team.seasons
  return season?.name || 'SEASON'
}

export function renderHome(prompt, { rulesVersion, onSeasons, onOpenTeam, setTabs }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = { teams: null, error: '' }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const head = el('div', 'choices')
    if (rulesVersion != null) head.append(el('p', '', `RULES v${rulesVersion}`))

    if (state.teams == null) {
      // The purse shows up when the list returns.
    } else if (!state.teams.length) {
      head.append(el('p', '', 'NO TEAMS YET'))
    } else {
      const list = el('div', 'team-list')
      for (const team of state.teams) {
        const card = el('button', 'team-card')
        card.type = 'button'
        card.addEventListener('click', () => onOpenTeam(team.id))
        card.append(
          el('span', 'season-name', team.name),
          el('span', '', `${counted(team.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(team.reputation, 'REPUTATION', 'REPUTATION')}`),
          el('span', 'season-status', seasonName(team)),
        )
        list.append(card)
      }
      head.append(list)
    }
    if (state.error) head.append(el('p', 'alert', state.error))
    setTabs?.([{ label: 'SEASONS', onClick: onSeasons }])
    prompt.append(head)
  }

  async function load() {
    const session = await supabase.auth.getSession()
    const userId = session.data.session?.user?.id
    if (!userId) {
      state.teams = []
      paint()
      return
    }
    const { data, error } = await supabase
      .from('teams')
      .select('id, name, bottlecaps, reputation, season_id, seasons!teams_season_id_fkey(name)')
      .eq('coach_id', userId)
      .order('created_at', { ascending: false })
    if (prompt.dataset.paint !== token) return
    if (error) {
      state.error = (error.message || 'THE TEAMS DID NOT LOAD.').toUpperCase()
      state.teams = []
    } else {
      state.teams = data || []
    }
    paint()
  }

  paint()
  load()
}
