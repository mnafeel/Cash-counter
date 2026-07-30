import type { AppData, Expense, StaffMember } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'

export type SalaryMonthKey = string

export const STAFF_MIN_YEAR = 2026

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function currentSalaryMonth(date = new Date()): SalaryMonthKey {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function salaryMonthFromDate(iso: string): SalaryMonthKey {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return currentSalaryMonth()
  return currentSalaryMonth(date)
}

export function parseSalaryMonth(key: SalaryMonthKey): { year: number; month: number } {
  const [yearStr, monthStr] = key.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return { year, month }
}

export function salaryMonthKey(year: number, month: number): SalaryMonthKey {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function formatSalaryMonthLabel(key: SalaryMonthKey): string {
  const { year, month } = parseSalaryMonth(key)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function listMonthOptionsForYear(year: number): { key: SalaryMonthKey; label: string }[] {
  return MONTH_NAMES.map((name, index) => {
    const month = index + 1
    const key = salaryMonthKey(year, month)
    return { key, label: `${name} ${year}` }
  })
}

/** Recent months for salary assignment dropdown (newest first, from 2026 onward). */
export function listSalaryMonthPickerOptions(date = new Date(), count = 12): { key: SalaryMonthKey; label: string }[] {
  const options: { key: SalaryMonthKey; label: string }[] = []
  const minKey = salaryMonthKey(STAFF_MIN_YEAR, 1)
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  for (let i = 0; i < count; i++) {
    const key = salaryMonthKey(year, month)
    if (key < minKey) break
    options.push({ key, label: formatSalaryMonthLabel(key) })
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
  }
  return options
}

export function clampStaffYear(year: number, date = new Date()): number {
  const maxYear = Math.max(STAFF_MIN_YEAR, date.getFullYear())
  return Math.min(Math.max(year, STAFF_MIN_YEAR), maxYear + 1)
}

export function staffDefaultYear(date = new Date()): number {
  return Math.max(STAFF_MIN_YEAR, date.getFullYear())
}

/** Early in the month, salary is often for the previous month. */
export function suggestDefaultSalaryMonth(date = new Date()): SalaryMonthKey {
  if (date.getDate() <= 7) {
    const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1)
    return currentSalaryMonth(previous)
  }
  return currentSalaryMonth(date)
}

export function shouldPromptSalaryMonthChoice(date = new Date()): boolean {
  return date.getDate() <= 7
}

export function salaryMonthChoiceHint(date = new Date()): string {
  const current = currentSalaryMonth(date)
  const suggested = suggestDefaultSalaryMonth(date)
  if (current === suggested) return ''
  return `Entered on ${MONTH_NAMES[date.getMonth()]} ${date.getDate()} — often counted for ${formatSalaryMonthLabel(suggested)}. Pick the salary month below.`
}

export function isStaffLinkableExpense(expense: Expense): boolean {
  if (expense.kind && expense.kind !== 'expense') return false
  if (isPurchaseExpense(expense)) return false
  return true
}

export function expenseCountsTowardStaffSalary(expense: Expense): boolean {
  if (!expense.staffId) return false
  if (expense.staffSalaryLink === false) return false
  return isStaffLinkableExpense(expense)
}

export function findStaffByName(data: AppData, name: string): StaffMember | undefined {
  const key = name.trim().toLowerCase()
  if (!key) return undefined
  return (data.staff ?? []).find((member) => member.name.trim().toLowerCase() === key)
}

export function getStaffMember(data: AppData, staffId: string): StaffMember | undefined {
  return (data.staff ?? []).find((member) => member.id === staffId)
}

export interface StaffMonthSummary {
  staffId: string
  name: string
  monthlySalary: number
  paidTotal: number
  remaining: number
  paymentCount: number
}

export interface StaffOverview {
  staffCount: number
  totalSalary: number
  totalPaid: number
  totalRemaining: number
}

function paidAmountForExpense(expense: Expense): number {
  return Math.max(0, expense.amount)
}

export function getStaffSalaryPayments(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
): Expense[] {
  return data.expenses
    .filter(
      (expense) =>
        expenseCountsTowardStaffSalary(expense) &&
        expense.staffId === staffId &&
        (expense.staffSalaryMonth ?? salaryMonthFromDate(expense.createdAt)) === monthKey,
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function getStaffMonthSummary(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
): StaffMonthSummary | null {
  const member = getStaffMember(data, staffId)
  if (!member) return null
  const payments = getStaffSalaryPayments(data, staffId, monthKey)
  const paidTotal = payments.reduce((sum, expense) => sum + paidAmountForExpense(expense), 0)
  const monthlySalary = Math.max(0, member.monthlySalary)
  return {
    staffId: member.id,
    name: member.name,
    monthlySalary,
    paidTotal,
    remaining: Math.max(0, monthlySalary - paidTotal),
    paymentCount: payments.length,
  }
}

export function buildStaffMonthSummaries(data: AppData, monthKey: SalaryMonthKey): StaffMonthSummary[] {
  return (data.staff ?? [])
    .map((member) => getStaffMonthSummary(data, member.id, monthKey))
    .filter((summary): summary is StaffMonthSummary => summary !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function buildStaffOverview(data: AppData, monthKey: SalaryMonthKey): StaffOverview {
  const summaries = buildStaffMonthSummaries(data, monthKey)
  return {
    staffCount: summaries.length,
    totalSalary: summaries.reduce((sum, row) => sum + row.monthlySalary, 0),
    totalPaid: summaries.reduce((sum, row) => sum + row.paidTotal, 0),
    totalRemaining: summaries.reduce((sum, row) => sum + row.remaining, 0),
  }
}

export function searchStaffSummaries(
  summaries: StaffMonthSummary[],
  query: string,
): StaffMonthSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return summaries
  return summaries.filter((row) => row.name.toLowerCase().includes(q))
}
