const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function practiceWaitLabel(when) {
  return `PRACTICE AGAIN ${DAYS[when.getUTCDay()]} ${MONTHS[when.getUTCMonth()]} ${when.getUTCDate()}`
}

export function practiceGate({ status, everyDays, lastPractice, now }) {
  if (status !== 'active') {
    return { note: 'PRACTICE STARTS WHEN THE SEASON DOES', open: false }
  }
  const days = Number(everyDays)
  if (!Number.isInteger(days) || days < 1) {
    return { note: 'PRACTICE STARTS WHEN THE SEASON DOES', open: false }
  }
  if (!lastPractice) return { note: '', open: true }
  const last = new Date(lastPractice)
  if (Number.isNaN(last.getTime())) return { note: '', open: true }
  const ready = new Date(last.getTime() + days * 24 * 60 * 60 * 1000)
  if (ready.getTime() > now) return { note: practiceWaitLabel(ready), open: false }
  return { note: '', open: true }
}
