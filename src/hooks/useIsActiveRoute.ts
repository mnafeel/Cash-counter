import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppData } from '../types'
import { normalizeRoutePath } from '../utils/hashRoute'

/** Empty dataset for keep-alive tabs that are hidden — skips heavy list rebuilds. */
export const IDLE_TAB_DATA: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  sales: [],
  expenses: [],
}

/** True when this route is the visible tab (keep-alive panes stay mounted but hidden). */
export function useIsActiveRoute(routePrefix: string): boolean {
  const { pathname } = useLocation()
  const path = normalizeRoutePath(pathname)
  if (routePrefix === '/') return path === '/' || path === ''
  return path === routePrefix || path.startsWith(`${routePrefix}/`)
}

/** Clear form state when leaving a tab (e.g. Expenses should not keep draft entries). */
export function useResetOnRouteLeave(routePrefix: string, reset: () => void) {
  const routeActive = useIsActiveRoute(routePrefix)
  useResetOnTabEnter(routeActive, reset)
}

/** Reset UI when a tab becomes visible again (deferred so tab switch paints first). */
export function useResetOnTabEnter(active: boolean, reset: () => void) {
  const wasActiveRef = useRef(active)

  useEffect(() => {
    const entering = !wasActiveRef.current && active
    wasActiveRef.current = active
    if (!entering) return

    const run = () => reset()
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 500 })
      return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 0)
    return () => window.clearTimeout(id)
  }, [active, reset])
}

/** @deprecated Prefer useResetOnTabEnter — leaving-tab resets block the UI thread. */
export function useResetOnTabLeave(active: boolean, reset: () => void) {
  const wasActiveRef = useRef(active)

  useEffect(() => {
    if (wasActiveRef.current && !active) {
      reset()
    }
    wasActiveRef.current = active
  }, [active, reset])
}
