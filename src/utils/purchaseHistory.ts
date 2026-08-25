import type { AppData, Expense } from '../types'
import {
  isGstExpense,
  isPurchaseExpense,
  purchaseBillLabel,
  stripExpenseBillSuffix,
} from './expenseBillLabels'
import { formatDate, formatMoney } from './format'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import { memoByDataRef } from './memoByDataRef'

export type PurchaseDateFilter = CashDateFilter

export const PURCHASE_CASH_LABEL = 'Cash'

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
  billNo?: string
  billType: 'gst' | 'no-gst' | 'both'
  billLabel: string
  payLabel: string
  payDetail: string
  /** When money was recorded / paid in the app — used for Today / Week filters. */
  date: string
  /** Supplier bill date from the form — display only, not used for period filters. */
  billDate?: string
  createdAt: string
  /** Last payment / update ISO time — used for sorting and “Updated” labels. */
  updatedAt: string
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
  billNumber: 1 | 2
  billNo?: string
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

export interface PurchaseBillPaymentBreakdown {
  cash: number
  bank: number
  cheque: number
  credit: number
  other: number
  total: number
}

export interface PurchasePaymentBreakdown {
  no1: Pick<PurchaseBillPaymentBreakdown, 'cash' | 'bank' | 'total'>
  no2: PurchaseBillPaymentBreakdown
}

function emptyPurchasePaymentBreakdown(): PurchasePaymentBreakdown {
  return {
    no1: { cash: 0, bank: 0, total: 0 },
    no2: { cash: 0, bank: 0, cheque: 0, credit: 0, other: 0, total: 0 },
  }
}

function purchaseExpensesForHistoryItems(data: AppData, items: PurchaseHistoryItem[]): Expense[] {
  const purchases = data.expenses.filter((expense) => isPurchaseExpense(expense))
  const byId = new Map(purchases.map((expense) => [expense.id, expense]))
  const consumed = new Set<string>()
  const result: Expense[] = []

  for (const item of items) {
    const expense = byId.get(item.id)
    if (!expense || consumed.has(expense.id)) continue

    if (item.billType === 'both') {
      const paired = expense.pairedExpenseId ? byId.get(expense.pairedExpenseId) : undefined
      if (paired && !consumed.has(paired.id)) {
        consumed.add(expense.id)
        consumed.add(paired.id)
        const no1 = isGstExpense(expense.name, expense.billNumber) ? expense : paired
        const no2 = no1.id === expense.id ? paired : expense
        result.push(no1, no2)
        continue
      }
    }

    consumed.add(expense.id)
    result.push(expense)
  }

  return result
}

export function summarizePurchasePaymentBreakdown(
  data: AppData,
  items: PurchaseHistoryItem[],
): PurchasePaymentBreakdown {
  const breakdown = emptyPurchasePaymentBreakdown()

  for (const expense of purchaseExpensesForHistoryItems(data, items)) {
    const paid = purchasePaidComponents(expense)
    const openCredit = purchaseCreditAmount(expense)
    const isNo1 = isGstExpense(expense.name, expense.billNumber)

    if (isNo1) {
      breakdown.no1.cash += paid.cash
      breakdown.no1.bank += paid.bank
      breakdown.no1.total += paid.cash + paid.bank + paid.cheque
      continue
    }

    breakdown.no2.cash += paid.cash
    breakdown.no2.bank += paid.bank
    breakdown.no2.cheque += paid.cheque
    breakdown.no2.credit += openCredit
    if (expense.payType === 'credit' && openCredit <= 0 && paid.cash + paid.bank + paid.cheque <= 0) {
      breakdown.no2.other += expense.amount
    }
    breakdown.no2.total += paid.cash + paid.bank + paid.cheque + openCredit
  }

  return breakdown
}

export interface SupplierPurchaseFileSummary {
  billCount: number
  pendingBillCount: number
  paidBillCount: number
  creditOpenBillCount: number
  creditOpenTotal: number
  billTotal: number
  no1BillTotal: number
  no2BillTotal: number
  paidTotal: number
  pendingTotal: number
  paidNo1Total: number
  paidNo2Total: number
  cashTotal: number
  bankTotal: number
  no1CashTotal: number
  no1BankTotal: number
  no2CashTotal: number
  no2BankTotal: number
  no2ChequeTotal: number
  chequeTotal: number
}

