import type { Sale, SaleReturnEntry } from '../types'
import { getSalePaymentEvents, saleCollectedAmount } from './salePayment'
import { formatMoney } from './format'

export function saleReturnTotal(
  sale: Pick<Sale, 'returns'> | { returns?: SaleReturnEntry[] } | null | undefined,
): number {
  if (!sale?.returns?.length) return 0
  return sale.returns.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0)
}

/** Parent + split children that share one customer bill (includes siblings when anchor row was removed). */
export function saleRelatedBillSales(sale: Sale, allSales: Sale[]): Sale[] {
  const byId = new Map<string, Sale>()
  byId.set(sale.id, sale)

  const anchorId = sale.parentSplitId ?? sale.id
  for (const row of allSales) {
    if (row.id === anchorId || row.parentSplitId === anchorId) {
      byId.set(row.id, row)
    }
  }

  return [...byId.values()]
}

function saleOpenBalanceGroupGross(sale: Sale, allSales: Sale[]): number {
  const group = saleRelatedBillSales(sale, allSales)
  let gross = 0
  for (const row of group) {
    gross = Math.max(gross, saleGrossBillAmount(row), row.originalBillAmount ?? 0)
  }
  return gross > 0 ? gross : saleGrossBillAmount(sale)
}

function saleOpenBalanceGroupReturns(sale: Sale, allSales: Sale[]): number {
  const group = saleRelatedBillSales(sale, allSales)
  let total = 0
  for (const row of group) {
    total = Math.max(total, saleReturnTotal(row))
  }
  return total
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

/** Cash / bank / approved cheque received on the bill — excludes open credit & pending cheque. */
export function saleBillGroupRealizedCollected(sale: Sale, allSales: Sale[] = []): number {
  const gross = saleOpenBalanceGroupGross(sale, allSales)
  const returns = saleOpenBalanceGroupReturns(sale, allSales)
  const openCredit = linkedPendingCreditTotal(sale, allSales)
  const openCheque = linkedPendingChequeTotal(sale, allSales)
  return Math.max(
    0,
    Math.round((gross - returns - openCredit - openCheque) * 100) / 100,
  )
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

export function isCreditPendingSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.payType === 'credit' || sale.pendingPayType === 'credit')
  )
}

export function isChequePendingSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.payType === 'cheque' || sale.pendingPayType === 'cheque')
  )
}

/** Open amount on a pending credit or cheque leg row. */
export function salePendingLegAmount(sale: Sale): number {
  if (isCreditPendingSale(sale)) {
    return Math.max(sale.billAmount ?? 0, sale.creditAmount ?? 0)
  }
  if (isChequePendingSale(sale)) {
    return Math.max(sale.billAmount ?? 0, sale.chequeAmount ?? 0)
  }
  return sale.billAmount ?? 0
}

/** Shared anchor for credit ↔ cheque pending legs (standalone or split children). */
export function saleBalanceLinkId(sale: Sale): string | null {
  if (sale.parentSplitId) return sale.parentSplitId
  if (isCreditPendingSale(sale) || isChequePendingSale(sale)) return sale.id
  return null
}

/** Anchor + pending children that share one open customer balance. */
export function saleLinkedPendingLegs(sale: Sale, allSales: Sale[]): Sale[] {
  const linkId = saleBalanceLinkId(sale)
  if (!linkId) {
    return sale.status === 'pending' ? [sale] : []
  }
  const legs: Sale[] = []
  const anchor = allSales.find((row) => row.id === linkId)
  if (anchor && anchor.status === 'pending') legs.push(anchor)
  for (const row of allSales) {
    if (
      row.parentSplitId === linkId &&
      row.status === 'pending' &&
      !legs.some((leg) => leg.id === row.id)
    ) {
      legs.push(row)
    }
  }
  return legs
}

/** Clear remaining due: original − sum(all payments) − returns. */
/** Sum of all open cheque legs linked to this bill (handles split + repeated transfers). */
export function linkedPendingChequeTotal(sale: Sale, allSales: Sale[] = []): number {
  const legs = saleLinkedPendingLegs(sale, allSales).filter(isChequePendingSale)
  if (legs.length === 0) {
    return isChequePendingSale(sale) ? salePendingLegAmount(sale) : 0
  }
  const total = legs.reduce((sum, leg) => sum + salePendingLegAmount(leg), 0)
  return Math.round(total * 100) / 100
}

