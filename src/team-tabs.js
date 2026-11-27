import { teamTabs } from './menu.js'

export function teamTabRow(active, onOpen) {
  const row = document.createElement('div')
  row.className = 'subtabs'
  for (const tab of teamTabs()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = active === tab.id ? 'on' : ''
    button.textContent = tab.label
    button.setAttribute('aria-pressed', active === tab.id ? 'true' : 'false')
    button.addEventListener('click', () => {
      if (active === tab.id) return
      onOpen?.(tab.id)
    })
    row.append(button)
  }
  return row
}
