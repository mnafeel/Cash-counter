import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import { normalizeRoutePath } from '../utils/hashRoute'

/** Lock Home when leaving it, except Home ↔ Purchase / Loan / History (no PIN when returning). */
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
    const noPinWhenReturning = ['/purchase', '/loan', '/history', '/staff']

    if (wasHome && noPinWhenReturning.includes(curr)) return
    if (isHome && noPinWhenReturning.includes(prev)) return

    if (wasHome || isHome) {
      lockHome()
    }
  }, [location.pathname, lockHome])
}
