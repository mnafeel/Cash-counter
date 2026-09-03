import {
  isGstExpense,
  NO1_BILL_LABEL,
  NO1_EXPENSE_LABEL,
  purchaseBillLabel,
  stripExpenseBillSuffix,
} from './expenseBillLabels'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import { formatDate, formatMoney, formatTime } from './format'
import type { AppData } from '../types'
import {
  buildPurchaseOutflowSources,
  type PurchaseHistoryItem,
} from './purchaseHistory'
import {
  formatLoanGivenSettlementDetail,
  type LoanOutflowHistoryItem,
} from './loanLedger'
import type { NormalExpenseHistoryItem } from './normalExpenseHistory'

export type ExpenseTimelineSort = 'time-desc' | 'time-asc'

export type ExpenseTimelineKind = 'expense' | 'purchase' | 'no1-purchase' | 'loan' | 'transfer'

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
  loanOutflowKind?: 'given' | 'borrow-repaid'
  loanOriginalAmount?: number
  loanSettledAmount?: number
  loanUnsettledAmount?: number
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
  if (kind === 'transfer') return 'Transfer'
  return purchaseTypeLabel(kind)
}

function sortExpenseTimelineEntries(
  entries: ExpenseTimelineEntry[],
  sort: ExpenseTimelineSort,
): ExpenseTimelineEntry[] {
  entries.sort((a, b) =>
    sort === 'time-desc'
      ? b.sortTime - a.sortTime || b.amount - a.amount
      : a.sortTime - b.sortTime || a.amount - b.amount,
  )
  return entries
}

/** Loan given / loan repayment — money left cash or bank. */
export function buildLoanExpenseTimelineEntries(
  loanItems: LoanOutflowHistoryItem[],
  sort: ExpenseTimelineSort = 'time-desc',
): ExpenseTimelineEntry[] {
  const entries: ExpenseTimelineEntry[] = []
  for (const item of loanItems) {
    if (!(item.amount > 0)) continue
    const fromBank = item.paySource === 'bank'
    const kindLabel =
      item.kind === 'given' ? 'Loan given' : 'Loan settlement'
    const settlementDetail =
      item.kind === 'given' ? formatLoanGivenSettlementDetail(item) : undefined
    entries.push({
      kind: 'loan',
      id: item.id,
      date: item.date,
      sortTime: new Date(item.date).getTime(),
      title: item.name?.trim() || kindLabel,
      detail: settlementDetail ?? item.note?.trim() ?? kindLabel,
      amount: item.amount,
      payLabel: fromBank ? 'Bank' : 'Cash',
      payDetail: fromBank
        ? `🏦 Bank · ${kindLabel} ${formatMoney(item.amount)}`
        : `💵 Cash · ${kindLabel} ${formatMoney(item.amount)}`,
      cashAmount: fromBank ? 0 : item.amount,
      bankAmount: fromBank ? item.amount : 0,
      loanOutflowKind: item.kind,
      ...(item.kind === 'given'
        ? {
            loanOriginalAmount: item.originalAmount ?? item.amount,
            loanSettledAmount: item.settledAmount ?? 0,
            loanUnsettledAmount: item.unsettledAmount ?? 0,
          }
        : {}),
    })
  }
  return sortExpenseTimelineEntries(entries, sort)
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
      if (entry.kind === 'expense' || entry.kind === 'transfer') {
        acc.expenseTotal += entry.amount
        acc.expenseCount += 1
        acc.expenseCash += entry.cashAmount ?? 0
        acc.expenseBank += entry.bankAmount ?? 0
        if (entry.kind === 'transfer') {
          acc.transferTotal += entry.amount
          acc.transferCount += 1
        }
      } else if (entry.kind === 'loan') {
        if (entry.loanOutflowKind === 'given') {
          acc.loanTotal += entry.amount
          acc.loanCount += 1
          acc.loanCash += entry.cashAmount ?? 0
          acc.loanBank += entry.bankAmount ?? 0
          if (entry.loanOriginalAmount != null) {
            acc.loanGivenOriginalTotal += entry.loanOriginalAmount
            acc.loanGivenSettledTotal += entry.loanSettledAmount ?? 0
            acc.loanGivenUnsettledTotal += entry.loanUnsettledAmount ?? 0
          }
        } else if (entry.loanOutflowKind === 'borrow-repaid') {
          acc.loanBorrowRepaidTotal += entry.amount
          acc.loanBorrowRepaidCount += 1
          acc.loanBorrowRepaidCash += entry.cashAmount ?? 0
          acc.loanBorrowRepaidBank += entry.bankAmount ?? 0
        }
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
      no1Total: 0,
      no1Count: 0,
      loanTotal: 0,
      loanCount: 0,
      loanCash: 0,
      loanBank: 0,
      loanGivenOriginalTotal: 0,
      loanGivenSettledTotal: 0,
      loanGivenUnsettledTotal: 0,
      loanBorrowRepaidTotal: 0,
      loanBorrowRepaidCount: 0,
      loanBorrowRepaidCash: 0,
      loanBorrowRepaidBank: 0,
      transferTotal: 0,
      transferCount: 0,
    },
  )
}

