import type { Sale } from '../types'

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
