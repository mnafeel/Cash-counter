import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import { normalizeRoutePath } from '../utils/hashRoute'

/** Lock Home when leaving it, except on Home ↔ Purchase (no PIN when returning from purchase). */
export function useHomePinLock() {
  const location = useLocation()
  const { lockHome } = useCash()
  const prevPathRef = useRef(normalizeRoutePath(location.pathname))

  useEffect(() => {
    const curr = normalizeRoutePath(location.pathname)
    const prev = prevPathRef.current
    if (prev === curr) return
    prevPathRef.current = curr

    const wasHome = prev === '/'
    const isHome = curr === '/'
    const wasPurchase = prev === '/purchase'
    const isPurchase = curr === '/purchase'

    if ((wasHome && isPurchase) || (wasPurchase && isHome)) return

    if (wasHome || isHome) {
      lockHome()
    }
  }, [location.pathname, lockHome])
}
