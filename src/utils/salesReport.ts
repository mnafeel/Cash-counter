import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'
import {
  saleCollectedAmount,
  saleHasCollectionInRange,
  salePaymentEventsInRange,
  salePendingCreditPaidBreakdown,
} from './salePayment'

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
  createdDate: string
  createdDateLabel: string
  billAmount: number
  collectedTotal: number
  creditPending: number
  chequePending: number
  cashTotal: number
  bankTotal: number
  chequeTotal: number
  customerName?: string
  payLabel: string
  detailLabel: string
  groupId: string
}

export interface SalesBillSummary {
  billCount: number
  totalBills: number
  billTotal: number
  withCreditSales: number
  cashTotal: number
  bankTotal: number
  chequeTotal: number
  creditPending: number
  chequePending: number
}

export interface SaleCollectedBreakdown {
  cash: number
  bank: number
  cheque: number
  total: number
}

function emptyCollectedBreakdown(): SaleCollectedBreakdown {
  return { cash: 0, bank: 0, cheque: 0, total: 0 }
}

function sumPaymentEvents(
  events: ReturnType<typeof salePaymentEventsInRange>,
): SaleCollectedBreakdown {
  return events.reduce(
    (acc, event) => {
      acc.cash += event.cash ?? 0
      acc.bank += event.bank ?? 0
      acc.cheque += event.cheque ?? 0
      acc.total += event.amount
      return acc
    },
    emptyCollectedBreakdown(),
  )
}

export function saleCollectedForFilter(
  sale: Sale,
  filter?: SalesReportFilter,
): SaleCollectedBreakdown {
  const full = {
    cash: saleCashCollected(sale),
    bank: saleBankCollected(sale),
    cheque: saleChequeToBankCollected(sale),
    total: 0,
  }
  full.total = full.cash + full.bank + full.cheque

  const mode = filter?.dateMode ?? 'collected'
  if (mode === 'created' || (!filter?.fromDate && !filter?.toDate)) {
    return full
  }

  if (sale.paymentEvents && sale.paymentEvents.length > 0) {
    const events = salePaymentEventsInRange(sale, filter.fromDate, filter.toDate)
    return events.length > 0 ? sumPaymentEvents(events) : emptyCollectedBreakdown()
  }

  if (!saleMatchesReportFilter(sale, filter)) {
    return emptyCollectedBreakdown()
  }

  return full
}

export function toInputDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isPendingBalanceBill(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'credit' ||
      sale.payType === 'credit' ||
      sale.pendingPayType === 'cheque' ||
      sale.payType === 'cheque')
  )
}

function saleHasPartialCollection(sale: Sale): boolean {
  return isPendingBalanceBill(sale) && saleCollectedAmount(sale) > 0
}

export function saleReportDate(sale: Sale, mode: SaleDateMode = 'collected'): string {
  if (mode === 'created') return sale.createdAt
  if (sale.status === 'pending') {
    if (saleHasPartialCollection(sale) && sale.updatedAt) return sale.updatedAt
    return sale.createdAt
  }
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

function salesForReport(data: AppData): Sale[] {
  return data.sales.filter((s) => s.status !== 'pending' || saleHasPartialCollection(s))
}

function filteredReportSales(data: AppData, filter?: SalesReportFilter): Sale[] {
  return salesForReport(data).filter((sale) => saleMatchesReportFilter(sale, filter))
}

function filteredFullyPaidSales(data: AppData, filter?: SalesReportFilter): Sale[] {
  return paidSales(data).filter((sale) => saleMatchesReportFilter(sale, filter))
}

function isCreditPendingSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.payType === 'credit' || sale.pendingPayType === 'credit')
  )
}

function isChequePendingSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.payType === 'cheque' || sale.pendingPayType === 'cheque')
  )
}

export function saleOriginalBillAmount(sale: Sale): number {
  const collected = saleCollectedAmount(sale)
  if (sale.originalBillAmount && sale.originalBillAmount > 0) return sale.originalBillAmount
  if (isCreditPendingSale(sale) || isChequePendingSale(sale)) {
    return sale.billAmount + collected
  }
  return sale.billAmount
}

export function saleCreditPendingAmount(sale: Sale): number {
  if (!isCreditPendingSale(sale)) return 0
  return sale.billAmount
}

export function saleChequePendingAmount(sale: Sale): number {
  if (!isChequePendingSale(sale)) return 0
  return sale.billAmount
}

function buildSalesBillDetailLabel(sale: Sale): string {
  const collected = saleTotalCollected(sale)
  const creditPending = saleCreditPendingAmount(sale)
  const chequePending = saleChequePendingAmount(sale)
  const parts: string[] = []

  if (collected > 0) {
    parts.push(`Paid ${formatMoney(collected)}`)
  }
  if (creditPending > 0) {
    parts.push(`Credit ${formatMoney(creditPending)}`)
  }
  if (chequePending > 0) {
    parts.push(`Cheque ${formatMoney(chequePending)}`)
  }

  if (parts.length > 0) return parts.join(' · ')
  return salePayLabel(sale)
}

