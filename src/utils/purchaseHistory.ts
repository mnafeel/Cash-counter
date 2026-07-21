import type { AppData, Expense } from '../types'
import {
  isGstExpense,
  isPurchaseExpense,
  purchaseBillLabel,
  stripExpenseBillSuffix,
} from './expenseBillLabels'
import { formatDate, formatMoney } from './format'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'

export type PurchaseDateFilter = CashDateFilter

export interface PurchaseHistoryItem {
  id: string
  amount: number
  no1Amount: number
  no2Amount: number
  shopName: string
  description?: string
  billType: 'gst' | 'no-gst' | 'both'
  billLabel: string
  payLabel: string
  payDetail: string
  date: string
}

export interface PurchaseSummary {
  total: number
  gstTotal: number
  noGstTotal: number
  count: number
}

export interface TopPurchaseShop {
  shopName: string
  total: number
  gstTotal: number
  noGstTotal: number
}

function purchasePayLabel(expense: Expense): string {
  if (expense.payType === 'split') return 'Split'
  if (expense.payType === 'cheque') return expense.chequeApproved ? 'Cheque ✓' : 'Cheque pending'
  if (expense.payType === 'bank') return 'Bank'
  return 'Cash'
}

function purchasePayDetail(expense: Expense): string {
  if (expense.payType === 'split') {
    const parts: string[] = []
    if ((expense.cashAmount ?? 0) > 0) parts.push(`💵 ${formatMoney(expense.cashAmount ?? 0)}`)
    if ((expense.bankAmount ?? 0) > 0) parts.push(`🏦 ${formatMoney(expense.bankAmount ?? 0)}`)
    if ((expense.chequeAmount ?? 0) > 0) {
      parts.push(
        `🧾 ${formatMoney(expense.chequeAmount ?? 0)}${expense.chequeApproved ? ' ✓' : ''}`,
      )
    }
    return parts.length > 0 ? parts.join(' + ') : 'Split'
  }
  if (expense.payType === 'cheque') {
    return `🧾 Cheque ${formatMoney(expense.amount)}${expense.chequeApproved ? ' ✓' : ''}`
  }
  if (expense.payType === 'bank') return `🏦 Bank ${formatMoney(expense.amount)}`
  return `💵 Cash ${formatMoney(expense.amount)}`
}

export function buildPurchaseHistoryItems(data: AppData): PurchaseHistoryItem[] {
  const purchases = data.expenses.filter((expense) => isPurchaseExpense(expense))
  const byId = new Map(purchases.map((expense) => [expense.id, expense]))
  const consumed = new Set<string>()
  const items: PurchaseHistoryItem[] = []

  for (const expense of purchases) {
    if (consumed.has(expense.id)) continue

    const paired = expense.pairedExpenseId ? byId.get(expense.pairedExpenseId) : undefined
    if (paired && !consumed.has(paired.id)) {
      const no1 = isGstExpense(expense.name, expense.billNumber) ? expense : paired
      const no2 = no1.id === expense.id ? paired : expense
      consumed.add(expense.id)
      consumed.add(paired.id)
      items.push({
        id: expense.id,
        amount: no1.amount + no2.amount,
        no1Amount: no1.amount,
        no2Amount: no2.amount,
        shopName: stripExpenseBillSuffix(no1.name || no2.name),
        description: no1.description ?? no2.description,
        billType: 'both',
        billLabel: `${purchaseBillLabel(1)} + ${purchaseBillLabel(2)}`,
        payLabel: 'Both bills',
        payDetail: `No 1: ${purchasePayDetail(no1)} · No 2: ${purchasePayDetail(no2)}`,
        date: expense.createdAt,
      })
      continue
    }

    consumed.add(expense.id)
    const gst = isGstExpense(expense.name, expense.billNumber)
    items.push({
      id: expense.id,
      amount: expense.amount,
      no1Amount: gst ? expense.amount : 0,
      no2Amount: gst ? 0 : expense.amount,
      shopName: stripExpenseBillSuffix(expense.name),
      description: expense.description,
      billType: gst ? 'gst' : 'no-gst',
      billLabel: gst ? purchaseBillLabel(1) : purchaseBillLabel(2),
      payLabel: purchasePayLabel(expense),
      payDetail: purchasePayDetail(expense),
      date: expense.createdAt,
    })
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function summarizePurchases(items: PurchaseHistoryItem[]): PurchaseSummary {
  return items.reduce(
    (acc, item) => {
      acc.total += item.amount
      acc.count += 1
      acc.gstTotal += item.no1Amount
      acc.noGstTotal += item.no2Amount
      return acc
    },
    { total: 0, gstTotal: 0, noGstTotal: 0, count: 0 },
  )
}

export function getTopPurchaseShop(items: PurchaseHistoryItem[]): TopPurchaseShop | null {
  const byShop = new Map<string, TopPurchaseShop>()

  for (const item of items) {
    const key = item.shopName.trim().toLowerCase()
    const current = byShop.get(key) ?? {
      shopName: item.shopName,
      total: 0,
      gstTotal: 0,
      noGstTotal: 0,
    }
    current.total += item.amount
    current.gstTotal += item.no1Amount
    current.noGstTotal += item.no2Amount
    byShop.set(key, current)
  }

  let top: TopPurchaseShop | null = null
  for (const entry of byShop.values()) {
    if (!top || entry.total > top.total) top = entry
  }

  return top?.shopName ? top : null
}

export function filterPurchaseHistoryItems(
  items: PurchaseHistoryItem[],
  dateFilter: PurchaseDateFilter,
  selectedDate: string,
): PurchaseHistoryItem[] {
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate))
}

export function matchesPurchaseHistorySearch(item: PurchaseHistoryItem, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim()
  const haystack = [
    item.shopName,
    item.description,
    item.billLabel,
    item.payLabel,
    item.payDetail,
    formatMoney(item.amount),
    formatMoney(item.no1Amount),
    formatMoney(item.no2Amount),
    formatDate(item.date),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

export interface PurchaseSupplierGroup {
  shopName: string
  shopKey: string
  total: number
  gstTotal: number
  noGstTotal: number
  count: number
  items: PurchaseHistoryItem[]
}

export function groupPurchasesBySupplier(items: PurchaseHistoryItem[]): PurchaseSupplierGroup[] {
  const map = new Map<string, PurchaseSupplierGroup>()

  for (const item of items) {
    const shopKey = item.shopName.trim().toLowerCase()
    if (!shopKey) continue
    const group = map.get(shopKey) ?? {
      shopName: item.shopName,
      shopKey,
      total: 0,
      gstTotal: 0,
      noGstTotal: 0,
      count: 0,
      items: [],
    }
    group.total += item.amount
    group.gstTotal += item.no1Amount
    group.noGstTotal += item.no2Amount
    group.count += 1
    group.items.push(item)
    map.set(shopKey, group)
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    }))
    .sort((a, b) => b.total - a.total)
}
