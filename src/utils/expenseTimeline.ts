import { NO1_BILL_LABEL, NO1_EXPENSE_LABEL } from './expenseBillLabels'
import { formatDate, formatTime } from './format'
import type { NormalExpenseHistoryItem } from './normalExpenseHistory'
import type { PurchaseHistoryItem } from './purchaseHistory'

export type ExpenseTimelineSort = 'time-desc' | 'time-asc'

export type ExpenseTimelineKind = 'expense' | 'purchase' | 'no1-purchase'

export interface ExpenseTimelineEntry {
  kind: ExpenseTimelineKind
  id: string
  date: string
  sortTime: number
  title: string
  detail: string
  amount: number
  payLabel: string
  payDetail: string
  no1Amount?: number
  billLabel?: string
}

function purchaseTimelineKind(item: PurchaseHistoryItem): ExpenseTimelineKind {
  return item.no1Amount > 0 ? 'no1-purchase' : 'purchase'
}

function purchaseTypeLabel(kind: ExpenseTimelineKind): string {
  if (kind === 'no1-purchase') return NO1_EXPENSE_LABEL
  return 'Purchase'
}

export function expenseTimelineKindLabel(kind: ExpenseTimelineKind): string {
  if (kind === 'expense') return 'Expense'
  return purchaseTypeLabel(kind)
}

export function buildExpenseTimelineEntries(
  normalItems: NormalExpenseHistoryItem[],
  purchaseItems: PurchaseHistoryItem[],
  sort: ExpenseTimelineSort = 'time-desc',
): ExpenseTimelineEntry[] {
  const entries: ExpenseTimelineEntry[] = [
    ...normalItems.map((item) => ({
      kind: 'expense' as const,
      id: item.id,
      date: item.date,
      sortTime: new Date(item.date).getTime(),
      title: item.name,
      detail: item.payLabel,
      amount: item.amount,
      payLabel: item.payLabel,
      payDetail: item.payDetail,
    })),
    ...purchaseItems.map((item) => {
      const kind = purchaseTimelineKind(item)
      return {
        kind,
        id: item.id,
        date: item.date,
        sortTime: new Date(item.date).getTime(),
        title: item.shopName,
        detail: item.description?.trim() || item.billLabel,
        amount: kind === 'no1-purchase' ? item.no1Amount : item.amount,
        payLabel: item.payLabel,
        payDetail: item.payDetail,
        no1Amount: item.no1Amount,
        billLabel: item.billLabel,
      }
    }),
  ]

  entries.sort((a, b) =>
    sort === 'time-desc'
      ? b.sortTime - a.sortTime || b.amount - a.amount
      : a.sortTime - b.sortTime || a.amount - b.amount,
  )
  return entries
}

export function summarizeExpenseTimeline(entries: ExpenseTimelineEntry[]) {
  return entries.reduce(
    (acc, entry) => {
      acc.count += 1
      if (entry.kind === 'expense') {
        acc.expenseTotal += entry.amount
        acc.expenseCount += 1
      } else if (entry.kind === 'no1-purchase') {
        acc.no1Total += entry.no1Amount ?? entry.amount
        acc.no1Count += 1
        acc.purchaseTotal += entry.amount
        acc.purchaseCount += 1
      } else {
        acc.purchaseTotal += entry.amount
        acc.purchaseCount += 1
      }
      return acc
    },
    {
      count: 0,
      expenseTotal: 0,
      expenseCount: 0,
      purchaseTotal: 0,
      purchaseCount: 0,
      no1Total: 0,
      no1Count: 0,
    },
  )
}

export function buildExpenseTimelineRows(
  entries: ExpenseTimelineEntry[],
  periodLabel: string,
  exportedAt = new Date().toISOString(),
): unknown[][] {
  const summary = summarizeExpenseTimeline(entries)
  const rows: unknown[][] = [
    ['Shalimar Fashions · Cash Counter · Expense + No 1 Purchase Report'],
    ['Period', periodLabel],
    ['Exported', formatDate(exportedAt.slice(0, 10)), formatTime(exportedAt)],
    ['Expense total', summary.expenseTotal],
    [`${NO1_BILL_LABEL} total`, summary.no1Total],
    ['Purchase total', summary.purchaseTotal],
    ['Count', summary.count],
    [],
    ['No', 'Date', 'Time', 'Type', 'Name', 'Details', 'Amount', 'Payment', 'Pay detail'],
  ]

  for (const [index, entry] of entries.entries()) {
    rows.push([
      index + 1,
      formatDate(entry.date),
      formatTime(entry.date),
      expenseTimelineKindLabel(entry.kind),
      entry.title,
      entry.detail,
      entry.amount,
      entry.payLabel,
      entry.payDetail.replace(/\s+/g, ' ').trim(),
    ])
  }

  return rows
}
