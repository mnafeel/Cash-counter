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
