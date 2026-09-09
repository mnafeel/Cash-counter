import { normalizeRoutePath } from './hashRoute'

export const SENSITIVE_ROUTE_PREFIXES = [
  '/reports',
  '/purchase',
  '/loan',
  '/staff',
  '/settings',
] as const

export function isSensitiveRoute(pathname: string): boolean {
  const path = normalizeRoutePath(pathname)
  return SENSITIVE_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

export function isDashboardRoute(pathname: string): boolean {
  const path = normalizeRoutePath(pathname)
  return path === '/' || path === ''
}
