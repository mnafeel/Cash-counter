import { useCallback, useContext, useRef, useSyncExternalStore } from 'react'
import type { AppData } from '../types'
import { CashDataStoreContext } from '../context/CashContext'

type LayoutSession = {
  homeUnlocked: boolean
  pinSessionLastActivityAt: number | null
}

/**
 * Session fields for Layout without re-rendering on every sale/expense data change.
 * Pin verification reads the latest AppData from a ref updated on each store notify.
 */
export function useCashLayoutSession(): LayoutSession & { dataRef: { current: AppData } } {
  const store = useContext(CashDataStoreContext)
  if (!store) throw new Error('useCashLayoutSession must be used within CashProvider')

  const dataRef = useRef(store.getSnapshot().data)
  const sessionRef = useRef<LayoutSession>({
    homeUnlocked: store.getSnapshot().homeUnlocked,
    pinSessionLastActivityAt: store.getSnapshot().pinSessionLastActivityAt,
  })

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store.subscribe(() => {
        const snap = store.getSnapshot()
        dataRef.current = snap.data
        const prev = sessionRef.current
        if (
          prev.homeUnlocked !== snap.homeUnlocked ||
          prev.pinSessionLastActivityAt !== snap.pinSessionLastActivityAt
        ) {
          sessionRef.current = {
            homeUnlocked: snap.homeUnlocked,
            pinSessionLastActivityAt: snap.pinSessionLastActivityAt,
          }
        }
        onStoreChange()
      }),
    [store],
  )

  const getSnapshot = useCallback(() => {
    const snap = store.getSnapshot()
    dataRef.current = snap.data
    const prev = sessionRef.current
    if (
      prev.homeUnlocked !== snap.homeUnlocked ||
      prev.pinSessionLastActivityAt !== snap.pinSessionLastActivityAt
    ) {
      sessionRef.current = {
        homeUnlocked: snap.homeUnlocked,
        pinSessionLastActivityAt: snap.pinSessionLastActivityAt,
      }
    }
    return sessionRef.current
  }, [store])

  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { ...session, dataRef }
}
