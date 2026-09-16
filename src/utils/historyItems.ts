import type { AppData, CustomerAdvanceLedgerEntry, Expense, Loan, Sale } from '../types'
import { expenseBillTag, isPurchaseExpense, NO1_BILL_LABEL, NO2_BILL_LABEL } from './expenseBillLabels'
import { formatDate, formatMoney, formatTimestamp } from './format'
import { decorateLoan, loanRemainingAmount, loanSettlementEvents } from './loanLedger'
import { normalExpensePaidChannels } from './normalExpenseHistory'
import { buildPurchaseHistoryItems, purchaseExpensePaymentModes, buildPurchaseLedgerPaymentEvents, type PurchaseHistoryItem, type PurchaseLedgerPaymentEvent } from './purchaseHistory'
import { getSaleCustomerName } from './saleCustomerName'
import { memoByDataRef } from './memoByDataRef'
import {
  formatSaleReturnLine,
  saleBillGroupRealizedCollected,
  saleGrossBillAmount,
  saleNetBillAmount,
  saleRelatedBillSales,
  saleReturnTotal,
} from './saleReturns'
import {
  getSalePaymentEvents,
  normalizeCollectedBreakdown,
  saleCollectedAmount,
  saleChannelCollectionAt,
  saleCollectedComponentBreakdown,
  saleDisplayCollectionAt,
  saleLastPaymentEventAt,
  salePendingBalanceHistoryDate,
  salePendingCreditPaidBreakdown,
  sanitizeSplitParentChildChequeOverlap,
  paymentEventBankInflow,
  paymentEventRealizedAmount,
} from './salePayment'

export type HistoryItemType =
  | 'sale'
  | 'expense'
  | 'purchase'
  | 'deposit'
  | 'transfer'
  | 'loan'
  | 'advance'

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
  status: 'paid' | 'pending' | 'return'
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
  type: 'bill-created' | 'pending-created' | 'collected' | 'pending' | 'return' | 'total'
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
  ADVANCE_APPLIED: 8,
  BALANCE_AFTER_ADVANCE: 9,
  CASH_RECEIVED: 10,
  CUSTOMER_GIVEN: 11,
  CHANGE_GIVEN: 12,
  BANK_RECEIVED: 15,
  BALANCE_PAID: 16,
  CREDIT_BALANCE: 45,
  BALANCE_TRANSFER: 20,
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

function activeSalePaymentEvents(sale: Sale) {
  return getSalePaymentEvents(sale).filter((event) => event.amount > 0 && !event.cancelled)
}

function mergedActivePaymentEvents(sales: Sale[]) {
  const rows = sales.flatMap((sale) =>
    getSalePaymentEvents(sale)
      .filter((event) => event.amount > 0 && !event.cancelled)
      .map((event) => ({ sale, event })),
  )
  return rows.sort(
    (a, b) => new Date(a.event.at).getTime() - new Date(b.event.at).getTime(),
  )
}

/** Chronological cash/bank/cheque lines for receipt timeline (one bill, many collections). */
function appendChronologicalPaymentEvents(
  sales: Sale[],
  drafts: ReceiptEventDraft[],
  style: 'standard' | 'credit' | 'cheque',
): number {
  const merged = mergedActivePaymentEvents(sales)
  let cashIndex = 0
  let bankIndex = 0
  let creditPayIndex = 0
  let total = 0

  for (const { sale, event } of merged) {
    total += paymentEventRealizedAmount(sale, event)
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })

    if (style === 'credit') {
      const realized = paymentEventRealizedAmount(sale, event)
      if (realized <= 0) continue
      if (normalized.cash > 0) {
        creditPayIndex += 1
        createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
          label:
            creditPayIndex === 1
              ? '1st credit payment · Cash'
              : `${ordinalWord(creditPayIndex - 1)} credit payment · Cash`,
          date: event.at,
          amount: normalized.cash,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      const bankPart = Math.max(0, Math.round((realized - normalized.cash) * 100) / 100)
      if (bankPart > 0) {
        creditPayIndex += 1
        createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
          label:
            creditPayIndex === 1
              ? '1st credit payment · Bank'
              : `${ordinalWord(creditPayIndex - 1)} credit payment · Bank`,
          date: event.at,
          amount: bankPart,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      continue
    }

    if (normalized.cash > 0) {
      const label =
        style === 'cheque'
          ? cashIndex === 0
            ? 'Cash received'
            : `${ordinalWord(cashIndex)} cash received`
          : cashIndex === 0 && merged.length <= 1
            ? 'Cash received'
            : `${ordinalWord(cashIndex)} cash received`
      createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
        label,
        date: event.at,
        amount: normalized.cash,
        type: 'collected',
        detail: formatDate(event.at),
      })
      cashIndex += 1
    }

    if (style === 'cheque') continue

    const bankPart = normalized.bank + normalized.cheque
    if (bankPart > 0) {
      const label =
        bankIndex === 0 && merged.length <= 1
          ? 'Bank received'
          : `${ordinalWord(bankIndex)} bank received`
      createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
        label,
        date: event.at,
        amount: bankPart,
        type: 'collected',
        detail: formatDate(event.at),
      })
      bankIndex += 1
    }
  }

  return Math.round(total * 100) / 100
}

function appendOpenBalanceLine(sale: Sale, drafts: ReceiptEventDraft[]): void {
  if (sale.status !== 'pending' || sale.billAmount <= 0.01) return
  const openAt = sale.updatedAt ?? saleLastPaymentEventAt(sale) ?? sale.createdAt
  if (isChequeBill(sale)) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_PENDING, {
      label: 'Cheque pending',
      date: openAt,
      amount: sale.billAmount,
      type: 'pending-created',
      detail: `Outstanding ${formatMoney(sale.billAmount)} · ${formatDate(openAt)}`,
    })
    return
  }
  if (isCreditBill(sale)) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_BALANCE, {
      label: 'Credit balance',
      date: openAt,
      amount: sale.billAmount,
      type: 'pending-created',
      detail: `Outstanding ${formatMoney(sale.billAmount)} · ${formatDate(openAt)}`,
    })
    return
  }
  createReceiptDraft(drafts, RECEIPT_SEQ.REMAINING, {
    label: 'Balance due',
    date: openAt,
    amount: sale.billAmount,
    type: 'pending',
    detail: formatDate(openAt),
  })
}

function finalizeReceiptEvents(drafts: ReceiptEventDraft[]): HistoryReceiptEvent[] {
  const sorted = [...drafts].sort(
    (a, b) =>
      a.seq - b.seq ||
      new Date(a.event.date).getTime() - new Date(b.event.date).getTime() ||
      a.subSeq - b.subSeq,
  )
  const seenBalanceTransfers = new Set<string>()
  const events: HistoryReceiptEvent[] = []
  for (const draft of sorted) {
    const event = draft.event
    if (
      event.label === 'Credit → Cheque' ||
      event.label === 'Cheque → Credit' ||
      event.label === 'Sent to cheque pending' ||
      event.label === 'Cheque returned to credit'
    ) {
      const key = `${event.date}|${event.amount ?? 0}|${event.label}`
      if (seenBalanceTransfers.has(key)) continue
      seenBalanceTransfers.add(key)
    }
    events.push(event)
  }
  return events
}

function receiptEventToLine(event: HistoryReceiptEvent, createdAt: string): HistoryReceiptLine {
  const isReturn = event.type === 'return'
  const isPending = event.type === 'pending' || event.type === 'pending-created'
  return {
    label: event.label,
    amount: event.amount ?? 0,
    status: isReturn ? 'return' : isPending ? 'pending' : 'paid',
    detail: event.detail,
    createdAt,
    paidAt: event.type === 'collected' ? event.date : undefined,
    date: event.date,
  }
}

function structuredReceiptLines(drafts: ReceiptEventDraft[], createdAt: string): HistoryReceiptLine[] {
  return finalizeReceiptEvents(drafts).map((event) => receiptEventToLine(event, createdAt))
}

function pruneReceiptLinesWhenFullyCollected(
  lines: HistoryReceiptLine[],
  fullBill: number,
  totalCollected: number,
): HistoryReceiptLine[] {
  if (fullBill <= 0 || totalCollected < fullBill - 0.01) return lines
  return lines.filter((line) => {
    if (line.status !== 'pending') return true
    const lower = line.label.toLowerCase()
    if (lower.includes('credit → cheque') || lower.includes('cheque → credit')) return true
    if (lower.includes('credit changed to cheque')) return false
    return false
  })
}

function createReceiptDraft(
  drafts: ReceiptEventDraft[],
  seq: number,
  event: HistoryReceiptEvent,
): void {
  drafts.push({ seq, subSeq: drafts.length, event })
}

function isReceiptTotalCollectedLabel(label: string): boolean {
  return label === 'Total collected' || label === 'Bill total collected'
}

function appendTotalCollected(
  drafts: ReceiptEventDraft[],
  amount: number,
  date: string,
  label: 'Total collected' | 'Bill total collected' = 'Bill total collected',
): void {
  if (amount <= 0) return
  createReceiptDraft(drafts, RECEIPT_SEQ.TOTAL, {
    label,
    date,
    amount,
    type: 'total',
    detail: formatDate(date),
  })
}

