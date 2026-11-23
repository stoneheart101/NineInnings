import { supabase } from '../supabase.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function counted(value, one, many) {
  return `${value} ${value === 1 ? one : many}`
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function coachName(team) {
  const profile = Array.isArray(team.profiles) ? team.profiles[0] : team.profiles
  return profile?.coach_name || 'COACH'
}

export function renderSeason(prompt, { seasonId, onBack }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    season: null,
    teams: [],
    userId: '',
    error: '',
    missing: false,
    busy: false,
    name: '',
    loaded: false,
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

    const season = state.season
    const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
    const practice = season.practice_every_days === 1
      ? 'EVERY 1 DAY'
      : `EVERY ${season.practice_every_days} DAYS`
    const weeks = season.weeks === 1 ? '1 WEEK' : `${season.weeks} WEEKS`
    const rounds = season.draft_rounds === 1 ? '1 ROUND' : `${season.draft_rounds} ROUNDS`
    box.append(
      el('p', 'season-title', season.name),
      el('p', 'season-status', season.status.toUpperCase()),
      el('p', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
      el('p', '', `${practice} · ${weeks} · ${rounds}`),
    )
    if (season.commissioner_id === state.userId) {
      box.append(el('p', 'season-role', 'YOU ARE THE COMMISSIONER'))
    }

    box.append(el('p', '', 'TEAMS'))
    if (!state.teams.length) {
      box.append(el('p', '', 'NO TEAMS YET'))
    } else {
      const list = el('div', 'team-list')
      for (const team of state.teams) {
        const card = el('div', 'team-card')
        card.append(el('span', 'season-name', team.name), el('span', '', coachName(team)))
        if (team.coach_id === state.userId) {
          card.append(el('span', 'season-role', `YOUR TEAM · ${counted(team.bottlecaps, 'BOTTLECAP', 'BOTTLECAPS')} · ${counted(team.reputation, 'REPUTATION', 'REPUTATION')}`))
        }
        list.append(card)
      }
      box.append(list)
    }

    const mine = state.teams.some((team) => team.coach_id === state.userId)
    if (season.status === 'forming' && !mine) box.append(form())
    else if (!mine) box.append(el('p', '', 'TEAMS JOIN WHILE THE SEASON IS FORMING'))

    if (state.error) box.append(el('p', 'alert', state.error))
    prompt.append(box)
  }

  function form() {
    const node = document.createElement('form')
    node.className = 'name-team'
    const name = document.createElement('input')
    name.name = 'team-name'
    name.required = true
    name.maxLength = 40
    name.autocomplete = 'off'
    name.spellcheck = false
    name.value = state.name
    const nameLabel = el('label')
    nameLabel.append(el('span', '', 'NAME'), name)

    const save = el('button', '', '2- NAME THE TEAM')
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'NAME YOUR TEAM'), nameLabel, save)
    node.addEventListener('submit', onSubmit)
    return node
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (state.busy) return
    const data = new FormData(event.currentTarget)
    const teamName = cleanName(String(data.get('team-name') || ''))
    state.name = teamName
    if (!/^[A-Z0-9][A-Z0-9 .'-]{0,39}$/.test(teamName)) {
      state.error = "USE 1 TO 40 LETTERS, NUMBERS, SPACES, OR . ' -"
      paint()
      return
    }
    state.busy = true
    state.error = ''
    const button = event.currentTarget.querySelector('button')
    if (button) button.disabled = true
    const { error } = await supabase.rpc('create_team', {
      season_id: seasonId,
      team_name: teamName,
    })
    state.busy = false
    if (error) {
      state.error = (error.message || 'THAT TEAM WAS NOT NAMED.').toUpperCase()
      paint()
      return
    }
    state.name = ''
    await load()
  }

  async function load() {
    const [session, season, teams] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('seasons')
        .select('id, name, commissioner_id, status, official_weekdays, practice_every_days, weeks, draft_rounds')
        .eq('id', seasonId)
        .maybeSingle(),
      supabase
        .from('teams')
        .select('id, name, coach_id, bottlecaps, reputation, profiles!teams_coach_id_fkey(coach_name)')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true }),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    if (season.error || teams.error) {
      state.error = ((season.error || teams.error).message || 'THE SEASON DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.missing = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
    } else {
      state.missing = false
      state.season = season.data
      state.teams = teams.data || []
    }
    state.loaded = true
    paint()
  }

  paint()
  load()
}
