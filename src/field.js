import { closePopup, mountPopup, popupKind, replacePopupBody } from './popup.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function headerPurse(info) {
  const caps = Number(info?.bottlecaps)
  const rep = Number(info?.reputation)
  return `${Number.isFinite(caps) ? caps : 0} BC · ${Number.isFinite(rep) ? rep : 0} REP`
}

const DIAMOND = `
  <svg viewBox="0 0 320 250" role="img" aria-label="NineInnings">
    <polygon points="24,22 296,22 232,156 160,228 88,156" fill="var(--field)" stroke="#fff" stroke-width="2"/>
    <polygon points="160,204 214,148 160,92 106,148" fill="none" stroke="#fff" stroke-width="2"/>
    <polygon points="160,214 170,204 170,196 150,196 150,204" fill="#fff"/>
    <rect x="-6" y="-6" width="12" height="12" fill="#fff" transform="translate(214,148) rotate(45)"/>
    <rect x="-6" y="-6" width="12" height="12" fill="#fff" transform="translate(160,92) rotate(45)"/>
    <rect x="-6" y="-6" width="12" height="12" fill="#fff" transform="translate(106,148) rotate(45)"/>
    <g fill="var(--player)">
      <g transform="translate(160,208)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(160,148)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(228,156)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(176,104)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(128,118)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(92,156)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(78,78)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(160,58)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      <g transform="translate(242,78)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
    </g>
  </svg>
`

export function signDiamond() {
  const node = el('div', 'sign-diamond')
  node.innerHTML = DIAMOND
  return node
}

export function drawField(root, { onSignOut } = {}) {
  root.replaceChildren()

  const header = el('header', 'header')
  const teamInfo = el('div', 'team-info')
  teamInfo.hidden = true
  const corner = el('div', 'corner')
  const brand = el('h1', 'brand', 'NineInnings')
  const userMenu = el('div', 'user-menu')
  userMenu.hidden = true
  corner.append(brand, userMenu)
  header.append(teamInfo, corner)

  const tabs = el('nav', 'tabs')
  tabs.hidden = true
  tabs.setAttribute('aria-label', 'Menu')

  const prompt = el('div', 'prompt')
  prompt.id = 'prompt'
  root.append(header, tabs, prompt)

  function setTabs(items) {
    tabs.replaceChildren()
    const list = Array.isArray(items) ? items.filter((item) => item?.label) : []
    if (!list.length) {
      tabs.hidden = true
      return
    }
    tabs.hidden = false
    for (const item of list) {
      const button = el('button', item.on ? 'on' : '', item.label)
      button.type = 'button'
      if (item.disabled) button.disabled = true
      if (item.onClick) button.addEventListener('click', item.onClick)
      tabs.append(button)
    }
  }

  function setTeam(info) {
    teamInfo.replaceChildren()
    if (!info?.name) {
      teamInfo.hidden = true
      return
    }
    teamInfo.hidden = false
    teamInfo.append(
      el('p', 'team-name', info.name),
      el('p', 'team-season', info.season || 'SEASON'),
      el('p', 'team-purse', headerPurse(info)),
    )
  }

  let coachHooks = {}
  let signOutAlert = ''

  function menuBody(details) {
    const body = el('div', 'coach-menu')
    if (details.rulesVersion != null) {
      body.append(el('p', 'coach-rules', `RULES v${details.rulesVersion}`))
    }
    const teams = details.teams
    if (Array.isArray(teams) && teams.length) {
      const list = el('div', 'coach-teams')
      for (const team of teams) {
        const open = team.id === details.teamId
        const button = el('button', open ? 'coach-team on' : 'coach-team', '')
        button.type = 'button'
        if (open) button.setAttribute('aria-current', 'true')
        button.append(
          el('span', 'coach-team-name', team.name),
          el('span', '', team.season || 'SEASON'),
          el('span', '', team.purse || ''),
        )
        button.addEventListener('click', () => {
          closePopup()
          details.onPickTeam?.(team)
        })
        list.append(button)
      }
      body.append(list)
    } else if (Array.isArray(teams)) {
      body.append(el('p', 'coach-empty', 'NO TEAMS YET'))
    }
    const openSeason = el('button', '', 'OPEN A SEASON')
    openSeason.type = 'button'
    openSeason.addEventListener('click', () => {
      const reopen = () => showCoach()
      closePopup()
      details.onOpenSeason?.({ reopen })
    })
    body.append(openSeason)
    const signOut = el('button', 'coach-sign-out', 'SIGN OUT')
    signOut.type = 'button'
    const alert = el('p', 'alert', signOutAlert)
    alert.hidden = !signOutAlert
    signOut.addEventListener('click', async () => {
      signOut.disabled = true
      signOutAlert = ''
      alert.hidden = true
      const message = onSignOut ? await onSignOut() : ''
      if (!message) {
        signOutAlert = ''
        closePopup()
        return
      }
      signOutAlert = message
      if (popupKind() === 'coach') replacePopupBody(menuBody(coachHooks))
    })
    body.append(signOut, alert)
    return body
  }

  function showCoach() {
    const toggle = userMenu.querySelector('.coach-toggle')
    const name = toggle?.textContent || 'COACH'
    mountPopup(document.body, {
      title: name,
      kind: 'coach',
      content: menuBody(coachHooks),
      actions: [{ label: 'CLOSE', onClick() { closePopup() } }],
      onClose() {
        toggle?.setAttribute('aria-expanded', 'false')
      },
    })
    toggle?.setAttribute('aria-expanded', 'true')
    coachHooks.onOpen?.()
  }

  function setCoach(name, details = {}) {
    coachHooks = details
    const cleaned = String(name || '').trim()
    if (!cleaned) {
      closePopup()
      signOutAlert = ''
      userMenu.replaceChildren()
      userMenu.hidden = true
      return
    }
    userMenu.hidden = false
    const current = userMenu.querySelector('.coach-toggle')
    if (current && current.textContent === cleaned) {
      if (popupKind() === 'coach') replacePopupBody(menuBody(details))
      return
    }
    if (popupKind() === 'coach') closePopup()
    userMenu.replaceChildren()
    const toggle = el('button', 'coach-toggle', cleaned)
    toggle.type = 'button'
    toggle.title = cleaned
    toggle.setAttribute('aria-haspopup', 'dialog')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      if (popupKind() === 'coach') {
        closePopup()
        return
      }
      showCoach()
    })
    userMenu.append(toggle)
  }

  return { prompt, setCoach, setTeam, setTabs }
}
