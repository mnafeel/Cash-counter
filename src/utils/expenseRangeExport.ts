import type { AppData } from '../types'
import { NO1_BILL_LABEL, NO1_EXPENSE_LABEL, NO2_BILL_LABEL } from './expenseBillLabels'
import { formatDate } from './format'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
  summarizeNormalExpenses,
  type NormalExpenseHistoryItem,
} from './normalExpenseHistory'
import {
  buildPurchaseHistoryItems,
  filterPurchaseHistoryItems,
  summarizePurchases,
  type PurchaseHistoryItem,
} from './purchaseHistory'
import { downloadExcelWorkbook, downloadExcelWorkbookSheets } from './spreadsheetExport'
import {
  buildExpenseTimelineEntries,
  buildExpenseTimelineRows,
  type ExpenseTimelineSort,
} from './expenseTimeline'

export interface ExpenseRangeInput {
  data: AppData
  fromDate: string
  toDate: string
  exportedAt?: string
}

function formatReportTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso))
}

function normalizeRange(fromDate: string, toDate: string): { from: string; to: string } {
  if (!fromDate || !toDate) return { from: fromDate || toDate, to: toDate || fromDate }
  return fromDate <= toDate ? { from: fromDate, to: toDate } : { from: toDate, to: fromDate }
}

function formatRangeLabel(fromDate: string, toDate: string): string {
  const { from, to } = normalizeRange(fromDate, toDate)
  if (!from) return 'All dates'
  if (from === to) return formatDate(from)
  return `${formatDate(from)} – ${formatDate(to)}`
}

function rangeFilenamePrefix(fromDate: string, toDate: string): string {
  const { from, to } = normalizeRange(fromDate, toDate)
  if (!from) return 'all-dates'
  if (from === to) return from
  return `${from}_to_${to}`
}

function normalExpenseItems(input: ExpenseRangeInput) {
  const { from, to } = normalizeRange(input.fromDate, input.toDate)
  return filterNormalExpenseHistoryItems(buildNormalExpenseHistoryItems(input.data), 'range', from, to).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
}

function purchaseExpenseItems(input: ExpenseRangeInput) {
  const { from, to } = normalizeRange(input.fromDate, input.toDate)
  return filterPurchaseHistoryItems(buildPurchaseHistoryItems(input.data), 'range', from, to).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
}

export function filterNo1PurchaseItems(items: PurchaseHistoryItem[]): PurchaseHistoryItem[] {
  return items.filter((item) => item.no1Amount > 0)
}

function summarizeNo1Purchases(items: PurchaseHistoryItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.total += item.no1Amount
      acc.paidTotal += item.paidNo1Amount
      acc.count += 1
      return acc
    },
    { total: 0, paidTotal: 0, count: 0 },
  )
}

export function buildNormalExpenseItemsRows(
  items: NormalExpenseHistoryItem[],
  periodLabel: string,
  exportedAt = new Date().toISOString(),
): unknown[][] {
  const summary = summarizeNormalExpenses(items)
  const rows: unknown[][] = [
    ['Shalimar Fashions · Cash Counter · Expense Report'],
    ['Period', periodLabel],
    ['Exported', formatDate(exportedAt.slice(0, 10)), formatReportTime(exportedAt)],
    ['Total', summary.total],
    ['Count', summary.count],
    [],
    ['No', 'Date', 'Time', 'Expense for', 'Payment', 'Amount', 'Details'],
  ]

  for (const [index, item] of items.entries()) {
    rows.push([
      index + 1,
      formatDate(item.date),
      formatReportTime(item.date),
      item.name,
      item.payLabel,
      item.amount,
      item.payDetail.replace(/\s+/g, ' ').trim(),
    ])
  }

  return rows
}

export function buildNo1PurchaseExpenseItemsRows(
  items: PurchaseHistoryItem[],
  periodLabel: string,
  exportedAt = new Date().toISOString(),
): unknown[][] {
  const no1Items = filterNo1PurchaseItems(items)
  const summary = summarizeNo1Purchases(no1Items)
  const rows: unknown[][] = [
    [`Shalimar Fashions · Cash Counter · ${NO1_EXPENSE_LABEL} Report`],
    ['Period', periodLabel],
    ['Exported', formatDate(exportedAt.slice(0, 10)), formatReportTime(exportedAt)],
    [`${NO1_BILL_LABEL} total`, summary.total],
    [`${NO1_BILL_LABEL} paid`, summary.paidTotal],
    ['Count', summary.count],
    [],
    ['No', 'Date', 'Time', 'Supplier', 'Bill No', 'Item / description', NO1_BILL_LABEL, 'Paid', 'Payment', 'Details'],
  ]

  for (const [index, item] of no1Items.entries()) {
    rows.push([
      index + 1,
      formatDate(item.date),
      formatReportTime(item.date),
      item.shopName,
      item.billNo ?? '',
      item.description ?? '',
      item.no1Amount,
      item.paidNo1Amount,
      item.payLabel,
      item.payDetail.replace(/\s+/g, ' ').trim(),
    ])
  }

  return rows
}

