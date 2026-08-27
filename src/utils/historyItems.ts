import type { AppData, Expense, Loan, Sale } from '../types'
import { expenseBillTag, isPurchaseExpense } from './expenseBillLabels'
import { formatDate, formatMoney, formatTimestamp } from './format'
import { decorateLoan, loanRemainingAmount, loanSettlementEvents } from './loanLedger'
import { normalExpensePaidChannels } from './normalExpenseHistory'
import { buildPurchaseHistoryItems, purchaseExpensePaymentModes, type PurchaseHistoryItem } from './purchaseHistory'
import { getSaleCustomerName } from './saleCustomerName'
import { memoByDataRef } from './memoByDataRef'
import {
  formatSaleReturnLine,
  saleGrossBillAmount,
  saleNetBillAmount,
  saleReturnTotal,
} from './saleReturns'

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
  type: 'bill-created' | 'pending-created' | 'collected' | 'pending' | 'total'
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
  /** Precomputed lowercase haystack for fast search filtering. */
  searchHaystack?: string
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

const RECEIPT_SEQ = {
  BILL_CREATED: 0,
  SALE_RETURN: 5,
  CASH_RECEIVED: 10,
  BANK_RECEIVED: 15,
  CREDIT_BALANCE: 45,
  CHEQUE_PENDING: 25,
  CHEQUE_APPROVED: 30,
  CHEQUE_CANCELLED: 35,
  CREDIT_PAYMENT: 40,
  REMAINING: 50,
  CANCELLED: 60,
  TOTAL: 100,
} as const

type ReceiptEventDraft = { seq: number; subSeq: number; event: HistoryReceiptEvent }

