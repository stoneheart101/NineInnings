export const CLUB_NAME_LIMIT = 16

export const CLUB_NAME_ERROR = "USE 1 TO 16 LETTERS, NUMBERS, SPACES, OR . ' -"

export function cleanClubName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export function clubNameOk(value) {
  return /^[A-Z0-9][A-Z0-9 .'-]{0,15}$/.test(value)
}
