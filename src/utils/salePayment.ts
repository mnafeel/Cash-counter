import type { Sale, SalePaymentEvent } from '../types'

export interface SaleCollectedBreakdown {
  cash: number
  bank: number
  cheque: number
  total: number
}

const paymentEventsCache = new Map<string, SalePaymentEvent[]>()
const breakdownCache = new Map<string, SaleCollectedBreakdown>()

function saleCacheKey(sale: Sale): string {
  const eventsLen = sale.paymentEvents?.length ?? 0
  const ev = sale.paymentEvents?.[0]
  const evKey = ev
    ? `${ev.cash ?? 0}:${ev.bank ?? 0}:${ev.cheque ?? 0}:${ev.amount}`
    : ''
  // Include cash/bank/cheque so sanitize (same updatedAt / event count) cannot
  // return a stale cached breakdown that still credits cheque money as cash.
  return `${sale.id}:${sale.updatedAt ?? sale.createdAt}:${eventsLen}:${sale.status ?? 'paid'}:${sale.cashAmount ?? 0}:${sale.bankAmount ?? 0}:${sale.chequeAmount ?? 0}:${sale.chequeApproved ? 1 : 0}:${evKey}`
}

export function clearSalePaymentCaches(): void {
  paymentEventsCache.clear()
  breakdownCache.clear()
}

