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
  createdAt: string
  hasOpenCredit?: boolean
  openCreditAmount?: number
  openCreditExpenseId?: string
}

export interface PurchaseCreditItem {
  id: string
  shopName: string
  description?: string
  /** Open credit balance remaining. */
  amount: number
  /** Cash / bank / cheque already paid on this bill. */
  paidAmount: number
  /** Full purchase bill amount. */
  billTotal: number
  date: string
  createdAt: string
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
  if (expense.payType === 'credit') {
    if (expense.creditAmount === 0) return 0
    return expense.creditAmount ?? expense.amount
  }
  if (expense.payType === 'split') return expense.creditAmount ?? 0
  return 0
}

/** Paid cash / bank / approved cheque components — excludes open credit. */
export function purchasePaidComponents(expense: Expense): {
  cash: number
  bank: number
  cheque: number
} {
  if (expense.payType === 'cash') {
    return { cash: expense.amount, bank: 0, cheque: 0 }
  }
  if (expense.payType === 'bank') {
    return { cash: 0, bank: expense.amount, cheque: 0 }
  }
  if (expense.payType === 'cheque') {
    const cheque =
      expense.chequeApproved && (expense.chequeAmount ?? 0) > 0
        ? expense.chequeAmount ?? expense.amount
        : 0
    return { cash: 0, bank: 0, cheque }
  }

  const cash = expense.cashAmount ?? 0
  const bank = expense.bankAmount ?? 0
  const cheque =
    expense.chequeApproved && (expense.chequeAmount ?? 0) > 0
      ? expense.chequeAmount ?? 0
      : 0

  if (expense.payType === 'credit') {
    const fromComponents = cash + bank + cheque
    if (fromComponents > 0) return { cash, bank, cheque }
    if (expense.creditAmount != null && expense.creditAmount < expense.amount) {
      return { cash: expense.amount - expense.creditAmount, bank: 0, cheque: 0 }
    }
  }

  return { cash, bank, cheque }
}

/** Cash / bank / approved cheque paid at purchase time — excludes credit portion. */
export function purchasePaidAmount(expense: Expense): number {
  const { cash, bank, cheque } = purchasePaidComponents(expense)
  const total = cash + bank + cheque
  if (expense.payType === 'credit' || expense.payType === 'split') return total
  return expense.amount
}

/** Last activity time — credit payments bump updatedAt. */
export function purchaseExpenseActivityTime(expense: Expense): string {
  return expense.updatedAt ?? expense.createdAt
}

function latestPurchaseActivityTime(...expenses: Expense[]): string {
  return expenses.reduce((latest, expense) => {
    const next = purchaseExpenseActivityTime(expense)
    return new Date(next).getTime() > new Date(latest).getTime() ? next : latest
  }, purchaseExpenseActivityTime(expenses[0]))
}

export function isPurchaseCreditExpense(expense: Expense): boolean {
  if (!isPurchaseExpense(expense)) return false
  return purchaseCreditAmount(expense) > 0
}

export interface CreditPaymentInput {
  payType: Expense['payType']
  payAmount: number
  cashAmount?: number
  bankAmount?: number
  chequeAmount?: number
  chequeApproved?: boolean
}

/** Pay-down uses cash/bank/cheque/split — never credit again. */
export function normalizeCreditPaymentPayType(payType: Expense['payType']): Expense['payType'] {
  if (payType === 'credit') return 'cash'
  return payType
}

/** Apply a partial or full payment against open supplier credit on a purchase expense. */
export function buildCreditPaymentUpdate(
  expense: Expense,
  payment: CreditPaymentInput,
): Partial<Expense> {
  const payType = normalizeCreditPaymentPayType(payment.payType)
  const openCredit = purchaseCreditAmount(expense)
  const payNow = Math.min(Math.max(0, payment.payAmount), openCredit)
  const remaining = openCredit - payNow
  const purchaseTotal = expense.amount

  const prevPaid = purchasePaidComponents(expense)
  const prevCash = prevPaid.cash
  const prevBank = prevPaid.bank
  const prevCheque = prevPaid.cheque

  let addCash = 0
  let addBank = 0
  let addCheque = 0
  let chequeApproved = expense.chequeApproved

  if (payType === 'cash') addCash = payNow
  else if (payType === 'bank') addBank = payNow
  else if (payType === 'cheque') {
    addCheque = payNow
    chequeApproved = payment.chequeApproved ?? false
  } else if (payType === 'split') {
    addCash = payment.cashAmount ?? 0
    addBank = payment.bankAmount ?? 0
    addCheque = payment.chequeApproved ? (payment.chequeAmount ?? 0) : 0
  }

  const totalCash = prevCash + addCash
  const totalBank = prevBank + addBank
  const totalCheque = prevCheque + addCheque

  if (remaining === 0) {
    const hasCash = totalCash > 0
    const hasBank = totalBank > 0
    const hasCheque = totalCheque > 0
    const modeCount = [hasCash, hasBank, hasCheque].filter(Boolean).length

    if (modeCount === 1) {
      if (hasCash) {
        return {
          payType: 'cash',
          amount: purchaseTotal,
          cashAmount: undefined,
          bankAmount: undefined,
          creditAmount: undefined,
          chequeAmount: undefined,
          chequeApproved: undefined,
        }
      }
      if (hasBank) {
        return {
          payType: 'bank',
          amount: purchaseTotal,
          bankAmount: purchaseTotal,
          cashAmount: undefined,
          creditAmount: undefined,
          chequeAmount: undefined,
          chequeApproved: undefined,
        }
      }
      if (hasCheque) {
        return {
          payType: 'cheque',
          amount: purchaseTotal,
          chequeAmount: purchaseTotal,
          chequeApproved: true,
          cashAmount: undefined,
          bankAmount: undefined,
          creditAmount: undefined,
        }
      }
    }

    return {
      payType: 'split',
      amount: purchaseTotal,
      cashAmount: totalCash || undefined,
      bankAmount: totalBank || undefined,
      creditAmount: undefined,
      chequeAmount: totalCheque || undefined,
      chequeApproved: totalCheque > 0 ? chequeApproved : undefined,
    }
  }

  return {
    payType: 'split',
    amount: purchaseTotal,
    cashAmount: totalCash || undefined,
    bankAmount: totalBank || undefined,
    creditAmount: remaining,
    chequeAmount: totalCheque || undefined,
    chequeApproved: totalCheque > 0 ? chequeApproved : expense.chequeApproved,
  }
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
      paidAmount: purchasePaidAmount(expense),
      billTotal: expense.amount,
      date: purchaseExpenseActivityTime(expense),
      createdAt: expense.createdAt,
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
        date: latestPurchaseActivityTime(no1, no2),
        createdAt: no1.createdAt,
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
      date: purchaseExpenseActivityTime(expense),
      createdAt: expense.createdAt,
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
