import type { AppData, Sale } from '../types'
import {
  buildSalesBillList,
  summarizeSalesBillRows,
  toInputDate,
  type SalesReportFilter,
} from './salesReport'
import { saleHasCollectionInRange } from './salePayment'
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
import {
  buildLoanOutflowHistoryItems,
  summarizeLoanOutflows,
} from './loanLedger'
import { buildNotSaleInflowItems, summarizeNotSaleInflow } from './notSaleInflow'

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
  /** Loan given + loan returned (money out) in period. */
  loanOutflowTotal: number
  loanOutflowCount: number
  moneyAddedTotal: number
  moneyAddedCount: number
  moneyAddedCash: number
  moneyAddedBank: number
  /** Cash added to counter/bank — not sales. */
  notSaleCollectedTotal: number
  notSaleCollectedCash: number
  notSaleCollectedBank: number
  notSaleCollectedCount: number
  /** Sales collected + cash-in (not sale). */
  totalCollected: number
  /** sales collected + not sale − expenses − purchases − loan outflows */
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

/**
 * Open balance belongs to the day it was created, or the day it was edited.
 * A part payment in the period does not move the remaining balance to that day.
 */
function pendingBelongsToPeriod(sale: Sale, fromDate: string, toDate: string): boolean {
  if (isInDateRange(sale.createdAt, fromDate, toDate)) return true
  if (!isInDateRange(sale.updatedAt ?? sale.createdAt, fromDate, toDate)) return false
  return !saleHasCollectionInRange(sale, fromDate, toDate)
}

function pendingCreditAddedOnCreate(sale: Sale, fromDate: string, toDate: string): number {
  if (sale.status !== 'pending') return 0
  if (sale.payType !== 'credit' && sale.pendingPayType !== 'credit') return 0
  return pendingBelongsToPeriod(sale, fromDate, toDate) ? sale.billAmount : 0
}

function pendingChequeAddedOnCreate(sale: Sale, fromDate: string, toDate: string): number {
  if (sale.status !== 'pending') return 0
  if (sale.payType !== 'cheque' && sale.pendingPayType !== 'cheque') return 0
  return pendingBelongsToPeriod(sale, fromDate, toDate) ? sale.billAmount : 0
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
  const salesTotals = summarizeSalesBillRows(salesRows, salesFilter)

  let cashCollected = 0
  let bankCollected = 0
  for (const row of salesRows) {
    cashCollected += row.cashTotal
    bankCollected += row.bankTotal + row.chequeTotal
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

  const loanOutflowItems = filterItemsByDateRange(
    buildLoanOutflowHistoryItems(data),
    fromDate,
    toDate,
  )
  const loanOutflowTotals = summarizeLoanOutflows(loanOutflowItems)

  const notSaleItems = buildNotSaleInflowItems(data, 'range', fromDate, toDate)
  const notSaleTotals = summarizeNotSaleInflow(notSaleItems)

  const creditOverview = buildCreditOverview(data)
  const chequeOverview = buildChequeOverview(data)

  const netInflow =
    salesTotals.totalBills +
    notSaleTotals.total -
    expenseTotals.total -
    purchaseTotals.total -
    loanOutflowTotals.cashOutflowTotal

  const totalCollected = salesTotals.totalBills + notSaleTotals.total

  return {
    fromDate,
    toDate,
    salesCollected: salesTotals.totalBills,
    salesBillTotal: salesTotals.billTotal,
    salesBillCount: salesTotals.billCount,
    cashCollected,
    bankCollected,
    chequeCollected: 0,
    creditAddedInPeriod,
    chequeAddedInPeriod,
    creditChequeAddedCombined: creditAddedInPeriod + chequeAddedInPeriod,
    creditPendingTotal: creditOverview.totalPending,
    chequePendingTotal: chequeOverview.totalPending,
    purchaseTotal: purchaseTotals.total,
    purchaseCount: purchaseTotals.count,
    expenseTotal: expenseTotals.total,
    expenseCount: expenseTotals.count,
    loanOutflowTotal: loanOutflowTotals.cashOutflowTotal,
    loanOutflowCount: loanOutflowTotals.count,
    moneyAddedTotal: notSaleTotals.total,
    moneyAddedCount: notSaleTotals.count,
    moneyAddedCash: notSaleTotals.cashTotal,
    moneyAddedBank: notSaleTotals.bankTotal,
    notSaleCollectedTotal: notSaleTotals.total,
    notSaleCollectedCash: notSaleTotals.cashTotal,
    notSaleCollectedBank: notSaleTotals.bankTotal,
    notSaleCollectedCount: notSaleTotals.count,
    totalCollected,
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
