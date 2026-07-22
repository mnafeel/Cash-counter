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
  paidAmount: number
  no1Amount: number
  no2Amount: number
  paidNo1Amount: number
  paidNo2Amount: number
  shopName: string
  description?: string
  billType: 'gst' | 'no-gst' | 'both'
  billLabel: string
  payLabel: string
  payDetail: string
  date: string
  hasOpenCredit?: boolean
  openCreditAmount?: number
  openCreditExpenseId?: string
}

export interface PurchaseCreditItem {
  id: string
  shopName: string
  description?: string
  amount: number
  date: string
  payDetail: string
  payLabel: string
  billLabel: string
  payType: Expense['payType']
}

export interface PurchaseSummary {
  total: number
  gstTotal: number
  noGstTotal: number
  count: number
  creditTotal: number
  creditCount: number
}

export interface TopPurchaseShop {
  shopName: string
  total: number
  gstTotal: number
  noGstTotal: number
}

export function purchaseCreditAmount(expense: Expense): number {
  if (expense.payType === 'credit') return expense.amount
  if (expense.payType === 'split') return expense.creditAmount ?? 0
  return 0
}

/** Cash / bank / approved cheque paid at purchase time — excludes credit portion. */
export function purchasePaidAmount(expense: Expense): number {
  if (expense.payType === 'credit') return 0
  if (expense.payType === 'split') {
    let paid = expense.cashAmount ?? 0
    if ((expense.bankAmount ?? 0) > 0) paid += expense.bankAmount ?? 0
    if (expense.chequeApproved && (expense.chequeAmount ?? 0) > 0) {
      paid += expense.chequeAmount ?? 0
    }
    return paid
  }
  return expense.amount
}

export function isPurchaseCreditExpense(expense: Expense): boolean {
  if (!isPurchaseExpense(expense)) return false
  return purchaseCreditAmount(expense) > 0
}

function purchaseCreditInfo(expense: Expense): { open: boolean; amount: number; expenseId: string } {
  const amount = purchaseCreditAmount(expense)
  return { open: amount > 0, amount, expenseId: expense.id }
}

function purchasePayLabel(expense: Expense): string {
  if (expense.payType === 'split') return 'Split'
  if (expense.payType === 'cheque') return expense.chequeApproved ? 'Cheque ✓' : 'Cheque pending'
  if (expense.payType === 'credit') return 'Credit'
  if (expense.payType === 'bank') return 'Bank'
  return 'Cash'
}

