import { useLocation } from 'react-router-dom'
import { normalizeRoutePath } from '../utils/hashRoute'

/** True when this route is the visible tab (keep-alive panes stay mounted but hidden). */
export function useIsActiveRoute(routePrefix: string): boolean {
  const { pathname } = useLocation()
  const path = normalizeRoutePath(pathname)
  if (routePrefix === '/') return path === '/' || path === ''
  return path === routePrefix || path.startsWith(`${routePrefix}/`)
}