/** Sum of all open credit legs linked to this bill. */
export function linkedPendingCreditTotal(sale: Sale, allSales: Sale[] = []): number {
  const legs = saleLinkedPendingLegs(sale, allSales).filter(isCreditPendingSale)
  if (legs.length === 0) {
    return isCreditPendingSale(sale) ? salePendingLegAmount(sale) : 0
  }
  const total = legs.reduce((sum, leg) => sum + salePendingLegAmount(leg), 0)
  return Math.round(total * 100) / 100
}

export function saleCreditBalanceDue(sale: Sale, allSales: Sale[] = []): number {
  if (
    sale.status === 'pending' &&
    allSales.length > 0 &&
    (isCreditPendingSale(sale) || isChequePendingSale(sale))
  ) {
    const gross = saleOpenBalanceGroupGross(sale, allSales)
    const returns = saleOpenBalanceGroupReturns(sale, allSales)
    const paid = saleBillGroupPaidTotal(sale, allSales)
    const groupDue = Math.max(0, Math.round((gross - paid - returns) * 100) / 100)
    if (isChequePendingSale(sale)) {
      const chequeOpen = linkedPendingChequeTotal(sale, allSales)
      if (chequeOpen > 0.01) {
        return Math.min(groupDue, Math.round(chequeOpen * 100) / 100)
      }
    }
    if (isCreditPendingSale(sale)) {
      const creditOpen = linkedPendingCreditTotal(sale, allSales)
      if (creditOpen > 0.01) {
        return Math.min(groupDue, Math.round(creditOpen * 100) / 100)
      }
    }
    const leg = salePendingLegAmount(sale)
    if (leg > 0.01) return Math.min(groupDue, leg)
    return groupDue
  }
  const gross = saleGrossBillAmount(sale)
  const returns = saleReturnTotal(sale)
  const paid = saleBillGroupPaidTotal(sale, allSales)
  return Math.max(0, Math.round((gross - paid - returns) * 100) / 100)
}

export type SaleReturnDraft = {
  itemName: string
  quantity: number
  rate: number
  discountAmount?: number
  gstPercent?: number
  taxAmount?: number
}

export function calculateSaleReturnAmount(input: {
  quantity: number
  rate: number
  discountAmount?: number
  gstPercent?: number
  taxAmount?: number
}): {
  subtotal: number
  discountAmount: number
  gstPercent: number
  taxAmount: number
  amount: number
} {
  const quantity = Math.max(0, input.quantity)
  const rate = Math.max(0, input.rate)
  const subtotal = Math.round(quantity * rate * 100) / 100
  const discountAmount = Math.max(0, Math.min(subtotal, input.discountAmount ?? 0))
  const gstPercent = Math.max(0, input.gstPercent ?? 0)
  const taxable = Math.max(0, subtotal - discountAmount)
  const taxFromPercent = Math.round(taxable * (gstPercent / 100) * 100) / 100
  const taxAmount =
    input.taxAmount != null && input.taxAmount >= 0
      ? Math.round(input.taxAmount * 100) / 100
      : taxFromPercent
  const amount = Math.round((taxable + taxAmount) * 100) / 100
  return { subtotal, discountAmount, gstPercent, taxAmount, amount }
}

export function formatSaleReturnLine(entry: SaleReturnEntry): string {
  const qty = entry.quantity
  const qtyLabel = Number.isInteger(qty) ? String(qty) : String(qty)
  const parts = [`${entry.itemName} · ${qtyLabel} × ${formatMoney(entry.rate)}`]
  if ((entry.discountAmount ?? 0) > 0) parts.push(`disc ${formatMoney(entry.discountAmount!)}`)
  if ((entry.taxAmount ?? 0) > 0) parts.push(`tax ${formatMoney(entry.taxAmount!)}`)
  else if ((entry.gstPercent ?? 0) > 0) parts.push(`GST ${entry.gstPercent}%`)
  return parts.join(' · ')
}

