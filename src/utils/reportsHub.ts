import type { AppData, Expense, Sale } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { formatDate, formatMoney } from './format'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
  summarizeNormalExpenses,
} from './normalExpenseHistory'
import {
  buildPurchaseHistoryItems,
  filterPurchaseHistoryItems,
  summarizePurchases,
} from './purchaseHistory'
import {
  buildSalesBillList,
  buildSalesReport,
  getTodaySalesSummary,
  saleTotalCollected,
  summarizeSales,
  summarizeSalesBillRows,
  toInputDate,
  type ReportPeriod,
  type ReportSort,
  type SalesReportFilter,
} from './salesReport'
import { saleCollectedAmount } from './salePayment'
import { UNNAMED_CREDIT_CUSTOMER } from './customerLedger'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'

export type ReportTab = 'all' | 'sales' | 'purchase' | 'expense' | 'credit' | 'cheque'
export type ReportDatePreset = CashDateFilter

export interface ReportOverview {
  todaySales: number
  monthSales: number
  todayPurchases: number
  monthPurchases: number
  todayExpenses: number
  monthExpenses: number
  creditPending: number
  creditCount: number
  chequePending: number
  chequeCount: number
}

export interface CreditReportItem {
  id: string
  kind: 'sale' | 'purchase'
  name: string
  /** Full bill / credit total. */
  totalBill: number
  /** Amount already collected toward credit. */
  paidAmount: number
  /** Open credit balance still unpaid. */
  pendingAmount: number
  /** Same as totalBill — kept for list display. */
  amount: number
  status: 'pending' | 'paid'
  date: string
  payDetail: string
}

export interface ChequeReportItem {
  id: string
  kind: 'sale' | 'purchase' | 'expense'
  name: string
  amount: number
  approved: boolean
  date: string
  payDetail: string
}

function monthStartInputDate(): string {
  const start = new Date()
  start.setDate(1)
  return toInputDate(start)
}

function monthFilter(): SalesReportFilter {
  return { fromDate: monthStartInputDate(), toDate: toInputDate() }
}

function isSaleCredit(sale: Sale): boolean {
  if (sale.status === 'pending') {
    return sale.payType === 'credit' || sale.pendingPayType === 'credit'
  }
  if (sale.payType === 'credit') return true
  return (sale.creditAmount ?? 0) > 0
}

function saleCreditAmount(sale: Sale): number {
  if (sale.status === 'pending') return sale.billAmount
  if (sale.payType === 'credit') return sale.billAmount
  return sale.creditAmount ?? 0
}

function saleCreditTotalBill(sale: Sale): number {
  const collected = saleCollectedAmount(sale)
  if (sale.originalBillAmount && sale.originalBillAmount > 0) return sale.originalBillAmount
  if (sale.status === 'pending' && isSaleCredit(sale)) return sale.billAmount + collected
  return sale.billAmount
}

function isExpenseCredit(expense: Expense): boolean {
  if (expense.kind && expense.kind !== 'expense') return false
  if (expense.payType === 'credit') return true
  return expense.payType === 'split' && (expense.creditAmount ?? 0) > 0
}

function expenseCreditAmount(expense: Expense): number {
  if (expense.payType === 'credit') return expense.amount
  return expense.creditAmount ?? 0
}

function expenseChequeAmount(expense: Expense): number {
  if (expense.payType === 'cheque') return expense.chequeAmount ?? expense.amount
  if (expense.payType === 'split') return expense.chequeAmount ?? 0
  return 0
}

function isSaleCheque(sale: Sale): boolean {
  if (sale.status === 'pending') {
    return sale.payType === 'cheque' || sale.pendingPayType === 'cheque'
  }
  if (sale.payType === 'cheque') return true
  return (sale.chequeAmount ?? 0) > 0
}

function saleChequeAmount(sale: Sale): number {
  if (sale.status === 'pending') return sale.billAmount
  if (sale.payType === 'cheque') return sale.billAmount
  return sale.chequeAmount ?? 0
}

