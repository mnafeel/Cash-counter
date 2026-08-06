import { NO1_BILL_LABEL, NO1_EXPENSE_LABEL } from './expenseBillLabels'
import { formatDate, formatTime } from './format'
import type { AppData, Expense } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { purchasePaidComponents } from './purchaseHistory'
import type { NormalExpenseHistoryItem } from './normalExpenseHistory'
import type { PurchaseHistoryItem } from './purchaseHistory'
import type { LoanOutflowItem } from './loanLedger'

export type ExpenseTimelineSort = 'time-desc' | 'time-asc'

export type ExpenseTimelineKind = 'expense' | 'purchase' | 'no1-purchase' | 'loan'

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
  cashAmount?: number
  bankAmount?: number
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
  if (kind === 'loan') return 'Loan'
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
        acc.expenseCash += entry.cashAmount ?? 0
        acc.expenseBank += entry.bankAmount ?? 0
      } else if (entry.kind === 'loan') {
        acc.loanTotal += entry.amount
        acc.loanCount += 1
        acc.loanCash += entry.cashAmount ?? 0
        acc.loanBank += entry.bankAmount ?? 0
      } else if (entry.kind === 'no1-purchase') {
        acc.no1Total += entry.no1Amount ?? entry.amount
        acc.no1Count += 1
        acc.purchaseTotal += entry.amount
        acc.purchaseCount += 1
        acc.purchaseCash += entry.cashAmount ?? 0
        acc.purchaseBank += entry.bankAmount ?? 0
      } else {
        acc.purchaseTotal += entry.amount
        acc.purchaseCount += 1
        acc.purchaseCash += entry.cashAmount ?? 0
        acc.purchaseBank += entry.bankAmount ?? 0
      }
      return acc
    },
    {
      count: 0,
      expenseTotal: 0,
      expenseCount: 0,
      expenseCash: 0,
      expenseBank: 0,
      purchaseTotal: 0,
      purchaseCount: 0,
      purchaseCash: 0,
      purchaseBank: 0,
      loanTotal: 0,
      loanCount: 0,
      loanCash: 0,
      loanBank: 0,
      no1Total: 0,
      no1Count: 0,
    },
  )
}

function normalExpenseCashBank(expense: Expense): { cash: number; bank: number } {
  if (expense.payType === 'bank') return { cash: 0, bank: expense.amount }
  if (expense.payType === 'split') {
    return { cash: expense.cashAmount ?? 0, bank: expense.bankAmount ?? 0 }
  }
  if (expense.payType === 'credit' || expense.payType === 'cheque') return { cash: 0, bank: 0 }
  return { cash: expense.amount, bank: 0 }
}

function purchaseItemCashBank(data: AppData, item: PurchaseHistoryItem): { cash: number; bank: number } {
  const expense = data.expenses.find((entry) => entry.id === item.id)
  if (!expense) return { cash: 0, bank: 0 }
  const paid = purchasePaidComponents(expense)
  return { cash: paid.cash, bank: paid.bank + paid.cheque }
}

export function buildExpenseTimelineEntriesFromData(
  data: AppData,
  normalItems: NormalExpenseHistoryItem[],
  purchaseItems: PurchaseHistoryItem[],
  sort: ExpenseTimelineSort = 'time-desc',
  loanItems: LoanOutflowItem[] = [],
): ExpenseTimelineEntry[] {
  const expenseById = new Map(
    data.expenses
      .filter((expense) => (!expense.kind || expense.kind === 'expense') && !isPurchaseExpense(expense))
      .map((expense) => [expense.id, expense]),
  )

  const entries: ExpenseTimelineEntry[] = [
    ...normalItems.map((item) => {
      const expense = expenseById.get(item.id)
      const parts = expense ? normalExpenseCashBank(expense) : { cash: item.amount, bank: 0 }
      return {
        kind: 'expense' as const,
        id: item.id,
        date: item.date,
        sortTime: new Date(item.date).getTime(),
        title: item.name,
        detail: item.payLabel,
        amount: item.amount,
        payLabel: item.payLabel,
        payDetail: item.payDetail,
        cashAmount: parts.cash,
        bankAmount: parts.bank,
      }
    }),
    ...purchaseItems.map((item) => {
      const kind = purchaseTimelineKind(item)
      const parts = purchaseItemCashBank(data, item)
      return {
        kind,
        id: item.id,
        date: item.date,
        sortTime: new Date(item.date).getTime(),
        title: item.shopName,
        detail: item.description?.trim() || item.billLabel,
        amount: kind === 'no1-purchase' ? item.no1Amount : item.paidAmount > 0 ? item.paidAmount : item.amount,
        payLabel: item.payLabel,
        payDetail: item.payDetail,
        no1Amount: item.no1Amount,
        billLabel: item.billLabel,
        cashAmount: parts.cash,
        bankAmount: parts.bank,
      }
    }),
    ...loanItems.map((item) => ({
      kind: 'loan' as const,
      id: item.id,
      date: item.date,
      sortTime: new Date(item.date).getTime(),
      title: item.name,
      detail: item.kind === 'given' ? 'Loan given' : 'Loan returned',
      amount: item.amount,
      payLabel: item.payLabel,
      payDetail: item.kind === 'given' ? `Loan given · ${item.payLabel}` : `Loan returned · ${item.payLabel}`,
      cashAmount: item.cashAmount,
      bankAmount: item.bankAmount,
    })),
  ]

  entries.sort((a, b) =>
    sort === 'time-desc'
      ? b.sortTime - a.sortTime || b.amount - a.amount
      : a.sortTime - b.sortTime || a.amount - b.amount,
  )
  return entries
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
    ['Loan total', summary.loanTotal],
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