/** Open loan-given balance still counted as expense exposure (drops to zero when collected). */
export function expenseOpenLoanGivenTotal(summary: ExpenseTimelineSummary): number {
  return summary.loanGivenOriginalTotal > 0 ? summary.loanGivenUnsettledTotal : summary.loanTotal
}

/**
 * After loan settlement — normal + purchase + open loan given.
 * Borrow repayments stay in gross expense only; settled loan given no longer counts here.
 */
export function expenseTotalAfterLoanSettlement(summary: ExpenseTimelineSummary): number {
  return summary.expenseTotal + summary.purchaseTotal + expenseOpenLoanGivenTotal(summary)
}

export type ExpenseTimelineSummary = ReturnType<typeof summarizeExpenseTimeline>

/** Gross expense — normal + purchase + all loan outflows (given + repayments). */
export function expenseGrossTotal(summary: ExpenseTimelineSummary): number {
  return summary.expenseTotal + summary.purchaseTotal + expenseLoanCombinedTotal(summary)
}

/** All loan-related cash out — given (original) + borrow repayments. */
export function expenseLoanCombinedTotal(summary: ExpenseTimelineSummary): number {
  const loanGiven =
    summary.loanGivenOriginalTotal > 0 ? summary.loanGivenOriginalTotal : summary.loanTotal
  return loanGiven + summary.loanBorrowRepaidTotal
}

export function expenseHasLoanActivity(summary: ExpenseTimelineSummary): boolean {
  return expenseLoanCombinedTotal(summary) > 0
}

function purchaseTimelineKindFromExpense(expense: { name: string; billNumber?: 1 | 2 }): ExpenseTimelineKind {
  return isGstExpense(expense.name, expense.billNumber) ? 'no1-purchase' : 'purchase'
}

function appendPurchaseOutflowEventEntries(
  entries: ExpenseTimelineEntry[],
  expense: AppData['expenses'][number],
  events: Array<{ id: string; at: string; cash: number; bank: number }>,
  dateFilter: CashDateFilter,
  selectedDate: string,
  rangeTo: string,
) {
  const shopName = stripExpenseBillSuffix(expense.name)
  const gst = isGstExpense(expense.name, expense.billNumber)
  const billLabel =
    expense.billNumber === 1 || expense.billNumber === 2
      ? purchaseBillLabel(expense.billNumber)
      : gst
        ? purchaseBillLabel(1)
        : purchaseBillLabel(2)
  const kind = purchaseTimelineKindFromExpense(expense)

  for (const event of events) {
    if (!matchesCashDateFilter(event.at, dateFilter, selectedDate, rangeTo)) continue
    const paidOut = event.cash + event.bank
    if (!(paidOut > 0)) continue
    const payLabel =
      event.cash > 0 && event.bank > 0 ? 'Split' : event.bank > 0 ? 'Bank' : 'Cash'
    entries.push({
      kind,
      id: `${expense.id}:${event.id}`,
      date: event.at,
      sortTime: new Date(event.at).getTime(),
      title: shopName,
      detail: expense.description?.trim() || billLabel,
      amount: paidOut,
      payLabel,
      payDetail:
        event.cash > 0 && event.bank > 0
          ? `💵 ${formatMoney(event.cash)} + 🏦 ${formatMoney(event.bank)} · ${billLabel}`
          : event.bank > 0
            ? `🏦 Bank ${formatMoney(event.bank)} · ${billLabel}`
            : `💵 Cash ${formatMoney(event.cash)} · ${billLabel}`,
      no1Amount: gst ? paidOut : 0,
      billLabel,
      cashAmount: event.cash,
      bankAmount: event.bank,
    })
  }
}

