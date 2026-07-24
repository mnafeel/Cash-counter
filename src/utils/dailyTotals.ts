import type { AppData, Sale } from '../types'
import {
  buildSalesBillList,
  summarizeSalesBillRows,
  toInputDate,
  type SalesReportFilter,
} from './salesReport'
import { buildCreditOverview } from './customerLedger'
import { buildChequeOverview } from './chequeLedger'
import {
  buildNormalExpenseHistoryItems,
  summarizeNormalExpenses,
} from './normalExpenseHistory'
import { presetToSalesFilter, type ReportDatePreset } from './reportsHub'
import {
  buildPurchaseHistoryItems,
  summarizePurchases,
} from './purchaseHistory'
import { saleCollectedAmount } from './salePayment'

export interface DailyTotalsSummary {
  fromDate: string
  toDate: string
  /** Cash + bank + cheque collected in period. */
  salesCollected: number
  salesBillTotal: number
  salesBillCount: number
  cashCollected: number
  bankCollected: number
  chequeCollected: number
  /** New credit pending bills created in period. */
  creditAddedInPeriod: number
  /** New cheque pending bills created in period. */
  chequeAddedInPeriod: number
  creditChequeAddedCombined: number
  /** All-time open balances (current snapshot). */
  creditPendingTotal: number
  chequePendingTotal: number
  purchaseTotal: number
  purchaseCount: number
  expenseTotal: number
  expenseCount: number
  moneyAddedTotal: number
  moneyAddedCount: number
  /** sales collected + money added − expenses − purchases */
  netInflow: number
}

function localDayTimestamp(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function inputDateTimestamp(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function isInDateRange(iso: string, fromDate: string, toDate: string): boolean {
  const day = localDayTimestamp(iso)
  if (fromDate && day < inputDateTimestamp(fromDate)) return false
  if (toDate && day > inputDateTimestamp(toDate)) return false
  return true
}

function filterItemsByDateRange<T extends { date: string }>(
  items: T[],
  fromDate: string,
  toDate: string,
): T[] {
  return items.filter((item) => isInDateRange(item.date, fromDate, toDate))
}

function pendingCreditAddedOnCreate(sale: Sale, fromDate: string, toDate: string): number {
  if (!isInDateRange(sale.createdAt, fromDate, toDate)) return 0
  if (sale.status !== 'pending') return 0
  if (sale.payType !== 'credit' && sale.pendingPayType !== 'credit') return 0
  return sale.originalBillAmount ?? sale.billAmount + saleCollectedAmount(sale)
}

function pendingChequeAddedOnCreate(sale: Sale, fromDate: string, toDate: string): number {
  if (!isInDateRange(sale.createdAt, fromDate, toDate)) return 0
  if (sale.status !== 'pending') return 0
  if (sale.payType !== 'cheque' && sale.pendingPayType !== 'cheque') return 0
  return sale.originalBillAmount ?? sale.billAmount + saleCollectedAmount(sale)
}

export function buildDailyTotals(
  data: AppData,
  fromDate: string = toInputDate(),
  toDate: string = fromDate,
): DailyTotalsSummary {
  const salesFilter: SalesReportFilter = {
    fromDate,
    toDate,
    dateMode: 'collected',
  }
  const salesRows = buildSalesBillList(data, 'date-desc', salesFilter)
  const salesTotals = summarizeSalesBillRows(salesRows)

  let cashCollected = 0
  let bankCollected = 0
  let chequeCollected = 0
  for (const row of salesRows) {
    cashCollected += row.cashTotal
    bankCollected += row.bankTotal
    chequeCollected += row.chequeTotal
  }

  let creditAddedInPeriod = 0
  let chequeAddedInPeriod = 0
  for (const sale of data.sales) {
    creditAddedInPeriod += pendingCreditAddedOnCreate(sale, fromDate, toDate)
    chequeAddedInPeriod += pendingChequeAddedOnCreate(sale, fromDate, toDate)
  }

  const purchaseItems = filterItemsByDateRange(
    buildPurchaseHistoryItems(data),
    fromDate,
    toDate,
  )
  const purchaseTotals = summarizePurchases(purchaseItems)

  const expenseItems = filterItemsByDateRange(
    buildNormalExpenseHistoryItems(data),
    fromDate,
    toDate,
  )
  const expenseTotals = summarizeNormalExpenses(expenseItems)

  const moneyAddedItems = data.expenses.filter(
    (e) =>
      e.kind === 'add' &&
      isInDateRange(e.createdAt, fromDate, toDate),
  )
  const moneyAddedTotal = moneyAddedItems.reduce((sum, e) => sum + e.amount, 0)

  const creditOverview = buildCreditOverview(data)
  const chequeOverview = buildChequeOverview(data)

  const netInflow =
    salesTotals.totalBills + moneyAddedTotal - expenseTotals.total - purchaseTotals.total

  return {
    fromDate,
    toDate,
    salesCollected: salesTotals.totalBills,
    salesBillTotal: salesTotals.billTotal,
    salesBillCount: salesTotals.billCount,
    cashCollected,
    bankCollected,
    chequeCollected,
    creditAddedInPeriod,
    chequeAddedInPeriod,
    creditChequeAddedCombined: creditAddedInPeriod + chequeAddedInPeriod,
    creditPendingTotal: creditOverview.totalPending,
    chequePendingTotal: chequeOverview.totalPending,
    purchaseTotal: purchaseTotals.total,
    purchaseCount: purchaseTotals.count,
    expenseTotal: expenseTotals.total,
    expenseCount: expenseTotals.count,
    moneyAddedTotal,
    moneyAddedCount: moneyAddedItems.length,
    netInflow,
  }
}

export function getTodayDailyTotals(data: AppData): DailyTotalsSummary {
  const today = toInputDate()
  return buildDailyTotals(data, today, today)
}

export function buildDailyTotalsForPreset(
  data: AppData,
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): DailyTotalsSummary {
  const filter = presetToSalesFilter(preset, selectedDate, rangeTo)
  if (!filter?.fromDate) {
    const today = toInputDate()
    return buildDailyTotals(data, '2000-01-01', today)
  }
  return buildDailyTotals(data, filter.fromDate, filter.toDate ?? filter.fromDate)
}