function salePayLabel(sale: Sale): string {
  if (sale.payType === 'bank') return '🏦 Bank'
  if (sale.payType === 'cheque') return '🧾 Cheque'
  if (sale.payType === 'split') {
    const base = `💵 ${formatMoney(sale.cashAmount ?? 0)} · 🏦 ${formatMoney(sale.bankAmount ?? 0)}`
    const withCheque =
      (sale.chequeAmount ?? 0) > 0 ? `${base} · 🧾 ${formatMoney(sale.chequeAmount ?? 0)}` : base
    return (sale.creditAmount ?? 0) > 0
      ? `${withCheque} · 💳 ${formatMoney(sale.creditAmount ?? 0)}`
      : withCheque
  }
  return '💵 Cash'
}

export function saleCashCollected(sale: Sale): number {
  if (sale.status === 'pending') return salePendingCreditPaidBreakdown(sale).cash
  if (sale.payType === 'bank' || sale.payType === 'credit' || sale.payType === 'cheque') return 0
  if (sale.payType === 'split') return sale.cashAmount ?? 0
  return sale.billAmount
}

export function saleBankCollected(sale: Sale): number {
  if (sale.status === 'pending') return salePendingCreditPaidBreakdown(sale).bank
  if (sale.payType === 'bank') return sale.billAmount
  if (sale.payType === 'cheque') return sale.billAmount
  if (sale.payType === 'split') {
    const cheque = sale.chequeAmount ?? 0
    let bank = sale.bankAmount ?? 0
    if (sale.chequeApproved && cheque > 0) bank = Math.max(0, bank - cheque)
    return bank
  }
  return 0
}

export function saleChequeToBankCollected(sale: Sale): number {
  if (sale.status === 'pending') return salePendingCreditPaidBreakdown(sale).cheque
  if (sale.payType === 'split' && sale.chequeApproved) return sale.chequeAmount ?? 0
  return 0
}

export function saleTotalCollected(sale: Sale): number {
  return saleCashCollected(sale) + saleBankCollected(sale) + saleChequeToBankCollected(sale)
}

