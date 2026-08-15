import type { AppData, Expense, Loan, Sale } from '../types'
import { isPurchaseExpense } from './expenseBillLabels'
import { loanSettlementEvents } from './loanLedger'
import {
  getSalePaymentEvents,
  saleCollectionTimestamp,
  sanitizeSplitParentChildChequeOverlap,
} from './salePayment'
import { saleBankCollected, saleChequeToBankCollected } from './salesReport'
import {
  cashClosingLabel,
  cashOpeningLabel,
  type CashActivityItem,
  type CashDateFilter,
  matchesCashDateFilter,
} from './cashActivity'
import { memoByDataRef } from './memoByDataRef'

export type { CashDateFilter as BankDateFilter, CashActivityItem as BankActivityItem }
export { matchesCashDateFilter as matchesBankDateFilter }

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

/** Balance at 12 AM (start of day) before that period's bank activity. */
export function getBankOpeningBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
): number {
  const items = (prebuiltItems ?? buildBankActivityItems(data)).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  return currentBalance - summarizeBankActivity(items).net
}

export function summarizeBankActivityForPeriod(
  allItems: CashActivityItem[],
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
) {
  const items = allItems.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate))
  const summary = summarizeBankActivity(items)
  const opening = currentBalance - summary.net
  return { items, summary, opening, closing: opening + summary.net }
}

export { cashOpeningLabel as bankOpeningLabel, cashClosingLabel as bankClosingLabel }

/** End-of-day balance after that period's bank activity (night 12 AM closing). */
export function getBankClosingBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
  prebuiltItems?: CashActivityItem[],
): number {
  const items = (prebuiltItems ?? buildBankActivityItems(data)).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  const opening = currentBalance - summarizeBankActivity(items).net
  return opening + summarizeBankActivity(items).net
}