function ordinalWord(index: number): string {
  return index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`
}

function finalizeReceiptEvents(drafts: ReceiptEventDraft[]): HistoryReceiptEvent[] {
  return [...drafts]
    .sort(
      (a, b) =>
        a.seq - b.seq ||
        new Date(a.event.date).getTime() - new Date(b.event.date).getTime() ||
        a.subSeq - b.subSeq,
    )
    .map((d) => d.event)
}

function receiptEventToLine(event: HistoryReceiptEvent, createdAt: string): HistoryReceiptLine {
  const isPending = event.type === 'pending' || event.type === 'pending-created'
  return {
    label: event.label,
    amount: event.amount ?? 0,
    status: isPending ? 'pending' : 'paid',
    detail: event.detail,
    createdAt,
    paidAt: event.type === 'collected' ? event.date : undefined,
    date: event.date,
  }
}

function structuredReceiptLines(drafts: ReceiptEventDraft[], createdAt: string): HistoryReceiptLine[] {
  return finalizeReceiptEvents(drafts).map((event) => receiptEventToLine(event, createdAt))
}

function createReceiptDraft(
  drafts: ReceiptEventDraft[],
  seq: number,
  event: HistoryReceiptEvent,
): void {
  drafts.push({ seq, subSeq: drafts.length, event })
}

function appendTotalCollected(
  drafts: ReceiptEventDraft[],
  amount: number,
  date: string,
): void {
  if (amount <= 0) return
  createReceiptDraft(drafts, RECEIPT_SEQ.TOTAL, {
    label: 'Total collected',
    date,
    amount,
    type: 'total',
    detail: formatDate(date),
  })
}

function appendCreditSaleStructuredEvents(
  sale: Sale,
  drafts: ReceiptEventDraft[],
  opts?: { includeTotal?: boolean; includeBillCreated?: boolean },
): void {
  const totalBill = saleGrossBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)
  const allEvents = getSalePaymentEvents(sale).filter((event) => event.amount > 0)
  const activeEvents = allEvents.filter((event) => !event.cancelled)

  if (opts?.includeBillCreated !== false) {
    createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
      label: 'Bill created',
      date: sale.createdAt,
      amount: totalBill,
      type: 'bill-created',
      detail: formatDate(sale.createdAt),
    })
  }

  if (sale.returns?.length) {
    for (const row of sale.returns) {
      createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
        label: `Return · ${formatSaleReturnLine(row)}`,
        date: row.createdAt,
        amount: row.amount,
        type: 'pending',
        detail: `Bill reduced by ${formatMoney(row.amount)}`,
      })
    }
    createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
      label: 'Bill after returns',
      date: sale.updatedAt ?? sale.createdAt,
      amount: Math.max(0, totalBill - returnTotal),
      type: 'bill-created',
      detail: `Reduced by ${formatMoney(returnTotal)}`,
    })
  }

  const firstEvent = activeEvents[0]
  const firstNorm = firstEvent
    ? normalizeCollectedBreakdown({
        cash: firstEvent.cash ?? 0,
        bank: firstEvent.bank ?? 0,
        cheque: firstEvent.cheque ?? 0,
        total: firstEvent.amount,
      })
    : null

  if (firstNorm && firstNorm.cash > 0) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
      label: 'Cash received',
      date: firstEvent!.at,
      amount: firstNorm.cash,
      type: 'collected',
      detail: formatDate(firstEvent!.at),
    })
  }

  let creditPaymentNumber = 0
  activeEvents.forEach((event, index) => {
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })

    const addCreditPayment = (method: 'Cash' | 'Bank', amount: number) => {
      if (amount <= 0) return
      creditPaymentNumber += 1
      const ord =
        creditPaymentNumber === 1
          ? `Credit payment · ${method}`
          : `${ordinalWord(creditPaymentNumber - 1)} credit payment · ${method}`
      createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
        label: ord,
        date: event.at,
        amount,
        type: 'collected',
        detail: formatDate(event.at),
      })
    }

    if (index === 0) {
      addCreditPayment('Bank', normalized.bank)
      return
    }

    addCreditPayment('Cash', normalized.cash)
    addCreditPayment('Bank', normalized.bank)
  })

  if (sale.creditCancelledAt && (sale.creditCancelledAmount ?? 0) > 0) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CANCELLED, {
      label: 'Credit cancelled',
      detail: `Open balance cleared · ${formatDate(sale.creditCancelledAt)}`,
      date: sale.creditCancelledAt,
      amount: sale.creditCancelledAmount,
      type: 'pending',
    })
  } else if (sale.status === 'pending' && sale.billAmount > 0.01) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_BALANCE, {
      label: 'Credit balance',
      date: saleLastPaymentEventAt(sale) ?? sale.createdAt,
      amount: sale.billAmount,
      type: 'pending-created',
      detail: formatDate(saleLastPaymentEventAt(sale) ?? sale.createdAt),
    })
  }

  const totalCollected = activeEvents.reduce((sum, event) => sum + event.amount, 0)
  if (opts?.includeTotal !== false) {
    appendTotalCollected(
      drafts,
      totalCollected,
      saleLastPaymentEventAt(sale) ?? saleDisplayCollectionAt(sale) ?? sale.createdAt,
    )
  }
}

function appendChequeSaleStructuredEvents(
  sale: Sale,
  drafts: ReceiptEventDraft[],
  opts?: { includeTotal?: boolean; includeBillCreated?: boolean },
): void {
  const totalBill = saleGrossBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)
  const allEvents = getSalePaymentEvents(sale).filter((event) => event.amount > 0)
  const activeEvents = allEvents.filter((event) => !event.cancelled)

  if (opts?.includeBillCreated !== false) {
    createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
      label: 'Bill created',
      date: sale.createdAt,
      amount: totalBill,
      type: 'bill-created',
      detail: formatDate(sale.createdAt),
    })
  }

  if (sale.returns?.length) {
    for (const row of sale.returns) {
      createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
        label: `Return · ${formatSaleReturnLine(row)}`,
        date: row.createdAt,
        amount: row.amount,
        type: 'pending',
        detail: `Bill reduced by ${formatMoney(row.amount)}`,
      })
    }
    createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
      label: 'Bill after returns',
      date: sale.updatedAt ?? sale.createdAt,
      amount: Math.max(0, totalBill - returnTotal),
      type: 'bill-created',
      detail: `Reduced by ${formatMoney(returnTotal)}`,
    })
  }

  let cashLineIndex = 0
  let cashTotal = 0
  activeEvents.forEach((event) => {
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })
    if (normalized.cash > 0) {
      cashTotal += normalized.cash
      createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
        label: cashLineIndex === 0 ? 'Cash received' : `${ordinalWord(cashLineIndex)} cash received`,
        date: event.at,
        amount: normalized.cash,
        type: 'collected',
        detail: formatDate(event.at),
      })
      cashLineIndex += 1
    }
  })

  let chequeApprovedTotal = 0
  activeEvents.forEach((event) => {
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })
    chequeApprovedTotal += normalized.bank + normalized.cheque
  })

  const chequeAtEstablishment = Math.max(0, totalBill - cashTotal)
  const pendingAmount =
    sale.status === 'pending'
      ? Math.min(sale.billAmount, Math.max(0, chequeAtEstablishment - chequeApprovedTotal))
      : 0

  if (pendingAmount > 0.01) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_PENDING, {
      label: 'Cheque pending',
      date: activeEvents[0]?.at ?? sale.createdAt,
      amount: pendingAmount,
      type: 'pending-created',
      detail: formatDate(activeEvents[0]?.at ?? sale.createdAt),
    })
  }

  let chequeApprovalIndex = 0
  activeEvents.forEach((event) => {
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })
    const chequePart = normalized.bank + normalized.cheque
    if (chequePart <= 0) return

    createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_APPROVED, {
      label:
        chequeApprovalIndex === 0
          ? '1st cheque approved'
          : `${ordinalWord(chequeApprovalIndex)} cheque approved`,
      date: event.at,
      amount: chequePart,
      type: 'collected',
      detail: `To bank · ${formatDate(event.at)}`,
    })
    chequeApprovalIndex += 1
  })

  let chequeCancelIndex = 0
  allEvents.forEach((event) => {
    if (!event.cancelled) return
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })
    createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_CANCELLED, {
      label:
        allEvents.filter((e) => e.cancelled).length <= 1
          ? 'Cheque cancelled'
          : `${ordinalWord(chequeCancelIndex)} cheque cancelled`,
      detail: `Was approved · ${formatDate(event.cancelledAt ?? event.at)}`,
      date: event.cancelledAt ?? event.at,
      amount: normalized.total || event.amount,
      type: 'pending',
    })
    chequeCancelIndex += 1
  })

  if (sale.status === 'pending' && sale.billAmount > 0.01 && activeEvents.length > 0) {
    createReceiptDraft(drafts, RECEIPT_SEQ.REMAINING, {
      label: 'Remaining balance',
      date: saleLastPaymentEventAt(sale) ?? sale.createdAt,
      amount: sale.billAmount,
      type: 'pending',
      detail: formatDate(saleLastPaymentEventAt(sale) ?? sale.createdAt),
    })
  }

  const totalCollected = activeEvents.reduce((sum, event) => sum + event.amount, 0)
  if (opts?.includeTotal !== false) {
    appendTotalCollected(
      drafts,
      totalCollected,
      saleLastPaymentEventAt(sale) ?? saleDisplayCollectionAt(sale) ?? sale.createdAt,
    )
  }
}

function appendStandardSaleStructuredEvents(sale: Sale, drafts: ReceiptEventDraft[]): void {
  const totalBill = saleGrossBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)
  const activeEvents = getSalePaymentEvents(sale).filter((event) => event.amount > 0 && !event.cancelled)

  createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
    label: 'Bill created',
    date: sale.createdAt,
    amount: totalBill,
    type: 'bill-created',
    detail: formatDate(sale.createdAt),
  })

  if (sale.returns?.length) {
    for (const row of sale.returns) {
      createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
        label: `Return · ${formatSaleReturnLine(row)}`,
        date: row.createdAt,
        amount: row.amount,
        type: 'pending',
        detail: `Bill reduced by ${formatMoney(row.amount)}`,
      })
    }
    createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
      label: 'Bill after returns',
      date: sale.updatedAt ?? sale.createdAt,
      amount: Math.max(0, totalBill - returnTotal),
      type: 'bill-created',
      detail: `Reduced by ${formatMoney(returnTotal)}`,
    })
  }

  if (activeEvents.length > 0) {
    activeEvents.forEach((event, index) => {
      const normalized = normalizeCollectedBreakdown({
        cash: event.cash ?? 0,
        bank: event.bank ?? 0,
        cheque: event.cheque ?? 0,
        total: event.amount,
      })
      if (normalized.cash > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
          label:
            activeEvents.length <= 1
              ? 'Cash received'
              : `${ordinalWord(index)} cash received`,
          date: event.at,
          amount: normalized.cash,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      if (normalized.bank > 0 || normalized.cheque > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
          label:
            activeEvents.length <= 1
              ? 'Bank received'
              : `${ordinalWord(index)} bank received`,
          date: event.at,
          amount: normalized.bank + normalized.cheque,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
    })
  } else if (sale.status !== 'pending') {
    const { cash, bank } = saleCollectedComponentBreakdown(sale)
    const paidAt = saleDisplayCollectionAt(sale)
    if (cash > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
        label: 'Cash received',
        date: paidAt,
        amount: cash,
        type: 'collected',
        detail: formatDate(paidAt),
      })
    }
    if (bank > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
        label: 'Bank received',
        date: paidAt,
        amount: bank,
        type: 'collected',
        detail: formatDate(paidAt),
      })
    }
  }

  const totalCollected =
    activeEvents.length > 0
      ? activeEvents.reduce((sum, event) => sum + event.amount, 0)
      : collectedPaymentAmount(sale)
  appendTotalCollected(
    drafts,
    totalCollected,
    saleLastPaymentEventAt(sale) ?? saleDisplayCollectionAt(sale) ?? sale.createdAt,
  )
}

function buildStructuredSaleReceipt(sale: Sale): {
  timeline: HistoryReceiptEvent[]
  lines: HistoryReceiptLine[]
} {
  const drafts: ReceiptEventDraft[] = []
  if (isCreditBill(sale)) {
    appendCreditSaleStructuredEvents(sale, drafts)
  } else if (isChequeBill(sale)) {
    appendChequeSaleStructuredEvents(sale, drafts)
  } else {
    appendStandardSaleStructuredEvents(sale, drafts)
  }
  const timeline = finalizeReceiptEvents(drafts)
  const lines = structuredReceiptLines(drafts, sale.createdAt)
  return { timeline, lines }
}

function appendSplitParentCollectionEvents(
  parent: Sale,
  children: Sale[],
  drafts: ReceiptEventDraft[],
): void {
  if (parent.status === 'pending') return

  const activeEvents = getSalePaymentEvents(parent).filter(
    (event) => event.amount > 0 && !event.cancelled,
  )

  if (activeEvents.length > 0) {
    activeEvents.forEach((event, index) => {
      const normalized = normalizeCollectedBreakdown({
        cash: event.cash ?? 0,
        bank: event.bank ?? 0,
        cheque: event.cheque ?? 0,
        total: event.amount,
      })
      const prefix =
        index === 0 ? 'Split allocation' : `${ordinalWord(index)} split payment`

      if (normalized.cash > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
          label: `${prefix} · Cash`,
          date: event.at,
          amount: normalized.cash,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      if (normalized.bank > 0 || normalized.cheque > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
          label: `${prefix} · Bank`,
          date: event.at,
          amount: normalized.bank + normalized.cheque,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
    })
    return
  }

  const parentCollected = parentCollectedExcludingChequeChildren(parent, children)
  if (!parentCollected) return

  if (parentCollected.cash > 0) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
      label: 'Split allocation · Cash',
      date: saleChannelCollectionAt(parent, 'cash') ?? saleDisplayCollectionAt(parent, 'cash'),
      amount: parentCollected.cash,
      type: 'collected',
      detail: formatDate(
        saleChannelCollectionAt(parent, 'cash') ?? saleDisplayCollectionAt(parent, 'cash'),
      ),
    })
  }
  if (parentCollected.bank > 0) {
    createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
      label: 'Split allocation · Bank',
      date: saleChannelCollectionAt(parent, 'bank') ?? saleDisplayCollectionAt(parent, 'bank'),
      amount: parentCollected.bank,
      type: 'collected',
      detail: formatDate(
        saleChannelCollectionAt(parent, 'bank') ?? saleDisplayCollectionAt(parent, 'bank'),
      ),
    })
  }
}

function buildSplitStructuredReceipt(
  parent: Sale,
  children: Sale[],
): { timeline: HistoryReceiptEvent[]; lines: HistoryReceiptLine[] } {
  const drafts: ReceiptEventDraft[] = []
  const fullBill =
    parent.originalBillAmount ??
    children[0]?.originalBillAmount ??
    parent.billAmount + children.reduce((sum, child) => sum + child.billAmount, 0)

  createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
    label: 'Bill created',
    date: parent.createdAt,
    amount: fullBill,
    type: 'bill-created',
    detail: formatDate(parent.createdAt),
  })

  appendSplitParentCollectionEvents(parent, children, drafts)

  const sortedChildren = [...children].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  for (const child of sortedChildren) {
    if (isCreditBill(child)) {
      appendCreditSaleStructuredEvents(child, drafts, {
        includeTotal: false,
        includeBillCreated: false,
      })
    } else if (isChequeBill(child)) {
      appendChequeSaleStructuredEvents(child, drafts, {
        includeTotal: false,
        includeBillCreated: false,
      })
    }
  }

  appendTotalCollected(
    drafts,
    splitGroupMoneyCollected(parent, children),
    latestIso([
      saleLastPaymentEventAt(parent) ?? parent.createdAt,
      ...children.map(
        (c) => saleLastPaymentEventAt(c) ?? saleDisplayCollectionAt(c) ?? c.createdAt,
      ),
    ]) ?? parent.createdAt,
  )

  const timeline = finalizeReceiptEvents(drafts)
  const lines = structuredReceiptLines(drafts, parent.createdAt)
  return { timeline, lines }
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

  // Purchases: match payment / record day — not supplier bill date on the form.
  if (item.type === 'purchase') {
    return isoMatchesHistoryDateFilter(item.date, dateFilter, selectedDate)
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
      if (line.label === 'Total collected') continue
      if (channel === 'cash' && (line.label === 'Cash' || line.label === 'Cash received' || line.label.includes('cash received'))) sum += line.amount
      if (
        channel === 'bank' &&
        (line.label === 'Bank' ||
          line.label === 'Cheque' ||
          line.label === 'Bank received' ||
          line.label.includes('bank received') ||
          line.label.includes('cheque approved'))
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

/** Sale row label — pending bills show Credit/Cheque Pending instead of generic Bill Collected. */
export function getHistoryItemTypeLabel(item: HistoryItem): string {
  if (item.type !== 'sale') return getHistoryTypeLabel(item.type)

  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  const hasPendingLine =
    item.receiptLines?.some((line) => line.status === 'pending') ?? false

  if (modes.includes('cheque') || item.paymentMode === 'cheque') return 'Cheque Pending'
  if (modes.includes('credit') || item.paymentMode === 'credit') return 'Credit Pending'

  if (hasPendingLine || item.paymentMode === 'pending') {
    const haystack = (item.receiptLines ?? [])
      .map((line) => line.label.toLowerCase())
      .join(' ')
    if (haystack.includes('cheque pending')) return 'Cheque Pending'
    if (haystack.includes('credit balance') || haystack.includes('credit pending')) {
      return 'Credit Pending'
    }
  }

  if (hasPendingLine) return 'Bill Pending'
  return getHistoryTypeLabel(item.type)
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
    if (line.label === 'Total collected') continue
    const lower = line.label.toLowerCase()
    if (
      line.label === 'Cash' ||
      line.label === 'Cash received' ||
      lower.includes('cash received') ||
      lower.includes('split allocation · cash') ||
      lower.includes('split payment · cash')
    ) {
      modes.add('cash')
    }
    if (
      line.label === 'Bank' ||
      line.label === 'Bank received' ||
      lower.includes('bank received') ||
      lower.includes('split allocation · bank') ||
      lower.includes('split payment · bank') ||
      lower.includes('cheque approved')
    ) {
      modes.add('bank')
    }
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
  saleChannelCollectionAt,
  saleCollectedComponentBreakdown,
  saleDisplayCollectionAt,
  saleLastPaymentEventAt,
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
  if (sale.status === 'pending') {
    if (isChequeBill(sale)) return 'Cheque pending'
    if (isCreditBill(sale)) return 'Credit pending'
    return 'Pending'
  }
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
  return buildSplitStructuredReceipt(parent, children).lines
}

function buildSplitTimeline(parent: Sale, children: Sale[]): HistoryReceiptEvent[] {
  return buildSplitStructuredReceipt(parent, children).timeline
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
    if (line.label === 'Total collected') continue
    const lower = line.label.toLowerCase()
    if (
      line.label === 'Cash' ||
      line.label === 'Cash received' ||
      lower.includes('cash received') ||
      lower.includes('split allocation · cash') ||
      lower.includes('split payment · cash')
    ) {
      parts.push(`💵 ${formatMoney(line.amount)}`)
    } else if (
      line.label === 'Bank' ||
      line.label === 'Bank received' ||
      lower.includes('bank received') ||
      lower.includes('split allocation · bank') ||
      lower.includes('split payment · bank')
    ) {
      parts.push(`🏦 ${formatMoney(line.amount)}`)
    } else if (line.label === 'Cheque' || lower.includes('cheque approved')) {
      parts.push(`🏦 ${formatMoney(line.amount)}`)
    } else if (line.label === 'Credit' || lower.includes('credit payment')) {
      parts.push(`💳 ${formatMoney(line.amount)}`)
    }
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
        saleLastPaymentEventAt(parent) ?? saleDisplayCollectionAt(parent),
        ...children.map(
          (c) => saleLastPaymentEventAt(c) ?? saleDisplayCollectionAt(c),
        ),
      ])
    : undefined
  const date = latestIso([
    saleLastPaymentEventAt(parent) ?? parent.createdAt,
    ...children.map((c) =>
      c.status !== 'pending'
        ? saleLastPaymentEventAt(c) ?? saleDisplayCollectionAt(c)
        : saleLastPaymentEventAt(c) ?? c.createdAt,
    ),
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

function buildSaleReceiptLines(sale: Sale): HistoryReceiptLine[] {
  return buildStructuredSaleReceipt(sale).lines
}

function buildSaleTimeline(sale: Sale): HistoryReceiptEvent[] {
  return buildStructuredSaleReceipt(sale).timeline
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
  const lastCollectionAt = saleLastPaymentEventAt(sale)
  const paidAt =
    sale.status !== 'pending'
      ? lastCollectionAt ?? saleDisplayCollectionAt(sale)
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
        ? isChequeBill(sale)
          ? 'Cheque pending · '
          : isCreditBill(sale)
            ? 'Credit pending · '
            : 'Pending · '
        : sale.payType === 'bank' || sale.payType === 'credit' || sale.payType === 'cheque'
          ? `Paid ${paidDetail ?? payLabel} · `
          : `Give ${formatMoney(sale.paidAmount)} · ${paidDetail ?? payLabel} · `
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub = `${orig}${paidPart}${sale.changeAmount > 0 ? `Change ${formatMoney(sale.changeAmount)} · ` : ''}${paidTime}`.replace(/ · $/, '')
  }

  const totalBill = saleGrossBillAmount(sale)
  const netBill = saleNetBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)
  const paySummary =
    sale.status !== 'pending' && collected > 0
      ? `Paid ${formatMoney(collected)}`
      : sale.status === 'pending' && (isCreditBill(sale) || isChequeBill(sale))
        ? collected > 0
          ? `Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(sale)} · ${
              isChequeBill(sale) ? 'Cheque' : 'Credit'
            } pending ${formatMoney(sale.billAmount)}`
          : `${isChequeBill(sale) ? 'Cheque' : 'Credit'} pending ${formatMoney(sale.billAmount)}`
        : undefined

  const returnSub =
    returnTotal > 0
      ? `Return −${formatMoney(returnTotal)} · Net ${formatMoney(netBill)} · `
      : ''

  return {
    type: 'sale',
    id: sale.id,
    amount:
      isCreditBill(sale) || isChequeBill(sale) ? netBill : collected || netBill,
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
    sub: `${returnSub}${sub}`.replace(/ · $/, ''),
    name: getSaleCustomerName(sale, sales),
    date: lastCollectionAt ?? sale.createdAt,
    paymentCollections,
    receiptLines: buildSaleReceiptLines(sale),
    receiptTimeline: buildSaleTimeline(sale),
    billCreatedAt: sale.createdAt,
    completedAt: sale.status !== 'pending' ? paidAt : undefined,
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
  return item.updatedAt !== item.createdAt
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
  if (purchaseWasUpdated(item)) sub += ` · Updated ${formatTimestamp(item.updatedAt)}`
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
      paidAt: purchaseWasUpdated(item) ? item.updatedAt : item.createdAt,
      date: purchaseWasUpdated(item) ? item.updatedAt : item.createdAt,
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
      date: purchaseWasUpdated(item) ? item.updatedAt : item.createdAt,
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
  const lower = label.toLowerCase()
  if (
    label === 'Cash' ||
    lower.includes('cash received') ||
    lower.includes('credit payment · cash') ||
    lower.includes('split allocation · cash') ||
    lower.includes('split payment · cash')
  ) {
    return 'cash'
  }
  if (
    label === 'Bank' ||
    lower.includes('bank received') ||
    lower.includes('credit payment · bank') ||
    lower.includes('split allocation · bank') ||
    lower.includes('split payment · bank') ||
    lower.includes('cheque approved')
  ) {
    return status === 'pending' && lower.includes('cheque pending') ? 'cheque' : 'bank'
  }
  if (label === 'Cheque' || lower.includes('cheque pending')) {
    return status === 'paid' ? 'bank' : 'cheque'
  }
  if (label === 'Credit' || lower.includes('credit balance')) return 'credit'
  if (lower.includes('bill created') || lower.includes('total collected') || lower.includes('cancelled')) {
    return null
  }
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
      const lower = line.label.toLowerCase()
      if (line.label === 'Cheque' || lower.includes('cheque pending')) {
        mergeListPaymentPart(bucket, 'cheque', line.amount, 'pending')
      }
      if (line.label === 'Credit' || lower.includes('credit balance')) {
        mergeListPaymentPart(bucket, 'credit', line.amount, 'pending')
      }
    }
  } else if (item.receiptLines?.length) {
    for (const line of item.receiptLines) {
      if (
        line.label === 'Paid' ||
        line.label === 'Bill total' ||
        line.label === 'Purchase' ||
        line.label === 'Bill created' ||
        line.label === 'Total collected'
      ) {
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
  const cashAmount = historyItemChannelAmount(item, 'cash', dateFilter, selectedDate)
  const bankAmount = historyItemChannelAmount(item, 'bank', dateFilter, selectedDate)

  // Cash / Bank / All: show channel amounts separately (never collapse a split into one Bank total).
  if (paymentFilter === 'all' || paymentFilter === 'cash' || paymentFilter === 'bank') {
    const parts: string[] = []
    if (paymentFilter === 'bank') {
      if (bankAmount > 0) parts.push(`🏦 ${formatMoney(bankAmount)}`)
      if (cashAmount > 0) parts.push(`💵 ${formatMoney(cashAmount)}`)
    } else {
      if (cashAmount > 0) parts.push(`💵 ${formatMoney(cashAmount)}`)
      if (bankAmount > 0) parts.push(`🏦 ${formatMoney(bankAmount)}`)
    }

    for (const part of getHistoryItemListPaymentParts(item, dateFilter, selectedDate)) {
      if (part.status !== 'pending') continue
      if (part.mode === 'cheque') {
        parts.push(`🧾 ${formatMoney(part.amount)} · Cheque pending`)
      } else if (part.mode === 'credit') {
        parts.push(`💳 ${formatMoney(part.amount)} · Credit pending`)
      }
    }

    if (parts.length > 0) return parts.join(' · ')
    if (paymentFilter === 'cash' || paymentFilter === 'bank') return undefined
  }

  // Multi-day cheque/credit collections: show each approval with cash/bank and date.
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
      const dated = collections.flatMap((collection, index) => {
        const normalized = normalizeCollectedBreakdown({
          cash: collection.cash,
          bank: collection.bank,
          cheque: collection.cheque,
          total: collection.amount,
        })
        const ordinal =
          collections.length > 1
            ? `${index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`} `
            : ''
        const when =
          dateFilter === 'all' ? ` · ${formatCollectionDayLabel(collection.at)}` : ''
        const bits: string[] = []
        if (normalized.cash > 0) {
          bits.push(`${ordinal}💵 ${formatMoney(normalized.cash)}${when}`)
        }
        if (normalized.bank + normalized.cheque > 0) {
          bits.push(
            `${ordinal}🏦 ${formatMoney(normalized.bank + normalized.cheque)}${when}`,
          )
        }
        if (bits.length === 0 && normalized.total > 0) {
          bits.push(`${ordinal}🧾 ${formatMoney(normalized.total)}${when}`)
        }
        return bits
      })
      if (dated.length > 0) return dated.join(' · ')
    }
  }

  const parts = getHistoryItemListPaymentParts(item, dateFilter, selectedDate)
  if (parts.length > 0) {
    return parts
      .map((part) => {
        const icon = getHistoryListPaymentPartIcon(part.mode)
        if (part.status === 'pending') {
          if (part.mode === 'cheque') return `${icon} ${formatMoney(part.amount)} · Cheque pending`
          if (part.mode === 'credit') return `${icon} ${formatMoney(part.amount)} · Credit pending`
          return `${icon} ${formatMoney(part.amount)} pending`
        }
        return `${icon} ${formatMoney(part.amount)}`
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
  }
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
  if (item.type === 'sale' && item.paymentCollections && item.paymentCollections.length > 0) {
    const collections = item.paymentCollections.filter((c) => c.amount > 0)
    if (collections.length === 1) {
      const only = collections[0]
      if (item.billCreatedAt && only.at !== item.billCreatedAt) {
        return only.cash > 0 && only.bank <= 0
          ? `Cash collected ${formatDate(only.at)}`
          : only.bank > 0 && only.cash <= 0
            ? `Bank collected ${formatDate(only.at)}`
            : `Collected ${formatDate(only.at)}`
      }
    } else if (collections.length > 1) {
      const last = collections[collections.length - 1]
      return `Last collected ${formatDate(last.at)}`
    }
  }
  if (item.billCreatedAt && item.date !== item.billCreatedAt) {
    return `Updated ${formatTimestamp(item.completedAt ?? item.date)}`
  }
  return formatTimestamp(item.date)
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
    const created = formatTimestamp(item.billCreatedAt)
    const activity = item.completedAt ?? item.date
    if (activity !== item.billCreatedAt) {
      const paidLabel =
        item.type === 'purchase' && (item.paidAmount ?? 0) > 0 ? 'Paid' : 'Updated'
      return `Created ${created} · ${paidLabel} ${formatTimestamp(activity)}`
    }
    return `Created ${created}`
  }
  return formatTimestamp(item.date)
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

function buildLoanReceiptTimeline(loan: Loan): HistoryReceiptEvent[] {
  const payLabel = (source: 'cash' | 'bank') => (source === 'bank' ? 'Bank' : 'Cash')
  const events: HistoryReceiptEvent[] = [
    {
      label: loan.kind === 'lend' ? 'Loan given' : 'Loan taken',
      date: loan.createdAt,
      amount: loan.amount,
      type: 'bill-created',
      detail: payLabel(loan.paySource),
    },
  ]
  for (const event of loanSettlementEvents(loan)) {
    events.push({
      label: loan.kind === 'lend' ? 'Loan collected' : 'Loan returned',
      date: event.at,
      amount: event.amount,
      type: 'collected',
      detail: payLabel(event.paySource),
    })
  }
  if (loanRemainingAmount(loan) > 0) {
    const settlements = loanSettlementEvents(loan)
    events.push({
      label: 'Balance remaining',
      date: settlements.length > 0 ? settlements[settlements.length - 1].at : loan.createdAt,
      amount: loanRemainingAmount(loan),
      type: 'pending',
    })
  }
  return events
}

function buildHistoryItemsUncached(data: AppData): HistoryItem[] {
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
    .flatMap((e) => {
    if (e.kind === 'transfer') {
      const toBank = e.transferDirection === 'cash-to-bank'
      return [{
        type: 'transfer' as const,
        id: e.id,
        amount: e.amount,
        sub: toBank ? '💵 → 🏦 Cash to bank' : '🏦 → 💵 Bank to cash',
        name: e.name,
        date: e.updatedAt ?? e.createdAt,
        paymentMode: (toBank ? 'cash' : 'bank') as HistoryPaymentMode,
        paymentModes: [toBank ? 'cash' : 'bank'] as HistoryPaymentMode[],
      }]
    }
    const isAdd = e.kind === 'add'
    if (!isAdd) {
      const paid = normalExpensePaidChannels(e)
      // Credit / pending cheque: not a cash or bank expense — omit from expense history
      if (!(paid.cash > 0 || paid.bank > 0)) return []
    }
    const payMode: HistoryPaymentMode =
      e.payType === 'bank'
        ? 'bank'
        : e.payType === 'cheque'
          ? 'cheque'
          : e.payType === 'split'
            ? 'split'
            : e.payType === 'credit'
              ? 'credit'
              : 'cash'
    const billTag = e.billNumber ? ` · ${expenseBillTag(e.billNumber)}` : ''
    const giveTag =
      e.giveAmount && e.giveAmount > 0
        ? ` · Give ${formatMoney(e.giveAmount)}${e.changeAmount ? ` · Change ${formatMoney(e.changeAmount)}` : ''}`
        : ''
    const paidParts = !isAdd ? normalExpensePaidChannels(e) : null
    const expenseSub =
      e.payType === 'split'
        ? `➗ Split${billTag} · 💵 ${formatMoney(e.cashAmount ?? 0)} + 🏦 ${formatMoney(e.bankAmount ?? 0)}${(e.chequeAmount ?? 0) > 0 ? ` + 🧾 ${formatMoney(e.chequeAmount ?? 0)}${e.chequeApproved ? ' ✓' : ''}` : ''}${giveTag}`
        : e.payType === 'cheque'
          ? `🧾 Cheque expense${billTag}${e.chequeApproved ? ' ✓ Bank' : ' pending'}${giveTag}`
          : e.payType === 'bank'
            ? `🏦 Bank expense${billTag}${giveTag}`
            : e.payType === 'credit'
              ? `💳 Credit expense${billTag}${giveTag}`
              : `💵 Cash expense${billTag}${giveTag}`
    const addSub =
      e.payType === 'split'
        ? `➗ Split add · 💵 ${formatMoney(e.cashAmount ?? 0)} + 🏦 ${formatMoney(e.bankAmount ?? 0)}`
        : e.payType === 'bank'
          ? '🏦 Added to bank'
          : '💵 Added to counter'
    const expenseAmount = paidParts ? paidParts.cash + paidParts.bank : e.amount
    return [{
      type: isAdd ? ('deposit' as const) : ('expense' as const),
      id: e.id,
      amount: expenseAmount,
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
    }]
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
      completedAt: item.date,
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
    const loanReceiptTimeline = buildLoanReceiptTimeline(loan)

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
        receiptLines: [
          {
            label: 'Loan given',
            amount: loan.amount,
            status: 'paid',
            detail: `${giveTag}${loan.note ? ` · ${loan.note}` : ''}`,
            date: loan.createdAt,
          },
        ],
        receiptTimeline: loanReceiptTimeline,
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
        receiptLines: [
          {
            label: 'Loan taken',
            amount: loan.amount,
            status: 'paid',
            detail: `${payLabel}${loan.note ? ` · ${loan.note}` : ''}`,
            date: loan.createdAt,
          },
        ],
        receiptTimeline: loanReceiptTimeline,
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
          receiptLines: [
            {
              label: 'Loan collected',
              amount: event.amount,
              status: 'paid',
              detail: `${settleLabel} · Settled ${settledOn}`,
              date: event.at,
            },
          ],
          receiptTimeline: loanReceiptTimeline,
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
          receiptLines: [
            {
              label: 'Loan returned',
              amount: event.amount,
              status: 'paid',
              detail: `${settleLabel} · Settled ${settledOn}`,
              date: event.at,
            },
          ],
          receiptTimeline: loanReceiptTimeline,
        })
      }
    }
  }

  const items: HistoryItem[] = [...saleItems, ...expenseItems, ...purchaseItems, ...loanItems]
  for (const item of items) {
    item.searchHaystack = buildHistorySearchHaystack(item)
  }
  return items
}