export function summarizeSupplierPurchaseFile(
  data: AppData,
  items: PurchaseHistoryItem[],
): SupplierPurchaseFileSummary {
  const payment = summarizePurchasePaymentBreakdown(data, items)
  let pendingBillCount = 0
  let paidBillCount = 0
  let creditOpenBillCount = 0
  let creditOpenTotal = 0
  let billTotal = 0
  let paidTotal = 0
  let paidNo1Total = 0
  let paidNo2Total = 0
  let no1BillTotal = 0
  let no2BillTotal = 0
  let pendingTotal = 0

  for (const item of items) {
    billTotal += item.amount
    paidTotal += item.paidAmount
    paidNo1Total += item.paidNo1Amount
    paidNo2Total += item.paidNo2Amount
    no1BillTotal += item.no1Amount
    no2BillTotal += item.no2Amount
    pendingTotal += Math.max(0, item.amount - item.paidAmount)
    if (item.hasOpenCredit) {
      pendingBillCount += 1
      creditOpenBillCount += 1
      creditOpenTotal += item.openCreditAmount ?? 0
    } else if (item.paidAmount >= item.amount && item.amount > 0) {
      paidBillCount += 1
    } else if (item.paidAmount > 0) {
      pendingBillCount += 1
    } else {
      pendingBillCount += 1
    }
  }

  return {
    billCount: items.length,
    pendingBillCount,
    paidBillCount,
    creditOpenBillCount,
    creditOpenTotal,
    billTotal,
    no1BillTotal,
    no2BillTotal,
    paidTotal,
    pendingTotal,
    paidNo1Total,
    paidNo2Total,
    cashTotal: payment.no1.cash + payment.no2.cash,
    bankTotal: payment.no1.bank + payment.no2.bank,
    no1CashTotal: payment.no1.cash,
    no1BankTotal: payment.no1.bank,
    no2CashTotal: payment.no2.cash,
    no2BankTotal: payment.no2.bank,
    no2ChequeTotal: payment.no2.cheque,
    chequeTotal: payment.no2.cheque,
  }
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

/** Supplier bill date from the purchase form (YYYY-MM-DD). */
export function purchaseExpenseSupplierBillDate(expense: Expense): string | undefined {
  const billDate = expense.billDate?.trim()
  return billDate || undefined
}

export function purchaseHistoryDayKey(iso: string): string {
  if (!iso) return ''
  return iso.includes('T') ? iso.slice(0, 10) : iso.slice(0, 10)
}

/** True when supplier bill date differs from the day we recorded / paid in the app. */
export function purchaseSupplierBillDateDiffers(
  supplierBillDate: string | undefined,
  paidAt: string,
): boolean {
  if (!supplierBillDate) return false
  return purchaseHistoryDayKey(supplierBillDate) !== purchaseHistoryDayKey(paidAt)
}

/**
 * When cash/bank left for a purchase (and for sorting / credit lists).
 * Full cash/bank/cheque buys use createdAt — never rename-bumped updatedAt,
 * which otherwise dumps old supplier payments into Today after a name change.
 * Open credit/split still uses updatedAt (credit collections bump it).
 */
export function purchaseExpenseActivityTime(expense: Expense): string {
  if (expense.payType === 'cash' || expense.payType === 'bank' || expense.payType === 'cheque') {
    return expense.createdAt
  }
  const creditLeft = purchaseCreditAmount(expense)
  if (creditLeft > 0) return expense.updatedAt ?? expense.createdAt
  return expense.createdAt
}

/** Bill date for history display and sorting — falls back to created date. */
export function purchaseExpenseBillDate(expense: Expense): string {
  const billDate = expense.billDate?.trim()
  if (billDate) return billDate
  const created = expense.createdAt
  if (created.includes('T')) return created.slice(0, 10)
  return created
}

function latestPurchaseActivityTime(...expenses: Expense[]): string {
  return expenses.reduce((latest, expense) => {
    const next = purchaseExpenseActivityTime(expense)
    return new Date(next).getTime() > new Date(latest).getTime() ? next : latest
  }, purchaseExpenseActivityTime(expenses[0]))
}

function sortPurchaseHistoryItems(items: PurchaseHistoryItem[]): PurchaseHistoryItem[] {
  return sortPurchaseHistoryByMode(items, 'newest')
}

export type PurchaseBillSort = 'newest' | 'oldest' | 'no1' | 'no2' | 'billNo'

function billNoSortKey(billNo?: string): number {
  if (!billNo?.trim()) return Number.MAX_SAFE_INTEGER
  const digits = billNo.replace(/\D/g, '')
  const n = digits ? parseInt(digits, 10) : NaN
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

export function sortPurchaseHistoryByMode(
  items: PurchaseHistoryItem[],
  mode: PurchaseBillSort,
): PurchaseHistoryItem[] {
  const list = [...items]
  list.sort((a, b) => {
    if (mode === 'no1') {
      const rank = (item: PurchaseHistoryItem) =>
        item.billType === 'gst' || item.billType === 'both' ? 0 : 1
      const diff = rank(a) - rank(b)
      if (diff !== 0) return diff
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }
    if (mode === 'no2') {
      const rank = (item: PurchaseHistoryItem) =>
        item.billType === 'no-gst' || item.billType === 'both' ? 0 : 1
      const diff = rank(a) - rank(b)
      if (diff !== 0) return diff
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }
    if (mode === 'billNo') {
      const diff = billNoSortKey(a.billNo) - billNoSortKey(b.billNo)
      if (diff !== 0) return diff
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }
    const diff = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    return mode === 'newest' ? -diff : diff
  })
  return list
}

export type PurchaseCreditBillSort = 'newest' | 'oldest' | 'no1' | 'no2' | 'billNo'

export function sortPurchaseCreditItems(
  items: PurchaseCreditItem[],
  mode: PurchaseCreditBillSort,
): PurchaseCreditItem[] {
  const list = [...items]
  list.sort((a, b) => {
    if (mode === 'no1') {
      const diff = (a.billNumber === 1 ? 0 : 1) - (b.billNumber === 1 ? 0 : 1)
      if (diff !== 0) return diff
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    }
    if (mode === 'no2') {
      const diff = (a.billNumber === 2 ? 0 : 1) - (b.billNumber === 2 ? 0 : 1)
      if (diff !== 0) return diff
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    }
    if (mode === 'billNo') {
      const diff = billNoSortKey(a.billNo) - billNoSortKey(b.billNo)
      if (diff !== 0) return diff
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    }
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime()
    return mode === 'newest' ? -diff : diff
  })
  return list
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

export interface BulkCreditPaySelection {
  id: string
  amount: number
}

/** Build per-bill credit payments for bulk pay (full clear on each selected bill). */
export function buildBulkCreditPaymentPlan(
  selections: BulkCreditPaySelection[],
  mode: 'cash' | 'bank' | 'cheque' | 'split',
  split?: { cash: number; bank: number; cheque: number; chequeApproved?: boolean },
): Array<{ id: string; payment: CreditPaymentInput }> {
  const ordered = [...selections].filter((row) => row.amount > 0)
  if (ordered.length === 0) return []

  if (mode === 'cash' || mode === 'bank' || mode === 'cheque') {
    return ordered.map((row) => ({
      id: row.id,
      payment: {
        payType: mode,
        payAmount: row.amount,
        chequeApproved: mode === 'cheque' ? true : undefined,
      },
    }))
  }

  let cashLeft = Math.max(0, split?.cash ?? 0)
  let bankLeft = Math.max(0, split?.bank ?? 0)
  let chequeLeft = split?.chequeApproved === false ? 0 : Math.max(0, split?.cheque ?? 0)
  const chequeApproved = split?.chequeApproved ?? true
  const out: Array<{ id: string; payment: CreditPaymentInput }> = []

  for (const row of ordered) {
    let due = row.amount
    const fromCash = Math.min(due, cashLeft)
    cashLeft -= fromCash
    due -= fromCash
    const fromBank = Math.min(due, bankLeft)
    bankLeft -= fromBank
    due -= fromBank
    const fromCheque = Math.min(due, chequeLeft)
    chequeLeft -= fromCheque
    due -= fromCheque
    const paid = fromCash + fromBank + fromCheque
    if (paid <= 0) continue

    const modes = [fromCash > 0, fromBank > 0, fromCheque > 0].filter(Boolean).length
    const payType =
      modes > 1 ? 'split' : fromCash > 0 ? 'cash' : fromBank > 0 ? 'bank' : 'cheque'

    out.push({
      id: row.id,
      payment: {
        payType,
        payAmount: paid,
        cashAmount: fromCash || undefined,
        bankAmount: fromBank || undefined,
        chequeAmount: fromCheque || undefined,
        chequeApproved: fromCheque > 0 ? chequeApproved : undefined,
      },
    })
  }

  return out
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
  return PURCHASE_CASH_LABEL
}

function purchasePayDetail(expense: Expense): string {
  if (expense.payType === 'split') {
    const parts: string[] = []
    if ((expense.cashAmount ?? 0) > 0) {
      parts.push(`💵 ${PURCHASE_CASH_LABEL} ${formatMoney(expense.cashAmount ?? 0)}`)
    }
    if ((expense.bankAmount ?? 0) > 0) {
      parts.push(`🏦 Bank ${formatMoney(expense.bankAmount ?? 0)}`)
    }
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
  return `💵 ${PURCHASE_CASH_LABEL} ${formatMoney(expense.amount)}`
}

function buildPurchaseCreditItemsUncached(data: AppData): PurchaseCreditItem[] {
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
      billNumber: expense.billNumber === 2 ? 2 : 1,
      billNo: expense.billNo,
      payType: expense.payType,
    })
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export const buildPurchaseCreditItems = memoByDataRef(buildPurchaseCreditItemsUncached)

export interface PurchaseCreditSupplierGroup {
  shopName: string
  shopKey: string
  creditTotal: number
  creditCount: number
  no1CreditTotal: number
  no2CreditTotal: number
  no1Count: number
  no2Count: number
  items: PurchaseCreditItem[]
}

export interface PurchaseCreditSummary {
  creditTotal: number
  no1CreditTotal: number
  no2CreditTotal: number
  creditCount: number
  no1Count: number
  no2Count: number
  paidTotal: number
  billTotal: number
}

export function purchaseCreditMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

const PURCHASE_CREDIT_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function formatPurchaseCreditMonthLabel(monthKey: string): string {
  const [yearText, monthText] = monthKey.split('-')
  const month = Number(monthText)
  const year = Number(yearText)
  if (!month || !year) return monthKey
  return `${PURCHASE_CREDIT_MONTH_NAMES[month - 1] ?? monthText} ${year}`
}

export function summarizePurchaseCreditItems(items: PurchaseCreditItem[]): PurchaseCreditSummary {
  return items.reduce(
    (acc, item) => {
      acc.creditTotal += item.amount
      acc.creditCount += 1
      acc.paidTotal += item.paidAmount
      acc.billTotal += item.billTotal
      if (item.billNumber === 2) {
        acc.no2CreditTotal += item.amount
        acc.no2Count += 1
      } else {
        acc.no1CreditTotal += item.amount
        acc.no1Count += 1
      }
      return acc
    },
    {
      creditTotal: 0,
      no1CreditTotal: 0,
      no2CreditTotal: 0,
      creditCount: 0,
      no1Count: 0,
      no2Count: 0,
      paidTotal: 0,
      billTotal: 0,
    },
  )
}

export function listPurchaseCreditMonthOptions(
  items: PurchaseCreditItem[],
): { key: string; label: string }[] {
  const keys = new Set<string>()
  for (const item of items) keys.add(purchaseCreditMonthKey(item.date))
  return Array.from(keys)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: formatPurchaseCreditMonthLabel(key) }))
}

