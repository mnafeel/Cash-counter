import type { AppData, Sale } from '../types'
import { expenseBillTag, isPurchaseExpense } from './expenseBillLabels'
import { formatDate, formatMoney } from './format'
import { buildPurchaseHistoryItems, purchaseExpensePaymentModes, type PurchaseHistoryItem } from './purchaseHistory'

export type HistoryItemType = 'sale' | 'expense' | 'purchase' | 'deposit' | 'transfer'

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
}

export function getHistoryTypeLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Bill Collected'
  if (type === 'deposit') return 'Money Added'
  if (type === 'transfer') return 'Transfer'
  if (type === 'purchase') return 'Purchase'
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

function salePaymentMode(sale: Sale): HistoryPaymentMode {
  if (sale.status === 'pending') {
    if (isCreditBill(sale)) return 'credit'
    if (isChequeBill(sale)) return 'cheque'
    return 'pending'
  }
  if (isCreditBill(sale)) return 'credit'
  if (isChequeBill(sale)) return 'cheque'
  if (sale.payType === 'bank') return 'bank'
  if (sale.payType === 'split') return 'split'
  return 'cash'
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

import { saleCollectedAmount, salePendingCreditPaidBreakdown } from './salePayment'

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

  const cash = sale.cashAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (sale.chequeApproved && cheque > 0) bank = Math.max(0, bank - cheque)

  if (sale.payType === 'cash') return 'Cash'
  if (sale.payType === 'bank') return 'Bank'
  if (sale.payType === 'cheque') return sale.chequeApproved ? 'Cheque → Bank' : 'Cheque'

  const parts: string[] = []
  if (cash > 0) parts.push('Cash')
  if (bank > 0) parts.push('Bank')
  if (cheque > 0) parts.push(sale.chequeApproved ? 'Cheque → Bank' : 'Cheque')

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
    const base = `💵 ${formatMoney(sale.cashAmount ?? 0)} · 🏦 ${formatMoney(sale.bankAmount ?? 0)}`
    const withCheque =
      (sale.chequeAmount ?? 0) > 0 ? `${base} · 🧾 ${formatMoney(sale.chequeAmount ?? 0)}` : base
    return (sale.creditAmount ?? 0) > 0
      ? `${withCheque} · 💳 ${formatMoney(sale.creditAmount ?? 0)}`
      : withCheque
  }
  return '💵 Cash'
}