export function buildReportOverview(data: AppData): ReportOverview {
  const todaySales = getTodaySalesSummary(data).totalBills
  const monthSalesRows = buildSalesReport(data, 'month', 'date-desc', monthFilter())
  const monthSales = summarizeSales(monthSalesRows).totalBills

  const purchases = buildPurchaseHistoryItems(data)
  const todayPurchases = summarizePurchases(
    filterPurchaseHistoryItems(purchases, 'today', ''),
  ).total
  const monthPurchases = summarizePurchases(
    filterPurchaseHistoryItems(purchases, 'month', ''),
  ).total

  const expenses = buildNormalExpenseHistoryItems(data)
  const todayExpenses = summarizeNormalExpenses(
    filterNormalExpenseHistoryItems(expenses, 'today', ''),
  ).total
  const monthExpenses = summarizeNormalExpenses(
    filterNormalExpenseHistoryItems(expenses, 'month', ''),
  ).total

  const creditItems = buildCreditReportItems(data)
  const pendingCredit = creditItems.filter((item) => item.status === 'pending')
  const chequeItems = buildChequeReportItems(data)
  const pendingCheque = chequeItems.filter((item) => !item.approved)

  return {
    todaySales,
    monthSales,
    todayPurchases,
    monthPurchases,
    todayExpenses,
    monthExpenses,
    creditPending: pendingCredit.reduce((sum, item) => sum + item.pendingAmount, 0),
    creditCount: pendingCredit.length,
    chequePending: pendingCheque.reduce((sum, item) => sum + item.amount, 0),
    chequeCount: pendingCheque.length,
  }
}

export function buildCreditReportItems(data: AppData): CreditReportItem[] {
  const items: CreditReportItem[] = []

  for (const sale of data.sales) {
    if (!isSaleCredit(sale)) continue
    const pending = saleCreditAmount(sale)
    const collected = saleCollectedAmount(sale)
    const totalBill = saleCreditTotalBill(sale)
    if (pending <= 0 && collected <= 0) continue
    items.push({
      id: sale.id,
      kind: 'sale',
      name: sale.customerName?.trim() || UNNAMED_CREDIT_CUSTOMER,
      totalBill,
      paidAmount: collected,
      pendingAmount: pending,
      amount: totalBill,
      status: sale.status === 'pending' ? 'pending' : 'paid',
      date: sale.updatedAt ?? sale.createdAt,
      payDetail:
        sale.status === 'pending'
          ? collected > 0
            ? `Bill ${formatMoney(totalBill)} · Paid ${formatMoney(collected)} · Balance ${formatMoney(pending)}`
            : `Bill ${formatMoney(totalBill)} · Credit ${formatMoney(pending)}`
          : `Bill ${formatMoney(totalBill)} · Paid ${formatMoney(collected || totalBill)}`,
    })
  }

  for (const expense of data.expenses) {
    if (!isExpenseCredit(expense)) continue
    const amount = expenseCreditAmount(expense)
    if (amount <= 0) continue
    items.push({
      id: expense.id,
      kind: 'purchase',
      name: expense.name,
      totalBill: amount,
      paidAmount: 0,
      pendingAmount: amount,
      amount,
      status: 'pending',
      date: expense.createdAt,
      payDetail: `💳 Purchase credit · ${formatMoney(amount)}`,
    })
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function buildChequeReportItems(data: AppData): ChequeReportItem[] {
  const items: ChequeReportItem[] = []

  for (const sale of data.sales) {
    if (!isSaleCheque(sale)) continue
    const amount = saleChequeAmount(sale)
    if (amount <= 0) continue
    items.push({
      id: sale.id,
      kind: 'sale',
      name: sale.customerName?.trim() || 'Cheque sale',
      amount,
      approved: sale.status !== 'pending',
      date: sale.updatedAt ?? sale.createdAt,
      payDetail:
        sale.status === 'pending'
          ? `🧾 Cheque pending · ${formatMoney(amount)}`
          : `🧾 Cheque · ${formatMoney(amount)}`,
    })
  }

  for (const expense of data.expenses) {
    if (expense.kind && expense.kind !== 'expense') continue
    const amount = expenseChequeAmount(expense)
    if (amount <= 0) continue
    items.push({
      id: expense.id,
      kind: isPurchaseExpense(expense) ? 'purchase' : 'expense',
      name: expense.name,
      amount,
      approved: !!expense.chequeApproved,
      date: expense.createdAt,
      payDetail: expense.chequeApproved
        ? `🧾 Cheque ✓ · ${formatMoney(amount)}`
        : `🧾 Cheque pending · ${formatMoney(amount)}`,
    })
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function filterCreditReportItems(
  items: CreditReportItem[],
  dateFilter: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): CreditReportItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo))
}

export function filterChequeReportItems(
  items: ChequeReportItem[],
  dateFilter: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): ChequeReportItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo))
}