function purchasePayDetail(expense: Expense): string {
  if (expense.payType === 'split') {
    const parts: string[] = []
    if ((expense.cashAmount ?? 0) > 0) parts.push(`💵 ${formatMoney(expense.cashAmount ?? 0)}`)
    if ((expense.creditAmount ?? 0) > 0) parts.push(`💳 ${formatMoney(expense.creditAmount ?? 0)}`)
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
  if (expense.payType === 'credit') return `💳 Credit ${formatMoney(expense.amount)}`
  if (expense.payType === 'bank') return `🏦 Bank ${formatMoney(expense.amount)}`
  return `💵 Cash ${formatMoney(expense.amount)}`
}

export function buildPurchaseCreditItems(data: AppData): PurchaseCreditItem[] {
  const items: PurchaseCreditItem[] = []

  for (const expense of data.expenses) {
    if (!isPurchaseCreditExpense(expense)) continue
    const amount = purchaseCreditAmount(expense)
    items.push({
      id: expense.id,
      shopName: stripExpenseBillSuffix(expense.name),
      description: expense.description,
      amount,
      date: expense.createdAt,
      payDetail: purchasePayDetail(expense),
      payLabel: purchasePayLabel(expense),
      billLabel: expense.billNumber === 2 ? purchaseBillLabel(2) : purchaseBillLabel(1),
      payType: expense.payType,
    })
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function purchaseExpensePaymentModes(expense: Expense): Array<
  'cash' | 'bank' | 'credit' | 'cheque' | 'split'
> {
  if (expense.payType === 'split') {
    const modes: Array<'cash' | 'bank' | 'credit' | 'cheque' | 'split'> = ['split']
    if ((expense.cashAmount ?? 0) > 0) modes.push('cash')
    if ((expense.creditAmount ?? 0) > 0) modes.push('credit')
    if ((expense.chequeAmount ?? 0) > 0) modes.push('cheque')
    return modes
  }
  return [expense.payType]
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
      const no1Credit = purchaseCreditInfo(no1)
      const no2Credit = purchaseCreditInfo(no2)
      const openCreditAmount = no1Credit.amount + no2Credit.amount
      items.push({
        id: expense.id,
        amount: no1.amount + no2.amount,
        paidAmount: purchasePaidAmount(no1) + purchasePaidAmount(no2),
        no1Amount: no1.amount,
        no2Amount: no2.amount,
        paidNo1Amount: purchasePaidAmount(no1),
        paidNo2Amount: purchasePaidAmount(no2),
        shopName: stripExpenseBillSuffix(no1.name || no2.name),
        description: no1.description ?? no2.description,
        billType: 'both',
        billLabel: `${purchaseBillLabel(1)} + ${purchaseBillLabel(2)}`,
        payLabel: 'Both bills',
        payDetail: `No 1: ${purchasePayDetail(no1)} · No 2: ${purchasePayDetail(no2)}`,
        date: expense.createdAt,
        hasOpenCredit: no1Credit.open || no2Credit.open,
        openCreditAmount: openCreditAmount > 0 ? openCreditAmount : undefined,
        openCreditExpenseId: no1Credit.open ? no1.id : no2Credit.open ? no2.id : undefined,
      })
      continue
    }

    consumed.add(expense.id)
    const gst = isGstExpense(expense.name, expense.billNumber)
    const credit = purchaseCreditInfo(expense)
    items.push({
      id: expense.id,
      amount: expense.amount,
      paidAmount: purchasePaidAmount(expense),
      no1Amount: gst ? expense.amount : 0,
      no2Amount: gst ? 0 : expense.amount,
      paidNo1Amount: gst ? purchasePaidAmount(expense) : 0,
      paidNo2Amount: gst ? 0 : purchasePaidAmount(expense),
      shopName: stripExpenseBillSuffix(expense.name),
      description: expense.description,
      billType: gst ? 'gst' : 'no-gst',
      billLabel: gst ? purchaseBillLabel(1) : purchaseBillLabel(2),
      payLabel: purchasePayLabel(expense),
      payDetail: purchasePayDetail(expense),
      date: expense.createdAt,
      hasOpenCredit: credit.open,
      openCreditAmount: credit.open ? credit.amount : undefined,
      openCreditExpenseId: credit.open ? credit.expenseId : undefined,
    })
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function summarizePurchases(
  items: PurchaseHistoryItem[],
  paidOnly = false,
): PurchaseSummary {
  return items.reduce(
    (acc, item) => {
      const total = paidOnly ? item.paidAmount : item.amount
      const gstTotal = paidOnly ? item.paidNo1Amount : item.no1Amount
      const noGstTotal = paidOnly ? item.paidNo2Amount : item.no2Amount
      if (paidOnly && total <= 0) return acc
      acc.total += total
      acc.count += 1
      acc.gstTotal += gstTotal
      acc.noGstTotal += noGstTotal
      if (item.hasOpenCredit && item.openCreditAmount) {
        acc.creditTotal += item.openCreditAmount
        acc.creditCount += 1
      }
      return acc
    },
    { total: 0, gstTotal: 0, noGstTotal: 0, count: 0, creditTotal: 0, creditCount: 0 },
  )
}

export function getDisplayPurchaseAmount(item: PurchaseHistoryItem, paidOnly: boolean): number {
  return paidOnly ? item.paidAmount : item.amount
}

export function getDisplayPurchaseNo1Amount(item: PurchaseHistoryItem, paidOnly: boolean): number {
  return paidOnly ? item.paidNo1Amount : item.no1Amount
}

export function getDisplayPurchaseNo2Amount(item: PurchaseHistoryItem, paidOnly: boolean): number {
  return paidOnly ? item.paidNo2Amount : item.no2Amount
}

export function filterPaidPurchaseItems(items: PurchaseHistoryItem[]): PurchaseHistoryItem[] {
  return items.filter((item) => item.paidAmount > 0)
}

export function getTopPurchaseShop(
  items: PurchaseHistoryItem[],
  paidOnly = false,
): TopPurchaseShop | null {
  const byShop = new Map<string, TopPurchaseShop>()

  for (const item of items) {
    const total = paidOnly ? item.paidAmount : item.amount
    const gstTotal = paidOnly ? item.paidNo1Amount : item.no1Amount
    const noGstTotal = paidOnly ? item.paidNo2Amount : item.no2Amount
    if (paidOnly && total <= 0) continue
    const key = item.shopName.trim().toLowerCase()
    const current = byShop.get(key) ?? {
      shopName: item.shopName,
      total: 0,
      gstTotal: 0,
      noGstTotal: 0,
    }
    current.total += total
    current.gstTotal += gstTotal
    current.noGstTotal += noGstTotal
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
  creditTotal: number
  creditCount: number
  items: PurchaseHistoryItem[]
}

export function groupPurchasesBySupplier(
  items: PurchaseHistoryItem[],
  paidOnly = false,
): PurchaseSupplierGroup[] {
  const map = new Map<string, PurchaseSupplierGroup>()

  for (const item of items) {
    const total = paidOnly ? item.paidAmount : item.amount
    const gstTotal = paidOnly ? item.paidNo1Amount : item.no1Amount
    const noGstTotal = paidOnly ? item.paidNo2Amount : item.no2Amount
    if (paidOnly && total <= 0) continue
    const shopKey = item.shopName.trim().toLowerCase()
    if (!shopKey) continue
    const group = map.get(shopKey) ?? {
      shopName: item.shopName,
      shopKey,
      total: 0,
      gstTotal: 0,
      noGstTotal: 0,
      count: 0,
      creditTotal: 0,
      creditCount: 0,
      items: [],
    }
    group.total += total
    group.gstTotal += gstTotal
    group.noGstTotal += noGstTotal
    group.count += 1
    if (item.hasOpenCredit && item.openCreditAmount) {
      group.creditTotal += item.openCreditAmount
      group.creditCount += 1
    }
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
