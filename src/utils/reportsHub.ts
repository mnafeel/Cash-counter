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
  toInputDate,
  type ReportPeriod,
  type SalesReportFilter,
} from './salesReport'
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
    creditPending: pendingCredit.reduce((sum, item) => sum + item.amount, 0),
    creditCount: pendingCredit.length,
    chequePending: pendingCheque.reduce((sum, item) => sum + item.amount, 0),
    chequeCount: pendingCheque.length,
  }
}

export function buildCreditReportItems(data: AppData): CreditReportItem[] {
  const items: CreditReportItem[] = []

  for (const sale of data.sales) {
    if (!isSaleCredit(sale)) continue
    const amount = saleCreditAmount(sale)
    if (amount <= 0) continue
    items.push({
      id: sale.id,
      kind: 'sale',
      name: sale.customerName?.trim() || 'Credit sale',
      amount,
      status: sale.status === 'pending' ? 'pending' : 'paid',
      date: sale.updatedAt ?? sale.createdAt,
      payDetail:
        sale.status === 'pending'
          ? `💳 Credit pending · ${formatMoney(amount)}`
          : `💳 Credit · ${formatMoney(amount)}`,
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
): CreditReportItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate))
}

export function filterChequeReportItems(
  items: ChequeReportItem[],
  dateFilter: ReportDatePreset,
  selectedDate: string,
): ChequeReportItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate))
}

export function summarizeCreditItems(items: CreditReportItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.total += item.amount
      acc.count += 1
      if (item.status === 'pending') {
        acc.pendingTotal += item.amount
        acc.pendingCount += 1
      }
      return acc
    },
    { total: 0, count: 0, pendingTotal: 0, pendingCount: 0 },
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
) {
  const filter = presetToSalesFilter(preset, selectedDate)
  return buildSalesBillList(data, 'date-desc', filter)
}

export function presetToSalesFilter(
  preset: ReportDatePreset,
  selectedDate: string,
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
  return undefined
}

export function formatReportPresetLabel(preset: ReportDatePreset, selectedDate: string): string {
  if (preset === 'today') return 'Today'
  if (preset === 'yesterday') return 'Yesterday'
  if (preset === 'week') return 'This Week'
  if (preset === 'month') return 'This Month'
  if (preset === 'date' && selectedDate) return formatDate(selectedDate)
  return 'All Time'
}

export { summarizeSales, summarizePurchases, summarizeNormalExpenses, saleTotalCollected }
