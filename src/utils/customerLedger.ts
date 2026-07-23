import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'
import {
  saleBillGroupId,
  saleCreditPendingAmount,
  saleOriginalBillAmount,
  saleTotalCollected,
} from './salesReport'
import { saleCollectedAmount } from './salePayment'

export interface CustomerPurchaseRow {
  id: string
  groupId: string
  customerName: string
  date: string
  dateLabel: string
  billAmount: number
  paidAmount: number
  creditPending: number
  creditInvolved: boolean
  payDetail: string
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

  const date = parent.updatedAt ?? parent.createdAt

  return {
    id: parent.id,
    groupId: parent.id,
    customerName,
    date,
    dateLabel: formatDate(date),
    billAmount: billAmount || parent.billAmount + children.reduce((sum, c) => sum + c.billAmount, 0),
    paidAmount,
    creditPending,
    creditInvolved: groupCreditInvolved(parent, children),
    payDetail:
      creditPending > 0
        ? `Bill ${formatMoney(billAmount)} · Paid ${formatMoney(paidAmount)} · Credit ${formatMoney(creditPending)}`
        : `${salePayDetail(parent)} · Paid ${formatMoney(paidAmount)}`,
  }
}

function buildSinglePurchaseRow(sale: Sale): CustomerPurchaseRow | null {
  const billAmount = saleOriginalBillAmount(sale)
  const paidAmount = saleCollectedAmount(sale)
  const creditPending = saleCreditPendingAmount(sale)
  const creditInvolved = isCreditInvolvedSale(sale)
  const customerName = resolveCustomerLabel([sale.customerName], creditPending > 0 || creditInvolved)
  if (!customerName) return null

  const date = sale.updatedAt ?? sale.createdAt

  return {
    id: sale.id,
    groupId: saleBillGroupId(sale),
    customerName,
    date,
    dateLabel: formatDate(date),
    billAmount,
    paidAmount,
    creditPending,
    creditInvolved: isCreditInvolvedSale(sale),
    payDetail:
      creditPending > 0
        ? `Bill ${formatMoney(billAmount)} · Paid ${formatMoney(paidAmount)} · Credit ${formatMoney(creditPending)}`
        : `${salePayDetail(sale)} · Paid ${formatMoney(paidAmount)}`,
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

export function buildCustomerSummaries(data: AppData): CustomerSummary[] {
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

export function buildCreditOverview(data: AppData): CreditOverview {
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

export function getCustomerSummary(
  summaries: CustomerSummary[],
  name: string,
): CustomerSummary | undefined {
  const trimmed = name.trim()
  return summaries.find((summary) => summary.name === trimmed)
}