function paidCollectionDetail(sale: Sale): string | undefined {
  if (sale.status === 'pending') return 'Pending'
  const cash = sale.cashAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (sale.chequeApproved && cheque > 0) bank = Math.max(0, bank - cheque)

  const parts: string[] = []
  if (cash > 0) parts.push(`💵 ${formatMoney(cash)}`)
  if (bank > 0) parts.push(`🏦 ${formatMoney(bank)}`)
  if (cheque > 0) {
    parts.push(
      sale.chequeApproved ? `🧾 ${formatMoney(cheque)} → bank` : `🧾 ${formatMoney(cheque)}`,
    )
  }
  if (parts.length === 0 && sale.payType === 'cash') return `💵 ${formatMoney(sale.billAmount)}`
  if (parts.length === 0 && sale.payType === 'bank') return `🏦 ${formatMoney(sale.billAmount)}`
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

    const chequeOnParent = parent.chequeAmount ?? 0
    let bankOnParent = parent.bankAmount ?? 0
    if (parent.chequeApproved && chequeOnParent > 0) {
      bankOnParent = Math.max(0, bankOnParent - chequeOnParent)
    }
    if (bankOnParent > 0) {
      lines.push({
        label: 'Bank',
        amount: bankOnParent,
        status: 'paid',
        detail: '🏦 Collected to bank',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
    if (chequeOnParent > 0 && parent.chequeApproved && !childTypes.has('cheque')) {
      lines.push({
        label: 'Cheque',
        amount: chequeOnParent,
        status: 'paid',
        detail: '🧾 Cheque approved to bank',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
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

  const childTypes = new Set(children.map((c) => c.payType))
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
    const chequeOnParent = parent.chequeAmount ?? 0
    let bankOnParent = parent.bankAmount ?? 0
    if (parent.chequeApproved && chequeOnParent > 0) {
      bankOnParent = Math.max(0, bankOnParent - chequeOnParent)
    }
    if (bankOnParent > 0) {
      events.push({
        label: 'Bank collected',
        date: parentPaidAt,
        amount: bankOnParent,
        type: 'collected',
      })
    }
    if (chequeOnParent > 0 && parent.chequeApproved && !childTypes.has('cheque')) {
      events.push({
        label: 'Cheque approved',
        date: parentPaidAt,
        amount: chequeOnParent,
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

function buildSplitGroupItem(parent: Sale, children: Sale[]): HistoryItem {
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
    name: parent.customerName ?? children.find((c) => c.customerName)?.customerName,
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
        ? `Paid ${formatMoney(moneyCollected)}${
            completedAt && completedAt !== parent.createdAt
              ? ` · Updated ${formatDate(completedAt)}`
              : ''
          }`
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
    const wasUpdated = Boolean(sale.updatedAt && sale.updatedAt !== sale.createdAt)
    let label = `${saleReceiptLabel(sale)} collected`
    if (isCreditBill(sale)) {
      label = wasUpdated ? `Credit payment · ${method}` : `Credit paid · ${method}`
    } else if (isChequeBill(sale)) {
      label = wasUpdated ? `Cheque payment · ${method}` : `Cheque paid · ${method}`
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

function buildSaleHistoryItem(sale: Sale): HistoryItem {
  const collected = collectedPaymentAmount(sale)
  const paidAt =
    sale.status !== 'pending'
      ? sale.updatedAt ?? sale.createdAt
      : collected > 0 && sale.updatedAt && sale.updatedAt !== sale.createdAt
        ? sale.updatedAt
        : undefined
  const amount = formatMoney(sale.billAmount)
  let sub: string

  if (isCreditBill(sale)) {
    const paidTime =
      paidAt && sale.updatedAt && sale.updatedAt !== sale.createdAt
        ? `Updated ${formatDate(paidAt)}`
        : paidAt
          ? formatDate(paidAt)
          : ''
    sub =
      sale.status === 'pending'
        ? collected > 0
          ? `Credit · Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(sale)} · ${amount} pending${paidTime ? ` · ${paidTime}` : ''}`
          : `Credit · ${amount} pending`
        : `Credit · Paid ${formatMoney(collected)} · ${collectionMethodLabel(sale)}${paidTime ? ` · ${paidTime}` : ''}`
  } else if (isChequeBill(sale)) {
    const paidTime =
      paidAt && sale.updatedAt && sale.updatedAt !== sale.createdAt
        ? `Updated ${formatDate(paidAt)}`
        : paidAt
          ? formatDate(paidAt)
          : ''
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
    const paidTime =
      paidAt && sale.updatedAt && sale.updatedAt !== sale.createdAt
        ? `Updated ${formatDate(paidAt)}`
        : paidAt
          ? formatDate(paidAt)
          : ''
    sub = `${orig}${paidPart}${sale.changeAmount > 0 ? `Change ${formatMoney(sale.changeAmount)} · ` : ''}${paidTime}`.replace(/ · $/, '')
  }

  const wasUpdated = Boolean(sale.updatedAt && sale.updatedAt !== sale.createdAt)
  const updatedLabel = wasUpdated && sale.updatedAt ? ` · Updated ${formatDate(sale.updatedAt)}` : ''
  const totalBill =
    sale.originalBillAmount ??
    (isCreditBill(sale) || isChequeBill(sale) ? sale.billAmount + collected : sale.billAmount)
  const paySummary =
    sale.status !== 'pending' && collected > 0
      ? `Paid ${formatMoney(collected)}${updatedLabel}`
      : sale.status === 'pending' && (isCreditBill(sale) || isChequeBill(sale))
        ? collected > 0
          ? `Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(sale)} · Pending ${formatMoney(sale.billAmount)}${updatedLabel}`
          : `Pending ${formatMoney(sale.billAmount)}`
        : undefined

  return {
    type: 'sale',
    id: sale.id,
    amount:
      isCreditBill(sale) || isChequeBill(sale) ? totalBill : collected || sale.billAmount,
    originalBillAmount: totalBill,
    sub,
    name: sale.customerName,
    date: sale.updatedAt ?? sale.createdAt,
    receiptLines: buildSaleReceiptLines(sale),
    receiptTimeline: buildSaleTimeline(sale),
    billCreatedAt: sale.createdAt,
    completedAt: paidAt,
    paymentMode: salePaymentMode(sale),
    paymentModes: [salePaymentMode(sale)],
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

export function buildHistoryItems(data: AppData): HistoryItem[] {
  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  const saleItems: HistoryItem[] = []

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      saleItems.push(buildSplitGroupItem(sale, children))
      continue
    }

    saleItems.push(buildSaleHistoryItem(sale))
  }

  for (const group of findOrphanSplitGroups(data.sales, consumedChildIds)) {
    for (const child of group) consumedChildIds.add(child.id)
    saleItems.push(buildSplitGroupItem(buildSyntheticSplitParent(group), group))
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    saleItems.push(buildSaleHistoryItem(sale))
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
      receiptLines: buildPurchaseReceiptLines(item),
      receiptTimeline: buildPurchaseTimeline(item),
      paymentMode,
      paymentModes,
      paySummary: formatPurchasePaySummary(item),
      hasOpenCredit: item.hasOpenCredit,
      openCreditAmount: item.openCreditAmount,
      openCreditExpenseId: item.openCreditExpenseId,
    }
  })

  return [...saleItems, ...expenseItems, ...purchaseItems]
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