export function saleBillGroupId(sale: Sale): string {
  return sale.parentSplitId ?? sale.id
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

  for (const sale of filteredReportSales(data, filter)) {
    const mode = filter?.dateMode ?? 'collected'
    const events = filter ? salePaymentEventsInRange(sale, filter.fromDate, filter.toDate) : []

    if (events.length > 0) {
      for (const event of events) {
        const key = periodKey(event.at, period)
        const row = groups.get(key) ?? {
          billCount: 0,
          totalBills: 0,
          cashTotal: 0,
          bankTotal: 0,
        }
        row.totalBills += event.amount
        row.cashTotal += event.cash ?? 0
        row.bankTotal += (event.bank ?? 0) + (event.cheque ?? 0)
        groups.set(key, row)
      }
      continue
    }

    const collected = saleCollectedForFilter(sale, filter)
    if (collected.total <= 0) continue
    const iso = saleReportDate(sale, mode)
    const key = periodKey(iso, period)
    const row = groups.get(key) ?? {
      billCount: 0,
      totalBills: 0,
      cashTotal: 0,
      bankTotal: 0,
    }
    row.totalBills += collected.total
    row.cashTotal += collected.cash
    row.bankTotal += collected.bank + collected.cheque
    groups.set(key, row)
  }

  for (const [key, row] of groups) {
    const groupIds = new Set<string>()
    for (const sale of filteredFullyPaidSales(data, filter)) {
      if (saleCollectedForFilter(sale, filter).total <= 0) continue
      const iso = saleReportDate(sale, filter?.dateMode ?? 'collected')
      if (periodKey(iso, period) !== key) continue
      groupIds.add(saleBillGroupId(sale))
    }
    row.billCount = groupIds.size
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

function buildChildrenMap(sales: Sale[]): Map<string, Sale[]> {
  const map = new Map<string, Sale[]>()
  for (const sale of sales) {
    if (!sale.parentSplitId) continue
    const list = map.get(sale.parentSplitId) ?? []
    list.push(sale)
    map.set(sale.parentSplitId, list)
  }
  return map
}

function saleMatchesReportFilter(sale: Sale, filter?: SalesReportFilter): boolean {
  const mode = filter?.dateMode ?? 'collected'
  if (mode === 'created') {
    return isInDateRange(sale.createdAt, filter)
  }

  if (saleHasCollectionInRange(sale, filter?.fromDate, filter?.toDate)) {
    return true
  }

  if (sale.paymentEvents && sale.paymentEvents.length > 0) {
    return false
  }

  return isInDateRange(saleReportDate(sale, mode), filter)
}

function groupOriginalBillAmount(parent: Sale, children: Sale[]): number {
  if (parent.originalBillAmount && parent.originalBillAmount > 0) return parent.originalBillAmount
  const childOrig = children.find((c) => c.originalBillAmount && c.originalBillAmount > 0)
  if (childOrig?.originalBillAmount) return childOrig.originalBillAmount
  const childPendingCredit = children.reduce((sum, c) => sum + saleCreditPendingAmount(c), 0)
  const parentCollected = parent.status !== 'pending' ? saleTotalCollected(parent) : 0
  const childCollected = children.reduce((sum, c) => sum + saleCollectedAmount(c), 0)
  if (childPendingCredit > 0 || parentCollected + childCollected > 0) {
    return parent.billAmount + childPendingCredit + childCollected
  }
  return parent.billAmount + children.reduce((sum, c) => sum + c.billAmount, 0)
}

function groupCreditPending(parent: Sale, children: Sale[]): number {
  return saleCreditPendingAmount(parent) + children.reduce((sum, c) => sum + saleCreditPendingAmount(c), 0)
}

function groupChequePending(parent: Sale, children: Sale[]): number {
  return saleChequePendingAmount(parent) + children.reduce((sum, c) => sum + saleChequePendingAmount(c), 0)
}

function groupCustomerName(parent: Sale, children: Sale[]): string | undefined {
  return parent.customerName?.trim() || children.find((c) => c.customerName?.trim())?.customerName?.trim()
}

function buildGroupedSalesBillDetailLabel(
  parent: Sale,
  billAmount: number,
  collectedInPeriod: number,
  creditPending: number,
  chequePending: number,
): string {
  const parts: string[] = [`Bill ${formatMoney(billAmount)}`]
  if (collectedInPeriod > 0) parts.push(`Paid ${formatMoney(collectedInPeriod)}`)
  if (creditPending > 0) parts.push(`Credit ${formatMoney(creditPending)}`)
  if (chequePending > 0) parts.push(`Cheque ${formatMoney(chequePending)}`)
  if (parts.length > 1) return parts.join(' · ')
  return buildSalesBillDetailLabel(parent)
}

function buildPeriodCollectedLabel(collected: SaleCollectedBreakdown): string {
  if (collected.total <= 0) return 'Paid —'
  const parts: string[] = [`Paid ${formatMoney(collected.total)}`]
  if (collected.cash > 0) parts.push(`💵 ${formatMoney(collected.cash)}`)
  if (collected.bank > 0) parts.push(`🏦 ${formatMoney(collected.bank)}`)
  if (collected.cheque > 0) parts.push(`🧾 ${formatMoney(collected.cheque)}`)
  return parts.join(' · ')
}

function buildSingleSalesBillRow(sale: Sale, filter?: SalesReportFilter): SalesBillRow {
  const mode = filter?.dateMode ?? 'collected'
  const hasDateFilter = Boolean(filter?.fromDate || filter?.toDate)
  const events = filter ? salePaymentEventsInRange(sale, filter.fromDate, filter.toDate) : []
  const date =
    events.length > 0 ? events[events.length - 1].at : saleReportDate(sale, mode)
  const collected = saleCollectedForFilter(sale, filter)
  const billAmount = saleOriginalBillAmount(sale)
  const creditPending = saleCreditPendingAmount(sale)
  const chequePending = saleChequePendingAmount(sale)
  const payLabel =
    hasDateFilter && mode === 'collected'
      ? buildPeriodCollectedLabel(collected)
      : buildSalesBillDetailLabel(sale)
  return {
    id: sale.id,
    groupId: saleBillGroupId(sale),
    date,
    dateLabel: formatDate(date),
    createdDate: sale.createdAt,
    createdDateLabel: formatDate(sale.createdAt),
    billAmount,
    collectedTotal: collected.total,
    creditPending,
    chequePending,
    cashTotal: collected.cash,
    bankTotal: collected.bank,
    chequeTotal: collected.cheque,
    customerName: sale.customerName,
    payLabel,
    detailLabel: `Bill ${formatMoney(billAmount)} · ${payLabel}`,
  }
}

function buildGroupedSalesBillRow(
  parent: Sale,
  children: Sale[],
  filter: SalesReportFilter | undefined,
  mode: SaleDateMode,
): SalesBillRow | null {
  const members = [parent, ...children]
  const inRange = members.filter((member) => saleMatchesReportFilter(member, filter))
  if (inRange.length === 0) return null

  const billAmount = groupOriginalBillAmount(parent, children)
  const cashTotal = inRange.reduce((sum, member) => sum + saleCollectedForFilter(member, filter).cash, 0)
  const bankTotal = inRange.reduce((sum, member) => sum + saleCollectedForFilter(member, filter).bank, 0)
  const chequeTotal = inRange.reduce(
    (sum, member) => sum + saleCollectedForFilter(member, filter).cheque,
    0,
  )
  const collectedTotal = cashTotal + bankTotal + chequeTotal
  const creditPending = groupCreditPending(parent, children)
  const chequePending = groupChequePending(parent, children)
  const date = inRange.reduce((latest, member) => {
    const memberDate = saleReportDate(member, mode)
    return !latest || new Date(memberDate).getTime() > new Date(latest).getTime() ? memberDate : latest
  }, '')

  return {
    id: parent.id,
    groupId: parent.id,
    date,
    dateLabel: formatDate(date),
    createdDate: parent.createdAt,
    createdDateLabel: formatDate(parent.createdAt),
    billAmount,
    collectedTotal,
    creditPending,
    chequePending,
    cashTotal,
    bankTotal,
    chequeTotal,
    customerName: groupCustomerName(parent, children),
    payLabel: buildGroupedSalesBillDetailLabel(
      parent,
      billAmount,
      collectedTotal,
      creditPending,
      chequePending,
    ),
    detailLabel: buildGroupedSalesBillDetailLabel(
      parent,
      billAmount,
      collectedTotal,
      creditPending,
      chequePending,
    ),
  }
}

function sortSalesBillRows(rows: SalesBillRow[], sort: ReportSort): SalesBillRow[] {
  return [...rows].sort((a, b) => {
    const aTime = localDayTimestamp(a.date)
    const bTime = localDayTimestamp(b.date)
    if (sort === 'date-desc') return bTime - aTime || b.billAmount - a.billAmount
    if (sort === 'date-asc') return aTime - bTime || a.billAmount - b.billAmount
    if (sort === 'amount-desc') return b.collectedTotal - a.collectedTotal || bTime - aTime
    return a.collectedTotal - b.collectedTotal || aTime - bTime
  })
}

export function buildSalesBillList(
  data: AppData,
  sort: ReportSort,
  filter?: SalesReportFilter,
): SalesBillRow[] {
  const mode = filter?.dateMode ?? 'collected'
  const hasDateFilter = Boolean(filter?.fromDate || filter?.toDate)
  const includeBillRow = (row: SalesBillRow) =>
    !hasDateFilter || mode === 'created' || row.collectedTotal > 0
  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  const rows: SalesBillRow[] = []

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      const row = buildGroupedSalesBillRow(sale, children, filter, mode)
      if (row && includeBillRow(row)) rows.push(row)
      continue
    }

    if (!saleMatchesReportFilter(sale, filter)) continue
    const row = buildSingleSalesBillRow(sale, filter)
    if (includeBillRow(row)) rows.push(row)
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    if (!saleMatchesReportFilter(sale, filter)) continue
    const row = buildSingleSalesBillRow(sale, filter)
    if (includeBillRow(row)) rows.push(row)
  }

  return sortSalesBillRows(rows, sort)
}

