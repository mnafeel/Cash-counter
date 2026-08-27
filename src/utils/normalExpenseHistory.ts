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
  cashAmount: number
  bankAmount: number
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

/** Cash/bank that actually left for a normal expense — credit never counts. */
export function normalExpensePaidChannels(expense: Expense): { cash: number; bank: number } {
  if (expense.payType === 'bank') return { cash: 0, bank: expense.amount }
  if (expense.payType === 'split') {
    return { cash: expense.cashAmount ?? 0, bank: expense.bankAmount ?? 0 }
  }
  if (expense.payType === 'credit') return { cash: 0, bank: 0 }
  if (expense.payType === 'cheque') {
    if (!expense.chequeApproved) return { cash: 0, bank: 0 }
    return { cash: 0, bank: expense.chequeAmount ?? expense.amount }
  }
  return { cash: expense.amount, bank: 0 }
}

function normalPayLabel(expense: Expense): string {
  if (expense.payType === 'split') return 'Split'
  if (expense.payType === 'bank') return 'Bank'
  if (expense.payType === 'credit') return 'Credit'
  if (expense.payType === 'cheque') return expense.chequeApproved ? 'Cheque' : 'Cheque pending'
  return 'Cash'
}

function normalPayDetail(expense: Expense): string {
  const parts = normalExpensePaidChannels(expense)
  if (expense.payType === 'split') {
    return `💵 ${formatMoney(parts.cash)} + 🏦 ${formatMoney(parts.bank)}`
  }
  if (expense.payType === 'bank') return `🏦 Bank ${formatMoney(parts.bank)}`
  if (expense.payType === 'credit') return '💳 Credit (not a cash/bank expense)'
  if (expense.payType === 'cheque') {
    return expense.chequeApproved
      ? `🧾 Cheque ${formatMoney(parts.bank)}`
      : '🧾 Cheque pending'
  }
  return `💵 Cash ${formatMoney(parts.cash)}`
}

export function buildNormalExpenseHistoryItems(data: AppData): NormalExpenseHistoryItem[] {
  return data.expenses
    .filter((expense) => (!expense.kind || expense.kind === 'expense') && !isPurchaseExpense(expense))
    .map((expense) => {
      const { cash: cashAmount, bank: bankAmount } = normalExpensePaidChannels(expense)
      return {
        id: expense.id,
        amount: cashAmount + bankAmount,
        name: expense.name,
        payLabel: normalPayLabel(expense),
        payDetail: normalPayDetail(expense),
        date: expense.createdAt,
        cashAmount,
        bankAmount,
      }
    })
    // Credit / pending cheque: no cash or bank left — keep out of expense lists & totals
    .filter((item) => item.amount > 0)
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
/** Letter-by-letter match — prefix matches rank before substring matches. */
export function searchNamesByPrefix(names: string[], query: string, limit = 12): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return names.slice(0, limit)
  const prefix: string[] = []
  const contains: string[] = []
  for (const name of names) {
    const lower = name.toLowerCase()
    if (lower === q) continue
    if (lower.startsWith(q)) prefix.push(name)
    else if (lower.includes(q)) contains.push(name)
  }
  return [...prefix, ...contains].slice(0, limit)
}

export function searchExpenseNamePickerOptions(
  data: AppData,
  query: string,
  limit = 12,
): ExpenseNamePickerOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const options: ExpenseNamePickerOption[] = []
  const seenNames = new Set<string>()

  const rankedNames = searchNamesByPrefix(
    data.expenses
      .filter(isNormalExpenseRecord)
      .map((expense) => expense.name.trim())
      .filter(Boolean),
    q,
    limit * 2,
  )

  for (const raw of rankedNames) {
    const lower = raw.toLowerCase()
    if (seenNames.has(lower)) continue
    const fromHistory = findRecentExpenseNameOption(data, raw)
    if (fromHistory) {
      options.push(fromHistory)
      seenNames.add(lower)
      if (options.length >= limit) break
      continue
    }
    for (let i = 0; i < data.expenses.length; i++) {
      const expense = data.expenses[i]
      if (!isNormalExpenseRecord(expense)) continue
      if (expense.name.trim().toLowerCase() !== lower) continue
      options.push(expenseToPickerOption(data, expense))
      seenNames.add(lower)
      break
    }
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

export interface ExpenseNameGroup {
  nameKey: string
  name: string
  total: number
  count: number
  cashTotal: number
  bankTotal: number
  items: NormalExpenseHistoryItem[]
}

export interface ExpenseNameAnalysis {
  name: string
  total: number
  count: number
  average: number
  largest: NormalExpenseHistoryItem | null
  cashTotal: number
  bankTotal: number
  shareOfPeriod: number
  /** Highest amounts first — useful to see what drove the spend. */
  topByAmount: NormalExpenseHistoryItem[]
}

function expenseCashBankParts(item: NormalExpenseHistoryItem): { cash: number; bank: number } {
  return { cash: item.cashAmount, bank: item.bankAmount }
}

export function groupNormalExpensesByName(items: NormalExpenseHistoryItem[]): ExpenseNameGroup[] {
  const map = new Map<string, ExpenseNameGroup>()

  for (const item of items) {
    const displayName = item.name.trim() || 'Unnamed'
    const nameKey = displayName.toLowerCase()
    const parts = expenseCashBankParts(item)
    const group = map.get(nameKey) ?? {
      nameKey,
      name: displayName,
      total: 0,
      count: 0,
      cashTotal: 0,
      bankTotal: 0,
      items: [],
    }
    group.total += item.amount
    group.count += 1
    group.cashTotal += parts.cash
    group.bankTotal += parts.bank
    group.items.push(item)
    map.set(nameKey, group)
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function analyzeExpenseNameGroup(
  group: ExpenseNameGroup,
  periodTotal: number,
): ExpenseNameAnalysis {
  const topByAmount = [...group.items].sort((a, b) => b.amount - a.amount)
  return {
    name: group.name,
    total: group.total,
    count: group.count,
    average: group.count > 0 ? group.total / group.count : 0,
    largest: topByAmount[0] ?? null,
    cashTotal: group.cashTotal,
    bankTotal: group.bankTotal,
    shareOfPeriod: periodTotal > 0 ? (group.total / periodTotal) * 100 : 0,
    topByAmount: topByAmount.slice(0, 5),
  }
}

export function filterNormalExpensesByPayChannel(
  items: NormalExpenseHistoryItem[],
  channel: 'all' | 'cash' | 'bank',
): NormalExpenseHistoryItem[] {
  if (channel === 'all') return items
  return items
    .filter((item) => (channel === 'cash' ? item.cashAmount > 0 : item.bankAmount > 0))
    .map((item) => {
      if (channel === 'cash') {
        return {
          ...item,
          amount: item.cashAmount,
          bankAmount: 0,
          payLabel: item.payLabel === 'Split' ? 'Cash' : item.payLabel,
        }
      }
      return {
        ...item,
        amount: item.bankAmount,
        cashAmount: 0,
        payLabel: item.payLabel === 'Split' ? 'Bank' : item.payLabel,
      }
    })
}

export function filterNormalExpenseHistoryItems(
  items: NormalExpenseHistoryItem[],
  dateFilter: NormalExpenseDateFilter,
  selectedDate: string,
  rangeTo?: string,
): NormalExpenseHistoryItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo))
}
