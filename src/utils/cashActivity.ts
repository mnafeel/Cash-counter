import type { AppData, Expense, Loan, Sale } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { loanSettlementEvents } from './loanLedger'
import { purchasePaidComponents } from './purchaseHistory'
import { getSalePaymentEvents, saleCollectionTimestamp, sanitizeSplitParentChildChequeOverlap, isChequeOriginSale } from './salePayment'
import { saleCashCollected, saleBankCollected, saleChequeToBankCollected } from './salesReport'
import { memoByDataRef } from './memoByDataRef'

export type CashDateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'date' | 'range'

export interface CashActivityItem {
  id: string
  label: string
  amount: number
  direction: 'in' | 'out'
  date: string
  name?: string
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function matchesCashDateFilter(
  iso: string,
  dateFilter: CashDateFilter,
  selectedDate: string,
  rangeTo?: string,
): boolean {
  if (dateFilter === 'all') return true
  const d = new Date(iso)
  const now = new Date()

  if (dateFilter === 'today') return isSameDay(d, now)

  if (dateFilter === 'yesterday') {
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    return isSameDay(d, y)
  }

  if (dateFilter === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return d.getTime() >= start.getTime()
  }

  if (dateFilter === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }

  if (dateFilter === 'date') {
    if (!selectedDate) return true
    const [y, m, day] = selectedDate.split('-').map(Number)
    return isSameDay(d, new Date(y, m - 1, day))
  }

  if (dateFilter === 'range' && selectedDate && rangeTo) {
    const from = selectedDate <= rangeTo ? selectedDate : rangeTo
    const to = selectedDate <= rangeTo ? rangeTo : selectedDate
    const [fy, fm, fd] = from.split('-').map(Number)
    const [ty, tm, td] = to.split('-').map(Number)
    const start = new Date(fy, fm - 1, fd)
    start.setHours(0, 0, 0, 0)
    const end = new Date(ty, tm - 1, td)
    end.setHours(23, 59, 59, 999)
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
  }

  return true
}

function saleActivityDate(sale: Sale): string {
  if (sale.status === 'pending') {
    const collected =
      saleCashCollected(sale) + saleBankCollected(sale) + saleChequeToBankCollected(sale)
    if (collected > 0 && sale.updatedAt) return sale.updatedAt
    return sale.createdAt
  }
  return saleCollectionTimestamp(sale)
}

function pushSaleItems(items: CashActivityItem[], sale: Sale) {
  const events = getSalePaymentEvents(sale)
  if (events.length > 0) {
    events.forEach((event, index) => {
      const cash = event.cash ?? 0
      if (cash <= 0) return
      // Cheque→bank settlements must never appear as cash drawer credits.
      if (isChequeOriginSale(sale)) {
        const bank = (event.bank ?? 0) + (event.cheque ?? 0)
        if (bank > 0 && Math.abs(cash - bank) < 0.01) return
        if ((sale.chequeAmount ?? 0) > 0 && Math.abs(cash - (sale.chequeAmount ?? 0)) < 0.01) {
          return
        }
      }
      const cheque =
        sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
      if (sale.payType === 'split' && cheque > 0 && Math.abs(cash - cheque) < 0.01) return
      items.push({
        id: `sale-${sale.id}-cash-${index}`,
        label: 'Bill · cash collected',
        amount: cash,
        direction: 'in',
        date: event.at,
        name: sale.customerName,
      })
    })
    return
  }

  // Fallback path also uses sanitized breakdown (via getSalePaymentEvents/saleCashCollected).
  const date = saleActivityDate(sale)
  const cash = saleCashCollected(sale)
  if (cash <= 0) return

  // Split safety: cash that only duplicates an approved cheque must not hit the drawer.
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  if (sale.payType === 'split' && cheque > 0 && Math.abs(cash - cheque) < 0.01) return
  if (isChequeOriginSale(sale)) return

  items.push({
    id: `sale-${sale.id}-cash`,
    label: 'Bill · cash collected',
    amount: cash,
    direction: 'in',
    date,
    name: sale.customerName,
  })
}

function expenseOutLabel(expense: Expense): string {
  return isPurchaseExpense(expense) ? 'Purchase · cash' : 'Cash expense'
}

function pushExpenseItems(items: CashActivityItem[], expense: Expense) {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') {
      items.push({
        id: `transfer-${expense.id}`,
        label: 'Transfer to bank',
        amount: expense.amount,
        direction: 'out',
        date: expense.createdAt,
        name: expense.name,
      })
    } else if (expense.transferDirection === 'bank-to-cash') {
      items.push({
        id: `transfer-${expense.id}`,
        label: 'Transfer from bank',
        amount: expense.amount,
        direction: 'in',
        date: expense.createdAt,
        name: expense.name,
      })
    }
    return
  }

  if (isPurchaseExpense(expense)) {
    const { cash } = purchasePaidComponents(expense)
    if (cash <= 0) return
    items.push({
      id: `expense-${expense.id}-cash`,
      label: expenseOutLabel(expense),
      amount: cash,
      direction: 'out',
      date: expense.updatedAt ?? expense.createdAt,
      name: expense.name,
    })
    return
  }

  if (expense.payType === 'bank') return
  if (expense.payType === 'credit') return

  if (expense.payType === 'split') {
    const cash = expense.cashAmount ?? 0
    if (cash <= 0) return
    if (expense.kind === 'add') {
      items.push({
        id: `add-${expense.id}`,
        label: 'Added to drawer',
        amount: cash,
        direction: 'in',
        date: expense.createdAt,
        name: expense.name,
      })
      return
    }
    items.push({
      id: `expense-${expense.id}-cash`,
      label: expenseOutLabel(expense),
      amount: cash,
      direction: 'out',
      date: expense.createdAt,
      name: expense.name,
    })
    return
  }

  if (expense.kind === 'add') {
    items.push({
      id: `add-${expense.id}`,
      label: 'Added to drawer',
      amount: expense.amount,
      direction: 'in',
      date: expense.createdAt,
      name: expense.name,
    })
    return
  }

  items.push({
    id: `expense-${expense.id}`,
    label: expenseOutLabel(expense),
    amount: expense.amount,
    direction: 'out',
    date: expense.createdAt,
    name: expense.name,
  })
}

