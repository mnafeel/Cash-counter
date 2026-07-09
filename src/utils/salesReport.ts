import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'

export type ReportPeriod = 'day' | 'week' | 'month'
export type ReportSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'
export type SaleDateMode = 'collected' | 'created'

export interface SalesReportFilter {
  fromDate?: string
  toDate?: string
  dateMode?: SaleDateMode
}

export interface SalesPeriodRow {
  key: string
  label: string
  sortTimestamp: number
  billCount: number
  totalBills: number
  cashTotal: number
  bankTotal: number
}

export interface SalesBillRow {
  id: string
  date: string
  dateLabel: string
  billAmount: number
  cashTotal: number
  bankTotal: number
  customerName?: string
  payLabel: string
}

export function toInputDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function saleReportDate(sale: Sale, mode: SaleDateMode = 'collected'): string {
  if (mode === 'created') return sale.createdAt
  if (sale.status === 'pending') return sale.createdAt
  return sale.updatedAt ?? sale.createdAt
}

function localDayTimestamp(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function inputDateTimestamp(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function isInDateRange(iso: string, filter?: SalesReportFilter): boolean {
  if (!filter?.fromDate && !filter?.toDate) return true
  const day = localDayTimestamp(iso)
  if (filter.fromDate && day < inputDateTimestamp(filter.fromDate)) return false
  if (filter.toDate && day > inputDateTimestamp(filter.toDate)) return false
  return true
}

function filteredPaidSales(data: AppData, filter?: SalesReportFilter): Sale[] {
  const mode = filter?.dateMode ?? 'collected'
  return paidSales(data).filter((sale) => isInDateRange(saleReportDate(sale, mode), filter))
}

function salePayLabel(sale: Sale): string {
  if (sale.payType === 'bank') return '🏦 Bank'
  if (sale.payType === 'split') {
    return `💵 ${formatMoney(sale.cashAmount ?? 0)} · 🏦 ${formatMoney(sale.bankAmount ?? 0)}`
  }
  return '💵 Cash'
}

export function saleCashCollected(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank' || sale.payType === 'credit') return 0
  if (sale.payType === 'split') return sale.cashAmount ?? 0
  return sale.billAmount
}

export function saleBankCollected(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank') return sale.billAmount
  if (sale.payType === 'split') return sale.bankAmount ?? 0
  return 0
}

function paidSales(data: AppData): Sale[] {
  return data.sales.filter((s) => s.status !== 'pending')
}

function periodKey(iso: string, period: ReportPeriod): string {
  const d = new Date(iso)
  if (period === 'day') {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  if (period === 'month') {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(d.getDate() + diff)
  const y = monday.getFullYear()
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const wd = String(monday.getDate()).padStart(2, '0')
  return `${y}-${m}-${wd}`
}

export function formatPeriodLabel(key: string, period: ReportPeriod): string {
  if (period === 'day') {
    const [y, m, d] = key.split('-').map(Number)
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
      new Date(y, m - 1, d),
    )
  }
  if (period === 'month') {
    const [y, m] = key.split('-').map(Number)
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
      new Date(y, m - 1, 1),
    )
  }
  const [y, m, d] = key.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

function periodSortTimestamp(key: string, period: ReportPeriod): number {
  if (period === 'month') {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1).getTime()
  }
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function buildSalesReport(
  data: AppData,
  period: ReportPeriod,
  sort: ReportSort,
  filter?: SalesReportFilter,
): SalesPeriodRow[] {
  const groups = new Map<
    string,
    { billCount: number; totalBills: number; cashTotal: number; bankTotal: number }
  >()

  for (const sale of filteredPaidSales(data, filter)) {
    const iso = saleReportDate(sale, filter?.dateMode ?? 'collected')
    const key = periodKey(iso, period)
    const row = groups.get(key) ?? {
      billCount: 0,
      totalBills: 0,
      cashTotal: 0,
      bankTotal: 0,
    }
    row.billCount += 1
    row.totalBills += sale.billAmount
    row.cashTotal += saleCashCollected(sale)
    row.bankTotal += saleBankCollected(sale)
    groups.set(key, row)
  }

  const rows: SalesPeriodRow[] = [...groups.entries()].map(([key, totals]) => ({
    key,
    label: formatPeriodLabel(key, period),
    sortTimestamp: periodSortTimestamp(key, period),
    ...totals,
  }))

  rows.sort((a, b) => {
    if (sort === 'date-desc') return b.sortTimestamp - a.sortTimestamp
    if (sort === 'date-asc') return a.sortTimestamp - b.sortTimestamp
    if (sort === 'amount-desc') {
      return b.totalBills - a.totalBills || b.sortTimestamp - a.sortTimestamp
    }
    return a.totalBills - b.totalBills || a.sortTimestamp - b.sortTimestamp
  })

  return rows
}

export function buildSalesBillList(
  data: AppData,
  sort: ReportSort,
  filter?: SalesReportFilter,
): SalesBillRow[] {
  const mode = filter?.dateMode ?? 'collected'
  const rows = filteredPaidSales(data, filter).map((sale) => {
    const date = saleReportDate(sale, mode)
    return {
      id: sale.id,
      date,
      dateLabel: formatDate(date),
      billAmount: sale.billAmount,
      cashTotal: saleCashCollected(sale),
      bankTotal: saleBankCollected(sale),
      customerName: sale.customerName,
      payLabel: salePayLabel(sale),
    }
  })

  rows.sort((a, b) => {
    const aTime = localDayTimestamp(a.date)
    const bTime = localDayTimestamp(b.date)
    if (sort === 'date-desc') return bTime - aTime || b.billAmount - a.billAmount
    if (sort === 'date-asc') return aTime - bTime || a.billAmount - b.billAmount
    if (sort === 'amount-desc') return b.billAmount - a.billAmount || bTime - aTime
    return a.billAmount - b.billAmount || aTime - bTime
  })

  return rows
}

export function summarizeSales(rows: Pick<SalesPeriodRow, 'billCount' | 'totalBills' | 'cashTotal' | 'bankTotal'>[]) {
  return rows.reduce(
    (acc, row) => ({
      billCount: acc.billCount + row.billCount,
      totalBills: acc.totalBills + row.totalBills,
      cashTotal: acc.cashTotal + row.cashTotal,
      bankTotal: acc.bankTotal + row.bankTotal,
    }),
    { billCount: 0, totalBills: 0, cashTotal: 0, bankTotal: 0 },
  )
}

export function getTodaySalesSummary(data: AppData) {
  const today = toInputDate()
  const filter: SalesReportFilter = { fromDate: today, toDate: today, dateMode: 'collected' }
  const sales = filteredPaidSales(data, filter)

  return {
    billCount: sales.length,
    totalBills: sales.reduce((sum, s) => sum + s.billAmount, 0),
    cashTotal: sales.reduce((sum, s) => sum + saleCashCollected(s), 0),
    bankTotal: sales.reduce((sum, s) => sum + saleBankCollected(s), 0),
  }
}

export function formatSalesBreakdown(cash: number, bank: number): string {
  return `💵 ${formatMoney(cash)} · 🏦 ${formatMoney(bank)}`
}
