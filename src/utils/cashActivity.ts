import type { AppData, Expense, Sale } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { saleCashCollected } from './salesReport'

export type CashDateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'date'

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

  if (dateFilter === 'date') {
    if (!selectedDate) return true
    const [y, m, day] = selectedDate.split('-').map(Number)
    return isSameDay(d, new Date(y, m - 1, day))
  }

  return true
}

function saleActivityDate(sale: Sale): string {
  if (sale.status === 'pending') return sale.createdAt
  return sale.updatedAt ?? sale.createdAt
}

function pushSaleItems(items: CashActivityItem[], sale: Sale) {
  const cash = saleCashCollected(sale)
  if (!(cash > 0)) return
  items.push({
    id: `sale-${sale.id}`,
    label: 'Bill · cash collected',
    amount: cash,
    direction: 'in',
    date: saleActivityDate(sale),
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

  if (expense.payType === 'bank') return

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

export function buildCashActivityItems(data: AppData): CashActivityItem[] {
  const items: CashActivityItem[] = []
  for (const sale of data.sales) pushSaleItems(items, sale)
  for (const expense of data.expenses) pushExpenseItems(items, expense)
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

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
): number {
  const items = buildCashActivityItems(data).filter((item) =>
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
): number {
  const opening = getCashOpeningBalance(data, currentBalance, dateFilter, selectedDate)
  const items = buildCashActivityItems(data).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  return opening + summarizeCashActivity(items).net
}