function appendSaleTotalCollected(
  drafts: ReceiptEventDraft[],
  drawerCollected: number,
  advanceApplied: number,
  date: string,
): void {
  if (advanceApplied > 0.01) {
    // Advance + cash/bank/cheque actually received on this bill.
    appendTotalCollected(
      drafts,
      Math.round((drawerCollected + advanceApplied) * 100) / 100,
      date,
      'Total collected',
    )
    return
  }
  appendTotalCollected(drafts, drawerCollected, date, 'Bill total collected')
}

function appendPendingBalanceTransferEvents(sale: Sale, drafts: ReceiptEventDraft[]): void {
  for (const row of sale.pendingBalanceTransfers ?? []) {
    if (row.direction === 'credit_to_cheque') {
      createReceiptDraft(drafts, RECEIPT_SEQ.BALANCE_TRANSFER, {
        label: 'Credit → Cheque',
        date: row.at,
        amount: row.amount,
        type: 'bill-created',
        detail: `Balance moved to cheque · ${formatMoney(row.amount)} · ${formatDate(row.at)}`,
      })
    } else {
      createReceiptDraft(drafts, RECEIPT_SEQ.BALANCE_TRANSFER, {
        label: 'Cheque → Credit',
        date: row.at,
        amount: row.amount,
        type: 'bill-created',
        detail: `Balance moved to credit · ${formatMoney(row.amount)} · ${formatDate(row.at)}`,
      })
    }
  }
}

function appendCreditSaleStructuredEvents(
  sale: Sale,
  drafts: ReceiptEventDraft[],
  opts?: {
    includeTotal?: boolean
    includeBillCreated?: boolean
    groupSales?: Sale[]
    advances?: CustomerAdvanceLedgerEntry[]
  },
): void {
  const totalBill = saleGrossBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)

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
        type: 'return',
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

  const sources = opts?.groupSales?.length ? opts.groupSales : [sale]
  const advanceApplied = appendAdvanceAppliedReceiptEvents(sale, drafts, opts?.advances)
  appendChronologicalPaymentEvents(sources, drafts, 'credit')
  const drawerCollected = saleBillGroupRealizedCollected(sale, sources)

  if (sale.creditCancelledAt && (sale.creditCancelledAmount ?? 0) > 0) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CANCELLED, {
      label: 'Credit cancelled',
      detail: `Open balance cleared · ${formatDate(sale.creditCancelledAt)}`,
      date: sale.creditCancelledAt,
      amount: sale.creditCancelledAmount,
      type: 'pending',
    })
  } else {
    appendOpenBalanceLine(sale, drafts)
  }

  appendPendingBalanceTransferEvents(sale, drafts)
  if (opts?.includeTotal !== false) {
    appendSaleTotalCollected(
      drafts,
      drawerCollected,
      advanceApplied,
      saleLastPaymentEventAt(sale) ?? saleDisplayCollectionAt(sale) ?? sale.createdAt,
    )
  }
}

function appendChequeSaleStructuredEvents(
  sale: Sale,
  drafts: ReceiptEventDraft[],
  opts?: {
    includeTotal?: boolean
    includeBillCreated?: boolean
    groupSales?: Sale[]
    advances?: CustomerAdvanceLedgerEntry[]
  },
): void {
  const sources = opts?.groupSales?.length ? opts.groupSales : [sale]
  const totalBill = saleGrossBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)
  const allEvents = sources.flatMap((row) =>
    getSalePaymentEvents(row).filter((event) => event.amount > 0),
  )

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
        type: 'return',
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

  appendChronologicalPaymentEvents(sources, drafts, 'cheque')
  const advanceApplied = appendAdvanceAppliedReceiptEvents(sale, drafts, opts?.advances)

  appendPendingBalanceTransferEvents(sale, drafts)

  if (
    sale.pendingBalanceReclassifiedFrom === 'credit' &&
    sale.pendingBalanceReclassifiedAt &&
    sale.status === 'pending' &&
    sale.billAmount > 0.01
  ) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
      label: 'Credit changed to cheque',
      date: sale.pendingBalanceReclassifiedAt,
      amount: sale.billAmount,
      type: 'pending',
      detail: `Open balance moved to cheque · ${formatDate(sale.pendingBalanceReclassifiedAt)}`,
    })
  }

  appendOpenBalanceLine(sale, drafts)

  let chequeApprovalIndex = 0
  for (const row of sources) {
    for (const event of activeSalePaymentEvents(row)) {
      const normalized = normalizeCollectedBreakdown({
        cash: event.cash ?? 0,
        bank: event.bank ?? 0,
        cheque: event.cheque ?? 0,
        total: event.amount,
      })
      const realized = paymentEventRealizedAmount(row, event)
      const bankPart = Math.max(
        0,
        Math.round((realized - normalized.cash) * 100) / 100,
      )
      if (bankPart <= 0) continue

      createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_APPROVED, {
        label:
          chequeApprovalIndex === 0
            ? '1st cheque approved'
            : `${ordinalWord(chequeApprovalIndex)} cheque approved`,
        date: event.at,
        amount: bankPart,
        type: 'collected',
        detail: `To bank · ${formatDate(event.at)}`,
      })
      chequeApprovalIndex += 1
    }
  }

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

  const drawerCollected = saleBillGroupRealizedCollected(sale, sources)
  if (opts?.includeTotal !== false) {
    appendSaleTotalCollected(
      drafts,
      drawerCollected,
      advanceApplied,
      saleLastPaymentEventAt(sale) ?? saleDisplayCollectionAt(sale) ?? sale.createdAt,
    )
  }
}

function appendStandardSaleStructuredEvents(
  sale: Sale,
  drafts: ReceiptEventDraft[],
  groupSales?: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): void {
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
        type: 'return',
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

  const advanceApplied = appendAdvanceAppliedReceiptEvents(sale, drafts, advances)

  let totalCollected = 0
  const sources = groupSales?.length ? groupSales : [sale]
  const groupEvents = sources.flatMap((row) => activeSalePaymentEvents(row))
  if (groupEvents.length > 0) {
    totalCollected = appendChronologicalPaymentEvents(sources, drafts, 'standard')
    appendOpenBalanceLine(sale, drafts)
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

  if (activeEvents.length === 0) {
    totalCollected = collectedPaymentAmount(sale)
  }
  appendSaleTotalCollected(
    drafts,
    totalCollected,
    advanceApplied,
    saleLastPaymentEventAt(sale) ?? saleDisplayCollectionAt(sale) ?? sale.createdAt,
  )
}

function buildStructuredSaleReceipt(
  sale: Sale,
  groupSales?: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): {
  timeline: HistoryReceiptEvent[]
  lines: HistoryReceiptLine[]
} {
  const members = groupSales?.length ? groupSales : [sale]
  const primary = members[0]
  if (
    members.length > 1 &&
    members.some((row) => isCreditBill(row) || isChequeBill(row))
  ) {
    return buildBalanceGroupStructuredReceipt(members, advances)
  }
  const drafts: ReceiptEventDraft[] = []
  if (isCreditBill(primary)) {
    appendCreditSaleStructuredEvents(primary, drafts, { groupSales: members, advances })
  } else if (isChequeBill(primary)) {
    appendChequeSaleStructuredEvents(primary, drafts, { groupSales: members, advances })
  } else {
    appendStandardSaleStructuredEvents(primary, drafts, members, advances)
  }
  const timeline = finalizeReceiptEvents(drafts)
  const lines = structuredReceiptLines(drafts, primary.createdAt)
  return { timeline, lines }
}

function isBalanceLinkedGroup(parent: Sale, children: Sale[]): boolean {
  if (parent.payType === 'split') return false
  if (isCreditBill(parent) || isChequeBill(parent)) return true
  return children.some((child) => isCreditBill(child) || isChequeBill(child))
}

function balanceGroupPrimary(members: Sale[]): Sale {
  const sorted = [...members].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  return (
    sorted.find((row) => isCreditBill(row)) ??
    sorted.find((row) => isChequeBill(row)) ??
    sorted[0]
  )
}

function receiptPaymentLeg(sale: Sale): 'credit' | 'cheque' | 'standard' {
  if (isChequeBill(sale)) return 'cheque'
  if (isCreditBill(sale)) return 'credit'
  return 'standard'
}

/** Credit + cheque linked legs: one timeline with per-leg labels (1st credit …, 1st cheque …). */
function appendBalanceGroupPaymentEvents(
  members: Sale[],
  drafts: ReceiptEventDraft[],
): number {
  const merged = mergedActivePaymentEvents(members)
  let creditPayIndex = 0
  let chequeApprovalIndex = 0
  let standardCashIndex = 0
  let standardBankIndex = 0

  for (const { sale, event } of merged) {
    const normalized = normalizeCollectedBreakdown({
      cash: event.cash ?? 0,
      bank: event.bank ?? 0,
      cheque: event.cheque ?? 0,
      total: event.amount,
    })
    const leg = receiptPaymentLeg(sale)

    if (leg === 'cheque') {
      const realized = paymentEventRealizedAmount(sale, event)
      if (realized <= 0) continue
      const cash = normalized.cash
      if (cash > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
          label:
            chequeApprovalIndex === 0 && realized <= cash
              ? 'Cash received'
              : `${ordinalWord(chequeApprovalIndex)} cash received`,
          date: event.at,
          amount: cash,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      const bankPart = Math.max(0, Math.round((realized - cash) * 100) / 100)
      if (bankPart > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_APPROVED, {
          label:
            chequeApprovalIndex === 0
              ? '1st cheque approved'
              : `${ordinalWord(chequeApprovalIndex)} cheque approved`,
          date: event.at,
          amount: bankPart,
          type: 'collected',
          detail: `To bank · ${formatDate(event.at)}`,
        })
        chequeApprovalIndex += 1
      }
      continue
    }

    if (leg === 'credit') {
      if (normalized.cash > 0) {
        creditPayIndex += 1
        createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
          label:
            creditPayIndex === 1
              ? '1st credit payment · Cash'
              : `${ordinalWord(creditPayIndex - 1)} credit payment · Cash`,
          date: event.at,
          amount: normalized.cash,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      const bankIn = paymentEventBankInflow(event)
      if (bankIn > 0) {
        creditPayIndex += 1
        createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
          label:
            creditPayIndex === 1
              ? '1st credit payment · Bank'
              : `${ordinalWord(creditPayIndex - 1)} credit payment · Bank`,
          date: event.at,
          amount: bankIn,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
      continue
    }

    if (normalized.cash > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
        label:
          standardCashIndex === 0 ? 'Cash received' : `${ordinalWord(standardCashIndex)} cash received`,
        date: event.at,
        amount: normalized.cash,
        type: 'collected',
        detail: formatDate(event.at),
      })
      standardCashIndex += 1
    }
    const bankIn = paymentEventBankInflow(event)
    if (bankIn > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
        label:
          standardBankIndex === 0 ? 'Bank received' : `${ordinalWord(standardBankIndex)} bank received`,
        date: event.at,
        amount: bankIn,
        type: 'collected',
        detail: formatDate(event.at),
      })
      standardBankIndex += 1
    }
  }

  return saleBillGroupRealizedCollected(balanceGroupPrimary(members), members)
}

