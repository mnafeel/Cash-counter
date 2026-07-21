/** Normalize hash-router paths like /%2Fpurchase → /purchase */
export function normalizeRoutePath(pathname: string): string {
  let path = pathname || '/'
  if (path.includes('%')) {
    try {
      path = decodeURIComponent(path)
    } catch {
      // keep original when decode fails
    }
  }
  path = path.replace(/\/+/g, '/')
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return path || '/'
}

const KNOWN_ROUTES = new Set(['/', '/counter', '/purchase', '/expenses', '/history', '/settings'])

export function isKnownRoute(pathname: string): boolean {
  const clean = normalizeRoutePath(pathname)
  if (KNOWN_ROUTES.has(clean)) return true
  return [...KNOWN_ROUTES].some((route) => route !== '/' && clean.startsWith(`${route}/`))
}
