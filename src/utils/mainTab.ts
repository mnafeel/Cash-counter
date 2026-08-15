import { normalizeRoutePath } from './hashRoute'

export type MainTabKey = '/' | '/counter' | '/expenses' | '/history'

export function getMainTabKey(pathname: string): MainTabKey | null {
  const path = normalizeRoutePath(pathname)
  if (path === '/' || path === '') return '/'
  if (path === '/counter') return '/counter'
  if (path === '/expenses') return '/expenses'
  if (path === '/history') return '/history'
  return null
}

export function isMainTabPath(pathname: string): boolean {
  return getMainTabKey(pathname) !== null
}
