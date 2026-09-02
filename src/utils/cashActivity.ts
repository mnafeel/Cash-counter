import type { AppData, Expense, Loan, Sale } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { loanSettlementEvents } from './loanLedger'
import { purchaseExpenseActivityTime, purchasePaidComponents } from './purchaseHistory'
import { getSalePaymentEvents, saleCollectionTimestamp, sanitizeSplitParentChildChequeOverlap, isChequeOriginSale, isActivePaymentEvent } from './salePayment'
import { saleCashCollected, saleBankCollected, saleChequeToBankCollected, toInputDate } from './salesReport'
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

/**
 * Local-midnight start of the selected period.
 * `null` means “beginning of time” (All / unset date).
 * Opening for a period = live balance − net of all activity on/after this instant.
 */
export function getCashPeriodStartMs(
  dateFilter: CashDateFilter,
  selectedDate = '',
  rangeTo?: string,
): number | null {
  const now = new Date()

  if (dateFilter === 'all') return null

  if (dateFilter === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }

  if (dateFilter === 'yesterday') {
    const start = new Date(now)
    start.setDate(now.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }

  if (dateFilter === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }

  if (dateFilter === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime()
  }

  if (dateFilter === 'date') {
    if (!selectedDate) return null
    const [y, m, day] = selectedDate.split('-').map(Number)
    if (!y || !m || !day) return null
    return new Date(y, m - 1, day, 0, 0, 0, 0).getTime()
  }

  if (dateFilter === 'range' && selectedDate) {
    const from =
      rangeTo && rangeTo.length > 0
        ? selectedDate <= rangeTo
          ? selectedDate
          : rangeTo
        : selectedDate
    const [y, m, day] = from.split('-').map(Number)
    if (!y || !m || !day) return null
    return new Date(y, m - 1, day, 0, 0, 0, 0).getTime()
  }

  return null
}

function isOnOrAfterPeriodStart(iso: string, startMs: number | null): boolean {
  if (startMs == null) return true
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t >= startMs
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
      if (!isActivePaymentEvent(event)) return
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
      date: purchaseExpenseActivityTime(expense),
      name: expense.name,
    })
    return
  }

  if (expense.payType === 'bank') return
  if (expense.payType === 'credit') return
  if (expense.payType === 'cheque') return

  if (expense.payType === 'split') {
    const cash = expense.cashAmount ?? 0
    if (cash <= 0) return
    if (expense.kind === 'add') {
      items.push({
        id: `add-${expense.id}`,
        label: 'Not sale · credited to drawer',
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

/** Local YYYY-MM-DD for the start of a cash/bank period filter. */
export function cashPeriodDateKey(
  dateFilter: CashDateFilter,
  selectedDate = '',
  rangeTo?: string,
): string | null {
  const startMs = getCashPeriodStartMs(dateFilter, selectedDate, rangeTo)
  if (startMs == null) return null
  return toInputDate(new Date(startMs))
}

/**
 * Balance at the start of the selected period (e.g. that day’s 12 AM).
 * Always: live drawer − net of activity from period start onward.
 * So for Today: Opening + today’s In − today’s Out = Cash in Drawer.
 */
export function getCashOpeningBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
  rangeTo?: string,
): number {
  const allItems = prebuiltItems ?? buildCashActivityItems(data)
  const startMs = getCashPeriodStartMs(dateFilter, selectedDate, rangeTo)
  if (startMs == null) {
    return currentBalance - summarizeCashActivity(allItems).net
  }
  const fromStart = allItems.filter((item) => isOnOrAfterPeriodStart(item.date, startMs))
  return currentBalance - summarizeCashActivity(fromStart).net
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

/** End-of-period balance after that period's cash activity (e.g. night 12 AM closing). */
export function getCashClosingBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
  rangeTo?: string,
): number {
  const allItems = prebuiltItems ?? buildCashActivityItems(data)
  const opening = getCashOpeningBalance(
    data,
    currentBalance,
    dateFilter,
    selectedDate,
    allItems,
    rangeTo,
  )
  const periodItems = allItems.filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo),
  )
  return opening + summarizeCashActivity(periodItems).net
}

export function summarizeCashActivityForPeriod(
  allItems: CashActivityItem[],
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  rangeTo?: string,
) {
  const items = allItems.filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo),
  )
  const summary = summarizeCashActivity(items)
  const opening = getCashOpeningBalance(
    data,
    currentBalance,
    dateFilter,
    selectedDate,
    allItems,
    rangeTo,
  )
  return { items, summary, opening, closing: opening + summary.net }
}
