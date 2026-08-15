import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { CashDerivedStoreContext } from '../context/CashContext'
import type { CashDerivedSnapshot } from '../utils/cashDerivedStore'

/** Prebuilt lists (history, activity) — frozen when tab hidden. */
export function useCashDerivedSnapshot(active: boolean): CashDerivedSnapshot {
  const store = useContext(CashDerivedStoreContext)
  if (!store) throw new Error('useCashDerivedSnapshot must be used within CashProvider')

  const frozenRef = useRef<CashDerivedSnapshot>(store.getSnapshot())

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