export function filterPurchaseCreditItemsByMonth(
  items: PurchaseCreditItem[],
  monthKey: string | 'all',
): PurchaseCreditItem[] {
  if (monthKey === 'all') return items
  return items.filter((item) => purchaseCreditMonthKey(item.date) === monthKey)
}

export function getSupplierOpenCreditTotal(data: AppData, supplierName: string): number {
  const key = supplierName.trim().toLowerCase()
  if (!key) return 0
  const group = groupPurchaseCreditsBySupplier(buildPurchaseCreditItems(data)).find(
    (entry) => entry.shopKey === key,
  )
  return group?.creditTotal ?? 0
}

export function groupPurchaseCreditsBySupplier(items: PurchaseCreditItem[]): PurchaseCreditSupplierGroup[] {
  const map = new Map<string, PurchaseCreditSupplierGroup>()

  for (const item of items) {
    const shopKey = item.shopName.trim().toLowerCase() || 'supplier'
    const group = map.get(shopKey) ?? {
      shopName: item.shopName.trim() || 'Supplier',
      shopKey,
      creditTotal: 0,
      creditCount: 0,
      no1CreditTotal: 0,
      no2CreditTotal: 0,
      no1Count: 0,
      no2Count: 0,
      items: [],
    }
    group.creditTotal += item.amount
    group.creditCount += 1
    if (item.billNumber === 2) {
      group.no2CreditTotal += item.amount
      group.no2Count += 1
    } else {
      group.no1CreditTotal += item.amount
      group.no1Count += 1
    }
    group.items.push(item)
    map.set(shopKey, group)
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    }))
    .sort((a, b) => b.creditTotal - a.creditTotal)
}

