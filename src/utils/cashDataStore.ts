import type { AppData, Sale } from '../types'

export type CashDataSnapshot = {
  data: AppData
  balance: number
  bankBalance: number
  pendingBills: Sale[]
  homeUnlocked: boolean
  sensitiveUnlocked: boolean
  dataBooting: boolean
  pinSessionLastActivityAt: number | null
}

export type CashDataStore = {
  getSnapshot: () => CashDataSnapshot
  subscribe: (listener: () => void) => () => void
}

export function createCashDataStore(): CashDataStore & { setSnapshot: (next: CashDataSnapshot) => void } {
  let snapshot: CashDataSnapshot = {
    data: { openingBalance: 0, openingBankBalance: 0, sales: [], expenses: [] },
    balance: 0,
    bankBalance: 0,
    pendingBills: [],
    homeUnlocked: false,
    sensitiveUnlocked: false,
    dataBooting: false,
    pinSessionLastActivityAt: null,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSnapshot: (next) => {
      if (
        next.data === snapshot.data &&
        next.balance === snapshot.balance &&
        next.bankBalance === snapshot.bankBalance &&
        next.pendingBills === snapshot.pendingBills &&
        next.homeUnlocked === snapshot.homeUnlocked &&
        next.sensitiveUnlocked === snapshot.sensitiveUnlocked &&
        next.dataBooting === snapshot.dataBooting &&
        next.pinSessionLastActivityAt === snapshot.pinSessionLastActivityAt
      ) {
        return
      }
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}
