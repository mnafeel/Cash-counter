import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { CashDataStoreContext } from '../context/CashContext'
import type { CashDataSnapshot } from '../utils/cashDataStore'

/**
 * Cash data for a main tab. When `active` is false, unsubscribes from live updates
 * so hidden keep-alive tabs do not re-render on every sale/expense change.
 */
export function useCashSnapshot(active: boolean): CashDataSnapshot {
  const store = useContext(CashDataStoreContext)
  if (!store) throw new Error('useCashSnapshot must be used within CashProvider')

  const frozenRef = useRef<CashDataSnapshot>(store.getSnapshot())

  useEffect(() => {
    if (active) {
      frozenRef.current = store.getSnapshot()
    }
  }, [active, store])

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return () => {}
      return store.subscribe(onChange)
    },
    [active, store],
  )

  const getSnapshot = useCallback(() => {
    if (!active) return frozenRef.current
    return store.getSnapshot()
  }, [active, store])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