function localDayTimestamp(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function inputDateTimestamp(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function isIsoInDateRange(iso: string, fromDate?: string, toDate?: string): boolean {
  if (!fromDate && !toDate) return true
  const day = localDayTimestamp(iso)
  if (fromDate && day < inputDateTimestamp(fromDate)) return false
  if (toDate && day > inputDateTimestamp(toDate)) return false
  return true
}

/** Legacy partial payments stored on the sale before paymentEvents existed. */
export function priorPaymentEventsFromSale(sale: Sale): SalePaymentEvent[] {
  if (sale.paymentEvents && sale.paymentEvents.length > 0) return sale.paymentEvents

  const prior = salePendingCreditPaidBreakdown(sale)
  if (prior.total <= 0) return []

  return [
    {
      at: sale.updatedAt ?? sale.createdAt,
      amount: prior.total,
      cash: prior.cash > 0 ? prior.cash : undefined,
      bank: prior.bank > 0 ? prior.bank : undefined,
      cheque: prior.cheque > 0 ? prior.cheque : undefined,
    },
  ]
}

/** @deprecated Use priorPaymentEventsFromSale on the pre-payment sale only. */
export function ensurePriorPaymentEventsOnSale(sale: Sale): Sale {
  const events = priorPaymentEventsFromSale(sale)
  if (events.length === 0 || (sale.paymentEvents && sale.paymentEvents.length > 0)) return sale
  return { ...sale, paymentEvents: events }
}

export function buildIncrementalPaymentEvent(
  original: Sale | undefined,
  collected: {
    paidAmount: number
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    chequeApproved?: boolean
  },
  at: string,
): SalePaymentEvent {
  const prev = original ? salePendingCreditPaidBreakdown(original) : { cash: 0, bank: 0, cheque: 0, total: 0 }
  const nextCash = collected.cashAmount ?? 0
  let nextBank = collected.bankAmount ?? 0
  const nextCheque =
    collected.chequeApproved && (collected.chequeAmount ?? 0) > 0 ? collected.chequeAmount ?? 0 : 0
  if (nextCheque > 0) nextBank = Math.max(0, nextBank - nextCheque)

  if (!original || original.status !== 'pending') {
    return paymentEventFromNormalizedBreakdown(at, {
      cash: nextCash,
      bank: nextBank,
      cheque: nextCheque,
      total: collected.paidAmount,
    })
  }

  const addCash = Math.max(0, nextCash - prev.cash)
  const addBank = Math.max(0, nextBank - prev.bank)
  const addCheque = Math.max(0, nextCheque - prev.cheque)

  return paymentEventFromNormalizedBreakdown(at, {
    cash: addCash,
    bank: addBank,
    cheque: addCheque,
    total: addCash + addBank + addCheque,
  })
}

export function appendSalePaymentEvent(
  sale: Sale,
  event: Omit<SalePaymentEvent, 'amount'> & { amount: number },
): Sale {
  const nextEvent: SalePaymentEvent = {
    at: event.at,
    amount: event.amount,
    cash: event.cash && event.cash > 0 ? event.cash : undefined,
    bank: event.bank && event.bank > 0 ? event.bank : undefined,
    cheque: event.cheque && event.cheque > 0 ? event.cheque : undefined,
  }
  return {
    ...sale,
    paymentEvents: [...(sale.paymentEvents ?? []), nextEvent],
  }
}

export function normalizeCollectedBreakdown(breakdown: SaleCollectedBreakdown): SaleCollectedBreakdown {
  const cash = breakdown.cash
  let bank = breakdown.bank
  const cheque = breakdown.cheque
  if (cheque > 0) {
    // Approved cheque is bank money — never show as a separate cheque bucket.
    bank = bank >= cheque ? bank : bank + cheque
    return { cash, bank, cheque: 0, total: cash + bank }
  }
  return { cash, bank, cheque: 0, total: cash + bank }
}

/** Cheque→bank settlements (not cash collections against a cheque bill). */
export function isChequeOriginSale(sale: Sale): boolean {
  if (sale.payType === 'split' || sale.payType === 'cash') return false
  if (sale.payType === 'cheque') return true
  // Started as cheque pending but collected as bank/cheque approve
  return (
    sale.pendingPayType === 'cheque' &&
    (sale.chequeApproved === true || sale.payType === 'bank')
  )
}

/**
 * Strip duplicate cash that was wrongly copied onto cheque→bank rows.
 * Does not convert intentional cash collections into bank.
 */
export function sanitizeChequeSaleCash(sale: Sale): Sale {
  const cash = sale.cashAmount ?? 0
  const eventsHaveCash = (sale.paymentEvents ?? []).some((e) => (e.cash ?? 0) > 0)

  // Split parent: cash that exactly duplicates an approved cheque on the same row
  // is a mis-type — keep the cheque→bank credit only.
  if (sale.payType === 'split') {
    const cheque =
      sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
    if (cash > 0 && cheque > 0 && Math.abs(cash - cheque) < 0.01) {
      let bank = sale.bankAmount ?? 0
      if (cheque > 0) bank = Math.max(0, bank - cheque)
      const bankTotal = bank + cheque
      const next: Sale = {
        ...sale,
        cashAmount: undefined,
        bankAmount: bankTotal > 0 ? bankTotal : undefined,
      }
      if (next.paymentEvents && next.paymentEvents.length > 0) {
        const bankAt = [...(sale.paymentEvents ?? [])]
          .reverse()
          .find((e) => (e.bank ?? 0) > 0 || (e.cheque ?? 0) > 0)?.at
        const at =
          bankAt ??
          sale.paymentEvents?.[sale.paymentEvents.length - 1]?.at ??
          sale.updatedAt ??
          sale.createdAt
        next.paymentEvents = [
          paymentEventFromNormalizedBreakdown(at, {
            cash: 0,
            bank: bankTotal,
            cheque: 0,
            total: bankTotal,
          }),
        ]
      }
      return next
    }
    return sale
  }

  // Intentional cash collection (including against a former cheque bill) — leave alone.
  if (sale.payType === 'cash') return sale

  // Only clean cheque→bank rows where cash duplicates the bank/cheque amount.
  if (sale.payType !== 'cheque' && !(sale.chequeApproved && (sale.chequeAmount ?? 0) > 0)) {
    return sale
  }

  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0
      ? sale.chequeAmount ?? 0
      : sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (cheque > 0) bank = Math.max(0, bank - cheque)
  const bankChequeTotal = bank + cheque

  if (cash <= 0 && !eventsHaveCash) return sale

  // Cash-only on a cheque payType with no bank yet: keep cash (user collected as cash
  // but payType may still say cheque). Do not move it to bank.
  if (cash > 0 && bankChequeTotal <= 0) return sale

  // Duplicate mis-type: same amount in cash and bank/cheque — drop cash.
  const cashDuplicatesBank =
    cash > 0 &&
    bankChequeTotal > 0 &&
    (Math.abs(cash - bankChequeTotal) < 0.01 ||
      Math.abs(cash - cheque) < 0.01 ||
      Math.abs(cash - (sale.bankAmount ?? 0)) < 0.01)

  if (!cashDuplicatesBank && !eventsHaveCash) return sale
  if (!cashDuplicatesBank && eventsHaveCash) {
    // Events may still carry duplicate cash — rebuild from fields without forcing cash→bank.
    if (cash > 0 && bankChequeTotal > 0 && !cashDuplicatesBank) return sale
  }

  const bankTotal = bankChequeTotal
  const next: Sale = {
    ...sale,
    cashAmount: undefined,
    bankAmount: bankTotal > 0 ? bankTotal : undefined,
    chequeAmount: bankTotal > 0 ? (sale.chequeAmount ?? bankTotal) : sale.chequeAmount,
    chequeApproved: bankTotal > 0 ? true : sale.chequeApproved,
  }

  if (next.paymentEvents && next.paymentEvents.length > 0) {
    const bankAt = [...(sale.paymentEvents ?? [])]
      .reverse()
      .find((e) => (e.bank ?? 0) > 0 || (e.cheque ?? 0) > 0)?.at
    const at =
      bankAt ??
      sale.paymentEvents?.[sale.paymentEvents.length - 1]?.at ??
      sale.updatedAt ??
      sale.createdAt
    next.paymentEvents = [
      paymentEventFromNormalizedBreakdown(at, {
        cash: 0,
        bank: bankTotal,
        cheque: 0,
        total: bankTotal,
      }),
    ]
  }

  return next
}

function rebuildSalePaymentEventsFromFields(sale: Sale): SalePaymentEvent[] {
  const cash = sale.cashAmount ?? 0
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  let bank = sale.bankAmount ?? 0
  if (cheque > 0) bank = Math.max(0, bank - cheque)
  const total = cash + bank + cheque
  if (total <= 0) return []

  const at =
    sale.paymentEvents?.find((e) => (e.bank ?? 0) > 0 || (e.cheque ?? 0) > 0 || (e.cash ?? 0) > 0)
      ?.at ??
    sale.paymentEvents?.[0]?.at ??
    sale.updatedAt ??
    sale.createdAt
  return [
    paymentEventFromNormalizedBreakdown(at, {
      cash,
      bank,
      cheque,
      total,
    }),
  ]
}

function paidChequeChildrenCollected(chequeChildren: Sale[]): number {
  return chequeChildren.reduce((sum, child) => {
    if (child.status === 'pending') return sum
    const cash = child.cashAmount ?? 0
    const cheque =
      child.chequeApproved && (child.chequeAmount ?? 0) > 0 ? child.chequeAmount ?? 0 : 0
    let childBankAmt = child.bankAmount ?? 0
    if (cheque > 0) childBankAmt = Math.max(0, childBankAmt - cheque)
    const collected = cash + childBankAmt + cheque
    if (collected > 0) return sum + collected
    if (child.paidAmount > 0) return sum + child.paidAmount
    return sum + child.billAmount
  }, 0)
}

/**
 * Split parents sometimes kept the cheque on the parent AND created a cheque child.
 * That doubles bank (parent bank/cheque + child bank). Strip the parent cheque copy.
 * Also strip parent cash that only duplicates the paid cheque child (legacy mis-type).
 */
export function sanitizeSplitParentChildChequeOverlap(sales: Sale[]): Sale[] {
  const chequeChildrenByParent = new Map<string, Sale[]>()
  for (const sale of sales) {
    if (!sale.parentSplitId) continue
    if (sale.payType !== 'cheque' && sale.pendingPayType !== 'cheque') continue
    const list = chequeChildrenByParent.get(sale.parentSplitId) ?? []
    list.push(sale)
    chequeChildrenByParent.set(sale.parentSplitId, list)
  }
  if (chequeChildrenByParent.size === 0) {
    return sales.map((sale) => sanitizeChequeSaleCash(sale))
  }

  return sales.map((sale) => {
    const chequeChildren = chequeChildrenByParent.get(sale.id)
    if (!chequeChildren || chequeChildren.length === 0) {
      return sanitizeChequeSaleCash(sale)
    }

    // Only strip an approved cheque copy from the parent. Pending chequeAmount on
    // the parent (without approval) is also moved to the child, but parent bank
    // must stay — bank + pending-cheque is a valid split.
    const approvedParentCheque =
      sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
    const pendingParentCheque =
      !sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
    const paidChildBank = paidChequeChildrenCollected(chequeChildren)

    let bank = sale.bankAmount ?? 0
    let cash = sale.cashAmount ?? 0
    let changed = false
    let strippedChequeOverlap = false
    let next: Sale = sale

    if (approvedParentCheque > 0) {
      bank = Math.max(0, bank - approvedParentCheque)
      next = {
        ...sale,
        chequeAmount: undefined,
        chequeApproved: undefined,
        bankAmount: bank > 0 ? bank : undefined,
      }
      changed = true
      strippedChequeOverlap = true
    } else if (pendingParentCheque > 0) {
      // Child owns the open cheque — drop it from the parent row only.
      next = {
        ...sale,
        chequeAmount: undefined,
        chequeApproved: undefined,
      }
      changed = true
      strippedChequeOverlap = true
    } else if (
      bank > 0 &&
      paidChildBank > 0 &&
      Math.abs(bank - paidChildBank) < 0.01
    ) {
      // Parent bank may already be the folded approved cheque with no chequeAmount left.
      // Only compare against PAID cheque children — never pending (bank + pending cheque
      // with the same amount is a valid split).
      next = {
        ...sale,
        bankAmount: undefined,
        chequeAmount: undefined,
        chequeApproved: undefined,
      }
      bank = 0
      changed = true
      strippedChequeOverlap = true
    }

    // Cash on the parent that exactly matches the paid cheque child is usually a
    // duplicate mis-type (cheque credited as cash). Keep intentional cash when
    // cash + child still fits within the original bill (e.g. cash 50k + cheque 50k).
    cash = next.cashAmount ?? 0
    const eventsCash = (next.paymentEvents ?? []).reduce((sum, e) => sum + (e.cash ?? 0), 0)
    const cashToCheck = cash > 0 ? cash : eventsCash
    if (
      cashToCheck > 0 &&
      paidChildBank > 0 &&
      Math.abs(cashToCheck - paidChildBank) < 0.01
    ) {
      const billCap = next.originalBillAmount
      const remainingBank = next.bankAmount ?? 0
      const totalIfKeepCash = cashToCheck + remainingBank + paidChildBank
      const exceedsBill =
        billCap != null && billCap > 0 && totalIfKeepCash > billCap + 0.01
      // Whole bill was the cheque amount — parent cash copy is phantom.
      const billIsJustTheCheque =
        billCap != null && billCap > 0 && Math.abs(billCap - paidChildBank) < 0.01
      if (exceedsBill || strippedChequeOverlap || billIsJustTheCheque) {
        next = {
          ...next,
          cashAmount: undefined,
        }
        cash = 0
        changed = true
      }
    }

    if (changed) {
      next = { ...next, paymentEvents: rebuildSalePaymentEventsFromFields(next) }
    }

    return sanitizeChequeSaleCash(next)
  })
}

/** Approved cheque in payment events / history rows → bank only. */
export function normalizePaymentEvent(event: SalePaymentEvent): SalePaymentEvent {
  const cash = event.cash ?? 0
  const bank = event.bank ?? 0
  const cheque = event.cheque ?? 0
  if (cash === 0 && bank === 0 && cheque === 0) {
    return event
  }
  const normalized = normalizeCollectedBreakdown({
    cash,
    bank,
    cheque,
    total: event.amount > 0 ? event.amount : cash + bank + cheque,
  })
  return {
    at: event.at,
    amount: normalized.total,
    cash: normalized.cash > 0 ? normalized.cash : undefined,
    bank: normalized.bank > 0 ? normalized.bank : undefined,
    cheque: normalized.cheque > 0 ? normalized.cheque : undefined,
  }
}

function paymentEventFromNormalizedBreakdown(
  at: string,
  breakdown: SaleCollectedBreakdown,
): SalePaymentEvent {
  const normalized = normalizeCollectedBreakdown(breakdown)
  return {
    at,
    amount: normalized.total,
    cash: normalized.cash > 0 ? normalized.cash : undefined,
    bank: normalized.bank > 0 ? normalized.bank : undefined,
    cheque: normalized.cheque > 0 ? normalized.cheque : undefined,
  }
}

export function salePaidCollectedBreakdown(sale: Sale): SaleCollectedBreakdown {
  const rawCash = sale.cashAmount ?? 0
  // Only treat as cheque→bank when settled via cheque approve — not cash collection.
  const isChequeToBank =
    sale.payType === 'cheque' ||
    (sale.chequeApproved === true &&
      (sale.chequeAmount ?? 0) > 0 &&
      sale.payType !== 'cash' &&
      sale.payType !== 'split')
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  const splitChequeDupCash =
    sale.payType === 'split' &&
    cheque > 0 &&
    rawCash > 0 &&
    Math.abs(rawCash - cheque) < 0.01
  const cash = isChequeToBank || splitChequeDupCash ? 0 : rawCash
  let bank = sale.bankAmount ?? 0
  if (cheque > 0) bank = Math.max(0, bank - cheque)
  if (isChequeToBank && rawCash > 0) {
    const bankCheque = bank + cheque
    // Duplicate cash only — do not fold distinct/sole cash into bank.
    if (
      bankCheque > 0 &&
      (Math.abs(rawCash - bankCheque) < 0.01 ||
        Math.abs(rawCash - cheque) < 0.01 ||
        Math.abs(rawCash - (sale.bankAmount ?? 0)) < 0.01)
    ) {
      // drop duplicate cash (already excluded via cash=0)
    }
  }
  const total = cash + bank + cheque
  if (total > 0) {
    return normalizeCollectedBreakdown({
      cash,
      bank,
      cheque,
      total,
    })
  }
  if (sale.paidAmount > 0) {
    if (sale.payType === 'bank' || sale.payType === 'cheque') {
      return { cash: 0, bank: sale.paidAmount, cheque: 0, total: sale.paidAmount }
    }
    if (sale.payType === 'split') {
      return { cash: 0, bank: 0, cheque: 0, total: 0 }
    }
    return { cash: sale.paidAmount, bank: 0, cheque: 0, total: sale.paidAmount }
  }
  if (sale.billAmount > 0) {
    if (sale.payType === 'bank' || sale.payType === 'cheque') {
      return { cash: 0, bank: sale.billAmount, cheque: 0, total: sale.billAmount }
    }
    if (sale.payType === 'split') {
      return { cash: 0, bank: 0, cheque: 0, total: 0 }
    }
    return { cash: sale.billAmount, bank: 0, cheque: 0, total: sale.billAmount }
  }
  return { cash: 0, bank: 0, cheque: 0, total: 0 }
}

/** When cash/bank was collected — never use updatedAt alone (edits must not move activity). */
export function saleCollectionTimestamp(sale: Sale): string {
  if (sale.paymentEvents && sale.paymentEvents.length > 0) return sale.paymentEvents[0].at
  const events = inferLegacyPaymentEvents(sale)
  if (events.length > 0) return events[0].at
  return sale.createdAt
}

export function paymentEventFromCollectedBreakdown(
  at: string,
  breakdown: SaleCollectedBreakdown,
): SalePaymentEvent {
  return paymentEventFromNormalizedBreakdown(at, breakdown)
}

/** Rebuild payment events for a paid bill at the original collection date. */
export function buildPaidSalePaymentEvents(sale: Sale, at?: string): SalePaymentEvent[] {
  const collected =
    sale.status === 'pending' ? salePendingCreditPaidBreakdown(sale) : salePaidCollectedBreakdown(sale)
  if (collected.total <= 0) return []
  return [paymentEventFromNormalizedBreakdown(at ?? saleCollectionTimestamp(sale), collected)]
}

function paymentEventFromBreakdown(at: string, breakdown: SaleCollectedBreakdown): SalePaymentEvent {
  return paymentEventFromNormalizedBreakdown(at, breakdown)
}

/** Rebuild payment events for sales saved before paymentEvents existed. */
export function inferLegacyPaymentEvents(sale: Sale): SalePaymentEvent[] {
  if (sale.paymentEvents && sale.paymentEvents.length > 0) return sale.paymentEvents

  if (sale.status === 'pending') {
    const prior = salePendingCreditPaidBreakdown(sale)
    if (prior.total <= 0) return []
    return [paymentEventFromBreakdown(sale.updatedAt ?? sale.createdAt, prior)]
  }

  const collected = salePaidCollectedBreakdown(sale)
  if (collected.total <= 0) return []

  return [paymentEventFromBreakdown(sale.updatedAt ?? sale.createdAt, collected)]
}

export function getSalePaymentEvents(sale: Sale): SalePaymentEvent[] {
  const key = saleCacheKey(sale)
  const cached = paymentEventsCache.get(key)
  if (cached) return cached

  // Always sanitize first so legacy cash-on-cheque rows never reach activity/balances.
  const cleaned = sanitizeChequeSaleCash(sale)
  const raw =
    cleaned.paymentEvents && cleaned.paymentEvents.length > 0
      ? repairSalePaymentEvents(cleaned).paymentEvents ?? []
      : inferLegacyPaymentEvents(cleaned)
  const result = raw.map(normalizePaymentEvent)
  paymentEventsCache.set(key, result)
  return result
}

export function migrateSalePaymentEvents(sale: Sale): Sale {
  const repaired = repairSalePaymentEvents(sale)
  if (repaired.paymentEvents && repaired.paymentEvents.length > 0) {
    return repaired
  }

  const inferred = inferLegacyPaymentEvents(sale)
  if (inferred.length === 0) return sale
  return { ...sale, paymentEvents: inferred }
}

export function repairSalePaymentEvents(sale: Sale): Sale {
  const sanitized = sanitizeChequeSaleCash(sale)

  if (!sanitized.paymentEvents || sanitized.paymentEvents.length === 0) return sanitized

  const repaired: SalePaymentEvent[] = []
  for (const event of sanitized.paymentEvents) {
    const prev = repaired[repaired.length - 1]
    const isDuplicate =
      prev &&
      localDayTimestamp(prev.at) === localDayTimestamp(event.at) &&
      prev.amount === event.amount &&
      (prev.cash ?? 0) === (event.cash ?? 0) &&
      (prev.bank ?? 0) === (event.bank ?? 0) &&
      (prev.cheque ?? 0) === (event.cheque ?? 0)
    if (!isDuplicate) repaired.push(event)
  }

  let next =
    repaired.length === sanitized.paymentEvents.length && sanitized === sale
      ? sanitized
      : { ...sanitized, paymentEvents: repaired }

  // Paid bills: payment events must match final cash/bank on the sale row.
  // Pending split amounts must not linger after switching to a single pay type.
  if (next.status !== 'pending' && (next.paymentEvents?.length ?? 0) > 0) {
    const fieldBreakdown = salePaidCollectedBreakdown(next)
    if (fieldBreakdown.total > 0) {
      const eventBreakdown = normalizeCollectedBreakdown(
        (next.paymentEvents ?? []).reduce(
          (acc, event) => {
            acc.cash += event.cash ?? 0
            acc.bank += event.bank ?? 0
            acc.cheque += event.cheque ?? 0
            acc.total += event.amount
            return acc
          },
          { cash: 0, bank: 0, cheque: 0, total: 0 },
        ),
      )
      const totalsMatch =
        Math.abs(eventBreakdown.cash - fieldBreakdown.cash) < 0.01 &&
        Math.abs(eventBreakdown.bank - fieldBreakdown.bank) < 0.01 &&
        Math.abs(eventBreakdown.total - fieldBreakdown.total) < 0.01
      if (!totalsMatch) {
        return {
          ...next,
          paymentEvents: [
            paymentEventFromBreakdown(saleCollectionTimestamp(next), fieldBreakdown),
          ],
        }
      }
    }
  }

  return next
}

export function salePaymentEventsInRange(
  sale: Sale,
  fromDate?: string,
  toDate?: string,
): SalePaymentEvent[] {
  return getSalePaymentEvents(sale).filter((event) => isIsoInDateRange(event.at, fromDate, toDate))
}

export function saleHasCollectionInRange(
  sale: Sale,
  fromDate?: string,
  toDate?: string,
): boolean {
  return salePaymentEventsInRange(sale, fromDate, toDate).length > 0
}

/** Cash / bank / approved cheque already collected on a sale (including partial pending credit). */
export function saleCollectedAmount(sale: Sale): number {
  if (sale.status === 'pending') {
    const cash = sale.cashAmount ?? 0
    const cheque =
      sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
    let bank = sale.bankAmount ?? 0
    // Counter writes bankAmount = chequeAmount for approvals — count once.
    if (cheque > 0) bank = Math.max(0, bank - cheque)
    const splitChequeDupCash =
      sale.payType === 'split' &&
      cheque > 0 &&
      cash > 0 &&
      Math.abs(cash - cheque) < 0.01
    const paid = (splitChequeDupCash ? 0 : cash) + bank + cheque
    if (paid > 0) return paid
    if (sale.paidAmount > 0) {
      if (sale.pendingPayType === 'cheque' || sale.payType === 'cheque') return sale.paidAmount
      return sale.paidAmount
    }
    return 0
  }

  return saleCollectedComponentBreakdown(sale).total
}

export function saleCollectedComponentBreakdown(sale: Sale): SaleCollectedBreakdown {
  const key = saleCacheKey(sale)
  const cached = breakdownCache.get(key)
  if (cached) return cached

  const events = getSalePaymentEvents(sale)
  let result: SaleCollectedBreakdown
  if (events.length > 0) {
    const raw = events.reduce(
      (acc, event) => {
        acc.cash += event.cash ?? 0
        acc.bank += event.bank ?? 0
        acc.cheque += event.cheque ?? 0
        acc.total += event.amount
        return acc
      },
      { cash: 0, bank: 0, cheque: 0, total: 0 },
    )
    result = normalizeCollectedBreakdown(raw)
  } else if (sale.status === 'pending') {
    result = normalizeCollectedBreakdown(salePendingCreditPaidBreakdown(sale))
  } else {
    result = salePaidCollectedBreakdown(sale)
  }
  breakdownCache.set(key, result)
  return result
}

/** Cash / bank / approved cheque already collected on a pending credit or cheque bill. */
export function salePendingCreditPaidBreakdown(sale: Sale): {
  cash: number
  bank: number
  cheque: number
  total: number
} {
  const empty = { cash: 0, bank: 0, cheque: 0, total: 0 }
  if (sale.status !== 'pending') return empty

  const cash = sale.cashAmount ?? 0
  let bank = sale.bankAmount ?? 0
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  // Counter writes bankAmount = chequeAmount for approvals — count once.
  if (cheque > 0) bank = Math.max(0, bank - cheque)
  const total = cash + bank + cheque
  if (total > 0) return normalizeCollectedBreakdown({ cash, bank, cheque, total })

  if (sale.paidAmount > 0) {
    // Cheque pending must never infer paidAmount as cash.
    if (sale.pendingPayType === 'cheque' || sale.payType === 'cheque') {
      return { cash: 0, bank: sale.paidAmount, cheque: 0, total: sale.paidAmount }
    }
    return { cash: sale.paidAmount, bank: 0, cheque: 0, total: sale.paidAmount }
  }

  return empty
}
