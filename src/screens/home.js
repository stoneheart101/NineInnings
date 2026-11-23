function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function renderHome(prompt, { coachName, onSeasons, onSignOut }) {
  prompt.replaceChildren()
  const box = el('div', 'choices')
  box.dataset.keys = 'on'

  const seasons = el('button', '', '1- SEASONS')
  seasons.type = 'button'
  seasons.addEventListener('click', onSeasons)

  const signOut = el('button', '', '2- SIGN OUT')
  signOut.type = 'button'
  signOut.addEventListener('click', onSignOut)

  box.append(
    el('p', '', `COACH: ${coachName}`),
    el('p', '', 'NO TEAMS YET'),
    seasons,
    signOut,
    el('p', '', 'WHICH?'),
  )
  prompt.append(box)
}
