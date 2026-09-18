import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'
import {
  saleCollectedAmount,
  saleHasCollectionInRange,
  saleHasPendingBalanceTransferInRange,
  salePaymentEventsInRange,
  saleCollectedComponentBreakdown,
  getSalePaymentEvents,
  paymentEventBankInflow,
  salePaidCollectedBreakdown,
  salePendingBalanceHistoryDate,
  saleLastPaymentEventAt,
  normalizeCollectedBreakdown,
  sumRealizedPaymentEvents,
} from './salePayment'
import {
  linkedPendingCreditTotal,
  saleCreditBalanceDue,
  salePendingLegAmount,
} from './saleReturns'
import { listAdvanceSalesForReport, saleAdvanceSalesCountAmount } from './customerAdvance'

export type ReportPeriod = 'day' | 'week' | 'month'
export type ReportSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'
export type SaleDateMode = 'collected' | 'created'

export interface SalesReportFilter {
  fromDate?: string
  toDate?: string
  dateMode?: SaleDateMode
  /**
   * Same-period sales: bill created in the selected period AND money collected in that
   * same period (Today = same calendar day; Week/Month/Range = within that window;
   * All = every past collection on every bill from the start).
   */
  sameDayCreatedAndPaid?: boolean
  /** When on_receive, applied advance is not added again to sales totals. */
  advanceSalesCountMode?: 'on_bill' | 'on_receive'
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

export type SalesBillRow = {
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
  /** Bill involves credit and/or cheque (pending or settled). */
  hasCreditOrCheque: boolean
  hasCredit: boolean
  hasCheque: boolean
  /** When the credit leg was opened (bill/cheque date). */
  creditDate?: string
  creditDateLabel?: string
  /** When the cheque leg was opened (bill/cheque date). */
  chequeDate?: string
  chequeDateLabel?: string
  /** Last update on the credit/cheque leg (for pending updated today). */
  updatedDate?: string
  updatedDateLabel?: string
  /** Synthetic row for a customer advance payment. */
  isAdvanceRow?: boolean
  /** Open advance still held (not yet applied to a bill). */
  advanceRemaining?: number
  /** Portion of this advance already applied to bills. */
  advanceApplied?: number
}

export interface SalesBillSummary {
  billCount: number
  totalBills: number
  billTotal: number
  withCreditSales: number
  /** That day's total sales collected (same as totalBills). */
  withCreditCollected: number
  /** Old credit/cheque bills (opened earlier) that were cleared/collected in this period. */
  oldCreditChequeCollected: number
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
  sale: Sale,
  events: ReturnType<typeof salePaymentEventsInRange>,
): SaleCollectedBreakdown {
  return sumRealizedPaymentEvents(sale, events)
}

/** Same-period / same-day sales: cash + bank only; pending cheques excluded. */
function sumSameDaySalesCollectedEvents(
  sale: Sale,
  events: ReturnType<typeof getSalePaymentEvents>,
): SaleCollectedBreakdown {
  return sumRealizedPaymentEvents(sale, events)
}

function samePeriodSalesCollectedBreakdown(sale: Sale): SaleCollectedBreakdown {
  return normalizeCollectedBreakdown(salePaidCollectedBreakdown(sale))
}

/**
 * Same-period sales amount for a bill:
 * - Bill must be created in the filter window (any time when All / unbounded).
 * - Count only money collected inside that same window (all collections when All).
 */
export function saleCollectedForFilter(
  sale: Sale,
  filter?: SalesReportFilter,
): SaleCollectedBreakdown {
  if (filter?.sameDayCreatedAndPaid) {
    if (!isInDateRange(sale.createdAt, filter)) return emptyCollectedBreakdown()

    const bounded = Boolean(filter.fromDate || filter.toDate)
    const allEvents = getSalePaymentEvents(sale)

    if (bounded) {
      const periodEvents = allEvents.filter((event) =>
        isInDateRange(event.at, filter),
      )
      if (periodEvents.length > 0) {
        return sumSameDaySalesCollectedEvents(sale, periodEvents)
      }
      // Legacy paid bill with no events: treat full collection as on created day.
      if (allEvents.length === 0 && sale.status !== 'pending') {
        return samePeriodSalesCollectedBreakdown(sale)
      }
      return emptyCollectedBreakdown()
    }

    // All-time: every past collection on this bill (from the beginning).
    if (allEvents.length > 0) {
      return sumSameDaySalesCollectedEvents(sale, allEvents)
    }
    if (sale.status !== 'pending') {
      return samePeriodSalesCollectedBreakdown(sale)
    }
    return emptyCollectedBreakdown()
  }

  const mode = filter?.dateMode ?? 'collected'
  if (mode === 'created' || (!filter?.fromDate && !filter?.toDate)) {
    return saleCollectedComponentBreakdown(sale)
  }

  if (getSalePaymentEvents(sale).length > 0) {
    const events = salePaymentEventsInRange(sale, filter.fromDate, filter.toDate)
    return events.length > 0 ? sumPaymentEvents(sale, events) : emptyCollectedBreakdown()
  }

  if (!saleMatchesReportFilter(sale, filter)) {
    return emptyCollectedBreakdown()
  }

  return saleCollectedComponentBreakdown(sale)
}

/** Approved cheque → bank only for sales list / summary display. */
function collectedForSalesDisplay(breakdown: SaleCollectedBreakdown): SaleCollectedBreakdown {
  return normalizeCollectedBreakdown(breakdown)
}

/**
 * Advance applied counts toward Sales on the bill day (when it was applied), once —
 * never again on every later payment day in Week / Month filters.
 */
function saleAdvanceAppliedForSalesTotal(
  sale: Sale,
  filter?: SalesReportFilter,
  data?: AppData,
): number {
  const advance = data
    ? saleAdvanceSalesCountAmount(data, sale)
    : filter?.advanceSalesCountMode === 'on_receive'
      ? 0
      : (sale.customerAdvanceApplied ?? 0)
  if (advance <= 0.01) return 0

  if (!filter?.fromDate && !filter?.toDate) return advance

  if (filter.sameDayCreatedAndPaid) {
    // Advance belongs with the bill's create period (same as period collections).
    return isInDateRange(sale.createdAt, filter) ? advance : 0
  }

  const mode = filter.dateMode ?? 'collected'
  // Bill-day attribution keeps Today / Week / Month additive and avoids double-count.
  if (mode === 'created' || mode === 'collected') {
    return isInDateRange(sale.createdAt, filter) ? advance : 0
  }

  return 0
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

/** Sales list “updated” — hide credit↔cheque transfer bumps (receipt still shows transfer date). */
function saleSalesRowUpdatedAt(sale: Sale): string {
  const updated = sale.updatedAt ?? sale.createdAt
  const transfers = sale.pendingBalanceTransfers ?? []
  if (transfers.length === 0) return updated
  const lastTransfer = transfers[transfers.length - 1]
  if (localDayTimestamp(updated) === localDayTimestamp(lastTransfer.at)) {
    return sale.createdAt
  }
  return updated
}

export function saleReportDate(sale: Sale, mode: SaleDateMode = 'collected'): string {
  if (mode === 'created') return sale.createdAt
  if (sale.status === 'pending') {
    if (isPendingBalanceBill(sale)) return salePendingBalanceHistoryDate(sale)
    if (saleHasPartialCollection(sale) && sale.updatedAt) return sale.updatedAt
    return sale.createdAt
  }
  // Paid bills: last real payment day, never a later edit bump on updatedAt.
  return saleLastPaymentEventAt(sale) ?? sale.createdAt
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
  if (isCreditPendingSale(sale) || isChequePendingSale(sale)) {
    if (sale.parentSplitId) return sale.billAmount + collected
    if (sale.originalBillAmount && sale.originalBillAmount > 0) return sale.originalBillAmount
    return sale.billAmount + collected
  }
  if (sale.originalBillAmount && sale.originalBillAmount > 0) return sale.originalBillAmount
  return sale.billAmount
}

export function saleCreditPendingAmount(sale: Sale, allSales?: Sale[]): number {
  if (!isCreditPendingSale(sale)) return 0
  if (allSales && allSales.length > 0) {
    const linked = linkedPendingCreditTotal(sale, allSales)
    const leg =
      linked > 0.01
        ? linked
        : sale.status === 'pending'
          ? salePendingLegAmount(sale)
          : 0
    if (leg > 0.01) return leg
    const due = saleCreditBalanceDue(sale, allSales)
    return due > 0.01 ? due : 0
  }
  const bill = Math.max(0, sale.billAmount)
  return bill > 0.01 ? bill : 0
}

export function saleChequePendingAmount(sale: Sale, allSales?: Sale[]): number {
  if (!isChequePendingSale(sale)) return 0
  if (allSales && allSales.length > 0) return saleCreditBalanceDue(sale, allSales)
  return Math.max(0, sale.billAmount)
}

function saleIsChequeRelated(sale: Sale): boolean {
  if (sale.payType === 'cheque' || sale.pendingPayType === 'cheque') return true
  if ((sale.chequeAmount ?? 0) > 0 || sale.chequeApproved === true) return true
  return isChequePendingSale(sale)
}

function saleIsCreditRelated(sale: Sale): boolean {
  if (sale.payType === 'credit' || sale.pendingPayType === 'credit') return true
  if ((sale.creditAmount ?? 0) > 0) return true
  return isCreditPendingSale(sale)
}

/**
 * A pending credit/cheque balance belongs to the period it was opened in, or the
 * period it was edited in. Collecting part of it (cash, bank or cheque approval)
 * moves money only — the open balance keeps its original credit/cheque date.
 */
export function salePendingBelongsToPeriod(sale: Sale, filter?: SalesReportFilter): boolean {
  if (!filter?.fromDate && !filter?.toDate) return true
  if ((filter.dateMode ?? 'collected') === 'created') return true
  if (isInDateRange(sale.createdAt, filter)) return true
  if (!isInDateRange(sale.updatedAt ?? sale.createdAt, filter)) return false
  if (saleHasCollectionInRange(sale, filter.fromDate, filter.toDate)) return false
  if (saleHasPendingBalanceTransferInRange(sale, filter.fromDate, filter.toDate)) {
    return false
  }
  return true
}

function saleCreditPendingForFilter(sale: Sale, filter?: SalesReportFilter): number {
  const pending = saleCreditPendingAmount(sale)
  if (pending <= 0) return 0
  return salePendingBelongsToPeriod(sale, filter) ? pending : 0
}

function saleChequePendingForFilter(sale: Sale, filter?: SalesReportFilter): number {
  const pending = saleChequePendingAmount(sale)
  if (pending <= 0) return 0
  return salePendingBelongsToPeriod(sale, filter) ? pending : 0
}

function latestIsoDate(dates: string[]): string | undefined {
  if (dates.length === 0) return undefined
  return dates.reduce((best, next) =>
    new Date(next).getTime() > new Date(best).getTime() ? next : best,
  )
}

function isIsoBeforeRange(iso: string, filter?: SalesReportFilter): boolean {
  if (!filter?.fromDate) return false
  return localDayTimestamp(iso) < inputDateTimestamp(filter.fromDate)
}

/** Credit/cheque bill opened before the period, with money collected in the period. */
export function isOldCreditChequeClearedRow(
  row: SalesBillRow,
  filter?: SalesReportFilter,
): boolean {
  if (!filter?.fromDate && !filter?.toDate) return false
  if (row.collectedTotal <= 0) return false
  if (!row.hasCreditOrCheque && !row.hasCredit && !row.hasCheque) return false
  const openedAt = row.chequeDate ?? row.creditDate ?? row.createdDate
  return isIsoBeforeRange(openedAt, filter)
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
  if (sale.payType === 'cheque') {
    if (sale.chequeApproved && sale.status !== 'pending') {
      const collected = saleCollectedComponentBreakdown(sale)
      return `🏦 Bank ${formatMoney(collected.bank)}`
    }
    return '🧾 Cheque'
  }
  if (sale.payType === 'split') {
    const collected = saleCollectedComponentBreakdown(sale)
    const base = formatCollectedSalesBreakdown(collected.cash, collected.bank)
    return (sale.creditAmount ?? 0) > 0
      ? `${base} · 💳 ${formatMoney(sale.creditAmount ?? 0)}`
      : base
  }
  return '💵 Cash'
}

export function saleCashCollected(sale: Sale): number {
  return saleCollectedComponentBreakdown(sale).cash
}

export function saleBankCollected(sale: Sale): number {
  return saleCollectedComponentBreakdown(sale).bank
}

export function saleChequeToBankCollected(sale: Sale): number {
  return saleCollectedComponentBreakdown(sale).cheque
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
        row.bankTotal += paymentEventBankInflow(event)
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

/**
 * Same-period sales: bill created in the selected period, and money collected in
 * that same period (Today/Yesterday = that day; Week/Month/Range = that window;
 * All = any bill with collection from the start of business).
 */
function saleHasSamePeriodCreatedAndPaid(sale: Sale, filter?: SalesReportFilter): boolean {
  if (!filter?.sameDayCreatedAndPaid || !isInDateRange(sale.createdAt, filter)) return false

  const bounded = Boolean(filter.fromDate || filter.toDate)
  const allEvents = getSalePaymentEvents(sale)

  if (bounded) {
    const periodEvents = allEvents.filter((event) => isInDateRange(event.at, filter))
    if (periodEvents.length > 0) {
      if (sumSameDaySalesCollectedEvents(sale, periodEvents).total > 0) return true
      return (sale.customerAdvanceApplied ?? 0) > 0.01
    }
    if (allEvents.length === 0 && sale.status !== 'pending') {
      if (samePeriodSalesCollectedBreakdown(sale).total > 0) return true
      return (sale.customerAdvanceApplied ?? 0) > 0.01
    }
    // Advance-only settlement created in this period.
    return (sale.customerAdvanceApplied ?? 0) > 0.01 && allEvents.length === 0
  }

  // All-time: include every past collected bill.
  if (allEvents.length > 0) {
    if (sumSameDaySalesCollectedEvents(sale, allEvents).total > 0) return true
  } else if (sale.status !== 'pending' && samePeriodSalesCollectedBreakdown(sale).total > 0) {
    return true
  }
  return (sale.customerAdvanceApplied ?? 0) > 0.01
}

function saleMatchesReportFilter(
  sale: Sale,
  filter?: SalesReportFilter,
  data?: AppData,
): boolean {
  const mode = filter?.dateMode ?? 'collected'
  if (filter?.sameDayCreatedAndPaid) {
    return saleHasSamePeriodCreatedAndPaid(sale, filter)
  }
  if (mode === 'created') {
    return isInDateRange(sale.createdAt, filter)
  }

  if (saleHasCollectionInRange(sale, filter?.fromDate, filter?.toDate)) {
    return true
  }

  // Advance applied on this day — sale value belongs here even with no drawer cash/bank.
  if (saleAdvanceAppliedForSalesTotal(sale, filter, data) > 0.01) {
    return true
  }

  if (isPendingBalanceBill(sale)) {
    // Open credit/cheque counts for the day it was created, or a true edit day —
    // not the day a part payment / approve-to-bank bumps updatedAt.
    return salePendingBelongsToPeriod(sale, filter)
  }

  if ((sale.paymentEvents?.length ?? 0) > 0 || getSalePaymentEvents(sale).length > 0) {
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

function groupCreditPending(parent: Sale, children: Sale[], filter?: SalesReportFilter): number {
  return (
    saleCreditPendingForFilter(parent, filter) +
    children.reduce((sum, c) => sum + saleCreditPendingForFilter(c, filter), 0)
  )
}

function groupChequePending(parent: Sale, children: Sale[], filter?: SalesReportFilter): number {
  return (
    saleChequePendingForFilter(parent, filter) +
    children.reduce((sum, c) => sum + saleChequePendingForFilter(c, filter), 0)
  )
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
  const display = collectedForSalesDisplay(collected)
  if (display.total <= 0) return 'Paid —'
  return `Paid ${formatMoney(display.total)} · ${formatCollectedSalesBreakdown(display.cash, display.bank)}`
}

function saleWasOpenedAsCreditOrCheque(sale: Sale): boolean {
  if (saleIsCreditRelated(sale) || saleIsChequeRelated(sale)) return true
  if (sale.pendingPayType === 'credit' || sale.pendingPayType === 'cheque') return true
  const original = sale.originalBillAmount ?? 0
  if (original > sale.billAmount + 0.01 && (sale.paymentEvents?.length ?? 0) > 0) return true
  return (sale.paymentEvents ?? []).some(
    (event) => !event.cancelled && event.amount > 0 && (event.cheque ?? 0) > 0,
  )
}

function buildSingleSalesBillRow(
  sale: Sale,
  filter?: SalesReportFilter,
  data?: AppData,
): SalesBillRow {
  const mode = filter?.dateMode ?? 'collected'
  const hasDateFilter = Boolean(filter?.fromDate || filter?.toDate)
  const events = filter ? salePaymentEventsInRange(sale, filter.fromDate, filter.toDate) : []
  const date =
    events.length > 0 ? events[events.length - 1].at : saleReportDate(sale, mode)
  const collected = collectedForSalesDisplay(saleCollectedForFilter(sale, filter))
  const advanceApplied = saleAdvanceAppliedForSalesTotal(sale, filter, data)
  const collectedTotal = Math.round((collected.total + advanceApplied) * 100) / 100
  const billAmount = saleOriginalBillAmount(sale)
  const creditPendingAll = saleCreditPendingAmount(sale)
  const chequePendingAll = saleChequePendingAmount(sale)
  const creditPending = saleCreditPendingForFilter(sale, filter)
  const chequePending = saleChequePendingForFilter(sale, filter)
  const payLabel =
    hasDateFilter && mode === 'collected'
      ? buildPeriodCollectedLabel(collected)
      : buildSalesBillDetailLabel(sale)
  const hasCredit = saleIsCreditRelated(sale)
  const hasCheque = saleIsChequeRelated(sale)
  const hasCreditOrCheque = hasCredit || hasCheque || saleWasOpenedAsCreditOrCheque(sale)
  const updatedAt = saleSalesRowUpdatedAt(sale)
  const advanceOnBillNote =
    advanceApplied > 0.01
      ? ` · Advance in sale ${formatMoney(advanceApplied)}`
      : (sale.customerAdvanceApplied ?? 0) > 0.01
        ? ` · Advance applied ${formatMoney(sale.customerAdvanceApplied ?? 0)} (already in Sales when received)`
        : ''
  const baseDetail =
    hasDateFilter && mode === 'collected'
      ? buildGroupedSalesBillDetailLabel(
          sale,
          billAmount,
          collectedTotal,
          creditPendingAll,
          chequePendingAll,
        )
      : `Bill ${formatMoney(billAmount)} · ${payLabel}`
  return {
    id: sale.id,
    groupId: saleBillGroupId(sale),
    date,
    dateLabel: formatDate(date),
    createdDate: sale.createdAt,
    createdDateLabel: formatDate(sale.createdAt),
    billAmount,
    collectedTotal,
    creditPending,
    chequePending,
    cashTotal: collected.cash,
    bankTotal: collected.bank,
    chequeTotal: 0,
    customerName: sale.customerName,
    payLabel,
    hasCreditOrCheque,
    hasCredit,
    hasCheque,
    creditDate: hasCredit ? sale.createdAt : undefined,
    creditDateLabel: hasCredit ? formatDate(sale.createdAt) : undefined,
    chequeDate: hasCheque ? sale.createdAt : undefined,
    chequeDateLabel: hasCheque ? formatDate(sale.createdAt) : undefined,
    updatedDate: hasCredit || hasCheque ? updatedAt : undefined,
    updatedDateLabel: hasCredit || hasCheque ? formatDate(updatedAt) : undefined,
    detailLabel: `${baseDetail}${advanceOnBillNote}`,
    advanceApplied: advanceApplied > 0.01 ? advanceApplied : undefined,
  }
}

function buildGroupedSalesBillRow(
  parent: Sale,
  children: Sale[],
  filter: SalesReportFilter | undefined,
  mode: SaleDateMode,
  data?: AppData,
): SalesBillRow | null {
  const members = [parent, ...children]
  const inRange = members.filter((member) => saleMatchesReportFilter(member, filter, data))
  if (inRange.length === 0) return null

  const billAmount = groupOriginalBillAmount(parent, children)
  const cashTotal = inRange.reduce((sum, member) => sum + saleCollectedForFilter(member, filter).cash, 0)
  const bankTotal = inRange.reduce((sum, member) => sum + saleCollectedForFilter(member, filter).bank, 0)
  const chequeTotal = inRange.reduce(
    (sum, member) => sum + saleCollectedForFilter(member, filter).cheque,
    0,
  )
  const collected = collectedForSalesDisplay({
    cash: cashTotal,
    bank: bankTotal,
    cheque: chequeTotal,
    total: cashTotal + bankTotal + chequeTotal,
  })
  const advanceApplied = inRange.reduce(
    (sum, member) => sum + saleAdvanceAppliedForSalesTotal(member, filter, data),
    0,
  )
  const collectedTotal = Math.round((collected.total + advanceApplied) * 100) / 100
  const creditPendingAll =
    saleCreditPendingAmount(parent) + children.reduce((sum, c) => sum + saleCreditPendingAmount(c), 0)
  const chequePendingAll =
    saleChequePendingAmount(parent) + children.reduce((sum, c) => sum + saleChequePendingAmount(c), 0)
  const creditPending = groupCreditPending(parent, children, filter)
  const chequePending = groupChequePending(parent, children, filter)
  const date = inRange.reduce((latest, member) => {
    const memberDate = saleReportDate(member, mode)
    return !latest || new Date(memberDate).getTime() > new Date(latest).getTime() ? memberDate : latest
  }, '')
  const creditMembers = members.filter((member) => saleIsCreditRelated(member))
  const chequeMembers = members.filter((member) => saleIsChequeRelated(member))
  const creditDate = latestIsoDate(creditMembers.map((m) => m.createdAt))
  const chequeDate = latestIsoDate(chequeMembers.map((m) => m.createdAt))
  const updatedDate = latestIsoDate(
    [...creditMembers, ...chequeMembers].map((m) => m.updatedAt ?? m.createdAt),
  )
  const hasCredit = creditMembers.length > 0
  const hasCheque = chequeMembers.length > 0

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
    cashTotal: collected.cash,
    bankTotal: collected.bank,
    chequeTotal: 0,
    customerName: groupCustomerName(parent, children),
    hasCreditOrCheque: hasCredit || hasCheque,
    hasCredit,
    hasCheque,
    creditDate,
    creditDateLabel: creditDate ? formatDate(creditDate) : undefined,
    chequeDate,
    chequeDateLabel: chequeDate ? formatDate(chequeDate) : undefined,
    updatedDate,
    updatedDateLabel: updatedDate ? formatDate(updatedDate) : undefined,
    payLabel: buildGroupedSalesBillDetailLabel(
      parent,
      billAmount,
      collectedTotal,
      creditPendingAll,
      chequePendingAll,
    ),
    detailLabel: buildGroupedSalesBillDetailLabel(
      parent,
      billAmount,
      collectedTotal,
      creditPendingAll,
      chequePendingAll,
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

/** Sum collected sales for a filter without building/sorting full bill rows. */
export function sumSalesCollectedForFilter(data: AppData, filter?: SalesReportFilter): number {
  const mode = filter?.dateMode ?? 'collected'
  const hasDateFilter = Boolean(filter?.fromDate || filter?.toDate)
  const includeCollected = (
    collectedTotal: number,
    creditPending: number,
    chequePending: number,
  ) =>
    !hasDateFilter ||
    mode === 'created' ||
    collectedTotal > 0 ||
    creditPending > 0 ||
    chequePending > 0

  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  let total = 0

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      const members = [sale, ...children]
      const inRange = members.filter((member) => saleMatchesReportFilter(member, filter, data))
      if (inRange.length === 0) continue

      const cashTotal = inRange.reduce(
        (sum, member) => sum + saleCollectedForFilter(member, filter).cash,
        0,
      )
      const bankTotal = inRange.reduce(
        (sum, member) => sum + saleCollectedForFilter(member, filter).bank,
        0,
      )
      const chequeTotal = inRange.reduce(
        (sum, member) => sum + saleCollectedForFilter(member, filter).cheque,
        0,
      )
      const collectedTotal =
        collectedForSalesDisplay({
          cash: cashTotal,
          bank: bankTotal,
          cheque: chequeTotal,
          total: cashTotal + bankTotal + chequeTotal,
        }).total +
        inRange.reduce(
          (sum, member) => sum + saleAdvanceAppliedForSalesTotal(member, filter, data),
          0,
        )
      const creditPending = groupCreditPending(sale, children, filter)
      const chequePending = groupChequePending(sale, children, filter)
      if (includeCollected(collectedTotal, creditPending, chequePending)) {
        total += collectedTotal
      }
      continue
    }

    if (!saleMatchesReportFilter(sale, filter, data)) continue
    const collectedTotal =
      collectedForSalesDisplay(saleCollectedForFilter(sale, filter)).total +
      saleAdvanceAppliedForSalesTotal(sale, filter, data)
    const creditPending = saleCreditPendingForFilter(sale, filter)
    const chequePending = saleChequePendingForFilter(sale, filter)
    if (includeCollected(collectedTotal, creditPending, chequePending)) {
      total += collectedTotal
    }
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    if (!saleMatchesReportFilter(sale, filter, data)) continue
    const collectedTotal =
      collectedForSalesDisplay(saleCollectedForFilter(sale, filter)).total +
      saleAdvanceAppliedForSalesTotal(sale, filter, data)
    const creditPending = saleCreditPendingForFilter(sale, filter)
    const chequePending = saleChequePendingForFilter(sale, filter)
    if (includeCollected(collectedTotal, creditPending, chequePending)) {
      total += collectedTotal
    }
  }

  return total
}

export function buildSalesBillList(
  data: AppData,
  sort: ReportSort,
  filter?: SalesReportFilter,
): SalesBillRow[] {
  const mode = filter?.dateMode ?? 'collected'
  const hasDateFilter = Boolean(filter?.fromDate || filter?.toDate)
  const includeBillRow = (row: SalesBillRow) =>
    !hasDateFilter ||
    mode === 'created' ||
    row.collectedTotal > 0 ||
    row.creditPending > 0 ||
    row.chequePending > 0
  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  const rows: SalesBillRow[] = []

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      const row = buildGroupedSalesBillRow(sale, children, filter, mode, data)
      if (row && includeBillRow(row)) rows.push(row)
      continue
    }

    if (!saleMatchesReportFilter(sale, filter, data)) continue
    const row = buildSingleSalesBillRow(sale, filter, data)
    if (includeBillRow(row)) rows.push(row)
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    if (!saleMatchesReportFilter(sale, filter, data)) continue
    const row = buildSingleSalesBillRow(sale, filter, data)
    if (includeBillRow(row)) rows.push(row)
  }

  // Advance payments that count in Sales — listed with remaining after bill apply.
  if (!filter?.sameDayCreatedAndPaid) {
    for (const advance of listAdvanceSalesForReport(data, filter?.fromDate, filter?.toDate)) {
      const cash = advance.cashAmount
      const bank = advance.bankAmount
      const payBits: string[] = []
      if (cash > 0) payBits.push(`Cash ${formatMoney(cash)}`)
      if (bank > 0) payBits.push(`Bank ${formatMoney(bank)}`)
      const remainLabel =
        advance.remaining > 0.01
          ? `Remaining ${formatMoney(advance.remaining)}`
          : 'Fully applied to bill'
      const appliedLabel =
        advance.applied > 0.01 ? `Applied ${formatMoney(advance.applied)}` : 'Not applied yet'
      rows.push({
        id: `advance-sale-${advance.id}`,
        groupId: `advance-sale-${advance.id}`,
        date: advance.at,
        dateLabel: formatDate(advance.at),
        createdDate: advance.at,
        createdDateLabel: formatDate(advance.at),
        billAmount: advance.amount,
        collectedTotal: advance.amount,
        creditPending: 0,
        chequePending: 0,
        cashTotal: cash,
        bankTotal: bank,
        chequeTotal: 0,
        customerName: advance.customerName,
        payLabel: 'Advance',
        detailLabel: [
          payBits.join(' · ') || 'Advance',
          appliedLabel,
          remainLabel,
          advance.note,
        ]
          .filter(Boolean)
          .join(' · '),
        hasCreditOrCheque: false,
        hasCredit: false,
        hasCheque: false,
        isAdvanceRow: true,
        advanceRemaining: advance.remaining,
        advanceApplied: advance.applied,
      })
    }
  }

  return sortSalesBillRows(rows, sort)
}

export function summarizeSalesBillRows(
  rows: SalesBillRow[],
  filter?: SalesReportFilter,
): SalesBillSummary {
  const seenGroups = new Set<string>()
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalBills += row.collectedTotal
      acc.cashTotal += row.cashTotal
      acc.bankTotal += row.bankTotal + row.chequeTotal
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
      withCreditCollected: 0,
      oldCreditChequeCollected: 0,
      cashTotal: 0,
      bankTotal: 0,
      chequeTotal: 0,
      creditPending: 0,
      chequePending: 0,
    },
  )

  const hasDateFilter = Boolean(filter?.fromDate || filter?.toDate)
  const mode = filter?.dateMode ?? 'collected'

  if (hasDateFilter && mode === 'collected' && !filter?.sameDayCreatedAndPaid) {
    // With credit/cheque sales for a day =
    //   Sales collected (that day's total) + Credit pending + Cheque pending.
    // Part payment / Approve to Bank does not move remaining balance onto today.
    // Old credit/cheque cleared today is already inside Sales collected.
    let openedInPeriod = 0
    let oldCleared = 0
    for (const row of rows) {
      openedInPeriod += row.creditPending + row.chequePending
      if (isOldCreditChequeClearedRow(row, filter)) {
        oldCleared += row.collectedTotal
      }
    }
    summary.withCreditCollected = summary.totalBills
    summary.oldCreditChequeCollected = oldCleared
    summary.withCreditSales = summary.totalBills + openedInPeriod
  } else {
    summary.withCreditCollected = summary.totalBills
    summary.oldCreditChequeCollected = 0
    summary.withCreditSales =
      summary.totalBills + summary.creditPending + summary.chequePending
  }
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
  return summarizeSalesBillRows(buildSalesBillList(data, 'date-desc', filter), filter)
}

export function getTodaySameDaySalesSummary(data: AppData): SalesBillSummary {
  const today = toInputDate()
  const filter: SalesReportFilter = {
    fromDate: today,
    toDate: today,
    dateMode: 'collected',
    sameDayCreatedAndPaid: true,
  }
  return summarizeSalesBillRows(buildSalesBillList(data, 'date-desc', filter), filter)
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

/** Collected cash / bank only — approved cheques shown in bank, not as separate cheque. */
export function formatCollectedSalesBreakdown(cash: number, bank: number): string {
  return [`💵 ${formatMoney(cash)}`, `🏦 ${formatMoney(bank)}`].join(' · ')
}
