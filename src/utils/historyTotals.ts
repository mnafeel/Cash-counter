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
  loanOutflows: number
  loanOutflowCount: number
  moneyAdded: number
  addedCount: number
  transferCount: number
  salesCash: number
  salesBank: number
  salesCredit: number
  /** Pending cheque only — approved cheque is counted in salesBank. */
  salesCheque: number
  /** bills collected + money added − expenses − purchases − loan outflows */
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

  if (item.collectionBreakdown) {
    totals.salesCash += item.collectionBreakdown.cash
    // Approved cheque is folded into bank — never count it again as cheque.
    totals.salesBank += item.collectionBreakdown.bank + item.collectionBreakdown.cheque
    return
  }

  const amount = item.collectedAmount ?? historyItemDisplayAmount(item, false)
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  const hasPendingCheque = item.receiptLines?.some(
    (line) => line.label === 'Cheque' && line.status === 'pending',
  )

  if (modes.length === 0) {
    totals.salesCash += amount
    return
  }

  // Without a breakdown, count the collected amount once (never into bank AND cheque).
  if (modes.includes('credit') && !modes.includes('cash') && !modes.includes('bank') && !modes.includes('cheque')) {
    totals.salesCredit += amount
    return
  }
  if (modes.includes('cash') && !modes.includes('bank') && !modes.includes('cheque')) {
    totals.salesCash += amount
    return
  }
  if (hasPendingCheque && !modes.includes('cash') && !modes.includes('bank')) {
    totals.salesCheque += amount
    return
  }
  if (modes.includes('bank') || modes.includes('cheque') || modes.includes('split')) {
    // Paid/approved cheque and bank both clear to bank.
    if (modes.includes('cash')) totals.salesCash += amount
    else totals.salesBank += amount
    if (modes.includes('credit')) totals.salesCredit += amount
    return
  }
  if (modes.includes('pending')) totals.salesCredit += amount
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
    loanOutflows: 0,
    loanOutflowCount: 0,
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
    } else if (item.type === 'loan') {
      // Money out: loan given, or repayments on loans we took.
      if (
        item.sub?.includes('Loan given') ||
        item.sub?.includes('Loan returned')
      ) {
        totals.loanOutflows += amount
        totals.loanOutflowCount += 1
      }
    } else if (item.type === 'deposit') {
      totals.moneyAdded += amount
      totals.addedCount += 1
    } else if (item.type === 'transfer') {
      totals.transferCount += 1
    }
  }

  totals.netTotal =
    totals.billsCollected +
    totals.moneyAdded -
    totals.expenses -
    totals.purchases -
    totals.loanOutflows
  return totals
}

export function historyTotalsLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Bills'
  if (type === 'expense') return 'Expenses'
  if (type === 'purchase') return 'Purchases'
  if (type === 'deposit') return 'Not sale · credited'
  return 'Transfer'
}
