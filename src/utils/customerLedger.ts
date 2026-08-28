import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'
import { memoByDataRef } from './memoByDataRef'
import {
  saleBillGroupId,
  saleCreditPendingAmount,
  saleOriginalBillAmount,
  saleTotalCollected,
} from './salesReport'
import {
  getSalePaymentEvents,
  saleCollectedAmount,
  saleCollectedComponentBreakdown,
} from './salePayment'

export interface CustomerPurchaseRow {
  id: string
  groupId: string
  customerName: string
  date: string
  dateLabel: string
  /** Bill creation timestamp (ISO). */
  billDate: string
  billDateLabel: string
  billAmount: number
  paidAmount: number
  creditPending: number
  creditInvolved: boolean
  payDetail: string
  /** Cash / bank / cheque collected so far. */
  paidBreakdown?: string
  /** Bill date + each payment/approval date on its own line. */
  paymentHistory?: string
}

export interface CustomerSummary {
  name: string
  purchaseCount: number
  totalPaid: number
  totalCreditPending: number
  totalBillAmount: number
  /** Bills with open credit balance. */
  openCreditCount: number
  /** Times customer used credit (open or fully paid). */
  creditTimes: number
  creditBills: CustomerPurchaseRow[]
  lastPurchaseDate: string
  lastPurchaseLabel: string
  purchases: CustomerPurchaseRow[]
}

export interface CustomerCreditAlert {
  name: string
  pendingAmount: number
  openBillCount: number
  lastCreditDate: string
  lastCreditLabel: string
}

export interface CreditOverview {
  totalPending: number
  customerCount: number
  openBillCount: number
  customers: CustomerCreditAlert[]
}

/** Label for open credit bills with no customer name on the sale. */
export const UNNAMED_CREDIT_CUSTOMER = 'Credit sale (no name)'

function isCreditInvolvedSale(sale: Sale): boolean {
  return (
    saleCreditPendingAmount(sale) > 0 ||
    sale.payType === 'credit' ||
    sale.pendingPayType === 'credit' ||
    (sale.creditAmount ?? 0) > 0
  )
}

function groupCreditInvolved(parent: Sale, children: Sale[]): boolean {
  return isCreditInvolvedSale(parent) || children.some((child) => isCreditInvolvedSale(child))
}

function normalizeCustomerName(name?: string): string | null {
  const trimmed = name?.trim()
  return trimmed ? trimmed : null
}

