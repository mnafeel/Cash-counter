import type { AppData, Expense } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { formatMoney } from './format'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'

export type NormalExpenseDateFilter = CashDateFilter

export interface NormalExpenseHistoryItem {
  id: string
  amount: number
  name: string
  payLabel: string
  payDetail: string
  date: string
}

export interface NormalExpenseSummary {
  total: number
  count: number
}

function normalPayLabel(expense: Expense): string {
  if (expense.payType === 'split') return 'Split'
  if (expense.payType === 'bank') return 'Bank'
  return 'Cash'
}

function normalPayDetail(expense: Expense): string {
  if (expense.payType === 'split') {
    return `💵 ${formatMoney(expense.cashAmount ?? 0)} + 🏦 ${formatMoney(expense.bankAmount ?? 0)}`
  }
  if (expense.payType === 'bank') return `🏦 Bank ${formatMoney(expense.amount)}`
  return `💵 Cash ${formatMoney(expense.amount)}`
}

export function buildNormalExpenseHistoryItems(data: AppData): NormalExpenseHistoryItem[] {
  return data.expenses
    .filter((expense) => (!expense.kind || expense.kind === 'expense') && !isPurchaseExpense(expense))
    .map((expense) => ({
      id: expense.id,
      amount: expense.amount,
      name: expense.name,
      payLabel: normalPayLabel(expense),
      payDetail: normalPayDetail(expense),
      date: expense.createdAt,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function summarizeNormalExpenses(items: NormalExpenseHistoryItem[]): NormalExpenseSummary {
  return items.reduce(
    (acc, item) => {
      acc.total += item.amount
      acc.count += 1
      return acc
    },
    { total: 0, count: 0 },
  )
}

export function filterNormalExpenseHistoryItems(
  items: NormalExpenseHistoryItem[],
  dateFilter: NormalExpenseDateFilter,
  selectedDate: string,
  rangeTo?: string,
): NormalExpenseHistoryItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo))
}
