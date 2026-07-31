import type { AppData, Expense } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { formatMoney, formatTime } from './format'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import { expenseCountsTowardStaffSalary, isStaffRosterName } from './staffLedger'

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

export interface ExpenseNamePickerOption {
  key: string
  name: string
  payLabel: string
  timeLabel: string
  isStaff: boolean
}

function isStaffExpenseName(data: AppData, expense: Expense): boolean {
  const raw = expense.name?.trim()
  if (!raw) return false
  return expenseCountsTowardStaffSalary(expense) || isStaffRosterName(data, raw)
}

function expenseToPickerOption(data: AppData, expense: Expense): ExpenseNamePickerOption {
  const raw = expense.name.trim()
  return {
    key: expense.id,
    name: raw,
    payLabel: normalPayLabel(expense),
    timeLabel: formatTime(expense.createdAt),
    isStaff: isStaffExpenseName(data, expense),
  }
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

function isNormalExpenseRecord(expense: Expense): boolean {
  if (expense?.kind && expense.kind !== 'expense') return false
  if (isPurchaseExpense(expense)) return false
  return Boolean(expense.name?.trim())
}

/** Most recent normal expense (newest first in storage). */
export function buildLastExpenseNamePickerOption(data: AppData): ExpenseNamePickerOption | null {
  for (let i = 0; i < data.expenses.length; i++) {
    const expense = data.expenses[i]
    if (!isNormalExpenseRecord(expense)) continue
    return expenseToPickerOption(data, expense)
  }
  return null
}

/** Recent unique normal expenses for the picker (newest first). */
export function buildExpenseNamePickerOptions(data: AppData, limit = 8): ExpenseNamePickerOption[] {
  const options: ExpenseNamePickerOption[] = []
  const seen = new Set<string>()

  for (let i = 0; i < data.expenses.length; i++) {
    const expense = data.expenses[i]
    if (!isNormalExpenseRecord(expense)) continue
    const raw = expense.name.trim()
    const nameKey = raw.toLowerCase()
    if (seen.has(nameKey)) continue
    seen.add(nameKey)

    options.push(expenseToPickerOption(data, expense))
    if (options.length >= limit) break
  }

  return options
}

export function findRecentExpenseNameOption(data: AppData, name: string): ExpenseNamePickerOption | null {
  const key = name.trim().toLowerCase()
  if (!key) return null

  for (let i = 0; i < data.expenses.length; i++) {
    const expense = data.expenses[i]
    if (!isNormalExpenseRecord(expense)) continue
    if (expense.name.trim().toLowerCase() !== key) continue
    return expenseToPickerOption(data, expense)
  }

  return null
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
