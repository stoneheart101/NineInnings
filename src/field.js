import { coachMenuBlocks, headerLines } from './header.js'
import { WHY } from './why.js'

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
      if (item.disabled && item.reason) tabs.append(el('p', 'why', item.reason))
    }
  }

  function setTeam(info) {
    teamInfo.replaceChildren()
    const lines = headerLines(info)
    if (!lines) {
      teamInfo.hidden = true
      return
    }
    teamInfo.hidden = false
    const classes = { name: 'team-name', purse: 'team-purse' }
    for (const line of lines) teamInfo.append(el('p', classes[line.role], line.text))
  }

  let coachHooks = {}
  let signOutAlert = ''
  let stopMenu = null

  function coachPanel() {
    return userMenu.querySelector('.coach-dropdown')
  }

  function closeCoachMenu() {
    coachPanel()?.remove()
    userMenu.querySelector('.coach-toggle')?.setAttribute('aria-expanded', 'false')
    if (stopMenu) {
      stopMenu()
      stopMenu = null
    }
  }

  function paintCoachMenu() {
    const panel = coachPanel()
    if (!panel) return
    panel.replaceChildren(menuBody(coachHooks))
  }

  function openCoachMenu() {
    const fresh = !coachPanel()
    if (fresh) {
      userMenu.append(el('div', 'coach-dropdown card'))
      const onDoc = (event) => {
        if (userMenu.contains(event.target)) return
        closeCoachMenu()
      }
      const onKey = (event) => {
        if (event.key !== 'Escape' || !coachPanel()) return
        event.preventDefault()
        closeCoachMenu()
      }
      document.addEventListener('click', onDoc)
      document.addEventListener('keydown', onKey)
      stopMenu = () => {
        document.removeEventListener('click', onDoc)
        document.removeEventListener('keydown', onKey)
      }
      coachHooks.onOpen?.()
    }
    paintCoachMenu()
    userMenu.querySelector('.coach-toggle')?.setAttribute('aria-expanded', 'true')
  }

  function menuBody(details) {
    const body = el('div', 'coach-menu')
    const alert = el('p', 'alert', signOutAlert)
    alert.hidden = !signOutAlert
    for (const block of coachMenuBlocks(details)) {
      if (block.kind === 'rules') body.append(el('p', 'coach-rules', block.text))
      if (block.kind === 'note') body.append(el('p', 'coach-viewing', block.text))
      if (block.kind === 'empty') body.append(el('p', 'coach-empty', block.text))
      if (block.kind === 'seasons') {
        const list = el('div', 'coach-seasons')
        for (const row of block.seasons) {
          const button = el('button', row.open ? 'coach-season on' : 'coach-season', '')
          button.type = 'button'
          if (row.open) button.setAttribute('aria-current', 'true')
          button.append(
            el('span', 'coach-season-name', row.season.name),
            el('span', '', row.season.status || ''),
          )
          button.addEventListener('click', () => {
            closeCoachMenu()
            details.onPickSeason?.(row.season)
          })
          list.append(button)
        }
        body.append(list)
      }
      if (block.kind === 'open') {
        const openSeason = el('button', '', 'OPEN A SEASON')
        openSeason.type = 'button'
        openSeason.addEventListener('click', () => {
          const reopen = () => openCoachMenu()
          closeCoachMenu()
          details.onOpenSeason?.({ reopen })
        })
        body.append(openSeason)
      }
      if (block.kind === 'sign-out') {
        const signOut = el('button', 'coach-sign-out', 'SIGN OUT')
        signOut.type = 'button'
        signOut.addEventListener('click', async () => {
          signOut.disabled = true
          signOut.after(el('p', 'why', WHY.signingOut))
          signOutAlert = ''
          alert.hidden = true
          const message = onSignOut ? await onSignOut() : ''
          if (!message) {
            signOutAlert = ''
            closeCoachMenu()
            return
          }
          signOutAlert = message
          paintCoachMenu()
        })
        body.append(signOut, alert)
      }
    }
    return body
  }

  function setCoach(name, details = {}) {
    coachHooks = details
    const cleaned = String(name || '').trim()
    if (!cleaned) {
      closeCoachMenu()
      signOutAlert = ''
      userMenu.replaceChildren()
      userMenu.hidden = true
      return
    }
    userMenu.hidden = false
    const current = userMenu.querySelector('.coach-toggle')
    if (current && current.textContent === cleaned) {
      paintCoachMenu()
      return
    }
    closeCoachMenu()
    userMenu.replaceChildren()
    const toggle = el('button', 'coach-toggle', cleaned)
    toggle.type = 'button'
    toggle.title = cleaned
    toggle.setAttribute('aria-haspopup', 'true')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      if (coachPanel()) closeCoachMenu()
      else openCoachMenu()
    })
    userMenu.append(toggle)
  }

  return { prompt, setCoach, setTeam, setTabs }
}
