function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

let stopKey = null
let onDismiss = null
let kindNow = ''

export function popupKind() {
  return kindNow
}

export function closePopup() {
  const back = document.querySelector('.popup-back')
  if (!back && !stopKey && !onDismiss) return
  if (stopKey) {
    stopKey()
    stopKey = null
  }
  kindNow = ''
  const dismiss = onDismiss
  onDismiss = null
  back?.remove()
  dismiss?.()
}

export function replacePopupBody(content) {
  const body = document.querySelector('.popup .popup-body')
  if (!body) return false
  body.replaceChildren()
  if (content) body.append(content)
  return true
}

export function mountPopup(_host, { title, note, actions, content, kind, onClose, focus }) {
  closePopup()
  kindNow = kind || ''
  onDismiss = onClose || null
  const back = el('div', 'popup-back')
  const box = el('div', 'popup card')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  if (title) box.setAttribute('aria-label', title)

  const head = el('div', 'card-head')
  head.append(el('p', 'card-title', title || ''))
  const actionRow = el('div', 'card-actions')
  const reasons = []
  for (const action of actions || []) {
    const button = el('button', '', action.label)
    button.type = action.submit ? 'submit' : 'button'
    if (action.form) button.setAttribute('form', action.form)
    if (action.disabled) button.disabled = true
    if (action.disabled && action.reason && !reasons.includes(action.reason)) reasons.push(action.reason)
    if (action.onClick) button.addEventListener('click', () => action.onClick())
    actionRow.append(button)
  }
  if (actionRow.childNodes.length) head.append(actionRow)
  box.append(head)

  const body = el('div', 'popup-body')
  for (const reason of reasons) body.append(el('p', 'why', reason))
  if (note) body.append(el('p', '', note))
  if (content) body.append(content)
  box.append(body)
  back.append(box)
  back.addEventListener('click', (event) => {
    if (event.target === back) closePopup()
  })
  const onKey = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closePopup()
  }
  document.addEventListener('keydown', onKey)
  stopKey = () => document.removeEventListener('keydown', onKey)
  document.body.append(back)
  if (focus) {
    focus(box)
    return
  }
  const buttons = actionRow.querySelectorAll('button')
  const target = buttons[buttons.length - 1] || box.querySelector('button, input, select')
  target?.focus({ preventScroll: true })
}