export function buildPurchaseExpenseItemsRows(
  items: PurchaseHistoryItem[],
  periodLabel: string,
  exportedAt = new Date().toISOString(),
): unknown[][] {
  const summary = summarizePurchases(items)
  const rows: unknown[][] = [
    ['Shalimar Fashions · Cash Counter · Purchase Expense Report'],
    ['Period', periodLabel],
    ['Exported', formatDate(exportedAt.slice(0, 10)), formatReportTime(exportedAt)],
    ['Total', summary.total],
    [NO1_BILL_LABEL, summary.gstTotal],
    [NO2_BILL_LABEL, summary.noGstTotal],
    ['Count', summary.count],
    [],
    [
      'No',
      'Date',
      'Time',
      'Supplier',
      'Bill No',
      'Item / description',
      'Bill type',
      NO1_BILL_LABEL,
      NO2_BILL_LABEL,
      'Total',
      'Paid',
      'Payment',
      'Details',
    ],
  ]

  for (const [index, item] of items.entries()) {
    rows.push([
      index + 1,
      formatDate(item.date),
      formatReportTime(item.date),
      item.shopName,
      item.billNo ?? '',
      item.description ?? '',
      item.billLabel,
      item.no1Amount,
      item.no2Amount,
      item.amount,
      item.paidAmount,
      item.payLabel,
      item.payDetail.replace(/\s+/g, ' ').trim(),
    ])
  }

  return rows
}

export function downloadExpenseAndNo1PurchaseSpreadsheet(
  normalItems: NormalExpenseHistoryItem[],
  purchaseItems: PurchaseHistoryItem[],
  periodLabel: string,
  filenamePrefix = 'cash-counter-expenses',
  timelineSort: ExpenseTimelineSort = 'time-asc',
): void {
  const no1Items = filterNo1PurchaseItems(purchaseItems)
  const timeline = buildExpenseTimelineEntries(normalItems, no1Items, timelineSort)
  downloadExcelWorkbookSheets(
    [
      { name: 'Expenses', rows: buildExpenseTimelineRows(timeline, periodLabel) },
      { name: 'Normal expenses', rows: buildNormalExpenseItemsRows(normalItems, periodLabel) },
      { name: 'No 1 Purchase', rows: buildNo1PurchaseExpenseItemsRows(purchaseItems, periodLabel) },
    ],
    `${filenamePrefix}.xlsx`,
  )
}

export function downloadNormalExpenseItemsSpreadsheet(
  items: NormalExpenseHistoryItem[],
  periodLabel: string,
  filenamePrefix = 'cash-counter-expenses',
): void {
  downloadExcelWorkbook(
    buildNormalExpenseItemsRows(items, periodLabel),
    `${filenamePrefix}.xlsx`,
    'Expenses',
  )
}

export function downloadPurchaseExpenseItemsSpreadsheet(
  items: PurchaseHistoryItem[],
  periodLabel: string,
  filenamePrefix = 'cash-counter-purchases',
): void {
  downloadExcelWorkbook(
    buildPurchaseExpenseItemsRows(items, periodLabel),
    `${filenamePrefix}.xlsx`,
    'Purchases',
  )
}

export function downloadNormalExpenseSpreadsheet(input: ExpenseRangeInput): void {
  const items = normalExpenseItems(input)
  downloadNormalExpenseItemsSpreadsheet(
    items,
    formatRangeLabel(input.fromDate, input.toDate),
    `cash-counter-expenses-${rangeFilenamePrefix(input.fromDate, input.toDate)}`,
  )
}

export function downloadPurchaseExpenseSpreadsheet(input: ExpenseRangeInput): void {
  const items = purchaseExpenseItems(input)
  downloadPurchaseExpenseItemsSpreadsheet(
    items,
    formatRangeLabel(input.fromDate, input.toDate),
    `cash-counter-purchases-${rangeFilenamePrefix(input.fromDate, input.toDate)}`,
  )
}

export function getNormalExpenseRangeCount(input: ExpenseRangeInput): number {
  return normalExpenseItems(input).length
}

export function getPurchaseExpenseRangeCount(input: ExpenseRangeInput): number {
  return purchaseExpenseItems(input).length
}