function resolveCustomerLabel(
  names: (string | null | undefined)[],
  allowUnnamedCredit: boolean,
): string | null {
  for (const raw of names) {
    const name = normalizeCustomerName(raw ?? undefined)
    if (name) return name
  }
  return allowUnnamedCredit ? UNNAMED_CREDIT_CUSTOMER : null
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

function saleCollectedPayDetail(sale: Sale): string {
  const breakdown = saleCollectedComponentBreakdown(sale)
  const parts: string[] = []
  if (breakdown.cash > 0) parts.push(`💵 ${formatMoney(breakdown.cash)}`)
  if (breakdown.bank > 0) parts.push(`🏦 ${formatMoney(breakdown.bank)}`)
  if (breakdown.cheque > 0) parts.push(`🧾 ${formatMoney(breakdown.cheque)}`)
  if (parts.length > 0) return parts.join(' · ')
  return salePayDetail(sale)
}

function eventAmountParts(event: { cash?: number; bank?: number; cheque?: number }): string {
  const parts: string[] = []
  if ((event.cash ?? 0) > 0) parts.push(`💵 ${formatMoney(event.cash ?? 0)}`)
  if ((event.bank ?? 0) > 0) parts.push(`🏦 ${formatMoney(event.bank ?? 0)}`)
  if ((event.cheque ?? 0) > 0) parts.push(`🧾 ${formatMoney(event.cheque ?? 0)}`)
  return parts.join(' · ')
}

function isChequeOriginSaleForHistory(sale: Sale): boolean {
  return sale.payType === 'cheque' || sale.pendingPayType === 'cheque'
}

function paymentEventScheduleLabel(
  sale: Sale,
  event: { cash?: number; bank?: number; cheque?: number; cancelled?: boolean },
  index: number,
  total: number,
): string {
  const cash = event.cash ?? 0
  const bank = event.bank ?? 0
  const cheque = event.cheque ?? 0
  const chequeOrigin = isChequeOriginSaleForHistory(sale)
  const ordinal =
    index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`

  if (event.cancelled) {
    if (chequeOrigin && cash <= 0 && (bank > 0 || cheque > 0)) {
      return total <= 1 ? 'Cheque cancelled' : `${ordinal} cheque cancelled`
    }
    return total <= 1 ? 'Payment cancelled' : `${ordinal} payment cancelled`
  }

  if (chequeOrigin && cash <= 0 && (bank > 0 || cheque > 0)) {
    if (total <= 1) return 'Cheque approved'
    return `${ordinal} cheque approved`
  }

  if (total <= 1) return 'Payment'
  return `${ordinal} payment`
}

/** Bill created date + each collection/approval dated separately. */
export function salePaymentHistoryDetail(
  sale: Sale,
  billAmount?: number,
  openLabel: 'Credit' | 'Cheque' | 'Bill' = 'Bill',
): string | undefined {
  const events = getSalePaymentEvents(sale).filter((event) => event.amount > 0)
  const lines: string[] = [
    `Bill ${formatDate(sale.createdAt)} · ${formatMoney(billAmount ?? sale.originalBillAmount ?? sale.billAmount)}`,
  ]

  if (events.length === 0) {
    if (sale.status === 'pending') {
      lines.push(
        `${openLabel} pending · ${formatMoney(sale.billAmount)}`,
      )
      return lines.join('\n')
    }
    return lines.join('\n')
  }

  events.forEach((event, index) => {
    const label = paymentEventScheduleLabel(sale, event, index, events.length)
    const parts = eventAmountParts(event)
    if (event.cancelled) {
      lines.push(
        `${label} · ${formatDate(event.cancelledAt ?? event.at)} · ${formatMoney(event.amount)}`,
      )
      return
    }
    lines.push(`${label} · ${formatDate(event.at)}${parts ? ` · ${parts}` : ` · ${formatMoney(event.amount)}`}`)
  })

  if (sale.status === 'pending' && sale.billAmount > 0) {
    lines.push(`${openLabel} pending · ${formatMoney(sale.billAmount)}`)
  }

  return lines.join('\n')
}

/** Merge dated payment lines from parent + split children. */
export function mergeSalePaymentHistoryDetail(
  sales: Sale[],
  billAmount: number,
  openLabel: 'Credit' | 'Cheque' | 'Bill' = 'Bill',
): string | undefined {
  const primary = sales[0]
  if (!primary) return undefined

  const allEvents = sales
    .flatMap((sale) =>
      getSalePaymentEvents(sale)
        .filter((event) => event.amount > 0)
        .map((event) => ({ sale, event })),
    )
    .sort((a, b) => new Date(a.event.at).getTime() - new Date(b.event.at).getTime())

  const lines: string[] = [
    `Bill ${formatDate(primary.createdAt)} · ${formatMoney(billAmount)}`,
  ]

  if (allEvents.length === 0) {
    const openPending = sales.reduce((sum, sale) => {
      if (sale.status !== 'pending') return sum
      return sum + sale.billAmount
    }, 0)
    if (openPending > 0) lines.push(`${openLabel} pending · ${formatMoney(openPending)}`)
    return lines.join('\n')
  }

  allEvents.forEach(({ sale, event }, index) => {
    const label = paymentEventScheduleLabel(sale, event, index, allEvents.length)
    const parts = eventAmountParts(event)
    lines.push(`${label} · ${formatDate(event.at)}${parts ? ` · ${parts}` : ` · ${formatMoney(event.amount)}`}`)
  })

  const openPending = sales.reduce((sum, sale) => {
    if (sale.status !== 'pending') return sum
    return sum + sale.billAmount
  }, 0)
  if (openPending > 0) lines.push(`${openLabel} pending · ${formatMoney(openPending)}`)

  return lines.join('\n')
}

export function buildPayDetail(
  sale: Sale,
  billAmount: number,
  paidAmount: number,
  openPending: number,
  openLabel: 'Credit' | 'Cheque' = 'Credit',
  relatedSales?: Sale[],
): { payDetail: string; paidBreakdown?: string; paymentHistory?: string } {
  const paidBreakdown = paidAmount > 0 ? saleCollectedPayDetail(sale) : undefined
  const paymentHistory =
    relatedSales && relatedSales.length > 1
      ? mergeSalePaymentHistoryDetail(relatedSales, billAmount, openLabel)
      : salePaymentHistoryDetail(sale, billAmount, openLabel)
  const payDetail =
    openPending > 0
      ? `Bill ${formatMoney(billAmount)} · Paid ${formatMoney(paidAmount)}${paidBreakdown ? ` (${paidBreakdown})` : ''} · ${openLabel} ${formatMoney(openPending)}`
      : `${paidBreakdown ?? salePayDetail(sale)} · Paid ${formatMoney(paidAmount)}`
  return { payDetail, paidBreakdown, paymentHistory }
}

function salePayDetail(sale: Sale): string {
  if (sale.payType === 'bank') return '🏦 Bank'
  if (sale.payType === 'cheque') return '🧾 Cheque'
  if (sale.payType === 'credit') return '💳 Credit'
  if (sale.payType === 'split') {
    const parts: string[] = []
    if ((sale.cashAmount ?? 0) > 0) parts.push(`💵 ${formatMoney(sale.cashAmount ?? 0)}`)
    if ((sale.bankAmount ?? 0) > 0) parts.push(`🏦 ${formatMoney(sale.bankAmount ?? 0)}`)
    if ((sale.chequeAmount ?? 0) > 0) parts.push(`🧾 ${formatMoney(sale.chequeAmount ?? 0)}`)
    if ((sale.creditAmount ?? 0) > 0) parts.push(`💳 ${formatMoney(sale.creditAmount ?? 0)}`)
    return parts.length > 0 ? parts.join(' · ') : '➗ Split'
  }
  return '💵 Cash'
}

function groupBillAmount(parent: Sale, children: Sale[]): number {
  if (parent.originalBillAmount && parent.originalBillAmount > 0) return parent.originalBillAmount
  const childOrig = children.find((c) => c.originalBillAmount && c.originalBillAmount > 0)
  if (childOrig?.originalBillAmount) return childOrig.originalBillAmount
  const creditPending = children.reduce((sum, c) => sum + saleCreditPendingAmount(c), 0)
  const collected =
    (parent.status !== 'pending' ? saleTotalCollected(parent) : saleCollectedAmount(parent)) +
    children.reduce((sum, c) => sum + saleCollectedAmount(c), 0)
  if (creditPending > 0 || collected > 0) return parent.billAmount + creditPending + collected
  return parent.billAmount + children.reduce((sum, c) => sum + c.billAmount, 0)
}

function buildGroupPurchaseRow(parent: Sale, children: Sale[]): CustomerPurchaseRow | null {
  const billAmount = groupBillAmount(parent, children)
  const paidAmount =
    (parent.status !== 'pending' ? saleTotalCollected(parent) : saleCollectedAmount(parent)) +
    children.reduce((sum, child) => sum + saleCollectedAmount(child), 0)
  const creditPending =
    saleCreditPendingAmount(parent) + children.reduce((sum, child) => sum + saleCreditPendingAmount(child), 0)
  const creditInvolved = groupCreditInvolved(parent, children)
  const customerName = resolveCustomerLabel(
    [parent.customerName, ...children.map((child) => child.customerName)],
    creditPending > 0 || creditInvolved,
  )
  if (!customerName) return null

  const date = parent.createdAt
  const detail = buildPayDetail(parent, billAmount, paidAmount, creditPending, 'Credit', [
    parent,
    ...children,
  ])

  return {
    id: parent.id,
    groupId: parent.id,
    customerName,
    date,
    dateLabel: formatDate(date),
    billDate: parent.createdAt,
    billDateLabel: formatDate(parent.createdAt),
    billAmount: billAmount || parent.billAmount + children.reduce((sum, c) => sum + c.billAmount, 0),
    paidAmount,
    creditPending,
    creditInvolved: groupCreditInvolved(parent, children),
    payDetail: detail.payDetail,
    paidBreakdown: detail.paidBreakdown,
    paymentHistory: detail.paymentHistory,
  }
}

function buildSinglePurchaseRow(sale: Sale): CustomerPurchaseRow | null {
  const billAmount = saleOriginalBillAmount(sale)
  const paidAmount = saleCollectedAmount(sale)
  const creditPending = saleCreditPendingAmount(sale)
  const creditInvolved = isCreditInvolvedSale(sale)
  const customerName = resolveCustomerLabel([sale.customerName], creditPending > 0 || creditInvolved)
  if (!customerName) return null

  const date = sale.createdAt
  const detail = buildPayDetail(sale, billAmount, paidAmount, creditPending)

  return {
    id: sale.id,
    groupId: saleBillGroupId(sale),
    customerName,
    date,
    dateLabel: formatDate(date),
    billDate: sale.createdAt,
    billDateLabel: formatDate(sale.createdAt),
    billAmount,
    paidAmount,
    creditPending,
    creditInvolved: isCreditInvolvedSale(sale),
    payDetail: detail.payDetail,
    paidBreakdown: detail.paidBreakdown,
    paymentHistory: detail.paymentHistory,
  }
}

export function buildCustomerPurchases(data: AppData): CustomerPurchaseRow[] {
  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  const rows: CustomerPurchaseRow[] = []

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      const row = buildGroupPurchaseRow(sale, children)
      if (row) rows.push(row)
      continue
    }

    const row = buildSinglePurchaseRow(sale)
    if (row) rows.push(row)
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    const row = buildSinglePurchaseRow(sale)
    if (row) rows.push(row)
  }

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

function buildCustomerSummariesUncached(data: AppData): CustomerSummary[] {
  const byName = new Map<string, CustomerPurchaseRow[]>()

  for (const row of buildCustomerPurchases(data)) {
    const list = byName.get(row.customerName) ?? []
    list.push(row)
    byName.set(row.customerName, list)
  }

  const summaries: CustomerSummary[] = []

  for (const [name, purchases] of byName) {
    const seenGroups = new Set<string>()
    let totalPaid = 0
    let totalCreditPending = 0
    let totalBillAmount = 0
    let creditTimes = 0
    const creditBills: CustomerPurchaseRow[] = []

    for (const purchase of purchases) {
      totalPaid += purchase.paidAmount
      totalCreditPending += purchase.creditPending
      if (purchase.creditInvolved) creditTimes += 1
      if (purchase.creditPending > 0) creditBills.push(purchase)
      if (!seenGroups.has(purchase.groupId)) {
        seenGroups.add(purchase.groupId)
        totalBillAmount += purchase.billAmount
      }
    }

    creditBills.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const lastPurchaseDate = purchases[0]?.date ?? ''
    summaries.push({
      name,
      purchaseCount: seenGroups.size,
      totalPaid,
      totalCreditPending,
      totalBillAmount,
      openCreditCount: creditBills.length,
      creditTimes,
      creditBills,
      lastPurchaseDate,
      lastPurchaseLabel: lastPurchaseDate ? formatDate(lastPurchaseDate) : '—',
      purchases,
    })
  }

  return summaries.sort((a, b) => {
    const timeDiff = new Date(b.lastPurchaseDate).getTime() - new Date(a.lastPurchaseDate).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.name.localeCompare(b.name)
  })
}

export const buildCustomerSummaries = memoByDataRef(buildCustomerSummariesUncached)

export function searchCustomerSummaries(
  summaries: CustomerSummary[],
  query: string,
): CustomerSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return summaries
  return summaries.filter((summary) => summary.name.toLowerCase().includes(q))
}

export function filterCustomersWithCredit(summaries: CustomerSummary[]): CustomerSummary[] {
  return summaries
    .filter((summary) => summary.totalCreditPending > 0)
    .sort((a, b) => b.totalCreditPending - a.totalCreditPending || a.name.localeCompare(b.name))
}

function buildCreditOverviewUncached(data: AppData): CreditOverview {
  const customers = filterCustomersWithCredit(buildCustomerSummaries(data)).map((summary) => ({
    name: summary.name,
    pendingAmount: summary.totalCreditPending,
    openBillCount: summary.openCreditCount,
    lastCreditDate: summary.creditBills[0]?.date ?? summary.lastPurchaseDate,
    lastCreditLabel: summary.creditBills[0]?.dateLabel ?? summary.lastPurchaseLabel,
  }))

  return {
    totalPending: customers.reduce((sum, customer) => sum + customer.pendingAmount, 0),
    customerCount: customers.length,
    openBillCount: customers.reduce((sum, customer) => sum + customer.openBillCount, 0),
    customers,
  }
}

export const buildCreditOverview = memoByDataRef(buildCreditOverviewUncached)

export function getCustomerSummary(
  summaries: CustomerSummary[],
  name: string,
): CustomerSummary | undefined {
  const trimmed = name.trim()
  return summaries.find((summary) => summary.name === trimmed)
}

export function lookupCustomerCreditPending(
  data: AppData,
  name: string,
  summaries?: CustomerSummary[],
): number {
  const key = name.trim().toLowerCase()
  if (!key) return 0
  const list = summaries ?? buildCustomerSummaries(data)
  for (const summary of list) {
    if (summary.name.trim().toLowerCase() === key) {
      return summary.totalCreditPending
    }
  }
  return 0
}
