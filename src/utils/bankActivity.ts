import type { AppData, Expense, Sale } from '../types'
import { saleBankCollected } from './salesReport'
import { type CashActivityItem, type CashDateFilter, matchesCashDateFilter } from './cashActivity'

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

  if (expense.payType !== 'bank') return

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
