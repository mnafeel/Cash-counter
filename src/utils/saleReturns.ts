import type { Sale, SaleReturnEntry } from '../types'
import { getSalePaymentEvents, saleCollectedAmount } from './salePayment'
import { formatMoney } from './format'

export function saleReturnTotal(
  sale: Pick<Sale, 'returns'> | { returns?: SaleReturnEntry[] } | null | undefined,
): number {
  if (!sale?.returns?.length) return 0
  return sale.returns.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0)
}

/** Parent + split children that share one customer bill. */
export function saleRelatedBillSales(sale: Sale, allSales: Sale[]): Sale[] {
  const byId = new Map<string, Sale>()
  byId.set(sale.id, sale)

  if (sale.parentSplitId) {
    const parent = allSales.find((row) => row.id === sale.parentSplitId)
    if (parent) byId.set(parent.id, parent)
    for (const row of allSales) {
      if (row.parentSplitId === sale.parentSplitId) byId.set(row.id, row)
    }
  } else {
    for (const row of allSales) {
      if (row.parentSplitId === sale.id) byId.set(row.id, row)
    }
  }

  return [...byId.values()]
}

/**
 * Sum of every collection toward this bill: 1st/2nd/3rd payments, cheque,
 * and split parent/sibling collections.
 */
export function saleBillGroupPaidTotal(sale: Sale, allSales: Sale[] = []): number {
  const group = allSales.length > 0 ? saleRelatedBillSales(sale, allSales) : [sale]
  let total = 0
  for (const row of group) {
    total += saleCollectedAmount(row)
  }
  return total
}

export type SaleBillPaymentLine = {
  key: string
  label: string
  amount: number
}

/** Dated payment lines (1st, 2nd, cheque, etc.) across the bill group. */
export function saleBillPaymentLines(sale: Sale, allSales: Sale[] = []): SaleBillPaymentLine[] {
  const group = allSales.length > 0 ? saleRelatedBillSales(sale, allSales) : [sale]
  const lines: SaleBillPaymentLine[] = []
  let paymentIndex = 0

  for (const row of group) {
    const events = getSalePaymentEvents(row).filter((event) => event.amount > 0 && !event.cancelled)
    for (const event of events) {
      const cash = event.cash ?? 0
      const bank = event.bank ?? 0
      const cheque = event.cheque ?? 0
      const ordinal =
        paymentIndex === 0
          ? '1st'
          : paymentIndex === 1
            ? '2nd'
            : paymentIndex === 2
              ? '3rd'
              : `${paymentIndex + 1}th`
      paymentIndex += 1

      const channel =
        cheque > 0 && cash <= 0 && bank <= cheque
          ? 'Cheque'
          : cash > 0 && bank <= 0 && cheque <= 0
            ? 'Cash'
            : bank > 0 && cash <= 0 && cheque <= 0
              ? 'Bank'
              : cheque > 0
                ? 'Cheque'
                : 'Payment'

      lines.push({
        key: `${row.id}-${event.at}-${paymentIndex}`,
        label: `${ordinal} ${channel.toLowerCase()}`,
        amount: event.amount,
      })
    }

    // Paid split parent with no paymentEvents — still count as an advance payment.
    if (events.length === 0 && row.status === 'paid') {
      const amount = saleCollectedAmount(row)
      if (amount > 0) {
        const ordinal =
          paymentIndex === 0
            ? '1st'
            : paymentIndex === 1
              ? '2nd'
              : paymentIndex === 2
                ? '3rd'
                : `${paymentIndex + 1}th`
        paymentIndex += 1
        lines.push({
          key: `${row.id}-paid`,
          label: `${ordinal} payment`,
          amount,
        })
      }
    }
  }

  return lines
}

/** Bill total before returns (gross). */
export function saleGrossBillAmount(sale: Sale): number {
  const returnTotal = saleReturnTotal(sale)
  if (sale.originalBillAmount != null && sale.originalBillAmount > 0) {
    return sale.originalBillAmount
  }
  const collected = saleCollectedAmount(sale)
  if (sale.status === 'pending') {
    return sale.billAmount + collected + returnTotal
  }
  return sale.billAmount + returnTotal
}

/** Bill after returns (customer obligation before collections). */
export function saleNetBillAmount(sale: Sale): number {
  return Math.max(0, saleGrossBillAmount(sale) - saleReturnTotal(sale))
}

/** Remaining credit/cheque due after ALL payments + returns. */
export function saleBalanceAfterReturns(sale: Sale, allSales: Sale[] = []): number {
  return saleCreditBalanceDue(sale, allSales)
}

/** Clear remaining due: original − sum(all payments) − returns. */
export function saleCreditBalanceDue(sale: Sale, allSales: Sale[] = []): number {
  const gross = saleGrossBillAmount(sale)
  const returns = saleReturnTotal(sale)
  const paid = saleBillGroupPaidTotal(sale, allSales)
  return Math.max(0, Math.round((gross - paid - returns) * 100) / 100)
}

export function formatSaleReturnLine(entry: SaleReturnEntry): string {
  const qty = entry.quantity
  const qtyLabel = Number.isInteger(qty) ? String(qty) : String(qty)
  return `${entry.itemName} · ${qtyLabel} × ${formatMoney(entry.rate)}`
}

export function buildSaleReturnEntry(input: {
  itemName: string
  quantity: number
  rate: number
  id?: string
  createdAt?: string
}): SaleReturnEntry | null {
  const itemName = input.itemName.trim()
  const quantity = Math.max(0, input.quantity)
  const rate = Math.max(0, input.rate)
  const amount = Math.round(quantity * rate * 100) / 100
  if (!itemName || quantity <= 0 || rate < 0 || amount <= 0) return null
  return {
    id: input.id ?? crypto.randomUUID(),
    itemName,
    quantity,
    rate,
    amount,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}