export const buildHistoryItems = memoByDataRef(buildHistoryItemsUncached)

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

export function buildHistorySearchHaystack(item: HistoryItem): string {
  const receiptHaystack =
    item.receiptLines
      ?.map(
        (line) =>
          `${line.label} ${line.detail ?? ''} ${formatMoney(line.amount)} ${line.createdAt ?? ''} ${line.paidAt ?? ''}`,
      )
      .join(' ') ?? ''
  const timelineHaystack =
    item.receiptTimeline?.map((e) => `${e.label} ${formatDate(e.date)}`).join(' ') ?? ''
  return [
    item.name,
    item.sub,
    receiptHaystack,
    timelineHaystack,
    item.billCreatedAt ? formatDate(item.billCreatedAt) : '',
    item.completedAt ? formatDate(item.completedAt) : '',
    formatMoney(item.amount),
    item.originalBillAmount ? formatMoney(item.originalBillAmount) : '',
    formatDate(item.date),
    getHistoryItemTypeLabel(item),
    item.isSplitGroup ? 'split' : '',
    item.paymentMode ? getHistoryPaymentLabel(item.paymentMode) : '',
    ...(item.paymentModes ?? []).map(getHistoryPaymentLabel),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function matchesHistorySearch(item: HistoryItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase().trim()
  const haystack = item.searchHaystack ?? buildHistorySearchHaystack(item)
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
