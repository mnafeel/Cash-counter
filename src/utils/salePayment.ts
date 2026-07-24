import type { Sale, SalePaymentEvent } from '../types'

export interface SaleCollectedBreakdown {
  cash: number
  bank: number
  cheque: number
  total: number
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
  const nextBank = collected.bankAmount ?? 0
  const nextCheque =
    collected.chequeApproved && (collected.chequeAmount ?? 0) > 0 ? collected.chequeAmount ?? 0 : 0

  if (!original || original.status !== 'pending') {
    const amount = collected.paidAmount
    return {
      at,
      amount,
      cash: nextCash > 0 ? nextCash : undefined,
      bank: nextBank > 0 ? nextBank : undefined,
      cheque: nextCheque > 0 ? nextCheque : undefined,
    }
  }

  const addCash = Math.max(0, nextCash - prev.cash)
  const addBank = Math.max(0, nextBank - prev.bank)
  const addCheque = Math.max(0, nextCheque - prev.cheque)
  const amount = addCash + addBank + addCheque

  return {
    at,
    amount,
    cash: addCash > 0 ? addCash : undefined,
    bank: addBank > 0 ? addBank : undefined,
    cheque: addCheque > 0 ? addCheque : undefined,
  }
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

export function repairSalePaymentEvents(sale: Sale): Sale {
  if (!sale.paymentEvents || sale.paymentEvents.length < 2) return sale

  const repaired: SalePaymentEvent[] = []
  for (const event of sale.paymentEvents) {
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

  if (repaired.length === sale.paymentEvents.length) return sale
  return { ...sale, paymentEvents: repaired }
}

export function salePaymentEventsInRange(
  sale: Sale,
  fromDate?: string,
  toDate?: string,
): SalePaymentEvent[] {
  return (sale.paymentEvents ?? []).filter((event) => isIsoInDateRange(event.at, fromDate, toDate))
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
    let paid = sale.cashAmount ?? 0
    if ((sale.bankAmount ?? 0) > 0) paid += sale.bankAmount ?? 0
    if (sale.chequeApproved && (sale.chequeAmount ?? 0) > 0) {
      paid += sale.chequeAmount ?? 0
    }
    if (paid > 0) return paid
    return sale.paidAmount > 0 ? sale.paidAmount : 0
  }

  const cash = sale.cashAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (sale.chequeApproved && cheque > 0) bank = Math.max(0, bank - cheque)
  const componentTotal = cash + bank + cheque
  if (componentTotal > 0) return componentTotal
  if (sale.paidAmount > 0) return sale.paidAmount
  return sale.billAmount
}

export function salePendingCreditPaidBreakdown(sale: Sale): {
  cash: number
  bank: number
  cheque: number
  total: number
} {
  const empty = { cash: 0, bank: 0, cheque: 0, total: 0 }
  if (sale.status !== 'pending') return empty

  const cash = sale.cashAmount ?? 0
  const bank = sale.bankAmount ?? 0
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  const total = cash + bank + cheque
  if (total > 0) return { cash, bank, cheque, total }

  if (sale.paidAmount > 0) {
    return { cash: sale.paidAmount, bank: 0, cheque: 0, total: sale.paidAmount }
  }

  return empty
}
