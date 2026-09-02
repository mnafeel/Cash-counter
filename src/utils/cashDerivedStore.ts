import type { CashActivityItem } from './cashActivity'
import type { HistoryItem } from './historyItems'
import type { LoanOutflowHistoryItem } from './loanLedger'
import type { NormalExpenseHistoryItem } from './normalExpenseHistory'
import type { PurchaseCreditItem, PurchaseHistoryItem } from './purchaseHistory'

export type CashDerivedSnapshot = {
  historyItems: HistoryItem[]
  cashActivityItems: CashActivityItem[]
  bankActivityItems: CashActivityItem[]
  purchaseHistoryItems: PurchaseHistoryItem[]
  purchaseCreditItems: PurchaseCreditItem[]
  normalExpenseHistoryItems: NormalExpenseHistoryItem[]
  loanOutflowHistoryItems: LoanOutflowHistoryItem[]
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
    normalExpenseHistoryItems: [],
    loanOutflowHistoryItems: [],
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
        next.purchaseCreditItems === snapshot.purchaseCreditItems &&
        next.normalExpenseHistoryItems === snapshot.normalExpenseHistoryItems &&
        next.loanOutflowHistoryItems === snapshot.loanOutflowHistoryItems
      ) {
        return
      }
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}
