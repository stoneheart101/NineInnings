function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function renderSeasons(prompt, { onBack }) {
  prompt.replaceChildren()
  const box = el('div', 'choices')
  box.dataset.keys = 'on'
  const back = el('button', '', '1- BACK')
  back.type = 'button'
  back.addEventListener('click', onBack)
  box.append(el('p', '', 'NO SEASONS YET'), back)
  prompt.append(box)
}
