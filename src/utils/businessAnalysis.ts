import type { AppData } from '../types'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import {
  buildCustomerSummaries,
  filterCustomersWithCredit,
} from './customerLedger'
import {
  buildChequeCustomerSummaries,
  filterCustomersWithCheque,
} from './chequeLedger'
import { buildNormalExpenseHistoryItems } from './normalExpenseHistory'
import { buildPurchaseHistoryItems } from './purchaseHistory'
import {
  formatReportPresetLabel,
  salesBillsForPreset,
  type ReportDatePreset,
} from './reportsHub'
import { toInputDate } from './salesReport'
import { memoByDataRef } from './memoByDataRef'

export type AnalyzeTopic =
  | 'overview'
  | 'customers'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'credit'
  | 'cheque'

export interface AnalyzeRankItem {
  key: string
  label: string
  amount: number
  count: number
  share: number
}

export interface AnalyzeSeriesPoint {
  key: string
  label: string
  amount: number
}

export interface AnalyzeMonthPoint {
  key: string
  label: string
  sales: number
  purchases: number
  expenses: number
}

export interface BusinessAnalysis {
  periodLabel: string
  salesTotal: number
  salesCount: number
  purchaseTotal: number
  purchaseCount: number
  expenseTotal: number
  expenseCount: number
  net: number
  topCustomers: AnalyzeRankItem[]
  topSuppliers: AnalyzeRankItem[]
  topExpenseNames: AnalyzeRankItem[]
  salesByDay: AnalyzeSeriesPoint[]
  monthlyTrend: AnalyzeMonthPoint[]
  creditParties: AnalyzeRankItem[]
  creditTotal: number
  chequeParties: AnalyzeRankItem[]
  chequeTotal: number
  topCustomer: AnalyzeRankItem | null
  topExpense: AnalyzeRankItem | null
  topSupplier: AnalyzeRankItem | null
  bestSalesDay: AnalyzeSeriesPoint | null
  bestSalesMonth: AnalyzeMonthPoint | null
}

/** Precomputed rows — built once per data snapshot, filtered cheaply per period. */
export interface AnalyzeCache {
  sales: Array<{ day: string; month: string; customerKey: string; customer: string; amount: number }>
  purchases: Array<{ day: string; month: string; supplierKey: string; supplier: string; amount: number }>
  expenses: Array<{ day: string; month: string; nameKey: string; name: string; amount: number }>
  monthlyTrend: AnalyzeMonthPoint[]
  creditParties: AnalyzeRankItem[]
  creditTotal: number
  chequeParties: AnalyzeRankItem[]
  chequeTotal: number
}

const TOP_N = 8

function dayKey(iso: string): string {
  if (!iso) return ''
  if (iso.length >= 10 && iso[4] === '-' && iso[7] === '-') return iso.slice(0, 10)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return toInputDate(d)
}

function monthKeyFromDay(day: string): string {
  return day.slice(0, 7)
}

function shortDayLabel(yyyyMmDd: string, mode: 'day' | 'day-month' = 'day-month'): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  if (!y || !m || !d) return yyyyMmDd
  if (mode === 'day') return String(d)
  return `${d}/${m}`
}

function shortMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  if (!y || !m) return yyyyMm
  const date = new Date(y, m - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function addDaysYmd(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return toInputDate(date)
}

/** Inclusive calendar span. Caps keep long histories scrollable (~3 years). */
function daysBetweenInclusive(from: string, to: string, maxDays = 1095): string[] {
  if (!from || !to) return []
  const start = from <= to ? from : to
  const end = from <= to ? to : from
  const out: string[] = []
  let cursor = start
  for (let i = 0; i < maxDays; i += 1) {
    out.push(cursor)
    if (cursor === end) break
    cursor = addDaysYmd(cursor, 1)
    if (cursor > end) break
  }
  return out
}

function earliestDayKey(dayMap: Map<string, number>): string | null {
  let min: string | null = null
  for (const key of dayMap.keys()) {
    if (!min || key < min) min = key
  }
  return min
}

/** Calendar days covered by the active Analyze date filter. */
export function periodDayKeys(
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
  fromDay?: string | null,
): string[] {
  const today = toInputDate()
  if (preset === 'today') return [today]
  if (preset === 'yesterday') {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    return [toInputDate(y)]
  }
  if (preset === 'week') {
    const start = new Date()
    start.setDate(start.getDate() - 6)
    return daysBetweenInclusive(toInputDate(start), today)
  }
  if (preset === 'month') {
    const start = new Date()
    start.setDate(1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    return daysBetweenInclusive(toInputDate(start), toInputDate(end))
  }
  if (preset === 'date' && selectedDate) return [selectedDate]
  if (preset === 'range' && selectedDate && rangeTo) {
    return daysBetweenInclusive(selectedDate, rangeTo)
  }
  // All time — every day from first sale (or fromDay) through today
  const start = fromDay && fromDay <= today ? fromDay : today
  return daysBetweenInclusive(start, today)
}

function chartDayLabel(key: string, index: number, denseMonth: boolean): string {
  const dayNum = Number(key.slice(8, 10))
  if (denseMonth && dayNum !== 1 && index !== 0) return String(dayNum)
  if (dayNum === 1 || index === 0) {
    const [y, m, d] = key.split('-').map(Number)
    if (!y || !m || !d) return key
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }
  return shortDayLabel(key, 'day-month')
}

function buildSalesByDaySeries(
  dayMap: Map<string, number>,
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): AnalyzeSeriesPoint[] {
  const fromDay = preset === 'all' ? earliestDayKey(dayMap) : null
  const keys = periodDayKeys(preset, selectedDate, rangeTo, fromDay)
  const denseMonth = preset === 'month' || (preset === 'range' && keys.length > 14)
  return keys.map((key, index) => ({
    key,
    label: chartDayLabel(key, index, denseMonth),
    amount: dayMap.get(key) ?? 0,
  }))
}

function toRankItems(
  map: Map<string, { label: string; amount: number; count: number }>,
  total: number,
  limit = TOP_N,
): AnalyzeRankItem[] {
  const entries: AnalyzeRankItem[] = []
  for (const [key, entry] of map) {
    if (entry.amount <= 0) continue
    entries.push({
      key,
      label: entry.label,
      amount: entry.amount,
      count: entry.count,
      share: total > 0 ? (entry.amount / total) * 100 : 0,
    })
  }
  entries.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
  if (entries.length > limit) entries.length = limit
  return entries
}

function lastNMonthKeys(count: number): string[] {
  const keys: string[] = []
  const cursor = new Date()
  cursor.setDate(1)
  for (let i = 0; i < count; i += 1) {
    keys.unshift(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return keys
}

function buildAnalyzeCacheUncached(data: AppData): AnalyzeCache {
  const monthKeys = lastNMonthKeys(6)
  const monthKeySet = new Set(monthKeys)
  const salesMap = new Map<string, number>()
  const purchaseMap = new Map<string, number>()
  const expenseMap = new Map<string, number>()

  const sales: AnalyzeCache['sales'] = []
  for (const bill of salesBillsForPreset(data, 'all', '', 'date-desc', undefined, 'collected')) {
    if (bill.collectedTotal <= 0) continue
    const day = dayKey(bill.date || bill.createdDate)
    if (!day) continue
    const month = monthKeyFromDay(day)
    const customer = bill.customerName?.trim() || 'Unnamed customer'
    sales.push({
      day,
      month,
      customerKey: customer.toLowerCase(),
      customer,
      amount: bill.collectedTotal,
    })
    if (monthKeySet.has(month)) {
      salesMap.set(month, (salesMap.get(month) ?? 0) + bill.collectedTotal)
    }
  }

  const purchases: AnalyzeCache['purchases'] = []
  for (const item of buildPurchaseHistoryItems(data)) {
    if (item.amount <= 0) continue
    const day = dayKey(item.date)
    if (!day) continue
    const month = monthKeyFromDay(day)
    const supplier = item.shopName?.trim() || 'Unnamed supplier'
    purchases.push({
      day,
      month,
      supplierKey: supplier.toLowerCase(),
      supplier,
      amount: item.amount,
    })
    if (monthKeySet.has(month)) {
      purchaseMap.set(month, (purchaseMap.get(month) ?? 0) + item.amount)
    }
  }

  const expenses: AnalyzeCache['expenses'] = []
  for (const item of buildNormalExpenseHistoryItems(data)) {
    if (item.amount <= 0) continue
    const day = dayKey(item.date)
    if (!day) continue
    const month = monthKeyFromDay(day)
    const name = item.name?.trim() || 'Unnamed'
    expenses.push({
      day,
      month,
      nameKey: name.toLowerCase(),
      name,
      amount: item.amount,
    })
    if (monthKeySet.has(month)) {
      expenseMap.set(month, (expenseMap.get(month) ?? 0) + item.amount)
    }
  }

  const monthlyTrend = monthKeys.map((key) => ({
    key,
    label: shortMonthLabel(key),
    sales: salesMap.get(key) ?? 0,
    purchases: purchaseMap.get(key) ?? 0,
    expenses: expenseMap.get(key) ?? 0,
  }))

  const creditCustomers = filterCustomersWithCredit(buildCustomerSummaries(data))
  const creditTotal = creditCustomers.reduce((sum, row) => sum + row.totalCreditPending, 0)
  const creditMap = new Map<string, { label: string; amount: number; count: number }>()
  for (const row of creditCustomers) {
    creditMap.set(row.name.toLowerCase(), {
      label: row.name,
      amount: row.totalCreditPending,
      count: row.openCreditCount,
    })
  }

  const chequeCustomers = filterCustomersWithCheque(buildChequeCustomerSummaries(data))
  const chequeTotal = chequeCustomers.reduce((sum, row) => sum + row.totalChequePending, 0)
  const chequeMap = new Map<string, { label: string; amount: number; count: number }>()
  for (const row of chequeCustomers) {
    chequeMap.set(row.name.toLowerCase(), {
      label: row.name,
      amount: row.totalChequePending,
      count: row.openChequeCount,
    })
  }

  return {
    sales,
    purchases,
    expenses,
    monthlyTrend,
    creditParties: toRankItems(creditMap, creditTotal),
    creditTotal,
    chequeParties: toRankItems(chequeMap, chequeTotal),
    chequeTotal,
  }
}

/** Heavy work once per AppData reference. */
export const buildAnalyzeCache = memoByDataRef(buildAnalyzeCacheUncached)

function rowInPeriod(
  day: string,
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): boolean {
  if (preset === 'all') return true
  // day is YYYY-MM-DD — matchesCashDateFilter accepts ISO-like strings
  return matchesCashDateFilter(`${day}T12:00:00`, preset, selectedDate, rangeTo)
}

function analyzePeriodLabel(
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
  salesByDay?: AnalyzeSeriesPoint[],
): string {
  if (preset === 'month') {
    return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  if (preset === 'all' && salesByDay && salesByDay.length > 0) {
    const first = salesByDay[0]!
    const last = salesByDay[salesByDay.length - 1]!
    if (first.key === last.key) return shortDayLabel(first.key, 'day-month')
    return `${shortDayLabel(first.key, 'day-month')} – ${shortDayLabel(last.key, 'day-month')}`
  }
  if (preset === 'week') {
    const keys = periodDayKeys(preset, selectedDate, rangeTo)
    if (keys.length >= 2) {
      return `${shortDayLabel(keys[0]!, 'day-month')} – ${shortDayLabel(keys[keys.length - 1]!, 'day-month')}`
    }
  }
  return formatReportPresetLabel(preset, selectedDate, rangeTo)
}

export function analyzeFromCache(
  cache: AnalyzeCache,
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): BusinessAnalysis {
  let salesTotal = 0
  let salesCount = 0
  const customerMap = new Map<string, { label: string; amount: number; count: number }>()
  const dayMap = new Map<string, number>()

  for (const row of cache.sales) {
    if (!rowInPeriod(row.day, preset, selectedDate, rangeTo)) continue
    salesTotal += row.amount
    salesCount += 1
    const customer = customerMap.get(row.customerKey) ?? {
      label: row.customer,
      amount: 0,
      count: 0,
    }
    customer.amount += row.amount
    customer.count += 1
    customerMap.set(row.customerKey, customer)
    dayMap.set(row.day, (dayMap.get(row.day) ?? 0) + row.amount)
  }

  let purchaseTotal = 0
  let purchaseCount = 0
  const supplierMap = new Map<string, { label: string; amount: number; count: number }>()
  for (const row of cache.purchases) {
    if (!rowInPeriod(row.day, preset, selectedDate, rangeTo)) continue
    purchaseTotal += row.amount
    purchaseCount += 1
    const supplier = supplierMap.get(row.supplierKey) ?? {
      label: row.supplier,
      amount: 0,
      count: 0,
    }
    supplier.amount += row.amount
    supplier.count += 1
    supplierMap.set(row.supplierKey, supplier)
  }

  let expenseTotal = 0
  let expenseCount = 0
  const expenseMap = new Map<string, { label: string; amount: number; count: number }>()
  for (const row of cache.expenses) {
    if (!rowInPeriod(row.day, preset, selectedDate, rangeTo)) continue
    expenseTotal += row.amount
    expenseCount += 1
    const expense = expenseMap.get(row.nameKey) ?? {
      label: row.name,
      amount: 0,
      count: 0,
    }
    expense.amount += row.amount
    expense.count += 1
    expenseMap.set(row.nameKey, expense)
  }

  const topCustomers = toRankItems(customerMap, salesTotal)
  const topSuppliers = toRankItems(supplierMap, purchaseTotal)
  const topExpenseNames = toRankItems(expenseMap, expenseTotal)

  const salesByDay = buildSalesByDaySeries(dayMap, preset, selectedDate, rangeTo)

  let bestSalesDay: AnalyzeSeriesPoint | null = null
  for (const point of salesByDay) {
    if (point.amount <= 0) continue
    if (!bestSalesDay || point.amount > bestSalesDay.amount) bestSalesDay = point
  }

  let bestSalesMonth: AnalyzeMonthPoint | null = null
  for (const point of cache.monthlyTrend) {
    if (!bestSalesMonth || point.sales > bestSalesMonth.sales) bestSalesMonth = point
  }

  return {
    periodLabel: analyzePeriodLabel(preset, selectedDate, rangeTo, salesByDay),
    salesTotal,
    salesCount,
    purchaseTotal,
    purchaseCount,
    expenseTotal,
    expenseCount,
    net: salesTotal - purchaseTotal - expenseTotal,
    topCustomers,
    topSuppliers,
    topExpenseNames,
    salesByDay,
    monthlyTrend: cache.monthlyTrend,
    creditParties: cache.creditParties,
    creditTotal: cache.creditTotal,
    chequeParties: cache.chequeParties,
    chequeTotal: cache.chequeTotal,
    topCustomer: topCustomers[0] ?? null,
    topExpense: topExpenseNames[0] ?? null,
    topSupplier: topSuppliers[0] ?? null,
    bestSalesDay,
    bestSalesMonth,
  }
}

/** @deprecated Prefer buildAnalyzeCache + analyzeFromCache for interactive UI. */
export function buildBusinessAnalysis(
  data: AppData,
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): BusinessAnalysis {
  return analyzeFromCache(buildAnalyzeCache(data), preset, selectedDate, rangeTo)
}

export const ANALYZE_DATE_PRESETS: { id: CashDateFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
]

export const ANALYZE_TOPICS: { id: AnalyzeTopic; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'sales', label: 'Sales' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'credit', label: 'Credit' },
  { id: 'cheque', label: 'Cheque' },
]

export function hasAnalyzeBars(items: Array<{ amount: number }>): boolean {
  return items.some((item) => item.amount > 0)
}
