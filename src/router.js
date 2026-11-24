// App routes live in the hash so a refresh on GitHub Pages still opens the same desk.
export function routeFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '')
  if (!raw || raw === '/') return '/'
  if (
    raw.startsWith('access_token=')
    || raw.startsWith('refresh_token=')
    || raw.startsWith('provider_token=')
    || raw.startsWith('expires_')
    || raw.startsWith('error=')
    || raw.startsWith('error_description=')
    || raw.includes('&access_token=')
  ) {
    return null
  }
  const path = raw.split('?')[0]
  if (path === '/seasons') return '/seasons'
  if (/^\/seasons\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/draft)?$/i.test(path)) return path
  if (/^\/teams\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/clubhouse)?$/i.test(path)) return path
  if (/^\/games\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/report)?$/i.test(path)) return path
  return '/'
}