export function summarizeCreditItems(items: CreditReportItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.total += item.totalBill
      acc.paidTotal += item.paidAmount
      acc.count += 1
      if (item.status === 'pending') {
        acc.pendingTotal += item.pendingAmount
        acc.pendingCount += 1
      }
      return acc
    },
    { total: 0, paidTotal: 0, count: 0, pendingTotal: 0, pendingCount: 0 },
  )
}

export function summarizeChequeItems(items: ChequeReportItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.total += item.amount
      acc.count += 1
      if (!item.approved) {
        acc.pendingTotal += item.amount
        acc.pendingCount += 1
      }
      return acc
    },
    { total: 0, count: 0, pendingTotal: 0, pendingCount: 0 },
  )
}

export function salesRowsForPreset(
  data: AppData,
  preset: ReportDatePreset,
  selectedDate: string,
  period: ReportPeriod = 'day',
) {
  const filter = presetToSalesFilter(preset, selectedDate)
  return buildSalesReport(data, period, 'date-desc', filter)
}

export function salesBillsForPreset(
  data: AppData,
  preset: ReportDatePreset,
  selectedDate: string,
  sort: ReportSort = 'date-desc',
  rangeTo?: string,
) {
  const filter = presetToSalesFilter(preset, selectedDate, rangeTo)
  return buildSalesBillList(data, sort, filter)
}

export function salesSummaryForPreset(
  data: AppData,
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
) {
  return summarizeSalesBillRows(salesBillsForPreset(data, preset, selectedDate, 'date-desc', rangeTo))
}

export function presetToSalesFilter(
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): SalesReportFilter | undefined {
  const today = toInputDate()
  if (preset === 'today') return { fromDate: today, toDate: today }
  if (preset === 'yesterday') {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const d = toInputDate(y)
    return { fromDate: d, toDate: d }
  }
  if (preset === 'week') {
    const start = new Date()
    start.setDate(start.getDate() - 6)
    return { fromDate: toInputDate(start), toDate: today }
  }
  if (preset === 'month') return monthFilter()
  if (preset === 'date' && selectedDate) return { fromDate: selectedDate, toDate: selectedDate }
  if (preset === 'range' && selectedDate && rangeTo) {
    const from = selectedDate <= rangeTo ? selectedDate : rangeTo
    const to = selectedDate <= rangeTo ? rangeTo : selectedDate
    return { fromDate: from, toDate: to }
  }
  return undefined
}

export function formatReportPresetLabel(
  preset: ReportDatePreset,
  selectedDate: string,
  rangeTo?: string,
): string {
  if (preset === 'today') return 'Today'
  if (preset === 'yesterday') return 'Yesterday'
  if (preset === 'week') return 'This Week'
  if (preset === 'month') return 'This Month'
  if (preset === 'date' && selectedDate) return formatDate(selectedDate)
  if (preset === 'range' && selectedDate && rangeTo) {
    const from = selectedDate <= rangeTo ? selectedDate : rangeTo
    const to = selectedDate <= rangeTo ? rangeTo : selectedDate
    if (from === to) return formatDate(from)
    return `${formatDate(from)} – ${formatDate(to)}`
  }
  return 'All Time'
}

export { summarizeSales, summarizeSalesBillRows, summarizePurchases, summarizeNormalExpenses, saleTotalCollected }
export type { ReportSort }
