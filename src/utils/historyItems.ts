import type { AppData, Expense, Sale } from '../types'
import { expenseBillTag, isPurchaseExpense } from './expenseBillLabels'
import { formatDate, formatMoney } from './format'
import { decorateLoan } from './loanLedger'
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
  if (breakdown.cheque > 0) modes.push('cheque')

  if (modes.length > 1) return ['split', ...modes]
  if (modes.length === 1) return modes

  if (sale.status === 'pending') {
    if (isCreditBill(sale)) return ['credit']
    if (isChequeBill(sale)) return ['cheque']
    return ['pending']
  }

  if (sale.payType === 'bank') return ['bank']
  if (sale.payType === 'cheque') return ['cheque']
  if (sale.payType === 'split') return ['split']
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
    if (line.label === 'Cheque') modes.add('cheque')
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

function balancePaymentEventLabel(sale: Sale): { label: string; detail?: string } {
  const kind = isCreditBill(sale) ? 'Credit' : isChequeBill(sale) ? 'Cheque' : 'Bill'
  const method = partialCollectionMethodLabel(sale)
  const amounts = partialCollectionAmountBreakdown(sale)
  return {
    label: method ? `${kind} payment · ${method}` : `${kind} payment`,
    detail: amounts || undefined,
  }
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

function buildSplitReceiptLines(parent: Sale, children: Sale[]): HistoryReceiptLine[] {
  const lines: HistoryReceiptLine[] = []
  const childTypes = new Set(children.map((c) => c.payType))
  const parentPaidAt = parent.updatedAt ?? parent.createdAt

  if (parent.status !== 'pending') {
    if ((parent.cashAmount ?? 0) > 0) {
      lines.push({
        label: 'Cash',
        amount: parent.cashAmount ?? 0,
        status: 'paid',
        detail: '💵 Collected at counter',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }

    const bankOnParent = parent.bankAmount ?? 0
    if (bankOnParent > 0) {
      lines.push({
        label: 'Bank',
        amount: bankOnParent,
        status: 'paid',
        detail: parent.chequeApproved ? '🧾 Cheque approved to bank' : '🏦 Collected to bank',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
    const pendingCheque = (parent.chequeAmount ?? 0) > 0 && !parent.chequeApproved
    if (pendingCheque && !childTypes.has('cheque')) {
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
    const label = kind === 'credit' ? 'Credit' : kind === 'cheque' ? 'Cheque' : 'Bill'
    const childCollected = collectedPaymentAmount(child)
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
      amount: child.billAmount,
      status: child.status === 'pending' ? 'pending' : 'paid',
      detail:
        child.status === 'pending'
          ? `${label} bill pending`
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

  if (parent.status !== 'pending') {
    if ((parent.cashAmount ?? 0) > 0) {
      events.push({
        label: 'Cash collected',
        date: parentPaidAt,
        amount: parent.cashAmount ?? 0,
        type: 'collected',
      })
    }
    const bankOnParent = parent.bankAmount ?? 0
    if (bankOnParent > 0) {
      events.push({
        label: parent.chequeApproved ? 'Cheque approved to bank' : 'Bank collected',
        date: parentPaidAt,
        amount: bankOnParent,
        type: 'collected',
      })
    }
  }

  for (const child of children) {
    const kind = childBillKind(child)
    const part = kind === 'credit' ? 'Credit' : kind === 'cheque' ? 'Cheque' : 'Bill'
    events.push({
      label: `${part} bill created`,
      date: child.createdAt,
      amount: child.billAmount,
      type: child.status === 'pending' ? 'pending' : 'pending-created',
    })
    if (child.status === 'pending') {
      const partial = collectedPaymentAmount(child)
      if (
        partial > 0 &&
        child.updatedAt != null &&
        child.updatedAt !== child.createdAt &&
        (isCreditBill(child) || isChequeBill(child))
      ) {
        events.push({
          label: `${part} payment · ${partialCollectionMethodLabel(child) || 'Partial'}`,
          detail: partialCollectionAmountBreakdown(child) || undefined,
          date: child.updatedAt,
          amount: partial,
          type: 'collected',
        })
      }
    } else {
      const paidAt = child.updatedAt ?? child.createdAt
      const method = collectionMethodLabel(child)
      const collected = collectedPaymentAmount(child)
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

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function splitPartsTarget(parent: Sale, children: Sale[]): number {
  const parentParts =
    (parent.cashAmount ?? 0) +
    (parent.bankAmount ?? 0) +
    (parent.chequeAmount ?? 0) +
    (parent.creditAmount ?? 0)
  const childTotal = children.reduce((sum, child) => sum + child.billAmount, 0)
  if (parentParts + childTotal > 0) return parentParts + childTotal
  return parent.billAmount
}

function splitGroupMoneyCollected(parent: Sale, children: Sale[]): number {
  let total = parent.status !== 'pending' ? collectedPaymentAmount(parent) : 0
  for (const child of children) {
    total += collectedPaymentAmount(child)
  }
  return total
}

function formatSplitPaymentBreakdown(lines: HistoryReceiptLine[]): string {
  const parts: string[] = []
  for (const line of lines) {
    if (line.status !== 'paid') continue
    if (line.label === 'Cash') parts.push(`💵 ${formatMoney(line.amount)}`)
    else if (line.label === 'Bank') parts.push(`🏦 ${formatMoney(line.amount)}`)
    else if (line.label === 'Cheque') parts.push(`🧾 ${formatMoney(line.amount)}`)
    else if (line.label === 'Credit') parts.push(`💳 ${formatMoney(line.amount)}`)
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
  if (isCreditBill(sale)) return 'Credit'
  if (isChequeBill(sale)) return 'Cheque'
  if (sale.payType === 'bank') return 'Bank'
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
  const events: HistoryReceiptEvent[] = [
    {
      label: 'Bill created',
      date: sale.createdAt,
      amount: sale.originalBillAmount ?? sale.billAmount,
      type: 'bill-created',
    },
  ]
  if (sale.status === 'pending') {
    const partialCollected = collectedPaymentAmount(sale)
    const hasPartialPayment =
      partialCollected > 0 &&
      sale.updatedAt != null &&
      sale.updatedAt !== sale.createdAt &&
      (isCreditBill(sale) || isChequeBill(sale))

    if (hasPartialPayment) {
      const paymentEvent = balancePaymentEventLabel(sale)
      events.push({
        label: paymentEvent.label,
        detail: paymentEvent.detail,
        date: sale.updatedAt ?? sale.createdAt,
        amount: partialCollected,
        type: 'collected',
      })
    }

    events.push({
      label: isCreditBill(sale)
        ? 'Credit pending'
        : isChequeBill(sale)
          ? 'Cheque pending'
          : `${saleReceiptLabel(sale)} pending`,
      date: hasPartialPayment ? sale.updatedAt ?? sale.createdAt : sale.createdAt,
      amount: sale.billAmount,
      type: 'pending',
    })
  } else {
    const method = collectionMethodLabel(sale)
    const collectedAt = sale.updatedAt ?? sale.createdAt
    let label = `${saleReceiptLabel(sale)} collected`
    if (isCreditBill(sale)) {
      label = `Credit paid · ${method}`
    } else if (isChequeBill(sale)) {
      label = `Cheque paid · ${method}`
    }

    events.push({
      label,
      date: collectedAt,
      amount: collectedPaymentAmount(sale),
      type: 'collected',
    })
  }
  return events
}

function buildSalePaymentCollections(sale: Sale): HistoryItem['paymentCollections'] {
  return getSalePaymentEvents(sale)
    .filter((event) => event.amount > 0)
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
        : `Cheque · Paid ${formatMoney(collected)} · ${collectionMethodLabel(sale)}${paidTime ? ` · ${paidTime}` : ''}`
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
    (isCreditBill(sale) || isChequeBill(sale) ? sale.billAmount + collected : sale.billAmount)
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
        ? { cash: breakdown.cash, bank: breakdown.bank, cheque: breakdown.cheque }
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

function receiptLinePaymentMode(label: string): HistoryListPaymentPart['mode'] | null {
  if (label === 'Cash') return 'cash'
  if (label === 'Bank') return 'bank'
  if (label === 'Cheque') return 'cheque'
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

  if (item.receiptLines?.length) {
    for (const line of item.receiptLines) {
      if (line.label === 'Paid' || line.label === 'Bill total' || line.label === 'Purchase') {
        continue
      }
      const mode = receiptLinePaymentMode(line.label)
      if (mode) mergeListPaymentPart(bucket, mode, line.amount, line.status)
    }
  }

  const breakdown = historyItemCollectionBreakdownForDateFilter(item, dateFilter, selectedDate)
  if (breakdown && bucket.size === 0) {
    mergeListPaymentPart(bucket, 'cash', breakdown.cash, 'paid')
    mergeListPaymentPart(bucket, 'bank', breakdown.bank, 'paid')
    mergeListPaymentPart(bucket, 'cheque', breakdown.cheque, 'paid')
  }

  if (bucket.size === 0 && item.paymentMode) {
    const amount = historyItemAmountForDateFilter(item, dateFilter, selectedDate, item.type === 'purchase')
    const pendingFromLines =
      item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (item.paymentMode === 'cash') mergeListPaymentPart(bucket, 'cash', amount, 'paid')
    else if (item.paymentMode === 'bank') mergeListPaymentPart(bucket, 'bank', amount, 'paid')
    else if (item.paymentMode === 'cheque') {
      mergeListPaymentPart(bucket, 'cheque', amount, pendingFromLines ? 'pending' : 'paid')
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
): string | undefined {
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
export function historyItemListRowSub(item: HistoryItem): string {
  if (item.type === 'sale' || item.type === 'purchase') {
    return historyItemListSubtitle(item)
  }
  return item.sub
}

export function historyItemListSubtitle(item: HistoryItem): string {
  if (item.type === 'sale') {
    const bill = item.originalBillAmount ?? item.amount
    if (item.isSplitGroup) return `Split bill · ${formatMoney(bill)}`
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

/** Date line on History list rows — always shows bill created date for sales/purchases. */
export function historyItemListDateLabel(item: HistoryItem): string {
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
  const sales = data.sales
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
    const payLabel = loan.paySource === 'bank' ? 'Bank' : 'Cash'
    const payMode: HistoryPaymentMode = loan.paySource === 'bank' ? 'bank' : 'cash'
    const statusPart =
      loan.status === 'settled' && decorated.settledDateLabel
        ? ` · Settled ${decorated.settledDateLabel}`
        : ' · Pending'

    if (loan.kind === 'lend') {
      const giveTag = loan.paySource === 'bank' ? '🏦 Bank expense' : '💵 Cash expense'
      loanItems.push({
        type: 'expense',
        id: loan.id,
        amount: loan.amount,
        name: loan.personName,
        sub: `🤝 Loan given · ${giveTag}${statusPart}${loan.note ? ` · ${loan.note}` : ''}`,
        date: loan.createdAt,
        billCreatedAt: loan.createdAt,
        completedAt: loan.createdAt,
        paymentMode: payMode,
        paymentModes: [payMode],
      })
      continue
    }

    loanItems.push({
      type: 'loan',
      id: loan.id,
      amount: loan.amount,
      name: loan.personName,
      sub: `${decorated.kindLabel} · ${payLabel}${statusPart}${loan.note ? ` · ${loan.note}` : ''}`,
      date: loan.createdAt,
      billCreatedAt: loan.createdAt,
      completedAt: loan.createdAt,
      paymentMode: payMode,
      paymentModes: [payMode],
    })
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
): boolean {
  if (paymentFilter === 'all') return true
  if (paymentFilter === 'pending') {
    if (item.type === 'sale') {
      return item.receiptLines?.some((line) => line.status === 'pending') ?? false
    }
    if (item.type === 'purchase') return Boolean(item.hasOpenCredit)
    return false
  }
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  return modes.includes(paymentFilter)
}