export function summarizeSalesBillRows(rows: SalesBillRow[]): SalesBillSummary {
  const seenGroups = new Set<string>()
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalBills += row.collectedTotal
      acc.cashTotal += row.cashTotal
      acc.bankTotal += row.bankTotal
      acc.chequeTotal += row.chequeTotal
      acc.creditPending += row.creditPending
      acc.chequePending += row.chequePending
      if (!seenGroups.has(row.groupId)) {
        seenGroups.add(row.groupId)
        acc.billCount += 1
        acc.billTotal += row.billAmount
      }
      return acc
    },
    {
      billCount: 0,
      totalBills: 0,
      billTotal: 0,
      withCreditSales: 0,
      cashTotal: 0,
      bankTotal: 0,
      chequeTotal: 0,
      creditPending: 0,
      chequePending: 0,
    },
  )
  summary.withCreditSales =
    summary.totalBills + summary.creditPending + summary.chequePending
  return summary
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

export function getTodaySalesSummary(data: AppData): SalesBillSummary {
  const today = toInputDate()
  const filter: SalesReportFilter = { fromDate: today, toDate: today, dateMode: 'collected' }
  return summarizeSalesBillRows(buildSalesBillList(data, 'date-desc', filter))
}

export function formatSalesBreakdown(
  cash: number,
  bank: number,
  credit = 0,
  cheque = 0,
): string {
  const parts = [
    `💵 ${formatMoney(cash)}`,
    `🏦 ${formatMoney(bank)}`,
    `💳 ${formatMoney(credit)}`,
    `🧾 ${formatMoney(cheque)}`,
  ]
  return parts.join(' · ')
}
