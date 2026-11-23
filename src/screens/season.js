import { supabase } from '../supabase.js'
import { statChip } from '../stat-color.js'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const STATS = [
  ['contact', 'CONTACT'],
  ['power', 'POWER'],
  ['eye', 'EYE'],
  ['speed', 'SPEED'],
  ['glove', 'GLOVE'],
  ['arm', 'ARM'],
  ['stamina', 'STAMINA'],
]

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

function whole(value, min, max) {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  if (number < min || number > max) return null
  return number
}

function coachName(team) {
  const profile = Array.isArray(team.profiles) ? team.profiles[0] : team.profiles
  return profile?.coach_name || 'COACH'
}

function draftIsOpen(season, draft) {
  if (season?.status !== 'drafting' || !draft) return false
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  return order.length > 0 && Number.isInteger(pickIndex) && pickIndex < order.length
}

function statusLabel(season, draft) {
  if (season?.status !== 'drafting' || !draft) return season.status.toUpperCase()
  const order = Array.isArray(draft.order) ? draft.order : []
  const pickIndex = Number(draft.pick_index)
  const complete = order.length > 0 && Number.isInteger(pickIndex) && pickIndex >= order.length
  return complete ? 'THE DRAFT IS COMPLETE' : season.status.toUpperCase()
}

