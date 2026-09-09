import { normalizeRoutePath } from './hashRoute'
import type { MainTabKey } from './mainTab'

/** Never require PIN and never count activity toward the secure-session timer. */
export const PIN_PUBLIC_ROUTES = ['/counter', '/expenses', '/history'] as const

const PIN_PROTECTED_PREFIXES = [
  '/reports',
  '/purchase',
  '/loan',
  '/staff',
  '/settings',
] as const

export function isPinPublicRoute(pathname: string): boolean {
  const path = normalizeRoutePath(pathname)
  return (PIN_PUBLIC_ROUTES as readonly string[]).includes(path)
}

export function isPinProtectedRoute(pathname: string): boolean {
  const path = normalizeRoutePath(pathname)
  if (isPinPublicRoute(path)) return false
  if (path === '/' || path === '') return true
  return PIN_PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

export function isPinProtectedMainTab(tab: MainTabKey | null | undefined): boolean {
  return tab === '/'
}