export function buildExpenseTimelineEntriesFromData(
  data: AppData,
  normalItems: NormalExpenseHistoryItem[],
  _purchaseItems: PurchaseHistoryItem[] = [],
  sort: ExpenseTimelineSort = 'time-desc',
  loanItems: LoanOutflowHistoryItem[] = [],
  dateFilter: CashDateFilter = 'all',
  selectedDate = '',
  rangeTo = '',
): ExpenseTimelineEntry[] {
  const entries: ExpenseTimelineEntry[] = []

  for (const item of normalItems) {
    if (!(item.amount > 0)) continue
    entries.push({
      kind: 'expense',
      id: item.id,
      date: item.date,
      sortTime: new Date(item.date).getTime(),
      title: item.name,
      detail: item.payLabel,
      amount: item.amount,
      payLabel: item.payLabel,
      payDetail: item.payDetail,
      cashAmount: item.cashAmount,
      bankAmount: item.bankAmount,
    })
  }

  for (const source of buildPurchaseOutflowSources(data)) {
    appendPurchaseOutflowEventEntries(
      entries,
      source.expense,
      source.events,
      dateFilter,
      selectedDate,
      rangeTo,
    )
  }

  entries.push(...buildLoanExpenseTimelineEntries(loanItems, sort))

  return sortExpenseTimelineEntries(entries, sort)
}

export type ExpensePayChannelFilter = 'all' | 'cash' | 'bank'

export interface PeriodExpenseChannelSummary {
  cash: number
  bank: number
  /** Cash + bank without transfers (safe for All). */
  total: number
  /** Cash channel total including cash→bank transfers. */
  cashWithTransfers: number
  /** Bank channel total including bank→cash transfers. */
  bankWithTransfers: number
  count: number
  transferCash: number
  transferBank: number
}

export function summarizePeriodExpenseChannels(
  data: AppData,
  normalItems: NormalExpenseHistoryItem[],
  _purchaseItems: PurchaseHistoryItem[],
  loanItems: LoanOutflowHistoryItem[],
  dateFilter: CashDateFilter = 'all',
  selectedDate = '',
  rangeTo = '',
): PeriodExpenseChannelSummary {
  let cash = 0
  let bank = 0
  let count = 0

  for (const item of normalItems) {
    if (!(item.cashAmount > 0 || item.bankAmount > 0)) continue
    cash += item.cashAmount
    bank += item.bankAmount
    count += 1
  }

  for (const source of buildPurchaseOutflowSources(data)) {
    for (const event of source.events) {
      if (!matchesCashDateFilter(event.at, dateFilter, selectedDate, rangeTo)) continue
      if (!(event.cash > 0 || event.bank > 0)) continue
      cash += event.cash
      bank += event.bank
      count += 1
    }
  }

  for (const item of loanItems) {
    if (item.kind !== 'given' && item.kind !== 'borrow-repaid') continue
    if (item.paySource === 'bank') bank += item.amount
    else cash += item.amount
    count += 1
  }

  let transferCash = 0
  let transferBank = 0
  for (const expense of data.expenses ?? []) {
    if (expense.kind !== 'transfer') continue
    if (!matchesCashDateFilter(expense.createdAt, dateFilter, selectedDate, rangeTo)) continue
    if (expense.transferDirection === 'cash-to-bank') {
      transferCash += expense.amount
    } else if (expense.transferDirection === 'bank-to-cash') {
      transferBank += expense.amount
    }
  }

  return {
    cash,
    bank,
    total: cash + bank,
    cashWithTransfers: cash + transferCash,
    bankWithTransfers: bank + transferBank,
    count,
    transferCash,
    transferBank,
  }
}

