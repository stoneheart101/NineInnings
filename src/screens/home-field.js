import { supabase } from '../supabase.js'
import { fetchHeld } from '../held-purse.js'
import { closePopup, popupKind } from '../popup.js'
import { WHY } from '../why.js'
import { HOME_PERKS, perkById, perkChoices } from '../home-perk.js'
import { teamTabRow } from '../team-tabs.js'

const NOTE = 'YOU ONLY GET ONE HOME FIELD ADVANTAGE THIS WAY. OTHERS COME FROM KIDS. IT STAYS ON FOR EVERY HOME GAME. AN AWAY GAME DOES NOT USE IT. A GAME DOES NOT SPEND IT.'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function seasonOf(team) {
  const season = Array.isArray(team?.seasons) ? team.seasons[0] : team?.seasons
  return season || null
}

export function renderHomeField(prompt, { teamId, setTeam, onDesk, onOpen }) {
  const token = String(Math.random())
  prompt.dataset.paint = token
  const state = {
    team: null,
    userId: '',
    error: '',
    kids: [],
    rosterError: '',
    perkBusy: false,
    perkId: '',
    perkError: '',
    missing: false,
    mine: false,
    loaded: false,
    held: { bottlecaps: 0, reputation: 0 },
  }

  function paint() {
    if (prompt.dataset.paint !== token) return
    if (popupKind() !== 'coach' && popupKind() !== 'season') closePopup()
    prompt.replaceChildren()
    const box = el('div', 'choices')

    if (!state.loaded) return
    if (state.missing || !state.team) {
      setTeam?.(null)
      onDesk?.({ seasonId: '', teamId: '' })
      box.append(el('p', '', 'THAT TEAM IS NOT HERE'))
      if (state.error) box.append(el('p', 'alert', state.error))
      prompt.append(box)
      return
    }
    if (!state.mine) {
      setTeam?.(null)
      onDesk?.({ seasonId: state.team.season_id, teamId: '' })
      box.append(el('p', '', 'THAT TEAM IS NOT YOURS'))
      prompt.append(box)
      return
    }

    onDesk?.({ seasonId: state.team.season_id, teamId: state.team.id })
    const season = seasonOf(state.team)
    setTeam?.({
      name: state.team.name,
      season: season?.name || 'SEASON',
      bottlecaps: state.team.bottlecaps,
      reputation: state.team.reputation,
      heldBottlecaps: state.held?.bottlecaps || 0,
      heldReputation: state.held?.reputation || 0,
    })
    prompt.append(teamTabRow('field', onOpen))
    if (state.error) box.append(el('p', 'alert', state.error))
    if (box.childNodes.length) prompt.append(box)
    prompt.append(fieldBlock())
  }

  function fieldBlock() {
    const wrap = el('div', 'home-field')
    const chosen = perkById(state.team?.home_perk)
    wrap.append(el('p', 'section', 'HOME FIELD'))
    wrap.append(el('p', '', chosen ? `THIS CANNOT BE CHANGED. ${NOTE}` : `PICK ONE. IT CANNOT BE CHANGED. ${NOTE}`))
    if (state.rosterError) wrap.append(el('p', 'alert', state.rosterError))
    const list = el('div', 'shelf-list')
    const shown = chosen ? [chosen] : HOME_PERKS
    for (const perk of shown) list.append(perkCard(perk, Boolean(chosen)))
    wrap.append(list)
    if (state.perkError) wrap.append(el('p', 'alert', state.perkError))
    const brought = perkChoices(state.kids)
    if (!state.rosterError && brought.length) {
      wrap.append(el('p', 'section', 'FROM THE KIDS'))
      const kids = el('div', 'shelf-list')
      for (const perk of brought) kids.append(kidCard(perk, chosen?.id || ''))
      wrap.append(kids)
    }
    return wrap
  }

  function perkCard(perk, locked) {
    const card = el('div', 'card kid-card')
    const head = el('div', 'card-head')
    const title = el('span', 'kid-title')
    title.append(el('span', locked ? 'season-name perk-on' : 'season-name', perk.label))
    head.append(title)
    if (!locked) {
      const button = el('button', '', 'CHOOSE')
      button.type = 'button'
      button.disabled = state.perkBusy
      button.addEventListener('click', () => onPerk(perk.id))
      const actions = el('div', 'card-actions')
      actions.append(button)
      head.append(actions)
    }
    card.append(head)
    card.append(el('span', '', perk.blurb))
    if (state.perkBusy && state.perkId === perk.id) card.append(el('p', 'why', WHY.perkSaving))
    return card
  }

  function kidCard(perk, chosenId) {
    const card = el('div', 'card kid-card')
    const head = el('div', 'card-head')
    head.append(el('span', 'card-title', perk.label))
    card.append(head)
    card.append(el('span', '', perk.blurb))
    card.append(el('span', '', `ON THE ROSTER: ${perk.kids.join(', ')}`))
    const same = perk.id === chosenId
    card.append(el('span', '', same
      ? 'THIS ONE IS ALREADY THE HOME FIELD.'
      : 'THIS ADDS ON AT HOME WHILE THAT KID IS ON THE TEAM.'))
    return card
  }

  async function onPerk(perk) {
    if (state.perkBusy || !state.team || state.team.home_perk) return
    state.perkBusy = true
    state.perkId = perk
    state.perkError = ''
    paint()
    const { error } = await supabase.rpc('set_home_perk', { team_id: state.team.id, perk })
    if (prompt.dataset.paint !== token) return
    state.perkBusy = false
    state.perkId = ''
    if (error) {
      state.perkError = (error.message || 'THE HOME FIELD DID NOT SAVE.').toUpperCase()
      paint()
      return
    }
    state.perkError = ''
    state.team.home_perk = perk
    await load()
  }

  async function load() {
    const [session, team] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('teams')
        .select('id, name, coach_id, bottlecaps, reputation, home_perk, season_id, seasons!teams_season_id_fkey(name, status)')
        .eq('id', teamId)
        .maybeSingle(),
    ])
    if (prompt.dataset.paint !== token) return
    state.userId = session.data.session?.user?.id ?? ''
    if (team.error) {
      state.error = (team.error.message || 'THE TEAM DID NOT LOAD.').toUpperCase()
      state.team = null
      state.missing = false
      state.mine = false
      state.loaded = true
      paint()
      return
    }
    if (!team.data) {
      state.missing = true
      state.team = null
      state.mine = false
      state.error = ''
      state.loaded = true
      paint()
      return
    }
    state.missing = false
    state.team = team.data
    state.mine = team.data.coach_id === state.userId
    state.error = ''
    if (!state.mine) {
      state.kids = []
      state.loaded = true
      paint()
      return
    }
    const [kids, held] = await Promise.all([
      supabase
        .from('players')
        .select('id, given_name, family_name, home_perk')
        .eq('team_id', teamId),
      fetchHeld(supabase, teamId),
    ])
    if (prompt.dataset.paint !== token) return
    state.held = held
    if (kids.error) {
      state.kids = []
      state.rosterError = 'THE ROSTER DID NOT LOAD.'
    } else {
      state.kids = kids.data || []
      state.rosterError = ''
    }
    state.loaded = true
    paint()
  }

  paint()
  load()
}
