import type { HistoryItem, HistoryItemType } from './historyItems'
import { historyItemDisplayAmount } from './historyItems'

export interface HistoryTotalsSummary {
  recordCount: number
  billsCollected: number
  billsBillTotal: number
  billCount: number
  expenses: number
  expenseCount: number
  purchases: number
  purchaseCount: number
  moneyAdded: number
  addedCount: number
  transferCount: number
  salesCash: number
  salesBank: number
  salesCredit: number
  salesCheque: number
  /** bills collected + money added − expenses − purchases */
  netTotal: number
}

function addPaymentAmount(
  item: HistoryItem,
  totals: Pick<
    HistoryTotalsSummary,
    'salesCash' | 'salesBank' | 'salesCredit' | 'salesCheque'
  >,
) {
  if (item.type !== 'sale') return
  const amount = historyItemDisplayAmount(item, false)
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  if (modes.length === 0) {
    totals.salesCash += amount
    return
  }
  if (modes.includes('split')) {
    if (item.paySummary?.includes('💵')) totals.salesCash += amount
    else if (modes.includes('cash')) totals.salesCash += amount
    if (modes.includes('bank')) totals.salesBank += amount
    if (modes.includes('cheque')) totals.salesCheque += amount
    if (modes.includes('credit')) totals.salesCredit += amount
    return
  }
  if (modes.includes('cash')) totals.salesCash += amount
  else if (modes.includes('bank')) totals.salesBank += amount
  else if (modes.includes('cheque')) totals.salesCheque += amount
  else if (modes.includes('credit')) totals.salesCredit += amount
  else if (modes.includes('pending')) totals.salesCredit += amount
}

export function buildHistoryTotals(
  items: HistoryItem[],
  purchasePaidMode = false,
): HistoryTotalsSummary {
  const totals: HistoryTotalsSummary = {
    recordCount: items.length,
    billsCollected: 0,
    billsBillTotal: 0,
    billCount: 0,
    expenses: 0,
    expenseCount: 0,
    purchases: 0,
    purchaseCount: 0,
    moneyAdded: 0,
    addedCount: 0,
    transferCount: 0,
    salesCash: 0,
    salesBank: 0,
    salesCredit: 0,
    salesCheque: 0,
    netTotal: 0,
  }

  for (const item of items) {
    const amount = historyItemDisplayAmount(item, purchasePaidMode && item.type === 'purchase')

    if (item.type === 'sale') {
      totals.billsCollected += amount
      totals.billsBillTotal += item.originalBillAmount ?? item.amount
      totals.billCount += 1
      addPaymentAmount(item, totals)
    } else if (item.type === 'expense') {
      totals.expenses += amount
      totals.expenseCount += 1
    } else if (item.type === 'purchase') {
      totals.purchases += amount
      totals.purchaseCount += 1
    } else if (item.type === 'deposit') {
      totals.moneyAdded += amount
      totals.addedCount += 1
    } else if (item.type === 'transfer') {
      totals.transferCount += 1
    }
  }

  totals.netTotal = totals.billsCollected + totals.moneyAdded - totals.expenses - totals.purchases
  return totals
}

export function historyTotalsLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Bills'
  if (type === 'expense') return 'Expenses'
  if (type === 'purchase') return 'Purchases'
  if (type === 'deposit') return 'Money added'
  return 'Transfer'
}