/** Cash→Bank as cash expense; Bank→Cash as bank expense. Not used when filter is All. */
export function buildTransferExpenseTimelineEntries(
  data: AppData,
  channel: 'cash' | 'bank',
  dateFilter: CashDateFilter = 'all',
  selectedDate = '',
  rangeTo = '',
  sort: ExpenseTimelineSort = 'time-desc',
): ExpenseTimelineEntry[] {
  const entries: ExpenseTimelineEntry[] = []

  for (const expense of data.expenses ?? []) {
    if (expense.kind !== 'transfer') continue
    if (!matchesCashDateFilter(expense.createdAt, dateFilter, selectedDate, rangeTo)) continue

    const toBank = expense.transferDirection === 'cash-to-bank'
    const toCash = expense.transferDirection === 'bank-to-cash'
    if (channel === 'cash' && !toBank) continue
    if (channel === 'bank' && !toCash) continue

    const amount = expense.amount
    if (!(amount > 0)) continue

    entries.push({
      kind: 'transfer',
      id: `transfer-expense-${expense.id}`,
      date: expense.createdAt,
      sortTime: new Date(expense.createdAt).getTime(),
      title: expense.name?.trim() || (toBank ? 'Cash to Bank' : 'Bank to Cash'),
      detail: toBank ? '💵 → 🏦 Cash to Bank' : '🏦 → 💵 Bank to Cash',
      amount,
      payLabel: toBank ? 'Cash' : 'Bank',
      payDetail: toBank
        ? `💵 Cash out · transfer to bank ${formatMoney(amount)}`
        : `🏦 Bank out · transfer to cash ${formatMoney(amount)}`,
      cashAmount: toBank ? amount : 0,
      bankAmount: toCash ? amount : 0,
    })
  }

  return sortExpenseTimelineEntries(entries, sort)
}

export function expenseTimelineEntryChannel(entry: ExpenseTimelineEntry): 'cash' | 'bank' | 'none' {
  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (cash > 0 && bank <= 0) return 'cash'
  if (bank > 0 && cash <= 0) return 'bank'
  if (cash > 0 && bank > 0) return 'cash'
  return 'none'
}

export function filterExpenseTimelineByPayChannel(
  entries: ExpenseTimelineEntry[],
  channel: ExpensePayChannelFilter,
): ExpenseTimelineEntry[] {
  if (channel === 'all') {
    // Already built without credit-only rows; keep only real cash/bank outflows.
    return entries.filter((entry) => (entry.cashAmount ?? 0) + (entry.bankAmount ?? 0) > 0)
  }

  return entries
    .filter((entry) => {
      const cash = entry.cashAmount ?? 0
      const bank = entry.bankAmount ?? 0
      if (channel === 'cash') return cash > 0
      return bank > 0
    })
    .map((entry) => {
      const cash = entry.cashAmount ?? 0
      const bank = entry.bankAmount ?? 0
      // Cash filter: show cash portion only. Bank filter: bank (+ approved cheque) only.
      if (channel === 'cash') {
        return {
          ...entry,
          amount: cash,
          payLabel: cash > 0 && bank > 0 ? 'Cash (of split)' : entry.payLabel === 'Split' ? 'Cash' : entry.payLabel,
        }
      }
      return {
        ...entry,
        amount: bank,
        payLabel: cash > 0 && bank > 0 ? 'Bank (of split)' : entry.payLabel === 'Split' ? 'Bank' : entry.payLabel,
      }
    })
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
