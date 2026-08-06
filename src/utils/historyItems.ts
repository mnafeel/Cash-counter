import type { AppData, Expense, Sale } from '../types'
import { expenseBillTag, isPurchaseExpense } from './expenseBillLabels'
import { formatDate, formatMoney } from './format'
import { decorateLoan, loanRemainingAmount, loanSettlementEvents } from './loanLedger'
import { buildPurchaseHistoryItems, purchaseExpensePaymentModes, type PurchaseHistoryItem } from './purchaseHistory'
import { getSaleCustomerName } from './saleCustomerName'

export type HistoryItemType = 'sale' | 'expense' | 'purchase' | 'deposit' | 'transfer' | 'loan'

export type HistoryFilter = 'all' | HistoryItemType

export type HistoryPaymentMode =
  | 'cash'
  | 'bank'
  | 'credit'
  | 'cheque'
  | 'split'
  | 'pending'

export type HistoryPaymentFilter = 'all' | HistoryPaymentMode

export interface HistoryReceiptLine {
  label: string
  amount: number
  status: 'paid' | 'pending'
  detail?: string
  /** @deprecated use paidAt */
  date?: string
  createdAt?: string
  paidAt?: string
}

export interface HistoryReceiptEvent {
  label: string
  date: string
  amount?: number
  detail?: string
  type: 'bill-created' | 'pending-created' | 'collected' | 'pending'
}

export interface HistoryItem {
  type: HistoryItemType
  id: string
  amount: number
  sub: string
  name?: string
  date: string
  isSplitGroup?: boolean
  receiptLines?: HistoryReceiptLine[]
  receiptTimeline?: HistoryReceiptEvent[]
  groupSaleIds?: string[]
  originalBillAmount?: number
  billCreatedAt?: string
  completedAt?: string
  paymentMode?: HistoryPaymentMode
  paymentModes?: HistoryPaymentMode[]
  /** Split bills — compact paid breakdown for list row */
  paySummary?: string
  /** Purchase on credit — open in Purchase to pay supplier */
  hasOpenCredit?: boolean
  openCreditAmount?: number
  openCreditExpenseId?: string
  /** Purchase cash / bank / approved cheque paid (excludes credit). */
  paidAmount?: number
  /** Cash / bank / cheque actually collected on this sale row. */
  collectionBreakdown?: { cash: number; bank: number; cheque: number }
  /** Money collected (partial or full) — used for totals when bill amount differs. */
  collectedAmount?: number
  /** Per-day collections — used to filter history by payment date. */
  paymentCollections?: Array<{
    at: string
    amount: number
    cash: number
    bank: number
    cheque: number
  }>
}

export type HistoryDateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'date'

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Prefer “Today” / “Yesterday” so multi-day cheque updates are easy to scan. */
function formatCollectionDayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (isSameLocalDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameLocalDay(d, yesterday)) return 'Yesterday'
  return formatDate(iso)
}

function isoMatchesHistoryDateFilter(
  iso: string,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
): boolean {
  if (dateFilter === 'all') return true
  const d = new Date(iso)
  const now = new Date()

  if (dateFilter === 'today') return isSameLocalDay(d, now)

  if (dateFilter === 'yesterday') {
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    return isSameLocalDay(d, y)
  }

  if (dateFilter === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return d.getTime() >= start.getTime()
  }

  if (dateFilter === 'date') {
    if (!selectedDate) return true
    const [y, m, day] = selectedDate.split('-').map(Number)
    return isSameLocalDay(d, new Date(y, m - 1, day))
  }

  return true
}

export function matchesHistoryDateFilter(
  item: HistoryItem,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
): boolean {
  if (dateFilter === 'all') return true

  if (item.type === 'sale' && item.paymentCollections && item.paymentCollections.length > 0) {
    if (
      item.paymentCollections.some((collection) =>
        isoMatchesHistoryDateFilter(collection.at, dateFilter, selectedDate),
      )
    ) {
      return true
    }

    const isPending = item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (isPending && item.billCreatedAt) {
      return isoMatchesHistoryDateFilter(item.billCreatedAt, dateFilter, selectedDate)
    }

    return false
  }

  const dateToMatch = item.completedAt ?? item.billCreatedAt ?? item.date
  return isoMatchesHistoryDateFilter(dateToMatch, dateFilter, selectedDate)
}

export function historyItemAmountForDateFilter(
  item: HistoryItem,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
  purchasePaidOnly = false,
): number {
  if (dateFilter === 'all') {
    return historyItemDisplayAmount(item, purchasePaidOnly)
  }

  if (item.type === 'sale' && item.paymentCollections && item.paymentCollections.length > 0) {
    const dayTotal = item.paymentCollections
      .filter((collection) => isoMatchesHistoryDateFilter(collection.at, dateFilter, selectedDate))
      .reduce((sum, collection) => {
        const normalized = normalizeCollectedBreakdown({
          cash: collection.cash,
          bank: collection.bank,
          cheque: collection.cheque,
          total: collection.amount,
        })
        return sum + normalized.total
      }, 0)
    if (dayTotal > 0) return dayTotal

    const isPending = item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (
      isPending &&
      item.billCreatedAt &&
      isoMatchesHistoryDateFilter(item.billCreatedAt, dateFilter, selectedDate)
    ) {
      return 0
    }
  }

  return historyItemDisplayAmount(item, purchasePaidOnly)
}

/** Cash or bank portion for a history row (approved cheque counts as bank). */
export function historyItemChannelAmount(
  item: HistoryItem,
  channel: 'cash' | 'bank',
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): number {
  const breakdown = historyItemCollectionBreakdownForDateFilter(item, dateFilter, selectedDate)
  if (breakdown && (breakdown.cash > 0 || breakdown.bank > 0 || breakdown.cheque > 0)) {
    return channel === 'cash' ? breakdown.cash : breakdown.bank + breakdown.cheque
  }

  if (item.receiptLines && item.receiptLines.length > 0) {
    let sum = 0
    for (const line of item.receiptLines) {
      if (line.status === 'pending') continue
      if (channel === 'cash' && line.label === 'Cash') sum += line.amount
      if (
        channel === 'bank' &&
        (line.label === 'Bank' || line.label === 'Cheque')
      ) {
        sum += line.amount
      }
    }
    if (sum > 0) return sum
  }

  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  const cashOnly =
    modes.includes('cash') &&
    !modes.includes('bank') &&
    !modes.includes('cheque') &&
    !modes.includes('split')
  const bankOnly =
    (modes.includes('bank') || modes.includes('cheque')) &&
    !modes.includes('cash') &&
    !modes.includes('split')

  if (channel === 'cash' && (cashOnly || item.paymentMode === 'cash')) {
    return historyItemAmountForDateFilter(item, dateFilter, selectedDate, item.type === 'purchase')
  }
  if (channel === 'bank' && (bankOnly || item.paymentMode === 'bank' || item.paymentMode === 'cheque')) {
    return historyItemAmountForDateFilter(item, dateFilter, selectedDate, item.type === 'purchase')
  }

  return 0
}

/**
 * Amount for History list/totals — when Cash or Bank filter is on, only that channel.
 */
export function historyItemFilteredAmount(
  item: HistoryItem,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
  paymentFilter: HistoryPaymentFilter = 'all',
  purchasePaidOnly = false,
): number {
  if (paymentFilter === 'cash' || paymentFilter === 'bank') {
    return historyItemChannelAmount(item, paymentFilter, dateFilter, selectedDate)
  }
  return historyItemAmountForDateFilter(item, dateFilter, selectedDate, purchasePaidOnly)
}

export function historyItemCollectionBreakdownForDateFilter(
  item: HistoryItem,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
): { cash: number; bank: number; cheque: number } | undefined {
  if (dateFilter === 'all') return item.collectionBreakdown

  if (item.type !== 'sale' || !item.paymentCollections || item.paymentCollections.length === 0) {
    return item.collectionBreakdown
  }

  const breakdown = { cash: 0, bank: 0, cheque: 0 }
  for (const collection of item.paymentCollections) {
    if (!isoMatchesHistoryDateFilter(collection.at, dateFilter, selectedDate)) continue
    breakdown.cash += collection.cash
    breakdown.bank += collection.bank
    breakdown.cheque += collection.cheque
  }

  const normalized = normalizeCollectedBreakdown({
    cash: breakdown.cash,
    bank: breakdown.bank,
    cheque: breakdown.cheque,
    total: breakdown.cash + breakdown.bank + breakdown.cheque,
  })
  if (normalized.cash > 0 || normalized.bank > 0 || normalized.cheque > 0) {
    return { cash: normalized.cash, bank: normalized.bank, cheque: normalized.cheque }
  }
  return undefined
}

export function getHistoryTypeLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Bill Collected'
  if (type === 'deposit') return 'Money Added'
  if (type === 'transfer') return 'Transfer'
  if (type === 'purchase') return 'Purchase'
  if (type === 'loan') return 'Loan'
  return 'Expense'
}

const PAYMENT_MODE_LABELS: Record<HistoryPaymentMode, string> = {
  cash: 'Cash',
  bank: 'Bank',
  credit: 'Credit',
  cheque: 'Cheque',
  split: 'Split',
  pending: 'Pending',
}

