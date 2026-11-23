function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

let stopKey = null

export function closePopup() {
  if (!stopKey) return
  stopKey()
  stopKey = null
}

export function mountPopup(prompt, { title, note, actions, onClose }) {
  closePopup()
  const back = el('div', 'popup-back')
  const box = el('div', 'popup')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  if (title) box.setAttribute('aria-label', title)
  if (title) box.append(el('p', 'popup-title', title))
  if (note) box.append(el('p', '', note))
  const list = el('div', 'popup-actions')
  for (const action of actions || []) {
    const button = el('button', '', action.label)
    button.type = 'button'
    if (action.disabled) button.disabled = true
    button.addEventListener('click', () => action.onClick?.())
    list.append(button)
  }
  box.append(list)
  back.append(box)
  back.addEventListener('click', (event) => {
    if (event.target === back) onClose?.()
  })
  const onKey = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose?.()
  }
  document.addEventListener('keydown', onKey)
  stopKey = () => document.removeEventListener('keydown', onKey)
  prompt.append(back)
  const buttons = list.querySelectorAll('button')
  buttons[buttons.length - 1]?.focus({ preventScroll: true })
}
