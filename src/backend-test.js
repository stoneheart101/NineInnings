import { supabase } from './supabase.js'

const HISTORY_LIMIT = 1000

const stamp = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function formatWhen(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return stamp.format(date).toUpperCase()
}

function formatRemain(ms) {
  if (ms <= 0) return 'DUE NOW'
  const total = Math.ceil(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `IN ${hours}:${clock}` : `IN ${clock}`
}

export function mountBackendTest(root) {
  const opener = el('button', 'backend-open', 'BACKEND TEST')
  opener.type = 'button'
  const prompt = root.querySelector('#prompt')
  root.insertBefore(opener, prompt)

  const dialog = el('dialog', 'backend-test')
  dialog.setAttribute('aria-labelledby', 'backend-test-title')

  const head = el('div', 'backend-head')
  const title = el('h2', '', 'BACKEND TEST')
  title.id = 'backend-test-title'
  const close = el('button', '', 'CLOSE')
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  head.append(title, close)

  const schedule = el('p', 'backend-schedule', 'RUNS EVERY 15 MINUTES')
  const next = el('p', 'backend-next', 'NEXT RUN')
  const remain = el('p', 'backend-remain', '')
  const status = el('p', 'backend-status', '')
  const columns = el('div', 'pick-columns')
  columns.append(el('span', '', 'NUMBER'), el('span', '', 'PICKED'))
  const list = el('ol', 'picks')

  dialog.append(head, schedule, next, remain, status, columns, list)
  document.body.append(dialog)

  let nextAt = null
  let dueReload = false
  let loading = false
  let timer = 0
  let poll = 0

  function paintClock() {
    if (!nextAt) {
      remain.textContent = ''
      return
    }
    const ms = nextAt.getTime() - Date.now()
    remain.textContent = formatRemain(ms)
    if (ms <= 0 && !dueReload) {
      dueReload = true
      load()
    }
  }

  async function load() {
    if (loading) return
    loading = true
    try {
      const [picks, state] = await Promise.all([
        supabase
          .from('backend_picks')
          .select('picked_number, picked_at', { count: 'exact' })
          .order('picked_at', { ascending: false })
          .limit(HISTORY_LIMIT),
        supabase.from('backend_test_state').select('next_run').eq('id', 1).maybeSingle(),
      ])
      if (picks.error) throw picks.error
      if (state.error) throw state.error

      const rows = picks.data || []
      list.replaceChildren()
      if (!rows.length) {
        list.append(el('li', 'pick-empty', 'NO NUMBERS YET'))
      } else {
        for (const row of rows) {
          const item = el('li', 'pick')
          item.append(el('span', 'pick-number', String(row.picked_number).padStart(3, '0')))
          const when = document.createElement('time')
          when.dateTime = row.picked_at
          when.textContent = formatWhen(row.picked_at)
          item.append(when)
          list.append(item)
        }
      }

      const total = picks.count
      status.textContent = total != null && total > rows.length
        ? `SHOWING THE LATEST ${rows.length} OF ${total}`
        : ''

      if (state.data?.next_run) {
        nextAt = new Date(state.data.next_run)
        next.textContent = `NEXT RUN ${formatWhen(state.data.next_run)}`
        if (nextAt.getTime() > Date.now()) dueReload = false
      } else {
        nextAt = null
        next.textContent = 'NEXT RUN NOT SCHEDULED'
        dueReload = false
      }
      paintClock()
    } catch (error) {
      status.textContent = (error.message || 'COULD NOT LOAD THE BACKEND TEST.').toUpperCase()
    } finally {
      loading = false
    }
  }

  opener.addEventListener('click', () => {
    dialog.showModal()
    load()
    window.clearInterval(timer)
    window.clearInterval(poll)
    timer = window.setInterval(paintClock, 1000)
    poll = window.setInterval(load, 10000)
  })

  function stop() {
    window.clearInterval(timer)
    window.clearInterval(poll)
  }

  dialog.addEventListener('close', stop)
}
