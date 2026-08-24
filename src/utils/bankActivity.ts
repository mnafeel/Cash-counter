import type { AppData, Expense, Loan, Sale } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { loanSettlementEvents } from './loanLedger'
import {
  getSalePaymentEvents,
  saleCollectionTimestamp,
  sanitizeSplitParentChildChequeOverlap,
  isActivePaymentEvent,
} from './salePayment'
import { saleBankCollected, saleChequeToBankCollected } from './salesReport'
import {
  cashClosingLabel,
  cashOpeningLabel,
  getCashPeriodStartMs,
  type CashActivityItem,
  type CashDateFilter,
  matchesCashDateFilter,
} from './cashActivity'
import { memoByDataRef } from './memoByDataRef'

export type { CashDateFilter as BankDateFilter, CashActivityItem as BankActivityItem }
export { matchesCashDateFilter as matchesBankDateFilter }

function isOnOrAfterPeriodStart(iso: string, startMs: number | null): boolean {
  if (startMs == null) return true
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t >= startMs
}

function saleActivityDate(sale: Sale): string {
  if (sale.status === 'pending') {
    const bank = saleBankCollected(sale) + saleChequeToBankCollected(sale)
    if (bank > 0 && sale.updatedAt) return sale.updatedAt
    return sale.createdAt
  }
  return saleCollectionTimestamp(sale)
}

function pushSaleItems(items: CashActivityItem[], sale: Sale) {
  const events = getSalePaymentEvents(sale)
  if (events.length > 0) {
    events.forEach((event, index) => {
      if (!isActivePaymentEvent(event)) return
      const bank = (event.bank ?? 0) + (event.cheque ?? 0)
      if (bank > 0) {
        items.push({
          id: `sale-${sale.id}-bank-${index}`,
          label: (event.cheque ?? 0) > 0 ? 'Bill · cheque to bank' : 'Bill · bank collected',
          amount: bank,
          direction: 'in',
          date: event.at,
          name: sale.customerName,
        })
      }
    })
    return
  }

  const date = saleActivityDate(sale)
  const bank = saleBankCollected(sale) + saleChequeToBankCollected(sale)
  if (bank > 0) {
    items.push({
      id: `sale-${sale.id}-bank`,
      label: 'Bill · bank collected',
      amount: bank,
      direction: 'in',
      date,
      name: sale.customerName,
    })
  }
}

function bankOutLabel(expense: Expense, kind: 'expense' | 'cheque' | 'bank'): string {
  const prefix = isPurchaseExpense(expense) ? 'Purchase' : 'Expense'
  if (kind === 'cheque') return `${prefix} · cheque`
  if (kind === 'bank') return `${prefix} · bank`
  return `${prefix} · bank`
}

function pushExpenseItems(items: CashActivityItem[], expense: Expense) {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') {
      items.push({
        id: `transfer-${expense.id}`,
        label: 'Transfer from cash',
        amount: expense.amount,
        direction: 'in',
        date: expense.createdAt,
        name: expense.name,
      })
    } else if (expense.transferDirection === 'bank-to-cash') {
      items.push({
        id: `transfer-${expense.id}`,
        label: 'Transfer to cash',
        amount: expense.amount,
        direction: 'out',
        date: expense.createdAt,
        name: expense.name,
      })
    }
    return
  }

  if (expense.payType === 'cash') return
  if (expense.payType === 'credit') return

  if (expense.payType === 'cheque') {
    if (!expense.chequeApproved) return
    const cheque = expense.chequeAmount ?? expense.amount
    items.push({
      id: `expense-${expense.id}-cheque`,
      label: bankOutLabel(expense, 'cheque'),
      amount: cheque,
      direction: expense.kind === 'add' ? 'in' : 'out',
      date: expense.createdAt,
      name: expense.name,
    })
    return
  }

  if (expense.payType === 'split') {
    const bank = expense.bankAmount ?? 0
    const cheque =
      expense.chequeApproved && (expense.chequeAmount ?? 0) > 0 ? (expense.chequeAmount ?? 0) : 0
    const bankTotal = bank + cheque
    if (bankTotal <= 0) return
    if (expense.kind === 'add') {
      items.push({
        id: `add-${expense.id}`,
        label: 'Added to bank',
        amount: bankTotal,
        direction: 'in',
        date: expense.createdAt,
        name: expense.name,
      })
      return
    }
    items.push({
      id: `expense-${expense.id}-bank`,
      label: bankOutLabel(expense, 'bank'),
      amount: bankTotal,
      direction: 'out',
      date: expense.createdAt,
      name: expense.name,
    })
    return
  }

  if (expense.kind === 'add') {
    items.push({
      id: `add-${expense.id}`,
      label: 'Added to bank',
      amount: expense.amount,
      direction: 'in',
      date: expense.createdAt,
      name: expense.name,
    })
    return
  }

  items.push({
    id: `expense-${expense.id}`,
    label: bankOutLabel(expense, 'bank'),
    amount: expense.amount,
    direction: 'out',
    date: expense.createdAt,
    name: expense.name,
  })
}

