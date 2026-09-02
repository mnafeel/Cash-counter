import type { AppData, Expense } from '../types'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'

export interface NotSaleInflowItem {
  id: string
  date: string
  sortTime: number
  name: string
  amount: number
  cashAmount: number
  bankAmount: number
  detail: string
  payLabel: string
}

export interface NotSaleInflowSummary {
  total: number
  cashTotal: number
  bankTotal: number
  count: number
}

/** Cash / bank channel split for money credited in (kind: add). */
export function addExpenseChannels(expense: Expense): { cash: number; bank: number } {
  if (expense.payType === 'split') {
    return { cash: expense.cashAmount ?? 0, bank: expense.bankAmount ?? 0 }
  }
  if (expense.payType === 'bank') return { cash: 0, bank: expense.amount }
  return { cash: expense.amount, bank: 0 }
}

function notSaleDetailLabel(cash: number, bank: number): string {
  if (cash > 0 && bank > 0) return 'Cash in · counter + bank'
  if (bank > 0) return 'Cash in · bank'
  return 'Cash in · counter'
}

function notSalePayLabel(cash: number, bank: number): string {
  if (cash > 0 && bank > 0) return 'Split'
  if (bank > 0) return 'Bank'
  return 'Cash'
}

/** Money added to counter or bank — not sales (Home add, Expenses receive-back). */
export function buildNotSaleInflowItems(
  data: AppData,
  dateFilter: CashDateFilter = 'all',
  selectedDate = '',
  rangeTo = '',
): NotSaleInflowItem[] {
  const items: NotSaleInflowItem[] = []

  for (const expense of data.expenses) {
    if (expense.kind !== 'add') continue
    if (!matchesCashDateFilter(expense.createdAt, dateFilter, selectedDate, rangeTo)) continue
    const { cash, bank } = addExpenseChannels(expense)
    if (!(expense.amount > 0)) continue
    items.push({
      id: `add-${expense.id}`,
      date: expense.createdAt,
      sortTime: new Date(expense.createdAt).getTime(),
      name: expense.name?.trim() || 'Cash in',
      amount: expense.amount,
      cashAmount: cash,
      bankAmount: bank,
      detail: notSaleDetailLabel(cash, bank),
      payLabel: notSalePayLabel(cash, bank),
    })
  }

  items.sort((a, b) => b.sortTime - a.sortTime || b.amount - a.amount)
  return items
}

export function summarizeNotSaleInflow(items: NotSaleInflowItem[]): NotSaleInflowSummary {
  const summary: NotSaleInflowSummary = {
    total: 0,
    cashTotal: 0,
    bankTotal: 0,
    count: 0,
  }
  for (const item of items) {
    summary.total += item.amount
    summary.cashTotal += item.cashAmount
    summary.bankTotal += item.bankAmount
    summary.count += 1
  }
  return summary
}

export function notSaleInflowKindLabel(item: NotSaleInflowItem): string {
  return item.detail
}
