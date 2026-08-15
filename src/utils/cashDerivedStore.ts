import type { CashActivityItem } from './cashActivity'
import type { HistoryItem } from './historyItems'
import type { PurchaseCreditItem, PurchaseHistoryItem } from './purchaseHistory'

export type CashDerivedSnapshot = {
  historyItems: HistoryItem[]
  cashActivityItems: CashActivityItem[]
  bankActivityItems: CashActivityItem[]
  purchaseHistoryItems: PurchaseHistoryItem[]
  purchaseCreditItems: PurchaseCreditItem[]
}

export type CashDerivedStore = {
  getSnapshot: () => CashDerivedSnapshot
  subscribe: (listener: () => void) => () => void
}

export function createCashDerivedStore(): CashDerivedStore & {
  setDerived: (next: CashDerivedSnapshot) => void
} {
  let snapshot: CashDerivedSnapshot = {
    historyItems: [],
    cashActivityItems: [],
    bankActivityItems: [],
    purchaseHistoryItems: [],
    purchaseCreditItems: [],
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setDerived: (next) => {
      if (
        next.historyItems === snapshot.historyItems &&
        next.cashActivityItems === snapshot.cashActivityItems &&
        next.bankActivityItems === snapshot.bankActivityItems &&
        next.purchaseHistoryItems === snapshot.purchaseHistoryItems &&
        next.purchaseCreditItems === snapshot.purchaseCreditItems
      ) {
        return
      }
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}