function appendBalanceGroupChequeCancellations(
  members: Sale[],
  drafts: ReceiptEventDraft[],
): void {
  const allEvents = members.flatMap((row) => getSalePaymentEvents(row).filter((e) => e.amount > 0))
  let chequeCancelIndex = 0
  for (const event of allEvents) {
    if (!event.cancelled) continue
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
  }
}

function appendBalanceGroupReturnEvents(sale: Sale, drafts: ReceiptEventDraft[]): void {
  const totalBill = saleGrossBillAmount(sale)
  const returnTotal = saleReturnTotal(sale)
  if (!sale.returns?.length) return

  for (const row of sale.returns) {
    createReceiptDraft(drafts, RECEIPT_SEQ.SALE_RETURN, {
      label: `Return · ${formatSaleReturnLine(row)}`,
      date: row.createdAt,
      amount: row.amount,
      type: 'return',
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

function buildBalanceGroupStructuredReceipt(
  members: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): {
  timeline: HistoryReceiptEvent[]
  lines: HistoryReceiptLine[]
} {
  const primary = balanceGroupPrimary(members)
  const sortedMembers = [...members].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  const drafts: ReceiptEventDraft[] = []
  const fullBill =
    primary.originalBillAmount ??
    sortedMembers.find((row) => row.originalBillAmount)?.originalBillAmount ??
    primary.billAmount + sortedMembers.filter((row) => row.id !== primary.id).reduce(
      (sum, row) => sum + row.billAmount,
      0,
    )

  createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
    label: 'Bill created',
    date: primary.createdAt,
    amount: fullBill,
    type: 'bill-created',
    detail: formatDate(primary.createdAt),
  })

  appendBalanceGroupReturnEvents(primary, drafts)

  let advanceApplied = 0
  for (const member of sortedMembers) {
    advanceApplied += appendAdvanceAppliedReceiptEvents(member, drafts, advances)
  }

  const drawerCollected = appendBalanceGroupPaymentEvents(members, drafts)

  for (const member of sortedMembers) {
    appendPendingBalanceTransferEvents(member, drafts)
  }

  for (const member of sortedMembers) {
    if (
      member.pendingBalanceReclassifiedFrom === 'credit' &&
      member.pendingBalanceReclassifiedAt &&
      member.status === 'pending' &&
      member.billAmount > 0.01 &&
      isChequeBill(member)
    ) {
      createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_PAYMENT, {
        label: 'Credit changed to cheque',
        date: member.pendingBalanceReclassifiedAt,
        amount: member.billAmount,
        type: 'bill-created',
        detail: `Open balance moved to cheque · ${formatDate(member.pendingBalanceReclassifiedAt)}`,
      })
    }
  }

  for (const member of sortedMembers) {
    if (member.creditCancelledAt && (member.creditCancelledAmount ?? 0) > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.CANCELLED, {
        label: 'Credit cancelled',
        detail: `Open balance cleared · ${formatDate(member.creditCancelledAt)}`,
        date: member.creditCancelledAt,
        amount: member.creditCancelledAmount,
        type: 'pending',
      })
    } else if (member.status === 'pending' && member.billAmount > 0.01) {
      appendOpenBalanceLine(member, drafts)
    }
  }

  appendBalanceGroupChequeCancellations(members, drafts)

  const settlementTotal = Math.round((drawerCollected + advanceApplied) * 100) / 100
  appendSaleTotalCollected(
    drafts,
    drawerCollected,
    advanceApplied,
    latestIso(
      members
        .map((row) => saleLastPaymentEventAt(row) ?? saleDisplayCollectionAt(row) ?? row.createdAt)
        .filter(Boolean),
    ) ?? primary.createdAt,
  )

  const timeline = finalizeReceiptEvents(drafts)
  let lines = structuredReceiptLines(drafts, primary.createdAt)
  lines = pruneReceiptLinesWhenFullyCollected(lines, fullBill, settlementTotal)
  return { timeline, lines }
}

function appendSplitParentCollectionEvents(
  parent: Sale,
  children: Sale[],
  drafts: ReceiptEventDraft[],
): void {
  const activeEvents = getSalePaymentEvents(parent).filter(
    (event) => event.amount > 0 && !event.cancelled,
  )

  if (activeEvents.length > 0) {
    if (isCreditBill(parent)) {
      appendChronologicalPaymentEvents([parent], drafts, 'credit')
      return
    }
    if (isChequeBill(parent)) {
      appendChronologicalPaymentEvents([parent], drafts, 'cheque')
      return
    }
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
      const bankIn = paymentEventBankInflow(event)
      if (bankIn > 0) {
        createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
          label: `${prefix} · Bank`,
          date: event.at,
          amount: bankIn,
          type: 'collected',
          detail: formatDate(event.at),
        })
      }
    })
    return
  }

  if (parent.status === 'pending') return

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
  advances?: CustomerAdvanceLedgerEntry[],
): { timeline: HistoryReceiptEvent[]; lines: HistoryReceiptLine[] } {
  if (isBalanceLinkedGroup(parent, children)) {
    return buildBalanceGroupStructuredReceipt([parent, ...children], advances)
  }

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

  const advanceApplied =
    appendAdvanceAppliedReceiptEvents(parent, drafts, advances) +
    children.reduce(
      (sum, child) => sum + appendAdvanceAppliedReceiptEvents(child, drafts, advances),
      0,
    )

  appendSplitParentCollectionEvents(parent, children, drafts)

  const sortedChildren = [...children].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  for (const child of sortedChildren) {
    if (isCreditBill(child)) {
      appendCreditSaleStructuredEvents(child, drafts, {
        includeTotal: false,
        includeBillCreated: false,
        advances,
      })
    } else if (isChequeBill(child)) {
      appendChequeSaleStructuredEvents(child, drafts, {
        includeTotal: false,
        includeBillCreated: false,
        advances,
      })
    }
  }

  const drawerCollected = splitGroupMoneyCollected(parent, children)
  appendSaleTotalCollected(
    drafts,
    drawerCollected,
    advanceApplied,
    latestIso([
      saleLastPaymentEventAt(parent) ?? parent.createdAt,
      ...children.map(
        (c) => saleLastPaymentEventAt(c) ?? saleDisplayCollectionAt(c) ?? c.createdAt,
      ),
    ]) ?? parent.createdAt,
  )

  const timeline = finalizeReceiptEvents(drafts)
  let lines = structuredReceiptLines(drafts, parent.createdAt)
  const settlementTotal = Math.round((drawerCollected + advanceApplied) * 100) / 100
  lines = pruneReceiptLinesWhenFullyCollected(lines, fullBill, settlementTotal)
  return { timeline, lines }
}

