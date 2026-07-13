import type { AppData, Expense, Sale } from '../types'
import { saleBankCollected } from './salesReport'
import {
  cashClosingLabel,
  cashOpeningLabel,
  type CashActivityItem,
  type CashDateFilter,
  matchesCashDateFilter,
} from './cashActivity'

export type { CashDateFilter as BankDateFilter, CashActivityItem as BankActivityItem }
export { matchesCashDateFilter as matchesBankDateFilter }

function saleActivityDate(sale: Sale): string {
  if (sale.status === 'pending') return sale.createdAt
  return sale.updatedAt ?? sale.createdAt
}

function pushSaleItems(items: CashActivityItem[], sale: Sale) {
  const bank = saleBankCollected(sale)
  if (!(bank > 0)) return
  items.push({
    id: `sale-${sale.id}`,
    label: 'Bill · bank collected',
    amount: bank,
    direction: 'in',
    date: saleActivityDate(sale),
    name: sale.customerName,
  })
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

  if (expense.payType === 'split') {
    const bank = expense.bankAmount ?? 0
    if (bank <= 0) return
    if (expense.kind === 'add') {
      items.push({
        id: `add-${expense.id}`,
        label: 'Added to bank',
        amount: bank,
        direction: 'in',
        date: expense.createdAt,
        name: expense.name,
      })
      return
    }
    items.push({
      id: `expense-${expense.id}-bank`,
      label: 'Bank expense',
      amount: bank,
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
    label: 'Bank expense',
    amount: expense.amount,
    direction: 'out',
    date: expense.createdAt,
    name: expense.name,
  })
}

export function buildBankActivityItems(data: AppData): CashActivityItem[] {
  const items: CashActivityItem[] = []
  for (const sale of data.sales) pushSaleItems(items, sale)
  for (const expense of data.expenses) pushExpenseItems(items, expense)
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

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
): number {
  const items = buildBankActivityItems(data).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  return currentBalance - summarizeBankActivity(items).net
}

export { cashOpeningLabel as bankOpeningLabel, cashClosingLabel as bankClosingLabel }

/** End-of-day balance after that period's bank activity (night 12 AM closing). */
export function getBankClosingBalance(
  data: AppData,
  currentBalance: number,
  dateFilter: CashDateFilter,
  selectedDate = '',
): number {
  const opening = getBankOpeningBalance(data, currentBalance, dateFilter, selectedDate)
  const items = buildBankActivityItems(data).filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate),
  )
  return opening + summarizeBankActivity(items).net
}