const PAYMENT_MODE_SORT_ORDER: Record<HistoryPaymentMode, number> = {
  cash: 1,
  bank: 2,
  credit: 3,
  cheque: 4,
  split: 5,
  pending: 6,
}

export function getHistoryPaymentLabel(mode: HistoryPaymentMode): string {
  return PAYMENT_MODE_LABELS[mode]
}

export function getHistoryPaymentSortKey(item: HistoryItem): number {
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  if (modes.length === 0) return 99
  return Math.min(...modes.map((mode) => PAYMENT_MODE_SORT_ORDER[mode]))
}

function saleCollectionBreakdown(sale: Sale): { cash: number; bank: number; cheque: number } {
  return saleCollectedComponentBreakdown(sale)
}

function saleCollectionPaymentModes(sale: Sale): HistoryPaymentMode[] {
  const breakdown = saleCollectionBreakdown(sale)
  const modes: HistoryPaymentMode[] = []
  if (breakdown.cash > 0) modes.push('cash')
  if (breakdown.bank > 0) modes.push('bank')
  // Approved cheque is already folded into bank — only pending cheque is its own mode.
  if (breakdown.cheque > 0 && sale.status === 'pending') modes.push('cheque')

  if (modes.length > 1) return ['split', ...modes]
  if (modes.length === 1) return modes

  if (sale.status === 'pending') {
    if (isCreditBill(sale)) return ['credit']
    if (isChequeBill(sale)) return ['cheque']
    return ['pending']
  }

  // Paid cheque → bank (funds cleared).
  if (sale.payType === 'bank' || sale.payType === 'cheque') return ['bank']
  if (sale.payType === 'split') return ['split']
  if (isChequeBill(sale)) return ['bank']
  return ['cash']
}

function salePaymentMode(sale: Sale): HistoryPaymentMode {
  const modes = saleCollectionPaymentModes(sale)
  if (modes.includes('split')) return 'split'
  if (modes.length === 1) return modes[0]
  if (modes.includes('credit')) return 'credit'
  if (modes.includes('cheque')) return 'cheque'
  if (modes.includes('pending')) return 'pending'
  return modes[0] ?? 'cash'
}

function paymentModesFromReceiptLines(
  lines: HistoryReceiptLine[],
): HistoryPaymentMode[] {
  const modes = new Set<HistoryPaymentMode>(['split'])
  for (const line of lines) {
    if (line.label === 'Cash') modes.add('cash')
    if (line.label === 'Bank') modes.add('bank')
    if (line.label === 'Credit') modes.add('credit')
    if (line.label === 'Cheque') {
      // Paid/approved cheque has cleared to bank.
      if (line.status === 'paid') modes.add('bank')
      else modes.add('cheque')
    }
    if (line.status === 'pending') modes.add('pending')
  }
  return [...modes]
}

function isCreditBill(sale: Sale): boolean {
  return (
    sale.pendingPayType === 'credit' ||
    (sale.status === 'pending' && sale.payType === 'credit') ||
    sale.source === 'tally'
  )
}

function isChequeBill(sale: Sale): boolean {
  return (
    sale.pendingPayType === 'cheque' ||
    (sale.status === 'pending' && sale.payType === 'cheque')
  )
}

import {
  getSalePaymentEvents,
  normalizeCollectedBreakdown,
  saleCollectedAmount,
  saleCollectedComponentBreakdown,
  salePendingCreditPaidBreakdown,
  sanitizeSplitParentChildChequeOverlap,
} from './salePayment'

function partialCollectionMethodLabel(sale: Sale): string {
  const { cash, bank, cheque } = salePendingCreditPaidBreakdown(sale)
  const parts: string[] = []
  if (cash > 0) parts.push('Cash')
  if (bank > 0) parts.push('Bank')
  if (cheque > 0) parts.push('Cheque → Bank')
  return parts.join(' + ')
}

function partialCollectionAmountBreakdown(sale: Sale): string {
  const { cash, bank, cheque } = salePendingCreditPaidBreakdown(sale)
  const parts: string[] = []
  if (cash > 0) parts.push(`💵 ${formatMoney(cash)}`)
  if (bank > 0) parts.push(`🏦 ${formatMoney(bank)}`)
  if (cheque > 0) parts.push(`🧾 ${formatMoney(cheque)} → bank`)
  return parts.join(' · ')
}

function partialCollectionDetailLabel(sale: Sale): string {
  const method = partialCollectionMethodLabel(sale)
  const amounts = partialCollectionAmountBreakdown(sale)
  if (method && amounts) return `${method} · ${amounts}`
  if (amounts) return amounts
  return method || 'Partial'
}

function collectedPaymentAmount(sale: Sale): number {
  return saleCollectedAmount(sale)
}

function latestPaidAt(lines: HistoryReceiptLine[]): string | undefined {
  const paidAt = latestIso(lines.filter((line) => line.status === 'paid').map((line) => line.paidAt ?? line.date))
  return paidAt || undefined
}

function childBillKind(sale: Sale): 'credit' | 'cheque' | null {
  if (isCreditBill(sale)) return 'credit'
  if (isChequeBill(sale)) return 'cheque'
  return null
}

function collectionMethodLabel(sale: Sale): string {
  if (sale.status === 'pending') return ''

  const { cash, bank } = saleCollectedComponentBreakdown(sale)

  if (sale.payType === 'cash') return 'Cash'
  if (sale.payType === 'bank') return 'Bank'
  if (sale.payType === 'cheque') return 'Cheque → Bank'

  const parts: string[] = []
  if (cash > 0) parts.push('Cash')
  if (bank > 0) parts.push('Bank')

  if (sale.payType === 'split') {
    return parts.length > 0 ? parts.join(' + ') : 'Split'
  }

  return parts.join(' + ')
}

function balanceBillCollectionDetail(sale: Sale): string | undefined {
  const kind = isCreditBill(sale) ? 'Credit' : isChequeBill(sale) ? 'Cheque' : null
  if (!kind) return paidCollectionDetail(sale)

  if (sale.status === 'pending') return `${kind} bill pending`

  const method = collectionMethodLabel(sale)
  const breakdown = paidCollectionDetail(sale)
  if (sale.payType === 'split' && breakdown) return `${kind} paid · ${breakdown}`
  return `${kind} paid · ${method}`
}

function salePayLabel(sale: Sale): string {
  if (sale.status === 'pending') {
    if (sale.source === 'tally') return '📒 Tally Pending'
    if (sale.payType === 'cheque') return '🧾 Cheque Pending'
    if (sale.payType === 'credit') return '💳 Credit Pending'
    return '📋 Pending'
  }
  if (sale.payType === 'bank') return '🏦 Bank'
  if (sale.payType === 'cheque') return '🧾 Cheque'
  if (sale.payType === 'credit') return '💳 Credit'
  if (sale.payType === 'split') {
    const { cash, bank } = saleCollectedComponentBreakdown(sale)
    const base = `💵 ${formatMoney(cash)} · 🏦 ${formatMoney(bank)}`
    return (sale.creditAmount ?? 0) > 0
      ? `${base} · 💳 ${formatMoney(sale.creditAmount ?? 0)}`
      : base
  }
  return '💵 Cash'
}

function paidCollectionDetail(sale: Sale): string | undefined {
  if (sale.status === 'pending') return 'Pending'
  const { cash, bank } = saleCollectedComponentBreakdown(sale)

  const parts: string[] = []
  if (cash > 0) parts.push(`💵 ${formatMoney(cash)}`)
  if (bank > 0) parts.push(`🏦 ${formatMoney(bank)}`)
  if (parts.length === 0 && sale.payType === 'cash') return `💵 ${formatMoney(sale.billAmount)}`
  if (parts.length === 0 && sale.payType === 'bank') return `🏦 ${formatMoney(sale.billAmount)}`
  if (parts.length === 0 && sale.payType === 'cheque') return `🏦 ${formatMoney(sale.billAmount)}`
  return parts.join(' · ')
}

function buildChildrenMap(sales: Sale[]): Map<string, Sale[]> {
  const map = new Map<string, Sale[]>()
  for (const sale of sales) {
    if (!sale.parentSplitId) continue
    const list = map.get(sale.parentSplitId) ?? []
    list.push(sale)
    map.set(sale.parentSplitId, list)
  }
  return map
}

function latestIso(dates: (string | undefined)[]): string {
  let best = ''
  let bestTime = 0
  for (const iso of dates) {
    if (!iso) continue
    const t = new Date(iso).getTime()
    if (t >= bestTime) {
      bestTime = t
      best = iso
    }
  }
  return best
}