export function matchesPurchaseCreditItem(item: PurchaseCreditItem, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim()
  const haystack = [
    item.shopName,
    item.description,
    item.billNo,
    item.billLabel,
    item.payLabel,
    item.payDetail,
    formatMoney(item.amount),
    formatMoney(item.paidAmount),
    formatMoney(item.billTotal),
    formatDate(item.date),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

export function matchesPurchaseCreditSupplier(group: PurchaseCreditSupplierGroup, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim()
  if (group.shopName.toLowerCase().includes(q)) return true
  return group.items.some((item) => matchesPurchaseCreditItem(item, q))
}

export function purchaseExpensePaymentModes(expense: Expense): Array<
  'cash' | 'bank' | 'credit' | 'cheque' | 'split'
> {
  if (expense.payType === 'split') {
    const modes: Array<'cash' | 'bank' | 'credit' | 'cheque' | 'split'> = ['split']
    if ((expense.cashAmount ?? 0) > 0) modes.push('cash')
    if ((expense.bankAmount ?? 0) > 0) modes.push('bank')
    if ((expense.creditAmount ?? 0) > 0) modes.push('credit')
    if ((expense.chequeAmount ?? 0) > 0) modes.push('cheque')
    return modes
  }
  return [expense.payType]
}

function buildPurchaseHistoryItemsUncached(data: AppData): PurchaseHistoryItem[] {
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
        billNo: no1.billNo ?? no2.billNo,
        billType: 'both',
        billLabel: `${purchaseBillLabel(1)} + ${purchaseBillLabel(2)}`,
        payLabel: 'Both bills',
        payDetail: `No 1: ${purchasePayDetail(no1)} · No 2: ${purchasePayDetail(no2)}`,
        date: latestPurchaseActivityTime(no1, no2),
        billDate:
          purchaseExpenseSupplierBillDate(no1) ?? purchaseExpenseSupplierBillDate(no2),
        createdAt: no1.createdAt,
        updatedAt: latestPurchaseActivityTime(no1, no2),
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
      billNo: expense.billNo,
      billType: gst ? 'gst' : 'no-gst',
      billLabel: gst ? purchaseBillLabel(1) : purchaseBillLabel(2),
      payLabel: purchasePayLabel(expense),
      payDetail: purchasePayDetail(expense),
      date: purchaseExpenseActivityTime(expense),
      billDate: purchaseExpenseSupplierBillDate(expense),
      createdAt: expense.createdAt,
      updatedAt: purchaseExpenseActivityTime(expense),
      hasOpenCredit: credit.open,
      openCreditAmount: credit.open ? credit.amount : undefined,
      openCreditExpenseId: credit.open ? credit.expenseId : undefined,
    })
  }

  return sortPurchaseHistoryItems(items)
}

