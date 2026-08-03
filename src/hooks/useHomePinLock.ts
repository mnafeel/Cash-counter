import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useCashLock } from '../context/CashContext'
import { normalizeRoutePath } from '../utils/hashRoute'

/** In-app routes — moving between these does not lock Home or require PIN again on return. */
const IN_APP_ROUTES = [
  '/',
  '/purchase',
  '/loan',
  '/history',
  '/staff',
  '/settings',
  '/expenses',
  '/counter',
  '/reports',
]

/** Lock Home only when leaving the app shell; in-app back navigation stays unlocked. */
export function useHomePinLock() {
  const location = useLocation()
  const { lockHome, unlockHome } = useCashLock()
  const prevPathRef = useRef(normalizeRoutePath(location.pathname))

  useEffect(() => {
    const curr = normalizeRoutePath(location.pathname)
    const prev = prevPathRef.current
    if (prev === curr) return
    prevPathRef.current = curr

    const prevInApp = IN_APP_ROUTES.includes(prev)
    const currInApp = IN_APP_ROUTES.includes(curr)

    if (prevInApp && currInApp) {
      unlockHome()
      return
    }

    if (prev === '/' && currInApp) return
    if (curr === '/' && prevInApp) {
      unlockHome()
      return
    }

    if (prev === '/' || curr === '/') {
      lockHome()
    }
  }, [location.pathname, lockHome, unlockHome])
}
