function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function renderHome(prompt, { coachName, rulesVersion, onSeasons, onSignOut }) {
  prompt.replaceChildren()
  const box = el('div', 'choices')
  box.dataset.keys = 'on'

  const seasons = el('button', '', '1- SEASONS')
  seasons.type = 'button'
  seasons.addEventListener('click', onSeasons)

  const signOut = el('button', '', '2- SIGN OUT')
  signOut.type = 'button'
  signOut.addEventListener('click', onSignOut)

  const lines = [el('p', '', `COACH: ${coachName}`)]
  if (rulesVersion != null) lines.push(el('p', '', `RULES v${rulesVersion}`))
  lines.push(el('p', '', 'NO TEAMS YET'), seasons, signOut, el('p', '', 'WHICH?'))
  box.append(...lines)
  prompt.append(box)
}