function parentCollectedExcludingChequeChildren(
  parent: Sale,
  children: Sale[],
): { cash: number; bank: number; cheque: number } | null {
  if (parent.status === 'pending') return null
  const breakdown = saleCollectedComponentBreakdown(parent)
  const chequeChildren = children.filter(
    (child) => child.payType === 'cheque' || child.pendingPayType === 'cheque',
  )
  if (chequeChildren.length === 0) {
    return { cash: breakdown.cash, bank: breakdown.bank, cheque: 0 }
  }

  const approvedParentCheque =
    parent.chequeApproved && (parent.chequeAmount ?? 0) > 0 ? parent.chequeAmount ?? 0 : 0
  let bank = breakdown.bank
  let cash = breakdown.cash
  if (approvedParentCheque > 0) {
    bank = Math.max(0, bank - approvedParentCheque)
  } else if (bank > 0 && (parent.cashAmount ?? 0) === 0) {
    const paidChildBank = chequeChildren.reduce((sum, child) => {
      if (child.status === 'pending') return sum
      return sum + saleCollectedComponentBreakdown(child).bank
    }, 0)
    if (paidChildBank > 0 && Math.abs(bank - paidChildBank) < 0.01) bank = 0
  }

  // Drop parent cash that only mirrors the paid cheque child (would 2× / hit cash drawer).
  const paidChildBank = chequeChildren.reduce((sum, child) => {
    if (child.status === 'pending') return sum
    return sum + saleCollectedComponentBreakdown(child).bank
  }, 0)
  if (cash > 0 && paidChildBank > 0 && Math.abs(cash - paidChildBank) < 0.01) {
    const billCap = parent.originalBillAmount
    const totalIfKeep = cash + bank + paidChildBank
    const exceedsBill = billCap != null && billCap > 0 && totalIfKeep > billCap + 0.01
    const billIsJustTheCheque =
      billCap != null && billCap > 0 && Math.abs(billCap - paidChildBank) < 0.01
    if (exceedsBill || billIsJustTheCheque) {
      cash = 0
    }
  }

  return { cash, bank, cheque: 0 }
}