export const buildPurchaseHistoryItems = memoByDataRef(buildPurchaseHistoryItemsUncached)

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

export function getTopPurchaseShops(
  items: PurchaseHistoryItem[],
  paidOnly = false,
  limit = 10,
): TopPurchaseShop[] {
  const byShop = new Map<string, TopPurchaseShop>()

  for (const item of items) {
    const total = paidOnly ? item.paidAmount : item.amount
    const gstTotal = paidOnly ? item.paidNo1Amount : item.no1Amount
    const noGstTotal = paidOnly ? item.paidNo2Amount : item.no2Amount
    if (paidOnly && total <= 0) continue
    const key = item.shopName.trim().toLowerCase()
    if (!key) continue
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

  return Array.from(byShop.values())
    .filter((entry) => entry.shopName.trim().length > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export function getTopPurchaseShop(
  items: PurchaseHistoryItem[],
  paidOnly = false,
): TopPurchaseShop | null {
  return getTopPurchaseShops(items, paidOnly, 1)[0] ?? null
}

export function summarizeTodayPaid(items: PurchaseHistoryItem[]): number {
  return items
    .filter((item) => matchesCashDateFilter(item.date, 'today', ''))
    .reduce((sum, item) => sum + item.paidAmount, 0)
}

export function filterPurchaseHistoryItems(
  items: PurchaseHistoryItem[],
  dateFilter: PurchaseDateFilter | 'monthPick',
  selectedDate: string,
  rangeTo?: string,
): PurchaseHistoryItem[] {
  if (dateFilter === 'monthPick') {
    if (!selectedDate) return items
    return filterPurchaseHistoryItemsByMonth(items, selectedDate)
  }
  return items.filter((item) => matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo))
}

export function listPurchaseHistoryMonthOptions(
  items: PurchaseHistoryItem[],
): { key: string; label: string }[] {
  const keys = new Set<string>()
  for (const item of items) keys.add(purchaseCreditMonthKey(item.date))
  return Array.from(keys)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: formatPurchaseCreditMonthLabel(key) }))
}

