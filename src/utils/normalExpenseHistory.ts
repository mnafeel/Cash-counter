import type { AppData, Expense } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { formatMoney, formatTime } from './format'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import {
  expenseCountsTowardStaffSalary,
  formatSalaryMonthLabel,
  getStaffMonthSummary,
  isStaffRosterName,
  searchStaffNames,
  suggestDefaultSalaryMonth,
  type SalaryMonthKey,
} from './staffLedger'

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
  /** Credit staff salary payment to this month. */
  staffSalaryMonth?: SalaryMonthKey
  /** Secondary line under the name (no amount — use amount picker). */
  metaLabel?: string
}

export interface ExpenseAmountPickerOption {
  key: string
  amount: number
  label: string
  metaLabel?: string
}

export interface ExpenseAmountPickerContext {
  staffId?: string
  staffSalaryMonth?: SalaryMonthKey
  linkToSalary?: boolean
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

/** Staff salary remaining only — shown on the expense amount field. */
export function buildExpenseAmountPickerOptions(
  data: AppData,
  context: ExpenseAmountPickerContext = {},
  date = new Date(),
): ExpenseAmountPickerOption[] {
  if (context.linkToSalary === false || !context.staffId) return []

  const monthKey = context.staffSalaryMonth ?? suggestDefaultSalaryMonth(date)
  const summary = getStaffMonthSummary(data, context.staffId, monthKey)
  if (!summary || summary.remaining <= 0 || summary.canApplyToNextMonth) return []

  return [
    {
      key: `staff-remaining-${summary.staffId}-${monthKey}`,
      amount: summary.remaining,
      label: formatMoney(summary.remaining),
      metaLabel: `${formatSalaryMonthLabel(monthKey)} remaining`,
    },
  ]
}

/** Recent normal expenses for the picker (newest first, each entry keeps its time). */
export function buildExpenseNamePickerOptions(data: AppData, limit = 12): ExpenseNamePickerOption[] {
  const options: ExpenseNamePickerOption[] = []

  for (let i = 0; i < data.expenses.length; i++) {
    const expense = data.expenses[i]
    if (!isNormalExpenseRecord(expense)) continue
    options.push(expenseToPickerOption(data, expense))
    if (options.length >= limit) break
  }

  return options
}

/** Filter expenses by typed name — each match shows with its recorded time. */
export function searchExpenseNamePickerOptions(
  data: AppData,
  query: string,
  limit = 12,
): ExpenseNamePickerOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const options: ExpenseNamePickerOption[] = []
  const seenNames = new Set<string>()

  for (let i = 0; i < data.expenses.length; i++) {
    const expense = data.expenses[i]
    if (!isNormalExpenseRecord(expense)) continue
    const raw = expense.name.trim()
    if (!raw.toLowerCase().includes(q)) continue
    options.push(expenseToPickerOption(data, expense))
    seenNames.add(raw.toLowerCase())
    if (options.length >= limit) break
  }

  for (const staffName of searchStaffNames(data, q)) {
    const lower = staffName.toLowerCase()
    if (seenNames.has(lower)) continue
    seenNames.add(lower)
    const fromHistory = findRecentExpenseNameOption(data, staffName)
    options.push(
      fromHistory ?? {
        key: `staff-${lower}`,
        name: staffName,
        payLabel: 'Cash',
        timeLabel: '',
        isStaff: true,
      },
    )
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