export function isoMatchesHistoryDateFilter(
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

function historySaleHasAdvanceApplied(item: HistoryItem): boolean {
  if (item.paySummary?.toLowerCase().includes('advance applied')) return true
  return (
    item.receiptLines?.some((line) => {
      const label = line.label.toLowerCase()
      return label === 'advance applied' || label.startsWith('advance applied')
    }) ?? false
  )
}

/** Dates that should keep a sale visible for a History day filter. */
function historySaleActivityDates(item: HistoryItem): string[] {
  const dates: string[] = []
  if (item.billCreatedAt) dates.push(item.billCreatedAt)
  if (item.completedAt) dates.push(item.completedAt)
  if (item.date) dates.push(item.date)
  for (const collection of item.paymentCollections ?? []) {
    if (collection.at) dates.push(collection.at)
  }
  for (const line of item.receiptLines ?? []) {
    if (line.label === 'Advance applied') {
      if (line.paidAt) dates.push(line.paidAt)
      if (line.date) dates.push(line.date)
      if (line.createdAt) dates.push(line.createdAt)
    }
  }
  for (const event of item.receiptTimeline ?? []) {
    if (event.label === 'Advance applied' && event.date) dates.push(event.date)
  }
  return dates
}

export function matchesHistoryDateFilter(
  item: HistoryItem,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
): boolean {
  if (dateFilter === 'all') return true

  if (item.type === 'sale') {
    // Match any bill activity day: created, settled, cash/bank collected, or advance applied.
    // Never hide a bill that Cash-in-Counter already shows for the same day.
    if (
      historySaleActivityDates(item).some((iso) =>
        isoMatchesHistoryDateFilter(iso, dateFilter, selectedDate),
      )
    ) {
      return true
    }

    const isPending = item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (isPending && item.billCreatedAt) {
      return isoMatchesHistoryDateFilter(item.billCreatedAt, dateFilter, selectedDate)
    }

    // Last resort for advance/return-credit bills with sparse timestamps.
    if (historySaleHasAdvanceApplied(item)) {
      const dateToMatch = item.completedAt ?? item.billCreatedAt ?? item.date
      return isoMatchesHistoryDateFilter(dateToMatch, dateFilter, selectedDate)
    }

    return false
  }

  // Purchases: match any payment day — not only the latest activity date.
  if (item.type === 'purchase') {
    if (item.paymentCollections && item.paymentCollections.length > 0) {
      if (
        item.paymentCollections.some((collection) =>
          isoMatchesHistoryDateFilter(collection.at, dateFilter, selectedDate),
        )
      ) {
        return true
      }
      if (item.hasOpenCredit && item.billCreatedAt) {
        return isoMatchesHistoryDateFilter(item.billCreatedAt, dateFilter, selectedDate)
      }
      return false
    }
    return isoMatchesHistoryDateFilter(item.date, dateFilter, selectedDate)
  }

  // Advance ledger rows (received / return credit / refund).
  if (item.type === 'advance') {
    const dateToMatch = item.completedAt ?? item.billCreatedAt ?? item.date
    return isoMatchesHistoryDateFilter(dateToMatch, dateFilter, selectedDate)
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

    if (dayTotal > 0) {
      return Math.round(dayTotal * 100) / 100
    }

    // Bill created/settled on this day even if drawer collection timestamps differ.
    if (
      historySaleActivityDates(item).some((iso) =>
        isoMatchesHistoryDateFilter(iso, dateFilter, selectedDate),
      )
    ) {
      return historyItemDisplayAmount(item, purchasePaidOnly)
    }

    const isPending = item.receiptLines?.some((line) => line.status === 'pending') ?? false
    if (
      isPending &&
      item.billCreatedAt &&
      isoMatchesHistoryDateFilter(item.billCreatedAt, dateFilter, selectedDate)
    ) {
      return 0
    }
  }

  if (item.type === 'sale') {
    if (
      historySaleActivityDates(item).some((iso) =>
        isoMatchesHistoryDateFilter(iso, dateFilter, selectedDate),
      )
    ) {
      return historyItemDisplayAmount(item, purchasePaidOnly)
    }
  }

  if (item.type === 'purchase' && item.paymentCollections && item.paymentCollections.length > 0) {
    const dayTotal = item.paymentCollections
      .filter((collection) => isoMatchesHistoryDateFilter(collection.at, dateFilter, selectedDate))
      .reduce((sum, collection) => sum + collection.amount, 0)
    if (dayTotal > 0) return dayTotal
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
      if (isReceiptTotalCollectedLabel(line.label)) continue
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
  if (type === 'deposit') return 'Not sale · credited'
  if (type === 'transfer') return 'Transfer'
  if (type === 'purchase') return 'Purchase'
  if (type === 'loan') return 'Loan'
  if (type === 'advance') return 'Advance'
  return 'Expense'
}

function advanceEntryChannelLabel(entry: CustomerAdvanceLedgerEntry): string {
  if (entry.kind === 'from_return') {
    return `Return Credit ${formatMoney(entry.amount)}`
  }
  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (cash > 0 && bank > 0) {
    return `💵 ${formatMoney(cash)} · 🏦 ${formatMoney(bank)}`
  }
  if (bank > 0) return `🏦 ${formatMoney(bank)}`
  if (cash > 0) return `💵 ${formatMoney(cash)}`
  return formatMoney(entry.amount)
}

function advanceEntryPaymentMode(entry: CustomerAdvanceLedgerEntry): HistoryPaymentMode | undefined {
  if (entry.kind === 'from_return') return undefined
  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (cash > 0 && bank > 0) return 'split'
  if (bank > 0) return 'bank'
  if (cash > 0) return 'cash'
  return undefined
}

function advanceAppliedPools(
  entry: CustomerAdvanceLedgerEntry | undefined,
  amount: number,
): { cash: number; bank: number; returnCredit: number } {
  const cash = Math.max(0, entry?.cashAmount ?? 0)
  const bank = Math.max(0, entry?.bankAmount ?? 0)
  let returnCredit = Math.round(Math.max(0, amount - cash - bank) * 100) / 100
  if (returnCredit <= 0.01 && entry?.note) {
    const match = entry.note.match(/Return credit\s+([\d.]+)/i)
    if (match) {
      const fromNote = Number(match[1])
      if (Number.isFinite(fromNote) && fromNote > 0) {
        returnCredit = Math.round(fromNote * 100) / 100
      }
    }
  }
  return { cash, bank, returnCredit }
}

function findAdvanceAppliedForSale(
  advances: CustomerAdvanceLedgerEntry[] | undefined,
  saleId: string,
): CustomerAdvanceLedgerEntry | undefined {
  if (!advances?.length) return undefined
  return advances.find((row) => row.kind === 'applied' && row.saleId === saleId)
}

/** Prefer sale field; fall back to ledger applied rows linked to this sale. */
function saleAdvanceAppliedAmount(
  sale: Sale,
  advances?: CustomerAdvanceLedgerEntry[],
): number {
  const fromSale = sale.customerAdvanceApplied ?? 0
  if (fromSale > 0.01) return fromSale
  if (!advances?.length) return 0
  const total = advances
    .filter((row) => row.kind === 'applied' && row.saleId === sale.id)
    .reduce((sum, row) => sum + row.amount, 0)
  return Math.round(total * 100) / 100
}

function withSaleAdvanceApplied(
  sale: Sale,
  advances?: CustomerAdvanceLedgerEntry[],
): Sale {
  const amount = saleAdvanceAppliedAmount(sale, advances)
  if (amount <= 0.01 || (sale.customerAdvanceApplied ?? 0) >= amount - 0.01) return sale
  return { ...sale, customerAdvanceApplied: amount }
}

function appendAdvanceAppliedReceiptEvents(
  sale: Sale,
  drafts: ReceiptEventDraft[],
  advances?: CustomerAdvanceLedgerEntry[],
): number {
  const amount = saleAdvanceAppliedAmount(sale, advances)
  if (amount <= 0.01) return 0
  const entry = findAdvanceAppliedForSale(advances, sale.id)
  const at = entry?.at ?? sale.updatedAt ?? sale.createdAt
  const pools = advanceAppliedPools(entry, amount)
  const fromReturnCredit = pools.returnCredit > 0.01
  createReceiptDraft(drafts, RECEIPT_SEQ.ADVANCE_APPLIED, {
    label: 'Advance applied',
    date: at,
    amount,
    type: 'collected',
    detail: fromReturnCredit
      ? `Return credit applied to this bill · ${formatMoney(amount)}`
      : `Advance applied to this bill · ${formatMoney(amount)}`,
  })
  return amount
}

function buildAdvanceReceiptLines(
  entry: CustomerAdvanceLedgerEntry,
  title: string,
  detail: string,
): HistoryReceiptLine[] {
  const note = entry.note?.trim()
  const lines: HistoryReceiptLine[] = [
    {
      label: title,
      amount: entry.amount,
      status: entry.kind === 'from_return' ? 'return' : 'paid',
      date: entry.at,
      detail: note ? `${detail} · ${note}` : detail,
    },
  ]
  if (entry.kind === 'from_return') return lines

  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (cash > 0.01) {
    lines.push({
      label: `${title} · Cash`,
      amount: cash,
      status: 'paid',
      date: entry.at,
      detail: formatDate(entry.at),
    })
  }
  if (bank > 0.01) {
    lines.push({
      label: `${title} · Bank`,
      amount: bank,
      status: 'paid',
      date: entry.at,
      detail: formatDate(entry.at),
    })
  }
  return lines
}

function buildCustomerAdvanceHistoryItems(data: AppData): HistoryItem[] {
  const items: HistoryItem[] = []

  for (const entry of data.customerAdvances ?? []) {
    // Applied advance is shown only on the bill receipt — not as its own history row.
    if (entry.kind === 'applied') continue

    const paymentMode = advanceEntryPaymentMode(entry)
    const channel = advanceEntryChannelLabel(entry)
    const paymentModes: HistoryPaymentMode[] =
      paymentMode === 'split'
        ? ['cash', 'bank', 'split']
        : paymentMode
          ? [paymentMode]
          : []

    if (entry.kind === 'refunded') {
      items.push({
        type: 'advance',
        id: `advance-${entry.id}`,
        amount: entry.amount,
        name: entry.customerName,
        date: entry.at,
        billCreatedAt: entry.at,
        completedAt: entry.at,
        paymentMode,
        paymentModes,
        sub: `Advance refunded · ${channel}${entry.note ? ` · ${entry.note}` : ''}`,
        receiptLines: buildAdvanceReceiptLines(
          entry,
          'Advance refunded',
          `Paid out to ${entry.customerName} · ${channel}`,
        ),
        receiptTimeline: buildAdvanceReceiptLines(
          entry,
          'Advance refunded',
          `Paid out to ${entry.customerName} · ${channel}`,
        ).map((line) => ({
          label: line.label,
          date: line.date ?? entry.at,
          amount: line.amount,
          type: 'collected' as const,
          detail: line.detail,
        })),
      })
      continue
    }

    if (entry.kind === 'from_return') {
      const title = 'Return Credit'
      const detail = `Return credited to advance for ${entry.customerName} · not cash received`
      items.push({
        type: 'advance',
        id: `advance-${entry.id}`,
        amount: entry.amount,
        name: entry.customerName,
        date: entry.at,
        billCreatedAt: entry.at,
        completedAt: entry.at,
        // No cash/bank payment mode — this is a return credit, not a drawer receipt.
        sub: `Return Credit · ${formatMoney(entry.amount)}`,
        receiptLines: buildAdvanceReceiptLines(entry, title, detail),
        receiptTimeline: buildAdvanceReceiptLines(entry, title, detail).map((line) => ({
          label: line.label,
          date: line.date ?? entry.at,
          amount: line.amount,
          type: 'return' as const,
          detail: line.detail,
        })),
      })
      continue
    }

    if (entry.kind === 'received') {
      const title = 'Advance created'
      const detail = `Advance created for ${entry.customerName} · ${channel}`
      items.push({
        type: 'advance',
        id: `advance-${entry.id}`,
        amount: entry.amount,
        name: entry.customerName,
        date: entry.at,
        billCreatedAt: entry.at,
        completedAt: entry.at,
        paymentMode,
        paymentModes,
        sub: `Advance created · ${channel}`,
        receiptLines: buildAdvanceReceiptLines(entry, title, detail),
        receiptTimeline: buildAdvanceReceiptLines(entry, title, detail).map((line) => ({
          label: line.label,
          date: line.date ?? entry.at,
          amount: line.amount,
          type: 'collected' as const,
          detail: line.detail,
        })),
      })
    }
  }
  return items
}

function salePendingOutstandingTotal(item: HistoryItem): number {
  return (item.receiptLines ?? [])
    .filter((line) => line.status === 'pending' && (line.amount ?? 0) > 0.01)
    .reduce((sum, line) => sum + line.amount, 0)
}

/** Sale row label — Bill Collected when fully paid; Bill Pending only while balance remains. */
export function getHistoryItemTypeLabel(item: HistoryItem): string {
  if (item.type === 'advance') {
    if (item.sub.toLowerCase().includes('refunded')) return 'Advance refunded'
    if (item.sub.toLowerCase().includes('return credit')) return 'Return Credit'
    if (item.sub.toLowerCase().includes('return')) return 'Return Credit'
    return 'Advance created'
  }
  if (item.type !== 'sale') return getHistoryTypeLabel(item.type)

  const pendingTotal = salePendingOutstandingTotal(item)
  if (pendingTotal <= 0.01) {
    const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
    const advanceOnly =
      modes.length === 0 &&
      (item.receiptLines?.some((line) => line.label.toLowerCase().includes('advance applied')) ??
        false)
    if (advanceOnly) return 'Bill Collected'
    if (modes.length === 1 && modes[0] === 'cash') return 'Cash Collected'
    return 'Bill Collected'
  }

  return 'Bill Pending'
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

  // Paid with customer advance only — not a cash/bank receipt.
  if ((sale.customerAdvanceApplied ?? 0) > 0.01) return []

  // Paid cheque → bank (funds cleared).
  if (sale.payType === 'bank' || sale.payType === 'cheque') return ['bank']
  if (sale.payType === 'split') return ['split']
  if (isChequeBill(sale)) return ['bank']
  return ['cash']
}

function salePaymentMode(sale: Sale): HistoryPaymentMode | undefined {
  const modes = saleCollectionPaymentModes(sale)
  if (modes.includes('split')) return 'split'
  if (modes.length === 1) return modes[0]
  if (modes.includes('credit')) return 'credit'
  if (modes.includes('cheque')) return 'cheque'
  if (modes.includes('pending')) return 'pending'
  if ((sale.customerAdvanceApplied ?? 0) > 0.01) return undefined
  return modes[0] ?? 'cash'
}

function paymentModesFromReceiptLines(
  lines: HistoryReceiptLine[],
): HistoryPaymentMode[] {
  const modes = new Set<HistoryPaymentMode>(['split'])
  for (const line of lines) {
    if (isReceiptTotalCollectedLabel(line.label)) continue
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

function earliestIso(dates: string[]): string {
  return dates.reduce((earliest, next) =>
    new Date(next).getTime() < new Date(earliest).getTime() ? next : earliest,
  )
}

function splitGroupBillCreatedAt(parent: Sale, children: Sale[]): string {
  return earliestIso([parent.createdAt, ...children.map((child) => child.createdAt)])
}

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
  const events = getSalePaymentEvents(sale).filter(
    (event) => event.amount > 0 && !event.cancelled,
  )
  if (events.length > 0) {
    return Math.round(
      events.reduce((sum, event) => sum + paymentEventRealizedAmount(sale, event), 0) * 100,
    ) / 100
  }
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

function buildSplitReceiptLines(
  parent: Sale,
  children: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryReceiptLine[] {
  return buildSplitStructuredReceipt(parent, children, advances).lines
}

function buildSplitTimeline(
  parent: Sale,
  children: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryReceiptEvent[] {
  return buildSplitStructuredReceipt(parent, children, advances).timeline
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
    if (isReceiptTotalCollectedLabel(line.label)) continue
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

function buildSplitGroupItem(
  parent: Sale,
  children: Sale[],
  sales: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryItem {
  const receiptLines = buildSplitReceiptLines(parent, children, advances)
  const receiptTimeline = buildSplitTimeline(parent, children, advances)
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
  const billCreatedAt = splitGroupBillCreatedAt(parent, children)
  const lastCollectedAt = latestIso(
    [parent, ...children]
      .map((sale) => saleLastPaymentEventAt(sale))
      .filter((iso): iso is string => Boolean(iso)),
  )
  const date = lastCollectedAt ?? billCreatedAt
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
    billCreatedAt,
    completedAt,
    paymentMode: 'split',
    paymentModes: paymentModesFromReceiptLines(receiptLines),
    paySummary:
      moneyCollected > 0
        ? `Paid ${formatMoney(moneyCollected)}`
        : formatSplitPaymentBreakdown(receiptLines) || undefined,
  }
}

function buildSaleReceiptLines(
  sale: Sale,
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryReceiptLine[] {
  return buildStructuredSaleReceipt(sale, undefined, advances).lines
}

function buildSaleTimeline(
  sale: Sale,
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryReceiptEvent[] {
  return buildStructuredSaleReceipt(sale, undefined, advances).timeline
}

function buildSalePaymentCollections(sale: Sale): NonNullable<HistoryItem['paymentCollections']> {
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

function buildMergedBalanceGroupHistoryItem(
  members: Sale[],
  allSales: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryItem {
  const primary = balanceGroupPrimary(members)
  const item = buildSaleHistoryItem(primary, allSales, advances)
  const uniqueMembers = [...new Map(members.map((row) => [row.id, row])).values()]

  const collected = saleBillGroupRealizedCollected(primary, uniqueMembers)
  const paymentCollections = uniqueMembers.flatMap((row) => buildSalePaymentCollections(row) ?? [])
  const receipt = buildBalanceGroupStructuredReceipt(uniqueMembers, advances)
  const fullBill =
    primary.originalBillAmount ??
    uniqueMembers.find((row) => row.originalBillAmount)?.originalBillAmount ??
    item.originalBillAmount ??
    item.amount
  const pendingOnReceipt = receipt.lines
    .filter((line) => line.status === 'pending' && line.amount > 0.01)
    .reduce((sum, line) => sum + line.amount, 0)
  const allPaid =
    uniqueMembers.every((row) => row.status !== 'pending' || row.billAmount <= 0.01) &&
    pendingOnReceipt <= 0.01

  return {
    ...item,
    id: primary.parentSplitId ?? primary.id,
    groupSaleIds: uniqueMembers.map((row) => row.id),
    originalBillAmount: fullBill,
    collectedAmount: collected > 0 ? collected : item.collectedAmount,
    amount: collected > 0 ? collected : fullBill,
    paymentCollections: paymentCollections.length > 0 ? paymentCollections : item.paymentCollections,
    receiptLines: receipt.lines,
    receiptTimeline: receipt.timeline,
    paymentMode: allPaid ? (item.paymentMode === 'cash' ? 'cash' : item.paymentMode) : item.paymentMode,
    paymentModes: paymentModesFromReceiptLines(receipt.lines),
    paySummary: buildBalanceGroupPaySummary(uniqueMembers, collected, receipt.lines, fullBill),
    completedAt: allPaid ? item.completedAt : undefined,
  }
}

function buildBalanceGroupPaySummary(
  members: Sale[],
  collected: number,
  lines: HistoryReceiptLine[],
  fullBill: number,
): string | undefined {
  const pending = lines
    .filter((line) => line.status === 'pending' && line.amount > 0.01)
    .map((line) => {
      const lower = line.label.toLowerCase()
      if (lower.includes('cheque')) return `Cheque pending ${formatMoney(line.amount)}`
      if (lower.includes('credit')) return `Credit pending ${formatMoney(line.amount)}`
      return `Pending ${formatMoney(line.amount)}`
    })
  if (pending.length > 0) {
    return `Bill ${formatMoney(fullBill)} · ${pending.join(' · ')}`
  }
  if (collected > 0) return `Paid ${formatMoney(collected)} · Bill collected`
  if (members.every((row) => row.status !== 'pending')) return `Bill ${formatMoney(fullBill)} · Collected`
  return undefined
}

function isBalanceLegSale(sale: Sale): boolean {
  return (
    isCreditBill(sale) ||
    isChequeBill(sale) ||
    sale.payType === 'credit' ||
    sale.payType === 'cheque' ||
    sale.pendingPayType === 'credit' ||
    sale.pendingPayType === 'cheque' ||
    Boolean(sale.parentSplitId) ||
    (sale.pendingBalanceTransfers?.length ?? 0) > 0
  )
}

/** Same customer bill across credit/cheque legs — only via split parent/child links. */
function expandHistoryRelatedSales(sale: Sale, sales: Sale[]): Sale[] {
  // Never merge unrelated bills that merely share customer name + original amount.
  // That incorrectly pulls old Credit→Cheque / cheque approvals into a new bill
  // (e.g. advance + cash + credit on a fresh ₹1000 sale).
  return saleRelatedBillSales(sale, sales)
}

function shouldMergeAsBalanceGroup(related: Sale[]): boolean {
  if (related.length < 2) return false

  // Only merge when rows are actually linked (parentSplitId family).
  const ids = new Set(related.map((row) => row.id))
  const linked = related.some(
    (row) =>
      (row.parentSplitId != null && ids.has(row.parentSplitId)) ||
      related.some((other) => other.parentSplitId === row.id),
  )
  if (!linked) return false

  const legs = related.filter(isBalanceLegSale)
  if (legs.length >= 2 || related.some((row) => row.parentSplitId)) return true

  return related.some(
    (row) =>
      row.payType === 'credit' ||
      row.payType === 'cheque' ||
      row.pendingPayType === 'credit' ||
      row.pendingPayType === 'cheque' ||
      (row.pendingBalanceTransfers?.length ?? 0) > 0 ||
      isCreditBill(row) ||
      isChequeBill(row),
  )
}

function pushBalanceOrSplitHistoryItem(
  related: Sale[],
  sales: Sale[],
  saleItems: HistoryItem[],
  consumedSaleIds: Set<string>,
  advances?: CustomerAdvanceLedgerEntry[],
): void {
  for (const row of related) consumedSaleIds.add(row.id)
  const parent =
    related.find((row) => !row.parentSplitId && related.some((c) => c.parentSplitId === row.id)) ??
    related.find((row) => !row.parentSplitId) ??
    related[0]
  const children = related.filter((row) => row.id !== parent.id)
  const cashSplit =
    parent.payType === 'split' &&
    children.length > 0 &&
    children.some((row) => row.payType !== 'credit' && row.payType !== 'cheque')

  if (cashSplit) {
    saleItems.push(buildSplitGroupItem(parent, children, sales, advances))
  } else {
    saleItems.push(buildMergedBalanceGroupHistoryItem(related, sales, advances))
  }
}

function buildSaleHistoryItem(
  sale: Sale,
  sales: Sale[],
  advances?: CustomerAdvanceLedgerEntry[],
): HistoryItem {
  const settledSale = withSaleAdvanceApplied(sale, advances)
  const collected = collectedPaymentAmount(settledSale)
  const breakdown = saleCollectionBreakdown(settledSale)
  const paymentModes = saleCollectionPaymentModes(settledSale)
  const paymentCollections = buildSalePaymentCollections(settledSale)
  const lastCollectionAt = saleLastPaymentEventAt(settledSale)
  const advanceOnSaleEarly = saleAdvanceAppliedAmount(settledSale, advances)
  const historyListDate =
    settledSale.status === 'pending' && (isCreditBill(settledSale) || isChequeBill(settledSale))
      ? salePendingBalanceHistoryDate(settledSale)
      : lastCollectionAt ??
        (advanceOnSaleEarly > 0.01
          ? settledSale.updatedAt ?? settledSale.createdAt
          : settledSale.createdAt)
  const paidAt =
    settledSale.status !== 'pending'
      ? lastCollectionAt ??
        (advanceOnSaleEarly > 0.01
          ? settledSale.updatedAt ?? settledSale.createdAt
          : saleDisplayCollectionAt(settledSale))
      : lastCollectionAt
  const amount = formatMoney(settledSale.billAmount)
  let sub: string

  if (isCreditBill(settledSale)) {
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub =
      settledSale.status === 'pending'
        ? collected > 0
          ? `Credit · Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(settledSale)} · ${amount} pending${paidTime ? ` · ${paidTime}` : ''}`
          : `Credit · ${amount} pending`
        : `Credit · Paid ${formatMoney(collected)} · ${collectionMethodLabel(settledSale)}${paidTime ? ` · ${paidTime}` : ''}`
  } else if (isChequeBill(settledSale)) {
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub =
      settledSale.status === 'pending'
        ? collected > 0
          ? `Cheque · Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(settledSale)} · ${amount} pending${paidTime ? ` · ${paidTime}` : ''}`
          : `Cheque · ${amount} pending`
        : `Bank · Cheque cleared ${formatMoney(collected)} · ${collectionMethodLabel(settledSale)}${paidTime ? ` · ${paidTime}` : ''}`
  } else {
    const payLabel = salePayLabel(settledSale)
    const paidDetail = paidCollectionDetail(settledSale)
    const orig =
      settledSale.originalBillAmount && settledSale.originalBillAmount !== settledSale.billAmount
        ? `Bill ${formatMoney(settledSale.originalBillAmount)} · Round ${formatMoney(settledSale.billAmount)} · `
        : ''
    const advanceOnlySettled = advanceOnSaleEarly > 0.01 && collected <= 0.01
    const paidPart =
      settledSale.status === 'pending'
        ? isChequeBill(settledSale)
          ? 'Cheque pending · '
          : isCreditBill(settledSale)
            ? 'Credit pending · '
            : 'Pending · '
        : advanceOnlySettled
          ? 'Settled · '
          : settledSale.payType === 'bank' || settledSale.payType === 'credit' || settledSale.payType === 'cheque'
            ? `Paid ${paidDetail ?? payLabel} · `
            : `Give ${formatMoney(settledSale.paidAmount)} · ${paidDetail ?? payLabel} · `
    const paidTime = paidAt ? formatDate(paidAt) : ''
    sub = `${orig}${paidPart}${settledSale.changeAmount > 0 ? `Change ${formatMoney(settledSale.changeAmount)} · ` : ''}${paidTime}`.replace(/ · $/, '')
  }

  const totalBill = saleGrossBillAmount(settledSale)
  const netBill = saleNetBillAmount(settledSale)
  const returnTotal = saleReturnTotal(settledSale)
  const advanceOnSale = advanceOnSaleEarly
  // List/right amount is cash/bank/cheque received only — never Advance applied.
  const listAmount =
    settledSale.status !== 'pending'
      ? collected > 0
        ? collected
        : advanceOnSale > 0
          ? 0
          : netBill
      : isCreditBill(settledSale) || isChequeBill(settledSale)
        ? netBill
        : collected || netBill
  // Keep paySummary simple like a normal bill — advance detail belongs only on the receipt.
  const paySummary =
    settledSale.status !== 'pending' && collected > 0
      ? `Paid ${formatMoney(collected)}`
      : settledSale.status !== 'pending' && advanceOnSale > 0
        ? 'Advance applied'
        : settledSale.status === 'pending' && (isCreditBill(settledSale) || isChequeBill(settledSale))
          ? collected > 0
            ? `Paid ${formatMoney(collected)} · ${partialCollectionDetailLabel(settledSale)} · ${
                isChequeBill(settledSale) ? 'Cheque' : 'Credit'
              } pending ${formatMoney(settledSale.billAmount)}`
            : `${isChequeBill(settledSale) ? 'Cheque' : 'Credit'} pending ${formatMoney(settledSale.billAmount)}`
          : undefined

  const returnSub =
    returnTotal > 0
      ? `Return −${formatMoney(returnTotal)} · Net ${formatMoney(netBill)} · `
      : ''

  return {
    type: 'sale',
    id: settledSale.id,
    amount: listAmount,
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
    name: getSaleCustomerName(settledSale, sales),
    date: historyListDate,
    paymentCollections:
      (paymentCollections?.length ?? 0) > 0 ? paymentCollections : undefined,
    receiptLines: buildSaleReceiptLines(settledSale, advances),
    receiptTimeline: buildSaleTimeline(settledSale, advances),
    billCreatedAt: settledSale.createdAt,
    completedAt:
      settledSale.status !== 'pending'
        ? paidAt ?? settledSale.updatedAt ?? settledSale.createdAt
        : undefined,
    paymentMode: salePaymentMode(settledSale),
    paymentModes,
    paySummary,
    groupSaleIds:
      isCreditBill(settledSale) || isChequeBill(settledSale)
        ? settledSale.parentSplitId
          ? [settledSale.parentSplitId, settledSale.id]
          : [settledSale.id]
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

function purchasePaymentEventLabel(event: PurchaseLedgerPaymentEvent, creditPaymentNumber: number): string {
  if (event.kind === 'cheque-pending') {
    return `${event.billLabel} · Cheque pending`
  }
  if (event.isCreditPaydown) {
    const ord =
      creditPaymentNumber === 1
        ? 'Credit payment'
        : `${ordinalWord(creditPaymentNumber - 1)} credit payment`
    return `${ord} · ${event.billLabel}`
  }
  return `Paid at purchase · ${event.billLabel}`
}

function buildPurchasePaymentCollections(
  data: AppData,
  item: PurchaseHistoryItem,
): NonNullable<HistoryItem['paymentCollections']> {
  return buildPurchaseLedgerPaymentEvents(data, item)
    .filter((event) => event.kind === 'paid' && event.total > 0)
    .map((event) => ({
      at: event.at,
      amount: event.total,
      cash: event.cash,
      bank: event.bank,
      cheque: 0,
    }))
}

function buildPurchaseStructuredReceipt(
  data: AppData,
  item: PurchaseHistoryItem,
): { timeline: HistoryReceiptEvent[]; lines: HistoryReceiptLine[] } {
  const drafts: ReceiptEventDraft[] = []
  const ledgerEvents = buildPurchaseLedgerPaymentEvents(data, item)
  const pendingAmount = Math.max(0, item.amount - item.paidAmount)

  createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
    label:
      item.billType === 'both'
        ? `Purchase · ${item.billLabel}`
        : `Purchase · ${item.billLabel}`,
    date: item.createdAt,
    amount: item.amount,
    type: 'bill-created',
    detail: item.billDate ? `Supplier bill ${formatDate(item.billDate)}` : formatDate(item.createdAt),
  })

  if (item.no1Amount > 0 && item.billType === 'both') {
    const no1Events = ledgerEvents.filter((event) => event.billNumber === 1 && event.kind === 'paid')
    const no1Paid = no1Events.reduce((sum, event) => sum + event.total, 0)
    createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
      label: `${NO1_BILL_LABEL} bill`,
      date: item.createdAt,
      amount: item.no1Amount,
      type: 'bill-created',
      detail:
        no1Paid > 0
          ? `Paid ${formatMoney(no1Paid)}${item.no1ActivityAt ? ` · ${formatDate(item.no1ActivityAt)}` : ''}`
          : `Pending · ${formatMoney(item.no1Amount)} due`,
    })
  }
  if (item.no2Amount > 0 && item.billType === 'both') {
    const no2Events = ledgerEvents.filter((event) => event.billNumber === 2 && event.kind === 'paid')
    const no2Paid = no2Events.reduce((sum, event) => sum + event.total, 0)
    createReceiptDraft(drafts, RECEIPT_SEQ.BILL_CREATED, {
      label: `${NO2_BILL_LABEL} bill`,
      date: item.createdAt,
      amount: item.no2Amount,
      type: 'bill-created',
      detail:
        no2Paid > 0
          ? `Paid ${formatMoney(no2Paid)}${item.no2ActivityAt ? ` · ${formatDate(item.no2ActivityAt)}` : ''}`
          : `Pending · ${formatMoney(item.no2Amount)} due`,
    })
  }

  let creditPaymentNumber = 0
  for (const event of ledgerEvents) {
    if (event.kind === 'cheque-pending') {
      createReceiptDraft(drafts, RECEIPT_SEQ.CHEQUE_PENDING, {
        label: purchasePaymentEventLabel(event, creditPaymentNumber),
        date: event.at,
        amount: event.total,
        type: 'pending-created',
        detail: `${event.methodDetail} · ${formatDate(event.at)}`,
      })
      continue
    }

    if (event.isCreditPaydown) creditPaymentNumber += 1
    const prefix = purchasePaymentEventLabel(event, creditPaymentNumber)

    if (event.cash > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.CASH_RECEIVED, {
        label: `${prefix} · Cash`,
        date: event.at,
        amount: event.cash,
        type: 'collected',
        detail: `${event.methodDetail} · ${formatDate(event.at)}`,
      })
    }
    if (event.bank > 0) {
      createReceiptDraft(drafts, RECEIPT_SEQ.BANK_RECEIVED, {
        label: `${prefix} · Bank`,
        date: event.at,
        amount: event.bank,
        type: 'collected',
        detail: `${event.methodDetail} · ${formatDate(event.at)}`,
      })
    }
  }

  if (item.hasOpenCredit && item.openCreditAmount) {
    createReceiptDraft(drafts, RECEIPT_SEQ.CREDIT_BALANCE, {
      label: 'Credit balance',
      date: item.date,
      amount: item.openCreditAmount,
      type: 'pending-created',
      detail: 'Supplier credit remaining',
    })
  } else if (pendingAmount > 0.01) {
    createReceiptDraft(drafts, RECEIPT_SEQ.REMAINING, {
      label: 'Balance due',
      date: item.date,
      amount: pendingAmount,
      type: 'pending',
      detail: formatDate(item.date),
    })
  }

  if (item.paidAmount > 0) {
    const lastPaidAt =
      ledgerEvents.filter((event) => event.kind === 'paid').at(-1)?.at ?? item.updatedAt
    appendTotalCollected(drafts, item.paidAmount, lastPaidAt)
  }

  const timeline = finalizeReceiptEvents(drafts)
  const lines = structuredReceiptLines(drafts, item.createdAt)
  return { timeline, lines }
}

function buildPurchaseReceiptLines(data: AppData, item: PurchaseHistoryItem): HistoryReceiptLine[] {
  return buildPurchaseStructuredReceipt(data, item).lines
}

function buildPurchaseTimeline(data: AppData, item: PurchaseHistoryItem): HistoryReceiptEvent[] {
  return buildPurchaseStructuredReceipt(data, item).timeline
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

function receiptLineMatchesDateFilter(
  line: HistoryReceiptLine,
  dateFilter: HistoryDateFilter,
  selectedDate: string,
): boolean {
  if (dateFilter === 'all') return true
  const iso = line.date ?? line.paidAt ?? line.createdAt
  if (!iso) return false
  return isoMatchesHistoryDateFilter(iso, dateFilter, selectedDate)
}

function receiptLinePaymentMode(
  label: string,
  status?: HistoryReceiptLine['status'],
): HistoryListPaymentPart['mode'] | null {
  const lower = label.toLowerCase()
  if (lower.includes('changed to cheque')) return null
  if (
    label === 'Cash' ||
    lower.includes('cash received') ||
    lower.includes('credit payment · cash') ||
    lower.includes('paid at purchase') && lower.includes('· cash') ||
    lower.includes('split allocation · cash') ||
    lower.includes('split payment · cash')
  ) {
    return 'cash'
  }
  if (
    label === 'Bank' ||
    lower.includes('bank received') ||
    lower.includes('credit payment · bank') ||
    lower.includes('paid at purchase') && lower.includes('· bank') ||
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
      if (!receiptLineMatchesDateFilter(line, dateFilter, selectedDate)) continue
      const lower = line.label.toLowerCase()
      if (lower.includes('remaining balance') || lower === 'balance due') continue
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
        line.label === 'Total collected' ||
        line.label === 'Bill total collected' ||
        line.label === 'Remaining balance' ||
        line.label === 'Balance due' ||
        line.status === 'return'
      ) {
        continue
      }
      if (dateFilter !== 'all' && !receiptLineMatchesDateFilter(line, dateFilter, selectedDate)) {
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

  // Advance-only bills: no cash/bank parts — list payment text comes from paySummary.

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
  if (item.type === 'advance') {
    if (item.sub.toLowerCase().includes('return credit') || item.sub.toLowerCase().includes('return')) {
      return `↩ ${formatMoney(item.amount)} · Return Credit`
    }
    if (item.sub.toLowerCase().includes('refunded')) {
      return item.paymentMode ? getHistoryPaymentLabel(item.paymentMode) : undefined
    }
  }

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

  if (
    item.type === 'purchase' &&
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
        const ordinal =
          collections.length > 1
            ? `${index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`} `
            : ''
        const when =
          dateFilter === 'all' ? ` · ${formatCollectionDayLabel(collection.at)}` : ''
        const bits: string[] = []
        if (collection.cash > 0) {
          bits.push(`${ordinal}💵 ${formatMoney(collection.cash)}${when}`)
        }
        if (collection.bank + collection.cheque > 0) {
          bits.push(
            `${ordinal}🏦 ${formatMoney(collection.bank + collection.cheque)}${when}`,
          )
        }
        if (bits.length === 0 && collection.amount > 0) {
          bits.push(`${ordinal}🧾 ${formatMoney(collection.amount)}${when}`)
        }
        return bits
      })
      if (dated.length > 0) return dated.join(' · ')
    }
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
    // Don't surface advance-only settlement text on the list — receipt shows that.
    if (item.paySummary === 'Advance applied') {
      return undefined
    }
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
  if (item.type === 'sale' || item.type === 'purchase' || item.type === 'advance') {
    return historyItemListSubtitle(item, dateFilter, selectedDate)
  }
  return item.sub
}

export function historyItemListSubtitle(
  item: HistoryItem,
  dateFilter: HistoryDateFilter = 'all',
  selectedDate = '',
): string {
  if (item.type === 'advance') {
    return item.sub
  }
  if (item.type === 'sale') {
    const bill = item.originalBillAmount ?? item.amount
    const pendingParts = getHistoryItemListPaymentParts(item, dateFilter, selectedDate).filter(
      (part) => part.status === 'pending' && part.amount > 0.01,
    )
    if (pendingParts.length > 0) {
      const pendingText = pendingParts
        .map((part) => {
          if (part.mode === 'cheque') return `Cheque pending ${formatMoney(part.amount)}`
          if (part.mode === 'credit') return `Credit pending ${formatMoney(part.amount)}`
          return `Pending ${formatMoney(part.amount)}`
        })
        .join(' · ')
      return `Bill ${formatMoney(bill)} · ${pendingText}`
    }
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
  if (item.type === 'purchase' && item.paymentCollections && item.paymentCollections.length > 0) {
    const collections = item.paymentCollections.filter((c) => c.amount > 0)
    if (collections.length === 1) {
      return `Paid ${formatDate(collections[0].at)}`
    }
    if (collections.length > 1) {
      return `Last paid ${formatDate(collections[collections.length - 1].at)}`
    }
  }
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
    if (item.type === 'purchase' && item.paymentCollections && item.paymentCollections.length > 1) {
      const parts = item.paymentCollections.map((collection, index) => {
        const ordinal =
          index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`
        return `${ordinal} paid ${formatCollectionDayLabel(collection.at)}`
      })
      return `Created ${created} · ${parts.join(' · ')}`
    }
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
  data: AppData,
  item: PurchaseHistoryItem,
): HistoryReceiptLine[] {
  return buildPurchaseReceiptLines(data, item)
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

function emitSaleHistoryItem(
  sale: Sale,
  sales: Sale[],
  childrenByParent: Map<string, Sale[]>,
  saleItems: HistoryItem[],
  consumedSaleIds: Set<string>,
  advances?: CustomerAdvanceLedgerEntry[],
): void {
  if (consumedSaleIds.has(sale.id)) return

  const related = expandHistoryRelatedSales(sale, sales).filter((row) => !consumedSaleIds.has(row.id))
  if (related.length === 0) return

  if (shouldMergeAsBalanceGroup(related)) {
    pushBalanceOrSplitHistoryItem(related, sales, saleItems, consumedSaleIds, advances)
    return
  }

  const root = related.find((row) => !row.parentSplitId) ?? sale
  if (consumedSaleIds.has(root.id)) return

  const children = childrenByParent.get(root.id) ?? []
  const isSplitGroup = root.payType === 'split' || children.length > 0

  if (isSplitGroup) {
    for (const child of children) consumedSaleIds.add(child.id)
    consumedSaleIds.add(root.id)
    saleItems.push(buildSplitGroupItem(root, children, sales, advances))
    return
  }

  consumedSaleIds.add(root.id)
  saleItems.push(buildSaleHistoryItem(root, sales, advances))
}

function buildHistoryItemsUncached(data: AppData): HistoryItem[] {
  const advances = data.customerAdvances ?? []
  const sales = sanitizeSplitParentChildChequeOverlap(data.sales).map((sale) =>
    withSaleAdvanceApplied(sale, advances),
  )
  const childrenByParent = buildChildrenMap(sales)
  const consumedSaleIds = new Set<string>()
  const saleItems: HistoryItem[] = []

  for (const sale of sales) {
    if (sale.parentSplitId) continue
    emitSaleHistoryItem(sale, sales, childrenByParent, saleItems, consumedSaleIds, advances)
  }

  for (const group of findOrphanSplitGroups(sales, consumedSaleIds)) {
    const fresh = group.filter((row) => !consumedSaleIds.has(row.id))
    if (fresh.length < 2) continue
    for (const child of fresh) consumedSaleIds.add(child.id)
    saleItems.push(
      buildSplitGroupItem(buildSyntheticSplitParent(fresh), fresh, sales, advances),
    )
  }

  for (const sale of sales) {
    emitSaleHistoryItem(sale, sales, childrenByParent, saleItems, consumedSaleIds, advances)
  }

  const expenseItems: HistoryItem[] = data.expenses
    .filter((e) => !isPurchaseExpense(e))
    .flatMap((e): HistoryItem[] => {
    if (e.kind === 'transfer') {
      const toBank = e.transferDirection === 'cash-to-bank'
      return [{
        type: 'transfer',
        id: e.id,
        amount: e.amount,
        sub: toBank ? '💵 → 🏦 Cash to bank' : '🏦 → 💵 Bank to cash',
        name: e.name,
        date: e.createdAt,
        billCreatedAt: e.createdAt,
        paymentMode: toBank ? 'cash' : 'bank',
        paymentModes: [toBank ? 'cash' : 'bank'],
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
      type: isAdd ? 'deposit' : 'expense',
      id: e.id,
      amount: expenseAmount,
      sub: isAdd ? addSub : expenseSub,
      name: e.name,
      date: e.createdAt,
      billCreatedAt: e.createdAt,
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
    const paymentCollections = buildPurchasePaymentCollections(data, item)
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
    const collectionBreakdown = paymentCollections.reduce(
      (acc, row) => {
        acc.cash += row.cash
        acc.bank += row.bank
        acc.cheque += row.cheque
        return acc
      },
      { cash: 0, bank: 0, cheque: 0 },
    )

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
      receiptLines: buildPurchaseListReceiptLines(data, item),
      receiptTimeline: buildPurchaseTimeline(data, item),
      paymentCollections: paymentCollections.length > 0 ? paymentCollections : undefined,
      collectionBreakdown:
        collectionBreakdown.cash > 0 || collectionBreakdown.bank > 0
          ? collectionBreakdown
          : undefined,
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

  const advanceItems = buildCustomerAdvanceHistoryItems(data)

  const items: HistoryItem[] = [
    ...saleItems,
    ...expenseItems,
    ...purchaseItems,
    ...loanItems,
    ...advanceItems,
  ]
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

/** Money actually collected for a history sale row (split-aware). Excludes Advance applied. */
export function historyItemSaleAmount(item: HistoryItem): number {
  if (item.type !== 'sale') return item.amount
  if (item.isSplitGroup) return item.amount

  if (item.collectedAmount != null && item.collectedAmount > 0) {
    return item.collectedAmount
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

/** Map a loan history row id (`loanId-give`, `loanId-settle-0`, …) to the underlying loan id. */
export function resolveLoanIdFromHistoryItemId(id: string, loans: Loan[] = []): string | null {
  if (loans.some((loan) => loan.id === id)) return id
  const giveTake = id.match(/^(.+)-(give|take)$/)
  if (giveTake && loans.some((loan) => loan.id === giveTake[1])) return giveTake[1]
  const settle = id.match(/^(.+)-settle-\d+$/)
  if (settle && loans.some((loan) => loan.id === settle[1])) return settle[1]
  return null
}
