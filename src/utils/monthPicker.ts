import type { AppData } from '../types'
import { getSalePaymentEvents } from './salePayment'

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

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthKeyFromIso(iso: string): string {
  if (!iso || iso.length < 7) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7)
  return monthKeyFromDate(d)
}

export function currentMonthKey(): string {
  return monthKeyFromDate(new Date())
}

export function monthRangeFromKey(monthKey: string): { fromDate: string; toDate: string } | null {
  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!year || !month) return null
  const end = new Date(year, month, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    fromDate: `${year}-${pad(month)}-01`,
    toDate: `${year}-${pad(month)}-${pad(end.getDate())}`,
  }
}

export function matchesMonthKey(iso: string, monthKey: string): boolean {
  if (!monthKey) return true
  return monthKeyFromIso(iso) === monthKey
}

export function formatMonthKeyLabel(monthKey: string): string {
  const [yearText, monthText] = monthKey.split('-')
  const month = Number(monthText)
  const year = Number(yearText)
  if (!month || !year) return monthKey
  return `${MONTH_NAMES[month - 1] ?? monthText} ${year}`
}

/** Collect activity timestamps used to decide which months appear in month pickers. */
export function collectAppDataMonthDates(data: AppData): string[] {
  const dates: string[] = []
  for (const sale of data.sales ?? []) {
    dates.push(sale.createdAt)
    if (sale.updatedAt) dates.push(sale.updatedAt)
    for (const event of getSalePaymentEvents(sale)) {
      dates.push(event.at)
    }
  }
  for (const expense of data.expenses ?? []) {
    dates.push(expense.createdAt)
    if (expense.updatedAt) dates.push(expense.updatedAt)
    for (const payment of expense.creditPayments ?? []) {
      dates.push(payment.at)
    }
  }
  for (const loan of data.loans ?? []) {
    dates.push(loan.createdAt)
    if (loan.settledAt) dates.push(loan.settledAt)
    if (loan.settlementEvents?.length) {
      for (const event of loan.settlementEvents) dates.push(event.at)
    }
  }
  return dates
}

/** Only months that have stored activity — newest first. */
export function listMonthPickerOptions(dateIsos: string[]): { key: string; label: string }[] {
  const keys = new Set<string>()
  for (const iso of dateIsos) {
    const key = monthKeyFromIso(iso)
    if (key) keys.add(key)
  }
  if (keys.size === 0) return []
  return Array.from(keys)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: formatMonthKeyLabel(key) }))
}

export function defaultMonthPickerKey(
  options: { key: string }[],
  preferred = currentMonthKey(),
): string {
  if (options.some((option) => option.key === preferred)) return preferred
  return options[0]?.key ?? preferred
}
