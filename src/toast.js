let node = null
let toastOwner = null

export function showToast(message, owner = true) {
  const text = String(message || '').trim()
  if (!text) {
    hideToast(owner)
    return
  }
  toastOwner = owner
  if (!node || !node.isConnected) {
    node = document.createElement('p')
    node.className = 'toast'
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    document.body.append(node)
  }
  node.textContent = text
  node.hidden = false
}

export function hideToast(owner) {
  if (owner !== undefined && owner !== toastOwner) return
  toastOwner = null
  if (node) node.hidden = true
}