export function filterPurchaseHistoryItemsByMonth(
  items: PurchaseHistoryItem[],
  monthKey: string,
): PurchaseHistoryItem[] {
  if (!monthKey) return items
  return items.filter((item) => purchaseCreditMonthKey(item.date) === monthKey)
}

export function matchesPurchaseHistorySearch(item: PurchaseHistoryItem, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim()
  const haystack = [
    item.shopName,
    item.description,
    item.billNo,
    item.billLabel,
    item.payLabel,
    item.payDetail,
    formatMoney(item.amount),
    formatMoney(item.no1Amount),
    formatMoney(item.no2Amount),
    formatDate(item.date),
    item.billDate,
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
      items: group.items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    }))
    .sort((a, b) => b.total - a.total)
}

export function sortPurchaseSupplierGroups(
  groups: PurchaseSupplierGroup[],
  order: 'spend' | 'name',
): PurchaseSupplierGroup[] {
  const sorted = [...groups]
  if (order === 'name') {
    sorted.sort((a, b) => a.shopName.localeCompare(b.shopName, undefined, { sensitivity: 'base' }))
  } else {
    sorted.sort((a, b) => b.total - a.total)
  }
  return sorted
}

export function purchaseItemPaidChannel(
  data: AppData,
  item: PurchaseHistoryItem,
): { cash: number; bank: number } {
  const expense = data.expenses.find((entry) => entry.id === item.id)
  if (!expense) return { cash: 0, bank: 0 }
  const paid = purchasePaidComponents(expense)
  return { cash: paid.cash, bank: paid.bank + paid.cheque }
}

export function purchaseItemMatchesPayChannel(
  data: AppData,
  item: PurchaseHistoryItem,
  channel: 'all' | 'cash' | 'bank',
): boolean {
  if (channel === 'all') return true
  const parts = purchaseItemPaidChannel(data, item)
  if (channel === 'cash') return parts.cash > 0
  return parts.bank > 0
}