function pushLoanItems(items: CashActivityItem[], loan: Loan) {
  if (loan.kind === 'lend' && loan.paySource === 'bank') {
    items.push({
      id: `loan-${loan.id}-give-bank`,
      label: 'Loan given · bank',
      amount: loan.amount,
      direction: 'out',
      date: loan.createdAt,
      name: loan.personName,
    })
  }

  for (const [index, event] of loanSettlementEvents(loan).entries()) {
    if (event.paySource !== 'bank') continue
    if (loan.kind === 'lend') {
      items.push({
        id: `loan-${loan.id}-settle-bank-${index}`,
        label: 'Loan collected · bank',
        amount: event.amount,
        direction: 'in',
        date: event.at,
        name: loan.personName,
      })
    } else {
      items.push({
        id: `loan-${loan.id}-settle-bank-${index}`,
        label: 'Loan returned · bank',
        amount: event.amount,
        direction: 'out',
        date: event.at,
        name: loan.personName,
      })
    }
  }
}

function buildBankActivityItemsUncached(data: AppData): CashActivityItem[] {
  const items: CashActivityItem[] = []
  const sales = sanitizeSplitParentChildChequeOverlap(data.sales)
  for (const sale of sales) pushSaleItems(items, sale)
  for (const expense of data.expenses) pushExpenseItems(items, expense)
  for (const loan of data.loans ?? []) pushLoanItems(items, loan)
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export const buildBankActivityItems = memoByDataRef(buildBankActivityItemsUncached)

export function summarizeBankActivity(items: CashActivityItem[]) {
  let bankIn = 0
  let bankOut = 0
  for (const item of items) {
    if (item.direction === 'in') bankIn += item.amount
    else bankOut += item.amount
  }
  return { bankIn, bankOut, net: bankIn - bankOut, count: items.length }
}

/**
 * Balance at the start of the selected period (e.g. that day’s 12 AM).
 * Always: live bank − net of activity from period start onward.
 * So for Today: Opening + today’s In − today’s Out = Bank Balance.
 */
export function getBankOpeningBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
  rangeTo?: string,
): number {
  const allItems = prebuiltItems ?? buildBankActivityItems(data)
  const startMs = getCashPeriodStartMs(dateFilter, selectedDate, rangeTo)
  if (startMs == null) {
    return currentBalance - summarizeBankActivity(allItems).net
  }
  const fromStart = allItems.filter((item) => isOnOrAfterPeriodStart(item.date, startMs))
  return currentBalance - summarizeBankActivity(fromStart).net
}

export function summarizeBankActivityForPeriod(
  allItems: CashActivityItem[],
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  rangeTo?: string,
) {
  const items = allItems.filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo),
  )
  const summary = summarizeBankActivity(items)
  const opening = getBankOpeningBalance(
    data,
    currentBalance,
    dateFilter,
    selectedDate,
    allItems,
    rangeTo,
  )
  return { items, summary, opening, closing: opening + summary.net }
}

export { cashOpeningLabel as bankOpeningLabel, cashClosingLabel as bankClosingLabel }

/** End-of-period balance after that period's bank activity (e.g. night 12 AM closing). */
export function getBankClosingBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
  rangeTo?: string,
): number {
  const allItems = prebuiltItems ?? buildBankActivityItems(data)
  const opening = getBankOpeningBalance(
    data,
    currentBalance,
    dateFilter,
    selectedDate,
    allItems,
    rangeTo,
  )
  const periodItems = allItems.filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo),
  )
  return opening + summarizeBankActivity(periodItems).net
}
