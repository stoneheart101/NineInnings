function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
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

export function drawField(root, { onSignOut } = {}) {
  root.replaceChildren()

  const header = el('header', 'header')
  const logo = el('div', 'logo')
  logo.innerHTML = DIAMOND
  const teamInfo = el('div', 'team-info')
  teamInfo.hidden = true
  const corner = el('div', 'corner')
  const brand = el('h1', 'brand', 'NineInnings')
  const userMenu = el('div', 'user-menu')
  userMenu.hidden = true
  corner.append(brand, userMenu)
  header.append(logo, teamInfo, corner)

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

  function closeMenu() {
    const panel = userMenu.querySelector('.coach-menu')
    const toggle = userMenu.querySelector('.coach-toggle')
    if (panel) panel.hidden = true
    if (toggle) toggle.setAttribute('aria-expanded', 'false')
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
      el('p', 'team-purse', info.purse || ''),
    )
  }

  let coachHooks = {}

  function fillCoachMenu(panel, details) {
    let rules = panel.querySelector('.coach-rules')
    if (!rules) {
      rules = el('p', 'coach-rules', '')
      panel.prepend(rules)
    }
    if (details.rulesVersion == null) {
      rules.hidden = true
      rules.textContent = ''
    } else {
      rules.hidden = false
      rules.textContent = `RULES v${details.rulesVersion}`
    }

    const signOut = panel.querySelector('.coach-sign-out')
    let list = panel.querySelector('.coach-teams')
    if (!list) {
      list = el('div', 'coach-teams')
      panel.insertBefore(list, signOut)
    }
    list.replaceChildren()
    const teams = details.teams
    let empty = panel.querySelector('.coach-empty')
    if (teams == null) {
      list.hidden = true
      if (empty) empty.hidden = true
      return
    }
    if (!teams.length) {
      list.hidden = true
      if (!empty) {
        empty = el('p', 'coach-empty', 'NO TEAMS YET')
        panel.insertBefore(empty, signOut)
      }
      empty.hidden = false
      return
    }
    list.hidden = false
    if (empty) empty.hidden = true
    for (const team of teams) {
      const open = team.id === details.teamId
      const button = el('button', open ? 'coach-team on' : 'coach-team')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      if (open) button.setAttribute('aria-current', 'true')
      button.append(
        el('span', 'coach-team-name', team.name),
        el('span', '', team.season || 'SEASON'),
        el('span', '', team.purse || ''),
      )
      button.addEventListener('click', () => {
        closeMenu()
        details.onPickTeam?.(team)
      })
      list.append(button)
    }
  }

  function setCoach(name, details = {}) {
    coachHooks = details
    const cleaned = String(name || '').trim()
    if (!cleaned) {
      userMenu.replaceChildren()
      userMenu.hidden = true
      return
    }
    userMenu.hidden = false
    const current = userMenu.querySelector('.coach-toggle')
    const currentPanel = userMenu.querySelector('.coach-menu')
    if (current && currentPanel && current.textContent === cleaned) {
      fillCoachMenu(currentPanel, details)
      return
    }
    userMenu.replaceChildren()
    const toggle = el('button', 'coach-toggle', cleaned)
    toggle.type = 'button'
    toggle.title = cleaned
    toggle.setAttribute('aria-haspopup', 'menu')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-controls', 'coach-menu')
    const panel = el('div', 'coach-menu')
    panel.id = 'coach-menu'
    panel.hidden = true
    panel.setAttribute('role', 'menu')
    const signOut = el('button', 'coach-sign-out', 'SIGN OUT')
    signOut.type = 'button'
    signOut.setAttribute('role', 'menuitem')
    const alert = el('p', 'alert', '')
    alert.hidden = true
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      const opening = panel.hidden
      panel.hidden = !opening
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false')
      if (opening) coachHooks.onOpen?.()
    })
    signOut.addEventListener('click', async () => {
      signOut.disabled = true
      alert.hidden = true
      const message = onSignOut ? await onSignOut() : ''
      signOut.disabled = false
      if (!message) {
        closeMenu()
        return
      }
      alert.textContent = message
      alert.hidden = false
      panel.hidden = false
      toggle.setAttribute('aria-expanded', 'true')
    })
    panel.append(signOut, alert)
    fillCoachMenu(panel, details)
    userMenu.append(toggle, panel)
  }

  document.addEventListener('click', (event) => {
    if (userMenu.hidden || userMenu.contains(event.target)) return
    closeMenu()
  })
  document.addEventListener('keydown', (event) => {
    const panel = userMenu.querySelector('.coach-menu')
    if (!panel || panel.hidden || event.key !== 'Escape') return
    event.preventDefault()
    closeMenu()
    userMenu.querySelector('.coach-toggle')?.focus()
  })

  return { prompt, setCoach, setTeam, setTabs }
}