function buildSplitReceiptLines(parent: Sale, children: Sale[]): HistoryReceiptLine[] {
  const lines: HistoryReceiptLine[] = []
  const childTypes = new Set(children.map((c) => c.payType))
  const parentPaidAt = parent.updatedAt ?? parent.createdAt
  const parentCollected = parentCollectedExcludingChequeChildren(parent, children)

  if (parent.status !== 'pending' && parentCollected) {
    if (parentCollected.cash > 0) {
      lines.push({
        label: 'Cash',
        amount: parentCollected.cash,
        status: 'paid',
        detail: '💵 Collected at counter',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }

    if (parentCollected.bank > 0) {
      lines.push({
        label: 'Bank',
        amount: parentCollected.bank,
        status: 'paid',
        detail: '🏦 Collected to bank',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
    const pendingCheque =
      (parent.chequeAmount ?? 0) > 0 && !parent.chequeApproved && !childTypes.has('cheque')
    if (pendingCheque) {
      lines.push({
        label: 'Cheque',
        amount: parent.chequeAmount ?? 0,
        status: 'pending',
        detail: '🧾 Cheque pending',
        createdAt: parent.createdAt,
        date: parent.createdAt,
      })
    }
    if ((parent.creditAmount ?? 0) > 0 && !childTypes.has('credit')) {
      lines.push({
        label: 'Credit',
        amount: parent.creditAmount ?? 0,
        status: 'paid',
        detail: '💳 Credit on split',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
  }

  for (const child of children) {
    const kind = childBillKind(child)
    const childCollected = collectedPaymentAmount(child)
    const paidToBank = kind === 'cheque' && child.status !== 'pending'
    const label = paidToBank
      ? 'Bank'
      : kind === 'credit'
        ? 'Credit'
        : kind === 'cheque'
          ? 'Cheque'
          : 'Bill'
    const hasPartial =
      child.status === 'pending' &&
      childCollected > 0 &&
      child.updatedAt != null &&
      child.updatedAt !== child.createdAt
    const paidAt = child.status !== 'pending' ? child.updatedAt ?? child.createdAt : undefined

    if (hasPartial) {
      lines.push({
        label: 'Paid',
        amount: childCollected,
        status: 'paid',
        detail: partialCollectionDetailLabel(child),
        createdAt: child.createdAt,
        paidAt: child.updatedAt,
        date: child.updatedAt,
      })
    }

    lines.push({
      label,
      amount: child.status === 'pending' ? child.billAmount : childCollected || child.billAmount,
      status: child.status === 'pending' ? 'pending' : 'paid',
      detail: paidToBank
        ? '🧾 Cheque approved to bank'
        : child.status === 'pending'
          ? `${kind === 'credit' ? 'Credit' : kind === 'cheque' ? 'Cheque' : 'Bill'} bill pending`
          : balanceBillCollectionDetail(child) ?? paidCollectionDetail(child),
      createdAt: child.createdAt,
      paidAt,
      date: paidAt,
    })
  }

  return lines
}

function buildSplitTimeline(parent: Sale, children: Sale[]): HistoryReceiptEvent[] {
  const events: HistoryReceiptEvent[] = [
    {
      label: 'Bill created',
      date: parent.createdAt,
      amount: parent.originalBillAmount ?? parent.billAmount,
      type: 'bill-created',
    },
  ]

  const parentPaidAt = parent.updatedAt ?? parent.createdAt
  const parentCollected = parentCollectedExcludingChequeChildren(parent, children)

  if (parent.status !== 'pending' && parentCollected) {
    if (parentCollected.cash > 0) {
      events.push({
        label: 'Cash collected',
        date: parentPaidAt,
        amount: parentCollected.cash,
        type: 'collected',
      })
    }
    if (parentCollected.bank > 0) {
      events.push({
        label: 'Bank collected',
        date: parentPaidAt,
        amount: parentCollected.bank,
        type: 'collected',
      })
    }
  }

  for (const child of children) {
    const kind = childBillKind(child)
    const part = kind === 'credit' ? 'Credit' : kind === 'cheque' ? 'Cheque' : 'Bill'
    const childBillAmount = child.originalBillAmount ?? child.billAmount
    events.push({
      label: `${part} bill created`,
      date: child.createdAt,
      amount: childBillAmount,
      type: child.status === 'pending' ? 'pending' : 'pending-created',
    })

    const childPayments = getSalePaymentEvents(child).filter((event) => event.amount > 0)
    childPayments.forEach((event, index) => {
      const normalized = normalizeCollectedBreakdown({
        cash: event.cash ?? 0,
        bank: event.bank ?? 0,
        cheque: event.cheque ?? 0,
        total: event.amount,
      })
      const ordinal =
        index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`
      let label: string
      if (kind === 'cheque' && normalized.cash <= 0) {
        label =
          childPayments.length <= 1
            ? 'Cheque approved to bank'
            : `${ordinal} cheque approved to bank`
      } else {
        const method = normalized.cash > 0 && normalized.bank > 0
          ? 'Cash + Bank'
          : normalized.cash > 0
            ? 'Cash'
            : 'Bank'
        label =
          childPayments.length <= 1
            ? `${part} payment · ${method}`
            : `${ordinal} ${part.toLowerCase()} payment · ${method}`
      }
      events.push({
        label,
        date: event.at,
        amount: normalized.total,
        type: 'collected',
      })
    })

    if (child.status === 'pending') {
      events.push({
        label: `${part} pending`,
        date:
          childPayments.length > 0
            ? childPayments[childPayments.length - 1].at
            : child.createdAt,
        amount: child.billAmount,
        type: 'pending',
      })
    } else if (childPayments.length === 0) {
      const paidAt = child.updatedAt ?? child.createdAt
      const collected = collectedPaymentAmount(child)
      if (kind === 'cheque') {
        events.push({
          label: 'Cheque approved to bank',
          date: paidAt,
          amount: collected,
          type: 'collected',
        })
      } else {
        const method = collectionMethodLabel(child)
        const detail = paidCollectionDetail(child)
        events.push({
          label: kind
            ? `${part} paid · ${method}${detail ? ` · ${detail}` : ''}`
            : `${part} paid${detail ? ` · ${detail}` : ''}`,
          date: paidAt,
          amount: collected,
          type: 'collected',
        })
      }
    }
  }

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function splitPartsTarget(parent: Sale, children: Sale[]): number {
  const chequeApproved =
    parent.chequeApproved && (parent.chequeAmount ?? 0) > 0 ? parent.chequeAmount ?? 0 : 0
  const chequePending =
    !parent.chequeApproved && (parent.chequeAmount ?? 0) > 0 ? parent.chequeAmount ?? 0 : 0
  let bank = parent.bankAmount ?? 0
  if (chequeApproved > 0) bank = Math.max(0, bank - chequeApproved)
  const parentParts =
    (parent.cashAmount ?? 0) + bank + chequeApproved + chequePending + (parent.creditAmount ?? 0)
  const childTotal = children.reduce((sum, child) => sum + child.billAmount, 0)
  if (parentParts + childTotal > 0) return parentParts + childTotal
  return parent.billAmount
}

function splitGroupCollectionBreakdown(
  parent: Sale,
  children: Sale[],
): { cash: number; bank: number; cheque: number } {
  const parentCollected = parentCollectedExcludingChequeChildren(parent, children)
  let cash = parentCollected?.cash ?? 0
  let bank = parentCollected?.bank ?? 0
  for (const child of children) {
    const b = saleCollectedComponentBreakdown(child)
    cash += b.cash
    bank += b.bank
  }
  return { cash, bank, cheque: 0 }
}

function splitGroupMoneyCollected(parent: Sale, children: Sale[]): number {
  const breakdown = splitGroupCollectionBreakdown(parent, children)
  return breakdown.cash + breakdown.bank
}

function formatSplitPaymentBreakdown(lines: HistoryReceiptLine[]): string {
  const parts: string[] = []
  for (const line of lines) {
    if (line.status !== 'paid') continue
    if (line.label === 'Cash') parts.push(`💵 ${formatMoney(line.amount)}`)
    else if (line.label === 'Bank') parts.push(`🏦 ${formatMoney(line.amount)}`)
    else if (line.label === 'Cheque') {
      // Should not appear as paid after normalize, but treat as bank if it does.
      parts.push(`🏦 ${formatMoney(line.amount)}`)
    } else if (line.label === 'Credit') parts.push(`💳 ${formatMoney(line.amount)}`)
  }
  return parts.join(' · ')
}

function formatSplitSub(
  parent: Sale,
  children: Sale[],
  lines: HistoryReceiptLine[],
  fullBill: number,
): string {
  const collectTarget = splitPartsTarget(parent, children)
  const paidBreakdown = formatSplitPaymentBreakdown(lines)
  const pendingLines = lines.filter((line) => line.status === 'pending')
  const latestPaid = latestPaidAt(lines)
  const moneyCollected = splitGroupMoneyCollected(parent, children)

  let sub = `Split · Bill ${formatMoney(fullBill)}`
  if (collectTarget > 0 && collectTarget !== fullBill) {
    sub += ` · Round ${formatMoney(collectTarget)}`
  }
  if (paidBreakdown) {
    sub += ` · Paid ${paidBreakdown}`
  }
  if (moneyCollected > 0) {
    sub += ` · Collected ${formatMoney(moneyCollected)}`
  }
  if (pendingLines.length > 0) {
    sub += ` · ${pendingLines.map((line) => `${line.label} ${formatMoney(line.amount)} pending`).join(' · ')}`
  }
  if (latestPaid) sub += ` · ${formatDate(latestPaid)}`
  return sub
}

function buildSyntheticSplitParent(children: Sale[]): Sale {
  const earliest = children.reduce((a, b) =>
    new Date(a.createdAt).getTime() < new Date(b.createdAt).getTime() ? a : b,
  )
  const fullBill =
    earliest.originalBillAmount ?? children.reduce((sum, child) => sum + child.billAmount, 0)
  const creditChild = children.find((c) => c.payType === 'credit')
  const chequeChild = children.find((c) => c.payType === 'cheque')

  return {
    id: `split-group-${children
      .map((c) => c.id)
      .sort()
      .join('-')}`,
    billAmount: children
      .filter((c) => c.status === 'paid')
      .reduce((sum, c) => sum + c.billAmount, 0),
    originalBillAmount: fullBill,
    paidAmount: 0,
    changeAmount: 0,
    payType: 'split',
    chequeAmount: chequeChild?.billAmount,
    creditAmount: creditChild?.billAmount,
    customerName: earliest.customerName,
    createdAt: earliest.createdAt,
    status: children.every((c) => c.status === 'paid') ? 'paid' : 'pending',
  }
}

function findOrphanSplitGroups(sales: Sale[], consumedIds: Set<string>): Sale[][] {
  const orphans = sales.filter(
    (sale) =>
      !sale.parentSplitId &&
      !consumedIds.has(sale.id) &&
      (sale.payType === 'credit' || sale.payType === 'cheque') &&
      (sale.originalBillAmount ?? 0) > 0,
  )
  const groups: Sale[][] = []
  const used = new Set<string>()

  for (const sale of orphans) {
    if (used.has(sale.id)) continue
    const created = new Date(sale.createdAt).getTime()
    const matches = orphans.filter(
      (other) =>
        !used.has(other.id) &&
        other.id !== sale.id &&
        other.originalBillAmount === sale.originalBillAmount &&
        (other.customerName ?? '') === (sale.customerName ?? '') &&
        Math.abs(new Date(other.createdAt).getTime() - created) <= 120_000,
    )

    if (matches.length === 0) continue

    const group = [sale, ...matches]
    const partsTotal = group.reduce((sum, child) => sum + child.billAmount, 0)
    if (partsTotal > (sale.originalBillAmount ?? partsTotal)) continue

    for (const child of group) used.add(child.id)
    groups.push(group)
  }

  return groups
}

function buildSplitGroupItem(parent: Sale, children: Sale[], sales: Sale[]): HistoryItem {
  const receiptLines = buildSplitReceiptLines(parent, children)
  const receiptTimeline = buildSplitTimeline(parent, children)
  const breakdown = splitGroupCollectionBreakdown(parent, children)
  const fullBill =
    parent.originalBillAmount ??
    children[0]?.originalBillAmount ??
    (receiptLines.reduce((sum, line) => sum + line.amount, 0) || parent.billAmount)

  const groupSaleIds = [parent.id, ...children.map((c) => c.id)]
  const allPaid =
    parent.status !== 'pending' && children.every((c) => c.status !== 'pending')
  const moneyCollected = splitGroupMoneyCollected(parent, children)
  const displayAmount = moneyCollected > 0 ? moneyCollected : fullBill
  const completedAt = allPaid
    ? latestIso([
        parent.updatedAt ?? parent.createdAt,
        ...children.map((c) => c.updatedAt ?? c.createdAt),
      ])
    : undefined
  const date = latestIso([
    parent.updatedAt ?? parent.createdAt,
    ...children.map((c) => (c.status !== 'pending' ? c.updatedAt ?? c.createdAt : c.createdAt)),
  ])
  const paymentCollections = [parent, ...children].flatMap((sale) =>
    buildSalePaymentCollections(sale) ?? [],
  )

  return {
    type: 'sale',
    id: parent.id,
    amount: displayAmount,
    sub: formatSplitSub(parent, children, receiptLines, fullBill),
    name:
      getSaleCustomerName(parent, sales) ??
      children.map((child) => getSaleCustomerName(child, sales)).find(Boolean),
    date: date || parent.createdAt,
    isSplitGroup: true,
    receiptLines,
    receiptTimeline,
    groupSaleIds,
    originalBillAmount: fullBill,
    collectedAmount: moneyCollected > 0 ? moneyCollected : undefined,
    collectionBreakdown:
      breakdown.cash > 0 || breakdown.bank > 0
        ? { cash: breakdown.cash, bank: breakdown.bank, cheque: 0 }
        : undefined,
    paymentCollections: paymentCollections.length > 0 ? paymentCollections : undefined,
    billCreatedAt: parent.createdAt,
    completedAt,
    paymentMode: 'split',
    paymentModes: paymentModesFromReceiptLines(receiptLines),
    paySummary:
      moneyCollected > 0
        ? `Paid ${formatMoney(moneyCollected)}`
        : formatSplitPaymentBreakdown(receiptLines) || undefined,
  }
}

function saleReceiptLabel(sale: Sale): string {
  if (isCreditBill(sale)) return sale.status === 'pending' ? 'Credit' : 'Credit'
  if (isChequeBill(sale)) {
    // Approved / paid cheque is bank money.
    return sale.status === 'paid' ? 'Bank' : 'Cheque'
  }
  if (sale.payType === 'bank') return 'Bank'
  if (sale.payType === 'cheque') return sale.status === 'paid' ? 'Bank' : 'Cheque'
  if (sale.payType === 'split') return 'Split'
  return 'Cash'
}

function buildSaleReceiptLines(sale: Sale): HistoryReceiptLine[] {
  const collected = collectedPaymentAmount(sale)
  const hasPartial =
    sale.status === 'pending' &&
    collected > 0 &&
    sale.updatedAt != null &&
    sale.updatedAt !== sale.createdAt &&
    (isCreditBill(sale) || isChequeBill(sale))
  const paidAt = sale.status !== 'pending' ? sale.updatedAt ?? sale.createdAt : undefined
  const lines: HistoryReceiptLine[] = []

  if (hasPartial) {
    lines.push({
      label: 'Paid',
      amount: collected,
      status: 'paid',
      detail: partialCollectionDetailLabel(sale),
      createdAt: sale.createdAt,
      paidAt: sale.updatedAt,
      date: sale.updatedAt,
    })
  }

  lines.push({
    label: saleReceiptLabel(sale),
    amount: sale.billAmount,
    status: sale.status === 'pending' ? 'pending' : 'paid',
    detail: balanceBillCollectionDetail(sale) ?? salePayLabel(sale),
    createdAt: sale.createdAt,
    paidAt,
    date: paidAt,
  })

  return lines
}

function buildSaleTimeline(sale: Sale): HistoryReceiptEvent[] {
  const billAmount = sale.originalBillAmount ?? sale.billAmount
  const events: HistoryReceiptEvent[] = [
    {
      label: 'Bill created',
      date: sale.createdAt,
      amount: billAmount,
      type: 'bill-created',
    },
  ]

  const paymentEvents = getSalePaymentEvents(sale).filter((event) => event.amount > 0)
  const chequeOrigin = isChequeBill(sale)
  const creditOrigin = isCreditBill(sale)

  paymentEvents.forEach((event, index) => {
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })
    const ordinal =
      index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`
    const methodParts: string[] = []
    if (normalized.cash > 0) methodParts.push('Cash')
    if (normalized.bank > 0) methodParts.push(chequeOrigin ? 'Cheque → Bank' : 'Bank')

    if (event.cancelled) {
      events.push({
        label:
          paymentEvents.filter((e) => (e.bank ?? 0) > 0 || (e.cheque ?? 0) > 0).length <= 1
            ? 'Cheque cancelled'
            : `${ordinal} cheque cancelled`,
        detail: `Was approved ${formatDate(event.at)}`,
        date: event.cancelledAt ?? event.at,
        amount: normalized.total || event.amount,
        type: 'pending',
      })
      return
    }

    let label: string
    if (chequeOrigin && normalized.cash <= 0 && normalized.bank > 0) {
      label =
        paymentEvents.filter((e) => !e.cancelled).length <= 1
          ? 'Cheque approved'
          : `${ordinal} cheque approved`
    } else if (creditOrigin) {
      label =
        paymentEvents.filter((e) => !e.cancelled).length <= 1
          ? `Credit payment${methodParts.length ? ` · ${methodParts.join(' + ')}` : ''}`
          : `${ordinal} credit payment${methodParts.length ? ` · ${methodParts.join(' + ')}` : ''}`
    } else {
      label =
        paymentEvents.filter((e) => !e.cancelled).length <= 1
          ? `Payment${methodParts.length ? ` · ${methodParts.join(' + ')}` : ''}`
          : `${ordinal} payment${methodParts.length ? ` · ${methodParts.join(' + ')}` : ''}`
    }

    events.push({
      label,
      detail:
        normalized.cash > 0 && normalized.bank > 0
          ? `💵 ${formatMoney(normalized.cash)} · 🏦 ${formatMoney(normalized.bank)}`
          : undefined,
      date: event.at,
      amount: normalized.total,
      type: 'collected',
    })
  })

  if (sale.status === 'pending') {
    events.push({
      label: creditOrigin
        ? 'Credit pending'
        : chequeOrigin
          ? 'Cheque pending'
          : `${saleReceiptLabel(sale)} pending`,
      date:
        paymentEvents.length > 0
          ? paymentEvents[paymentEvents.length - 1].at
          : sale.createdAt,
      amount: sale.billAmount,
      type: 'pending',
    })
  } else if (paymentEvents.length === 0) {
    const method = collectionMethodLabel(sale)
    let label = `${saleReceiptLabel(sale)} collected`
    if (creditOrigin) label = `Credit paid · ${method}`
    else if (chequeOrigin) label = `Cheque paid · ${method}`

    events.push({
      label,
      date: sale.updatedAt ?? sale.createdAt,
      amount: collectedPaymentAmount(sale),
      type: 'collected',
    })
  }

  return events
}

function buildSalePaymentCollections(sale: Sale): HistoryItem['paymentCollections'] {
  return getSalePaymentEvents(sale)
    .filter((event) => event.amount > 0 && !event.cancelled)
    .map((event) => {
      const normalized = normalizeCollectedBreakdown({
        cash: event.cash ?? 0,
        bank: event.bank ?? 0,
        cheque: event.cheque ?? 0,
        total: event.amount,
      })
      return {
        at: event.at,
        amount: normalized.total,
        cash: normalized.cash,
        bank: normalized.bank,
        cheque: normalized.cheque,
      }
    })
}

function buildSaleHistoryItem(sale: Sale, sales: Sale[]): HistoryItem {
  const collected = collectedPaymentAmount(sale)
  const breakdown = saleCollectionBreakdown(sale)
  const paymentModes = saleCollectionPaymentModes(sale)
  const paymentCollections = buildSalePaymentCollections(sale)
  const lastCollectionAt =
    paymentCollections && paymentCollections.length > 0
      ? paymentCollections[paymentCollections.length - 1].at
      : undefined
  const paidAt =
    sale.status !== 'pending'
      ? lastCollectionAt ?? sale.updatedAt ?? sale.createdAt
      : lastCollectionAt
  const amount = formatMoney(sale.billAmount)
  let sub: string

  if (isCreditBill(sale)) {
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub =
      sale.status === 'pending'
        ? collected > 0
          ? `Credit · Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(sale)} · ${amount} pending${paidTime ? ` · ${paidTime}` : ''}`
          : `Credit · ${amount} pending`
        : `Credit · Paid ${formatMoney(collected)} · ${collectionMethodLabel(sale)}${paidTime ? ` · ${paidTime}` : ''}`
  } else if (isChequeBill(sale)) {
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub =
      sale.status === 'pending'
        ? collected > 0
          ? `Cheque · Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(sale)} · ${amount} pending${paidTime ? ` · ${paidTime}` : ''}`
          : `Cheque · ${amount} pending`
        : `Bank · Cheque cleared ${formatMoney(collected)} · ${collectionMethodLabel(sale)}${paidTime ? ` · ${paidTime}` : ''}`
  } else {
    const payLabel = salePayLabel(sale)
    const paidDetail = paidCollectionDetail(sale)
    const orig =
      sale.originalBillAmount && sale.originalBillAmount !== sale.billAmount
        ? `Bill ${formatMoney(sale.originalBillAmount)} · Round ${formatMoney(sale.billAmount)} · `
        : ''
    const paidPart =
      sale.status === 'pending'
        ? 'Pending · '
        : sale.payType === 'bank' || sale.payType === 'credit' || sale.payType === 'cheque'
          ? `Paid ${paidDetail ?? payLabel} · `
          : `Give ${formatMoney(sale.paidAmount)} · ${paidDetail ?? payLabel} · `
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub = `${orig}${paidPart}${sale.changeAmount > 0 ? `Change ${formatMoney(sale.changeAmount)} · ` : ''}${paidTime}`.replace(/ · $/, '')
  }

  const totalBill =
    sale.originalBillAmount ??
    ((isCreditBill(sale) || isChequeBill(sale)) && sale.status === 'pending'
      ? sale.billAmount + collected
      : sale.billAmount)
  const paySummary =
    sale.status !== 'pending' && collected > 0
      ? `Paid ${formatMoney(collected)}`
      : sale.status === 'pending' && (isCreditBill(sale) || isChequeBill(sale))
        ? collected > 0
          ? `Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(sale)} · Pending ${formatMoney(sale.billAmount)}`
          : `Pending ${formatMoney(sale.billAmount)}`
        : undefined

  return {
    type: 'sale',
    id: sale.id,
    amount:
      isCreditBill(sale) || isChequeBill(sale) ? totalBill : collected || sale.billAmount,
    originalBillAmount: totalBill,
    collectedAmount: collected > 0 ? collected : undefined,
    collectionBreakdown:
      breakdown.cash > 0 || breakdown.bank > 0 || breakdown.cheque > 0
        ? {
            cash: breakdown.cash,
            bank: breakdown.bank + breakdown.cheque,
            cheque: 0,
          }
        : undefined,
    sub,
    name: getSaleCustomerName(sale, sales),
    date: lastCollectionAt ?? sale.createdAt,
    paymentCollections,
    receiptLines: buildSaleReceiptLines(sale),
    receiptTimeline: buildSaleTimeline(sale),
    billCreatedAt: sale.createdAt,
    completedAt: paidAt,
    paymentMode: salePaymentMode(sale),
    paymentModes,
    paySummary,
    groupSaleIds:
      isCreditBill(sale) || isChequeBill(sale)
        ? sale.parentSplitId
          ? [sale.parentSplitId, sale.id]
          : [sale.id]
        : undefined,
  }
}

function purchaseWasUpdated(item: PurchaseHistoryItem): boolean {
  return item.date !== item.createdAt
}

function formatPurchasePaySummary(item: PurchaseHistoryItem): string | undefined {
  const parts: string[] = []
  if (item.paidAmount > 0) parts.push(`Paid ${formatMoney(item.paidAmount)}`)
  if (item.hasOpenCredit && item.openCreditAmount) {
    parts.push(`Credit ${formatMoney(item.openCreditAmount)}`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function formatPurchaseHistorySub(item: PurchaseHistoryItem): string {
  let sub = `${item.billLabel} · ${item.payLabel}${item.description ? ` · ${item.description}` : ''}`
  if (item.paidAmount > 0) sub += ` · Paid ${formatMoney(item.paidAmount)}`
  if (item.hasOpenCredit && item.openCreditAmount) {
    sub += ` · Credit ${formatMoney(item.openCreditAmount)}`
  }
  if (purchaseWasUpdated(item)) sub += ` · Updated ${formatDate(item.date)}`
  return sub
}

function buildPurchaseReceiptLines(item: PurchaseHistoryItem): HistoryReceiptLine[] {
  const lines: HistoryReceiptLine[] = [
    {
      label: 'Bill total',
      amount: item.amount,
      status: 'pending',
      detail: item.payDetail,
      createdAt: item.createdAt,
      date: item.createdAt,
    },
  ]

  if (item.paidAmount > 0) {
    lines.push({
      label: 'Paid',
      amount: item.paidAmount,
      status: 'paid',
      detail: item.payDetail,
      createdAt: item.createdAt,
      paidAt: purchaseWasUpdated(item) ? item.date : item.createdAt,
      date: purchaseWasUpdated(item) ? item.date : item.createdAt,
    })
  }

  if (item.hasOpenCredit && item.openCreditAmount) {
    lines.push({
      label: 'Credit balance',
      amount: item.openCreditAmount,
      status: 'pending',
      detail: 'Supplier credit remaining',
      createdAt: item.createdAt,
      date: item.createdAt,
    })
  }

  return lines
}

function buildPurchaseTimeline(item: PurchaseHistoryItem): HistoryReceiptEvent[] {
  const events: HistoryReceiptEvent[] = [
    {
      label: 'Purchase',
      date: item.createdAt,
      amount: item.amount,
      type: 'bill-created',
    },
  ]

  if (item.paidAmount > 0) {
    events.push({
      label: purchaseWasUpdated(item) ? 'Credit payment' : 'Paid at purchase',
      date: purchaseWasUpdated(item) ? item.date : item.createdAt,
      amount: item.paidAmount,
      type: 'collected',
    })
  }

  if (item.hasOpenCredit && item.openCreditAmount) {
    events.push({
      label: 'Credit pending',
      date: item.createdAt,
      amount: item.openCreditAmount,
      type: 'pending',
    })
  }

  return events
}

export interface HistoryListPaymentPart {
  mode: 'cash' | 'bank' | 'credit' | 'cheque'
  amount: number
  status: 'paid' | 'pending'
}

const LIST_PAYMENT_PART_ORDER: HistoryListPaymentPart['mode'][] = [
  'cash',
  'bank',
  'cheque',
  'credit',
]

const LIST_PAYMENT_PART_LABELS: Record<HistoryListPaymentPart['mode'], string> = {
  cash: 'Cash',
  bank: 'Bank',
  credit: 'Credit',
  cheque: 'Cheque',
}

export function getHistoryListPaymentPartLabel(mode: HistoryListPaymentPart['mode']): string {
  return LIST_PAYMENT_PART_LABELS[mode]
}

export function getHistoryListPaymentPartIcon(mode: HistoryListPaymentPart['mode']): string {
  if (mode === 'cash') return '💵'
  if (mode === 'bank') return '🏦'
  if (mode === 'credit') return '💳'
  return '🧾'
}

function receiptLinePaymentMode(
  label: string,
  status?: HistoryReceiptLine['status'],
): HistoryListPaymentPart['mode'] | null {
  if (label === 'Cash') return 'cash'
  if (label === 'Bank') return 'bank'
  if (label === 'Cheque') {
    // Approved cheque has cleared — show under bank, not as a separate cheque total.
    return status === 'paid' ? 'bank' : 'cheque'
  }
  if (label === 'Credit' || label === 'Credit balance') return 'credit'
  return null
}

function mergeListPaymentPart(
  bucket: Map<string, HistoryListPaymentPart>,
  mode: HistoryListPaymentPart['mode'],
  amount: number,
  status: HistoryListPaymentPart['status'],
) {
  if (amount <= 0) return
  const key = `${mode}:${status}`
  const existing = bucket.get(key)
  if (existing) existing.amount += amount
  else bucket.set(key, { mode, amount, status })
}

export function getHistoryItemListPaymentParts(
  item: HistoryItem,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): HistoryListPaymentPart[] {
  const bucket = new Map<string, HistoryListPaymentPart>()

  const breakdown = historyItemCollectionBreakdownForDateFilter(item, dateFilter, selectedDate)
  if (breakdown && (breakdown.cash > 0 || breakdown.bank > 0 || breakdown.cheque > 0)) {
    mergeListPaymentPart(bucket, 'cash', breakdown.cash, 'paid')
    // Approved cheque is bank money — never a separate cheque total.
    mergeListPaymentPart(bucket, 'bank', breakdown.bank + breakdown.cheque, 'paid')
    // Keep open pending cheque / credit lines visible alongside collected amounts.
    for (const line of item.receiptLines ?? []) {
      if (line.status !== 'pending') continue
      if (line.label === 'Cheque') mergeListPaymentPart(bucket, 'cheque', line.amount, 'pending')
      if (line.label === 'Credit') mergeListPaymentPart(bucket, 'credit', line.amount, 'pending')
    }
  } else if (item.receiptLines?.length) {
    for (const line of item.receiptLines) {
      if (line.label === 'Paid' || line.label === 'Bill total' || line.label === 'Purchase') {
        continue
      }
      const mode = receiptLinePaymentMode(line.label, line.status)
      if (mode) mergeListPaymentPart(bucket, mode, line.amount, line.status)
    }
  }

  if (bucket.size === 0 && item.paymentMode) {
    const amount = historyItemAmountForDateFilter(item, dateFilter, selectedDate, item.type === 'purchase')
    const pendingFromLines =
      item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (item.paymentMode === 'cash') mergeListPaymentPart(bucket, 'cash', amount, 'paid')
    else if (item.paymentMode === 'bank') mergeListPaymentPart(bucket, 'bank', amount, 'paid')
    else if (item.paymentMode === 'cheque') {
      // Paid cheque → bank; only open cheque bills stay as cheque.
      if (pendingFromLines) mergeListPaymentPart(bucket, 'cheque', amount, 'pending')
      else mergeListPaymentPart(bucket, 'bank', amount, 'paid')
    } else if (item.paymentMode === 'credit') {
      mergeListPaymentPart(bucket, 'credit', amount, pendingFromLines ? 'pending' : 'paid')
    } else if (item.paymentMode === 'pending') {
      mergeListPaymentPart(bucket, 'credit', amount, 'pending')
    }
  }

  if (item.type === 'transfer') {
    return []
  }

  const ordered: HistoryListPaymentPart[] = []
  for (const mode of LIST_PAYMENT_PART_ORDER) {
    const paid = bucket.get(`${mode}:paid`)
    const pending = bucket.get(`${mode}:pending`)
    if (paid) ordered.push(paid)
    if (pending) ordered.push(pending)
  }
  return ordered
}

export function historyItemListPaymentTypeText(
  item: HistoryItem,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
  paymentFilter: HistoryPaymentFilter = 'all',
): string | undefined {
  // Cash / Bank filter: show both sides of a split, selected channel first.
  if (paymentFilter === 'cash' || paymentFilter === 'bank') {
    const cashAmount = historyItemChannelAmount(item, 'cash', dateFilter, selectedDate)
    const bankAmount = historyItemChannelAmount(item, 'bank', dateFilter, selectedDate)
    const parts: string[] = []
    if (paymentFilter === 'cash') {
      if (cashAmount > 0) parts.push(`💵 ${formatMoney(cashAmount)}`)
      if (bankAmount > 0) parts.push(`🏦 ${formatMoney(bankAmount)}`)
    } else {
      if (bankAmount > 0) parts.push(`🏦 ${formatMoney(bankAmount)}`)
      if (cashAmount > 0) parts.push(`💵 ${formatMoney(cashAmount)}`)
    }
    if (parts.length > 0) return parts.join(' · ')
    return undefined
  }

  // Multi-day cheque/credit collections: show each approval with its date.
  if (
    item.type === 'sale' &&
    item.paymentCollections &&
    item.paymentCollections.length > 0
  ) {
    const collections =
      dateFilter === 'all'
        ? item.paymentCollections.filter((c) => c.amount > 0)
        : item.paymentCollections.filter(
            (c) =>
              c.amount > 0 && isoMatchesHistoryDateFilter(c.at, dateFilter, selectedDate),
          )

    if (collections.length > 1 || (dateFilter !== 'all' && collections.length === 1)) {
      const dated = collections.map((collection, index) => {
        const normalized = normalizeCollectedBreakdown({
          cash: collection.cash,
          bank: collection.bank,
          cheque: collection.cheque,
          total: collection.amount,
        })
        const icon =
          normalized.cash > 0 && normalized.bank <= 0
            ? '💵'
            : normalized.bank + normalized.cheque > 0
              ? '🏦'
              : '🧾'
        const ordinal =
          collections.length > 1
            ? `${index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`} `
            : ''
        const when =
          dateFilter === 'all' ? ` · ${formatCollectionDayLabel(collection.at)}` : ''
        return `${ordinal}${icon} ${formatMoney(normalized.total)}${when}`
      })
      if (dated.length > 0) return dated.join(' · ')
    }
  }

  const parts = getHistoryItemListPaymentParts(item, dateFilter, selectedDate)
  if (parts.length > 0) {
    return parts
      .map((part) => {
        const icon = getHistoryListPaymentPartIcon(part.mode)
        const pending = part.status === 'pending' ? ' pending' : ''
        return `${icon} ${formatMoney(part.amount)}${pending}`
      })
      .join(' · ')
  }

  if (item.type === 'purchase') {
    if (item.paySummary) return item.paySummary
    if (item.paymentMode) return getHistoryPaymentLabel(item.paymentMode)
    return undefined
  }

  if (item.type === 'sale') {
    if (item.paySummary) return item.paySummary
    if (item.isSplitGroup) {
      const modes = (item.paymentModes ?? []).filter((mode) => mode !== 'split' && mode !== 'pending')
      if (modes.length > 0) return modes.map(getHistoryPaymentLabel).join(' + ')
      return 'Split'
    }
    if (item.paymentModes && item.paymentModes.length > 1) {
      const modes = item.paymentModes.filter((mode) => mode !== 'split')
      if (modes.length > 1) return modes.map(getHistoryPaymentLabel).join(' + ')
    }
    if (item.paymentMode) return getHistoryPaymentLabel(item.paymentMode)
    return undefined
  }

  if (item.paymentMode) return getHistoryPaymentLabel(item.paymentMode)
  return undefined
}

/** Second line on History list — bill amount / short detail without payment time noise. */
export function historyItemListRowSub(
  item: HistoryItem,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): string {
  if (item.type === 'sale' || item.type === 'purchase') {
    return historyItemListSubtitle(item, dateFilter, selectedDate)
  }
  return item.sub
}

export function historyItemListSubtitle(
  item: HistoryItem,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): string {
  if (item.type === 'sale') {
    const bill = item.originalBillAmount ?? item.amount
    const dayAmount =
      dateFilter === 'all'
        ? 0
        : historyItemAmountForDateFilter(item, dateFilter, selectedDate, false)
    if (item.isSplitGroup) {
      return dayAmount > 0
        ? `Split bill · ${formatMoney(bill)} · Collected ${formatMoney(dayAmount)}`
        : `Split bill · ${formatMoney(bill)}`
    }
    if (dayAmount > 0) {
      return `Bill ${formatMoney(bill)} · Collected ${formatMoney(dayAmount)}`
    }
    const collections = (item.paymentCollections ?? []).filter((c) => c.amount > 0)
    if (collections.length > 1) {
      const parts = collections.map((c, i) => {
        const ordinal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`
        return `${ordinal} ${formatMoney(c.amount)}`
      })
      return `Bill ${formatMoney(bill)} · ${parts.join(' · ')}`
    }
    return `Bill ${formatMoney(bill)}`
  }
  if (item.type === 'purchase') {
    const bill = item.originalBillAmount ?? item.amount
    return `Purchase · ${formatMoney(bill)}`
  }
  if (item.type === 'transfer') return item.sub
  const first = item.sub.split(' · ')[0]
  return first || item.sub
}

export function historyItemActivityLabel(item: HistoryItem): string {
  if (item.billCreatedAt && item.date !== item.billCreatedAt) {
    return `Updated ${formatDate(item.date)}`
  }
  return formatDate(item.date)
}

/** Date line on History list rows — bill created + each collection date when split across days. */
export function historyItemListDateLabel(
  item: HistoryItem,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): string {
  if (item.type === 'sale' && item.paymentCollections && item.paymentCollections.length > 0) {
    const collections = item.paymentCollections.filter((c) => c.amount > 0)
    const inFilter =
      dateFilter === 'all'
        ? collections
        : collections.filter((c) => isoMatchesHistoryDateFilter(c.at, dateFilter, selectedDate))

    if (dateFilter !== 'all' && inFilter.length > 0) {
      const when = formatCollectionDayLabel(inFilter[inFilter.length - 1].at)
      return `Collected ${when}`
    }

    if (collections.length > 1) {
      const created = item.billCreatedAt ? `Bill ${formatDate(item.billCreatedAt)}` : null
      const parts = collections.map((c, i) => {
        const ordinal =
          i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`
        return `${ordinal} ${formatCollectionDayLabel(c.at)}`
      })
      return created ? `${created} · ${parts.join(' · ')}` : parts.join(' · ')
    }

    if (item.billCreatedAt) {
      const created = formatDate(item.billCreatedAt)
      if (collections.length === 1 && collections[0].at !== item.billCreatedAt) {
        return `Created ${created} · Collected ${formatCollectionDayLabel(collections[0].at)}`
      }
      return `Created ${created}`
    }
  }

  if (item.billCreatedAt && (item.type === 'sale' || item.type === 'purchase')) {
    const created = formatDate(item.billCreatedAt)
    if (item.date !== item.billCreatedAt) {
      return `Created ${created} · Updated ${formatDate(item.date)}`
    }
    return `Created ${created}`
  }
  return formatDate(item.date)
}

function buildExpenseReceiptLines(expense: Expense): HistoryReceiptLine[] | undefined {
  if (expense.kind === 'transfer') return undefined

  const lines: HistoryReceiptLine[] = []
  if (expense.payType === 'split') {
    if ((expense.cashAmount ?? 0) > 0) {
      lines.push({
        label: 'Cash',
        amount: expense.cashAmount ?? 0,
        status: 'paid',
      })
    }
    if ((expense.bankAmount ?? 0) > 0) {
      lines.push({
        label: 'Bank',
        amount: expense.bankAmount ?? 0,
        status: 'paid',
      })
    }
    if ((expense.chequeAmount ?? 0) > 0) {
      lines.push({
        label: 'Cheque',
        amount: expense.chequeAmount ?? 0,
        status: expense.chequeApproved ? 'paid' : 'pending',
      })
    }
    if ((expense.creditAmount ?? 0) > 0) {
      lines.push({
        label: 'Credit',
        amount: expense.creditAmount ?? 0,
        status: 'paid',
      })
    }
  } else if (expense.payType === 'bank') {
    lines.push({ label: 'Bank', amount: expense.amount, status: 'paid' })
  } else if (expense.payType === 'cheque') {
    lines.push({
      label: 'Cheque',
      amount: expense.amount,
      status: expense.chequeApproved ? 'paid' : 'pending',
    })
  } else if (expense.payType === 'credit') {
    lines.push({ label: 'Credit', amount: expense.amount, status: 'paid' })
  } else {
    lines.push({ label: 'Cash', amount: expense.amount, status: 'paid' })
  }

  return lines.length > 0 ? lines : undefined
}

function buildPurchaseListReceiptLines(
  item: PurchaseHistoryItem,
  expense?: Expense,
  paired?: Expense,
): HistoryReceiptLine[] {
  const lines: HistoryReceiptLine[] = []

  const addExpenseLines = (entry: Expense) => {
    for (const line of buildExpenseReceiptLines(entry) ?? []) {
      if (line.status === 'paid') lines.push(line)
    }
  }

  if (expense) addExpenseLines(expense)
  if (paired) addExpenseLines(paired)

  if (item.hasOpenCredit && item.openCreditAmount) {
    lines.push({
      label: 'Credit balance',
      amount: item.openCreditAmount,
      status: 'pending',
    })
  }

  return lines.length > 0 ? lines : buildPurchaseReceiptLines(item)
}

export function buildHistoryItems(data: AppData): HistoryItem[] {
  const sales = sanitizeSplitParentChildChequeOverlap(data.sales)
  const childrenByParent = buildChildrenMap(sales)
  const consumedChildIds = new Set<string>()
  const saleItems: HistoryItem[] = []

  for (const sale of sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      saleItems.push(buildSplitGroupItem(sale, children, sales))
      continue
    }

    saleItems.push(buildSaleHistoryItem(sale, sales))
  }

  for (const group of findOrphanSplitGroups(sales, consumedChildIds)) {
    for (const child of group) consumedChildIds.add(child.id)
    saleItems.push(buildSplitGroupItem(buildSyntheticSplitParent(group), group, sales))
  }

  for (const sale of sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    saleItems.push(buildSaleHistoryItem(sale, sales))
  }

  const expenseItems = data.expenses
    .filter((e) => !isPurchaseExpense(e))
    .map((e) => {
    if (e.kind === 'transfer') {
      const toBank = e.transferDirection === 'cash-to-bank'
      return {
        type: 'transfer' as const,
        id: e.id,
        amount: e.amount,
        sub: toBank ? '💵 → 🏦 Cash to bank' : '🏦 → 💵 Bank to cash',
        name: e.name,
        date: e.updatedAt ?? e.createdAt,
        paymentMode: 'cash' as const,
        paymentModes: ['cash', 'bank'] as HistoryPaymentMode[],
      }
    }
    const isAdd = e.kind === 'add'
    const payMode: HistoryPaymentMode =
      e.payType === 'bank'
        ? 'bank'
        : e.payType === 'cheque'
          ? 'cheque'
          : e.payType === 'split'
            ? 'split'
            : 'cash'
    const billTag = e.billNumber ? ` · ${expenseBillTag(e.billNumber)}` : ''
    const giveTag =
      e.giveAmount && e.giveAmount > 0
        ? ` · Give ${formatMoney(e.giveAmount)}${e.changeAmount ? ` · Change ${formatMoney(e.changeAmount)}` : ''}`
        : ''
    const expenseSub =
      e.payType === 'split'
        ? `➗ Split${billTag} · 💵 ${formatMoney(e.cashAmount ?? 0)} + 🏦 ${formatMoney(e.bankAmount ?? 0)}${(e.chequeAmount ?? 0) > 0 ? ` + 🧾 ${formatMoney(e.chequeAmount ?? 0)}${e.chequeApproved ? ' ✓' : ''}` : ''}${giveTag}`
        : e.payType === 'cheque'
          ? `🧾 Cheque expense${billTag}${e.chequeApproved ? ' ✓ Bank' : ' pending'}${giveTag}`
          : e.payType === 'bank'
            ? `🏦 Bank expense${billTag}${giveTag}`
            : `💵 Cash expense${billTag}${giveTag}`
    const addSub =
      e.payType === 'split'
        ? `➗ Split add · 💵 ${formatMoney(e.cashAmount ?? 0)} + 🏦 ${formatMoney(e.bankAmount ?? 0)}`
        : e.payType === 'bank'
          ? '🏦 Added to bank'
          : '💵 Added to counter'
    return {
      type: isAdd ? ('deposit' as const) : ('expense' as const),
      id: e.id,
      amount: e.amount,
      sub: isAdd ? addSub : expenseSub,
      name: e.name,
      date: e.updatedAt ?? e.createdAt,
      paymentMode: payMode,
      paymentModes:
        e.payType === 'split'
          ? ((e.chequeAmount ?? 0) > 0
              ? (['cash', 'bank', 'cheque', 'split'] as HistoryPaymentMode[])
              : (['cash', 'bank', 'split'] as HistoryPaymentMode[]))
          : [payMode],
      receiptLines: buildExpenseReceiptLines(e),
    }
  })

  const purchaseItems: HistoryItem[] = buildPurchaseHistoryItems(data).map((item) => {
    const expense = data.expenses.find((e) => e.id === item.id)
    const paired = expense?.pairedExpenseId
      ? data.expenses.find((e) => e.id === expense.pairedExpenseId)
      : undefined
    const modeSet = new Set<HistoryPaymentMode>()
    if (expense) {
      for (const mode of purchaseExpensePaymentModes(expense)) modeSet.add(mode)
    }
    if (paired) {
      for (const mode of purchaseExpensePaymentModes(paired)) modeSet.add(mode)
    }
    const paymentModes =
      modeSet.size > 0
        ? Array.from(modeSet)
        : item.hasOpenCredit
          ? (['credit'] as HistoryPaymentMode[])
          : undefined
    const paymentMode = paymentModes?.includes('credit')
      ? 'credit'
      : paymentModes?.[0]

    return {
      type: 'purchase' as const,
      id: item.id,
      amount: item.amount,
      paidAmount: item.paidAmount,
      sub: formatPurchaseHistorySub(item),
      name: item.shopName,
      date: item.date,
      billCreatedAt: item.createdAt,
      completedAt: item.paidAmount > 0 ? item.date : item.createdAt,
      originalBillAmount: item.amount,
      receiptLines: buildPurchaseListReceiptLines(item, expense, paired),
      receiptTimeline: buildPurchaseTimeline(item),
      paymentMode,
      paymentModes,
      paySummary: formatPurchasePaySummary(item),
      hasOpenCredit: item.hasOpenCredit,
      openCreditAmount: item.openCreditAmount,
      openCreditExpenseId: item.openCreditExpenseId,
    }
  })

  const loanItems: HistoryItem[] = []
  for (const loan of data.loans ?? []) {
    const decorated = decorateLoan(loan)
    const remaining = loanRemainingAmount(loan)
    const payLabel = loan.paySource === 'bank' ? 'Bank' : 'Cash'
    const payMode: HistoryPaymentMode = loan.paySource === 'bank' ? 'bank' : 'cash'
    const remainingPart = remaining > 0 ? ` · Balance ${formatMoney(remaining)}` : ''

    if (loan.kind === 'lend') {
      const giveTag = loan.paySource === 'bank' ? '🏦 Bank' : '💵 Cash'
      loanItems.push({
        type: 'loan',
        id: `${loan.id}-give`,
        amount: loan.amount,
        name: loan.personName,
        sub: `🤝 Loan given · ${giveTag}${remainingPart}${loan.note ? ` · ${loan.note}` : ''}`,
        date: loan.createdAt,
        billCreatedAt: loan.createdAt,
        completedAt: loan.createdAt,
        paymentMode: payMode,
        paymentModes: [payMode],
      })
    } else {
      loanItems.push({
        type: 'loan',
        id: `${loan.id}-take`,
        amount: loan.amount,
        name: loan.personName,
        sub: `${decorated.kindLabel} · ${payLabel}${remainingPart}${loan.note ? ` · ${loan.note}` : ''}`,
        date: loan.createdAt,
        billCreatedAt: loan.createdAt,
        completedAt: loan.createdAt,
        paymentMode: payMode,
        paymentModes: [payMode],
      })
    }

    for (const [index, event] of loanSettlementEvents(loan).entries()) {
      const settlePayMode: HistoryPaymentMode = event.paySource === 'bank' ? 'bank' : 'cash'
      const settleLabel = event.paySource === 'bank' ? 'Bank' : 'Cash'
      const settledOn = formatDate(event.at)
      if (loan.kind === 'lend') {
        loanItems.push({
          type: 'loan',
          id: `${loan.id}-settle-${index}`,
          amount: event.amount,
          name: loan.personName,
          sub: `🤝 Loan collected · ${settleLabel} · Settled ${settledOn}`,
          date: event.at,
          billCreatedAt: loan.createdAt,
          completedAt: event.at,
          paymentMode: settlePayMode,
          paymentModes: [settlePayMode],
        })
      } else {
        loanItems.push({
          type: 'loan',
          id: `${loan.id}-settle-${index}`,
          amount: event.amount,
          name: loan.personName,
          sub: `🤝 Loan returned · ${settleLabel} · Settled ${settledOn}`,
          date: event.at,
          billCreatedAt: loan.createdAt,
          completedAt: event.at,
          paymentMode: settlePayMode,
          paymentModes: [settlePayMode],
        })
      }
    }
  }

  return [...saleItems, ...expenseItems, ...purchaseItems, ...loanItems]
}

/** Timestamp for sorting — last update / collection when available. */
export function historyItemSortTime(item: HistoryItem): number {
  return new Date(item.completedAt ?? item.date).getTime()
}

/** Timestamp for sorting by when the record was first created. */
export function historyItemCreatedTime(item: HistoryItem): number {
  return new Date(item.billCreatedAt ?? item.date).getTime()
}

/** Amount shown for a history row — purchase paid-only mode uses paidAmount. */
export function historyItemDisplayAmount(item: HistoryItem, purchasePaidOnly = false): number {
  if (item.type === 'sale') return historyItemSaleAmount(item)
  if (item.type === 'purchase' && purchasePaidOnly) return item.paidAmount ?? 0
  return item.amount
}

/** Money actually collected for a history sale row (split-aware). */
export function historyItemSaleAmount(item: HistoryItem): number {
  if (item.type !== 'sale') return item.amount
  if (item.isSplitGroup) return item.amount
  if (item.collectedAmount != null && item.collectedAmount > 0) {
    const isPending = item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (isPending || item.amount === item.originalBillAmount) {
      return item.collectedAmount
    }
  }
  return item.amount
}

export function matchesHistorySearch(item: HistoryItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase().trim()
  const receiptHaystack =
    item.receiptLines
      ?.map(
        (line) =>
          `${line.label} ${line.detail ?? ''} ${formatMoney(line.amount)} ${line.createdAt ?? ''} ${line.paidAt ?? ''}`,
      )
      .join(' ') ?? ''
  const timelineHaystack =
    item.receiptTimeline?.map((e) => `${e.label} ${formatDate(e.date)}`).join(' ') ?? ''
  const haystack = [
    item.name,
    item.sub,
    receiptHaystack,
    timelineHaystack,
    item.billCreatedAt ? formatDate(item.billCreatedAt) : '',
    item.completedAt ? formatDate(item.completedAt) : '',
    formatMoney(item.amount),
    item.originalBillAmount ? formatMoney(item.originalBillAmount) : '',
    formatDate(item.date),
    getHistoryTypeLabel(item.type),
    item.isSplitGroup ? 'split' : '',
    item.paymentMode ? getHistoryPaymentLabel(item.paymentMode) : '',
    ...(item.paymentModes ?? []).map(getHistoryPaymentLabel),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

export function matchesHistoryPaymentFilter(
  item: HistoryItem,
  paymentFilter: HistoryPaymentFilter,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): boolean {
  if (paymentFilter === 'all') return true
  if (paymentFilter === 'pending') {
    if (item.type === 'sale') {
      return item.receiptLines?.some((line) => line.status === 'pending') ?? false
    }
    if (item.type === 'purchase') return Boolean(item.hasOpenCredit)
    return false
  }
  if (paymentFilter === 'cheque') {
    // Open cheque bills, or any bill that originated as cheque (incl. cleared to bank).
    const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
    if (modes.includes('cheque')) return true
    return (
      item.receiptLines?.some(
        (line) =>
          line.label === 'Cheque' ||
          (line.label === 'Bank' && (line.detail ?? '').toLowerCase().includes('cheque')),
      ) ?? false
    )
  }
  if (paymentFilter === 'cash' || paymentFilter === 'bank') {
    // Prefer real channel amount so split bills only appear under sides that paid.
    return historyItemChannelAmount(item, paymentFilter, dateFilter, selectedDate) > 0
  }
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  return modes.includes(paymentFilter)
}