export function renderSeason(prompt, { seasonId, onBack, onOpenDraft, onOpenTeam, onOpenClubhouse, setTabs }) {
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
    kids: null,
    count: '',
    draftError: '',
    draft: null,
    draftFailed: false,
    loaded: false,
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    prompt.replaceChildren()
    const season = state.loaded && !state.missing ? state.season : null
    const myTeam = season ? state.teams.find((team) => team.coach_id === state.userId) : null
    const forming = season?.status === 'forming'
    const draftOpen = season?.status === 'drafting' && (state.draftFailed || draftIsOpen(season, state.draft))
    const tabs = [{ label: 'BACK', onClick: onBack }]
    if (draftOpen) {
      tabs.push({ label: 'THE DRAFT', onClick: () => onOpenDraft?.() })
    }
    if (myTeam) {
      tabs.push({ label: 'THE ROSTER', onClick: () => onOpenTeam?.(myTeam.id) })
      tabs.push({ label: 'CLUBHOUSE', onClick: () => onOpenClubhouse?.(myTeam.id) })
    }
    if (forming && season.commissioner_id === state.userId) {
      tabs.push({ label: 'START THE DRAFT', disabled: state.busy, onClick: onStart })
    }
    setTabs?.(tabs)
    prompt.append(el('h2', 'screen-name', 'SEASON'))

    if (!state.loaded) return
    if (state.missing || !state.season) {
      const box = el('div', 'choices')
      box.append(el('p', '', 'THAT SEASON IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }

    if (forming && season.commissioner_id === state.userId) {
      const draftNote = state.draftError || (state.teams.length < 2 ? 'NEED AT LEAST TWO TEAMS' : '')
      if (draftNote) prompt.append(el('p', 'alert', draftNote))
    }

    const box = el('div', 'choices')
    const days = (season.official_weekdays || []).map((day) => DAYS[day] || '').filter(Boolean)
    const practice = season.practice_every_days === 1
      ? 'EVERY 1 DAY'
      : `EVERY ${season.practice_every_days} DAYS`
    const weeks = season.weeks === 1 ? '1 WEEK' : `${season.weeks} WEEKS`
    const rounds = season.draft_rounds === 1 ? '1 ROUND' : `${season.draft_rounds} ROUNDS`
    box.append(
      el('p', 'season-title', season.name),
      el('p', 'season-status', statusLabel(season, state.draftFailed ? null : state.draft)),
      el('p', '', `OFFICIAL GAMES ON ${days.join(' ')}`),
      el('p', '', `${practice} · ${weeks} · ${rounds}`),
    )
    if (season.commissioner_id === state.userId) {
      box.append(el('p', 'season-role', 'YOU ARE THE COMMISSIONER'))
    }

    box.append(el('p', 'section', 'TEAMS'))
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

    if (forming && !myTeam) {
      box.append(form())
    } else if (!myTeam) {
      box.append(el('p', '', 'TEAMS JOIN WHILE THE SEASON IS FORMING'))
    }
    if (forming && season.commissioner_id === state.userId) {
      box.append(callForm())
    }
    if (state.kids) {
      const pool = state.kids.filter((kid) => !kid.team_id)
      box.append(el('p', 'section', 'THE POOL'))
      if (!state.kids.length) {
        box.append(el('p', '', 'NO KIDS YET'))
      } else if (!pool.length) {
        box.append(el('p', '', 'NO KIDS LEFT'))
      } else {
        box.append(el('p', '', counted(pool.length, 'KID', 'KIDS')))
        const list = el('div', 'kid-list')
        for (const kid of pool) list.append(kidCard(kid))
        box.append(list)
      }
    }

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

    const save = el('button', '', 'NAME THE TEAM')
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'NAME YOUR TEAM'), nameLabel, save)
    node.addEventListener('submit', onSubmit)
    return node
  }

  function callForm() {
    const node = document.createElement('form')
    node.className = 'call-kids'
    const count = document.createElement('input')
    count.className = 'num'
    count.name = 'kid-count'
    count.type = 'number'
    count.inputMode = 'numeric'
    count.required = true
    count.min = '1'
    count.max = '40'
    count.step = '1'
    count.value = state.count
    const countLabel = el('label')
    countLabel.append(el('span', '', 'HOW MANY'), count)
    const save = el('button', '', 'CALL THE KIDS')
    save.type = 'submit'
    save.disabled = state.busy
    node.append(el('p', '', 'CALL THE KIDS'), el('p', '', '1 TO 40 AT A TIME'), countLabel, save)
    node.addEventListener('submit', onCall)
    return node
  }

  function kidCard(kid) {
    const card = el('div', 'kid-card')
    const name = [kid.given_name, kid.family_name].filter(Boolean).join(' ')
    card.append(el('span', 'season-name', name || 'KID'))
    if (kid.nickname) card.append(el('span', '', `"${kid.nickname}"`))
    if (kid.flavor) card.append(el('span', '', kid.flavor))
    const stats = el('span', 'kid-stats')
    for (const [stat, label] of STATS) stats.append(statChip(label, kid.base_stats?.[stat]))
    card.append(stats)
    return card
  }

  async function onStart() {
    if (state.busy) return
    state.busy = true
    state.draftError = ''
    paint()
    const { error } = await supabase.rpc('start_draft', { season_id: seasonId })
    if (prompt.dataset.paint !== token) return
    state.busy = false
    if (error) {
      state.draftError = (error.message || 'THE DRAFT DID NOT START.').toUpperCase()
      paint()
      return
    }
    onOpenDraft?.()
  }

  async function onCall(event) {
    event.preventDefault()
    if (state.busy) return
    const data = new FormData(event.currentTarget)
    const raw = String(data.get('kid-count') || '')
    state.count = raw
    const kidCount = whole(raw, 1, 40)
    if (kidCount == null) {
      state.error = 'CALL BETWEEN 1 AND 40 KIDS'
      paint()
      return
    }
    state.busy = true
    state.error = ''
    const button = event.currentTarget.querySelector('button')
    if (button) button.disabled = true
    const { error } = await supabase.rpc('call_kids', {
      season_id: seasonId,
      kid_count: kidCount,
    })
    state.busy = false
    if (error) {
      state.error = (error.message || 'THE KIDS DID NOT COME.').toUpperCase()
      paint()
      return
    }
    state.count = ''
    await load()
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
    const [session, season, teams, kids, draft] = await Promise.all([
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
      supabase
        .from('players')
        .select('id, team_id, given_name, family_name, nickname, flavor, base_stats, created_at')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('draft_state')
        .select('pick_index,order')
        .eq('season_id', seasonId)
        .maybeSingle(),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    state.kids = null
    state.draftFailed = Boolean(draft.error)
    state.draft = draft.error ? null : draft.data
    if (season.error || teams.error) {
      state.error = ((season.error || teams.error).message || 'THE SEASON DID NOT LOAD.').toUpperCase()
      state.season = null
      state.teams = []
      state.missing = false
      state.draft = null
      state.draftFailed = false
    } else if (!season.data) {
      state.missing = true
      state.season = null
      state.teams = []
      state.draft = null
      state.draftFailed = false
    } else {
      state.missing = false
      state.season = season.data
      state.teams = teams.data || []
      if (kids.error) {
        state.error = (kids.error.message || 'THE KIDS DID NOT LOAD.').toUpperCase()
      } else {
        state.kids = kids.data || []
      }
    }
    state.loaded = true
    paint()
  }

  paint()
  load()
}