function pushLoanItems(items: CashActivityItem[], loan: Loan) {
  if (loan.kind === 'lend' && loan.paySource === 'cash') {
    items.push({
      id: `loan-${loan.id}-give-cash`,
      label: 'Loan given · cash',
      amount: loan.amount,
      direction: 'out',
      date: loan.createdAt,
      name: loan.personName,
    })
  } else if (loan.kind === 'borrow') {
    items.push({
      id: `loan-${loan.id}-take-cash`,
      label: 'Loan taken · cash',
      amount: loan.amount,
      direction: 'in',
      date: loan.createdAt,
      name: loan.personName,
    })
  }

  for (const [index, event] of loanSettlementEvents(loan).entries()) {
    if (event.paySource !== 'cash') continue
    if (loan.kind === 'lend') {
      items.push({
        id: `loan-${loan.id}-settle-cash-${index}`,
        label: 'Loan collected · cash',
        amount: event.amount,
        direction: 'in',
        date: event.at,
        name: loan.personName,
      })
    } else {
      items.push({
        id: `loan-${loan.id}-settle-cash-${index}`,
        label: 'Loan returned · cash',
        amount: event.amount,
        direction: 'out',
        date: event.at,
        name: loan.personName,
      })
    }
  }
}

function buildCashActivityItemsUncached(data: AppData): CashActivityItem[] {
  const items: CashActivityItem[] = []
  const sales = sanitizeSplitParentChildChequeOverlap(data.sales)
  for (const sale of sales) pushSaleItems(items, sale)
  for (const expense of data.expenses) pushExpenseItems(items, expense)
  for (const loan of data.loans ?? []) pushLoanItems(items, loan)
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export const buildCashActivityItems = memoByDataRef(buildCashActivityItemsUncached)

export function summarizeCashActivity(items: CashActivityItem[]) {
  let cashIn = 0
  let cashOut = 0
  for (const item of items) {
    if (item.direction === 'in') cashIn += item.amount
    else cashOut += item.amount
  }
  return { cashIn, cashOut, net: cashIn - cashOut, count: items.length }
}

/** Balance at 12 AM (start of day) before that period's cash activity. */
export function getCashOpeningBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
): number {
  const items = (prebuiltItems ?? buildCashActivityItems(data)).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  return currentBalance - summarizeCashActivity(items).net
}

export function cashOpeningLabel(dateFilter: CashDateFilter): string {
  if (dateFilter === 'today') return 'Opening (12 AM)'
  if (dateFilter === 'yesterday') return 'Opening (12 AM)'
  if (dateFilter === 'week') return 'Opening (week start)'
  if (dateFilter === 'date') return 'Opening (12 AM)'
  return 'Opening'
}

export function cashClosingLabel(dateFilter: CashDateFilter): string {
  if (dateFilter === 'today') return 'Closing (12 AM night)'
  if (dateFilter === 'yesterday') return 'Closing (12 AM night)'
  if (dateFilter === 'week') return 'Closing (week end)'
  if (dateFilter === 'date') return 'Closing (12 AM night)'
  return 'Closing'
}

/** End-of-day balance after that period's cash activity (night 12 AM closing). */
export function getCashClosingBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
): number {
  const items = (prebuiltItems ?? buildCashActivityItems(data)).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  const opening = currentBalance - summarizeCashActivity(items).net
  return opening + summarizeCashActivity(items).net
}

export function summarizeCashActivityForPeriod(
  allItems: CashActivityItem[],
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
) {
  const items = allItems.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate))
  const summary = summarizeCashActivity(items)
  const opening = currentBalance - summary.net
  return { items, summary, opening, closing: opening + summary.net }
}