export function buildSaleReturnEntry(input: SaleReturnDraft & {
  id?: string
  createdAt?: string
}): SaleReturnEntry | null {
  const itemName = input.itemName.trim()
  const quantity = Math.max(0, input.quantity)
  const rate = Math.max(0, input.rate)
  if (!itemName || quantity <= 0 || rate < 0) return null

  const calc = calculateSaleReturnAmount(input)
  if (calc.amount <= 0) return null

  return {
    id: input.id ?? crypto.randomUUID(),
    itemName,
    quantity,
    rate,
    subtotal: calc.subtotal,
    discountAmount: calc.discountAmount > 0 ? calc.discountAmount : undefined,
    gstPercent: calc.gstPercent > 0 && (input.taxAmount == null) ? calc.gstPercent : undefined,
    taxAmount: calc.taxAmount > 0 ? calc.taxAmount : undefined,
    amount: calc.amount,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export type SaleReturnGridRow = {
  id: string
  itemName: string
  quantity: number
  rate: number
  createdAt: string
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function saleReturnLineSubtotal(quantity: number, rate: number): number {
  return roundMoney(Math.max(0, quantity) * Math.max(0, rate))
}

/** Pull grid rows + footer discount/tax from saved return entries. */
export function saleReturnGridFromEntries(entries: SaleReturnEntry[]): {
  rows: SaleReturnGridRow[]
  discountAmount: number
  taxAmount: number
} {
  let discountAmount = 0
  let taxAmount = 0
  const rows: SaleReturnGridRow[] = []
  for (const entry of entries) {
    discountAmount = roundMoney(discountAmount + Math.max(0, entry.discountAmount ?? 0))
    if ((entry.taxAmount ?? 0) > 0) {
      taxAmount = roundMoney(taxAmount + (entry.taxAmount ?? 0))
    } else if ((entry.gstPercent ?? 0) > 0) {
      const sub = entry.subtotal ?? saleReturnLineSubtotal(entry.quantity, entry.rate)
      const disc = Math.max(0, entry.discountAmount ?? 0)
      taxAmount = roundMoney(
        taxAmount + Math.max(0, sub - disc) * ((entry.gstPercent ?? 0) / 100),
      )
    }
    rows.push({
      id: entry.id,
      itemName: entry.itemName,
      quantity: entry.quantity,
      rate: entry.rate,
      createdAt: entry.createdAt,
    })
  }
  return { rows, discountAmount, taxAmount }
}

/**
 * Build persisted return lines from the billing grid.
 * Discount + tax are document-level (footer) and stored on the first line;
 * line amounts are scaled so they sum to the final return total.
 */
export function buildSaleReturnEntriesFromGrid(
  rows: SaleReturnGridRow[],
  footer: { discountAmount: number; taxAmount: number },
): SaleReturnEntry[] {
  const valid = rows.filter(
    (row) => row.itemName.trim() && row.quantity > 0 && row.rate >= 0,
  )
  if (valid.length === 0) return []

  const bases = valid.map((row) => ({
    row,
    subtotal: saleReturnLineSubtotal(row.quantity, row.rate),
  }))
  const itemsSubtotal = roundMoney(bases.reduce((sum, row) => sum + row.subtotal, 0))
  if (itemsSubtotal <= 0) return []

  const discountAmount = Math.max(0, Math.min(itemsSubtotal, footer.discountAmount))
  const taxable = roundMoney(Math.max(0, itemsSubtotal - discountAmount))
  const taxAmount = Math.max(0, roundMoney(footer.taxAmount))
  const grandTotal = roundMoney(taxable + taxAmount)
  if (grandTotal <= 0) return []

  const entries: SaleReturnEntry[] = []
  let allocated = 0
  for (let i = 0; i < bases.length; i += 1) {
    const { row, subtotal } = bases[i]
    const isLast = i === bases.length - 1
    const share = isLast
      ? roundMoney(grandTotal - allocated)
      : roundMoney((subtotal / itemsSubtotal) * grandTotal)
    allocated = roundMoney(allocated + share)
    entries.push({
      id: row.id,
      itemName: row.itemName.trim(),
      quantity: row.quantity,
      rate: row.rate,
      subtotal,
      discountAmount: i === 0 && discountAmount > 0 ? discountAmount : undefined,
      taxAmount: i === 0 && taxAmount > 0 ? taxAmount : undefined,
      amount: share,
      createdAt: row.createdAt,
    })
  }
  return entries
}

export function saleReturnGridTotals(
  rows: SaleReturnGridRow[],
  footer: { discountAmount: number; taxAmount: number },
): {
  itemsSubtotal: number
  discountAmount: number
  taxAmount: number
  grandTotal: number
} {
  const itemsSubtotal = roundMoney(
    rows.reduce(
      (sum, row) =>
        row.itemName.trim() && row.quantity > 0
          ? sum + saleReturnLineSubtotal(row.quantity, row.rate)
          : sum,
      0,
    ),
  )
  const discountAmount = Math.max(0, Math.min(itemsSubtotal, footer.discountAmount))
  const taxAmount = Math.max(0, roundMoney(footer.taxAmount))
  const grandTotal = roundMoney(Math.max(0, itemsSubtotal - discountAmount) + taxAmount)
  return { itemsSubtotal, discountAmount, taxAmount, grandTotal }
}
