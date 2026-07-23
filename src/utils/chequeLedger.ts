import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'
import {
  saleBillGroupId,
  saleChequePendingAmount,
  saleOriginalBillAmount,
  saleTotalCollected,
} from './salesReport'
import { saleCollectedAmount } from './salePayment'

export interface ChequePurchaseRow {
  id: string
  groupId: string
  customerName: string
  date: string
  dateLabel: string
  billAmount: number
  paidAmount: number
  chequePending: number
  chequeInvolved: boolean
  payDetail: string
}

export interface ChequeCustomerSummary {
  name: string
  purchaseCount: number
  totalPaid: number
  totalChequePending: number
  totalBillAmount: number
  openChequeCount: number
  chequeTimes: number
  chequeBills: ChequePurchaseRow[]
  lastPurchaseDate: string
  lastPurchaseLabel: string
  purchases: ChequePurchaseRow[]
}

export interface ChequeOverview {
  totalPending: number
  customerCount: number
  openBillCount: number
  customers: {
    name: string
    pendingAmount: number
    openBillCount: number
    lastChequeDate: string
    lastChequeLabel: string
  }[]
}

export const UNNAMED_CHEQUE_CUSTOMER = 'Cheque sale (no name)'

function approvedChequeAmount(sale: Sale): number {
  if (sale.chequeApproved && (sale.chequeAmount ?? 0) > 0) return sale.chequeAmount ?? 0
  if (sale.status === 'paid' && sale.payType === 'cheque') return sale.chequeAmount ?? sale.billAmount
  return 0
}

function isChequeInvolvedSale(sale: Sale): boolean {
  return (
    saleChequePendingAmount(sale) > 0 ||
    sale.payType === 'cheque' ||
    sale.pendingPayType === 'cheque' ||
    (sale.chequeAmount ?? 0) > 0 ||
    approvedChequeAmount(sale) > 0
  )
}

function groupChequeInvolved(parent: Sale, children: Sale[]): boolean {
  return isChequeInvolvedSale(parent) || children.some((child) => isChequeInvolvedSale(child))
}

function normalizeCustomerName(name?: string): string | null {
  const trimmed = name?.trim()
  return trimmed ? trimmed : null
}

function resolveCustomerLabel(
  names: (string | null | undefined)[],
  allowUnnamed: boolean,
): string | null {
  for (const raw of names) {
    const name = normalizeCustomerName(raw ?? undefined)
    if (name) return name
  }
  return allowUnnamed ? UNNAMED_CHEQUE_CUSTOMER : null
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
  const chequePending = children.reduce((sum, c) => sum + saleChequePendingAmount(c), 0)
  const collected =
    (parent.status !== 'pending' ? saleTotalCollected(parent) : saleCollectedAmount(parent)) +
    children.reduce((sum, c) => sum + saleCollectedAmount(c), 0)
  if (chequePending > 0 || collected > 0) return parent.billAmount + chequePending + collected
  return parent.billAmount + children.reduce((sum, c) => sum + c.billAmount, 0)
}

function buildGroupRow(parent: Sale, children: Sale[]): ChequePurchaseRow | null {
  const billAmount = groupBillAmount(parent, children)
  const paidAmount =
    (parent.status !== 'pending' ? saleTotalCollected(parent) : saleCollectedAmount(parent)) +
    children.reduce((sum, child) => sum + saleCollectedAmount(child), 0)
  const chequePending =
    saleChequePendingAmount(parent) + children.reduce((sum, child) => sum + saleChequePendingAmount(child), 0)
  const chequeInvolved = groupChequeInvolved(parent, children)
  const customerName = resolveCustomerLabel(
    [parent.customerName, ...children.map((child) => child.customerName)],
    chequePending > 0 || chequeInvolved,
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
    chequePending,
    chequeInvolved,
    payDetail:
      chequePending > 0
        ? `Bill ${formatMoney(billAmount)} · Paid ${formatMoney(paidAmount)} · Cheque ${formatMoney(chequePending)}`
        : `${salePayDetail(parent)} · Paid ${formatMoney(paidAmount)}`,
  }
}

function buildSingleRow(sale: Sale): ChequePurchaseRow | null {
  const billAmount = saleOriginalBillAmount(sale)
  const paidAmount = saleCollectedAmount(sale)
  const chequePending = saleChequePendingAmount(sale)
  const chequeInvolved = isChequeInvolvedSale(sale)
  const customerName = resolveCustomerLabel([sale.customerName], chequePending > 0 || chequeInvolved)
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
    chequePending,
    chequeInvolved: isChequeInvolvedSale(sale),
    payDetail:
      chequePending > 0
        ? `Bill ${formatMoney(billAmount)} · Paid ${formatMoney(paidAmount)} · Cheque ${formatMoney(chequePending)}`
        : `${salePayDetail(sale)} · Paid ${formatMoney(paidAmount)}`,
  }
}

export function buildChequePurchases(data: AppData): ChequePurchaseRow[] {
  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  const rows: ChequePurchaseRow[] = []

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      const row = buildGroupRow(sale, children)
      if (row && row.chequeInvolved) rows.push(row)
      continue
    }

    const row = buildSingleRow(sale)
    if (row && row.chequeInvolved) rows.push(row)
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    const row = buildSingleRow(sale)
    if (row && row.chequeInvolved) rows.push(row)
  }

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function buildChequeCustomerSummaries(data: AppData): ChequeCustomerSummary[] {
  const byName = new Map<string, ChequePurchaseRow[]>()

  for (const row of buildChequePurchases(data)) {
    const list = byName.get(row.customerName) ?? []
    list.push(row)
    byName.set(row.customerName, list)
  }

  const summaries: ChequeCustomerSummary[] = []

  for (const [name, purchases] of byName) {
    const seenGroups = new Set<string>()
    let totalPaid = 0
    let totalChequePending = 0
    let totalBillAmount = 0
    let chequeTimes = 0
    const chequeBills: ChequePurchaseRow[] = []

    for (const purchase of purchases) {
      totalPaid += purchase.paidAmount
      totalChequePending += purchase.chequePending
      if (purchase.chequeInvolved) chequeTimes += 1
      if (purchase.chequePending > 0) chequeBills.push(purchase)
      if (!seenGroups.has(purchase.groupId)) {
        seenGroups.add(purchase.groupId)
        totalBillAmount += purchase.billAmount
      }
    }

    chequeBills.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const lastPurchaseDate = purchases[0]?.date ?? ''
    summaries.push({
      name,
      purchaseCount: seenGroups.size,
      totalPaid,
      totalChequePending,
      totalBillAmount,
      openChequeCount: chequeBills.length,
      chequeTimes,
      chequeBills,
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

export function filterCustomersWithCheque(summaries: ChequeCustomerSummary[]): ChequeCustomerSummary[] {
  return summaries
    .filter((summary) => summary.totalChequePending > 0)
    .sort((a, b) => b.totalChequePending - a.totalChequePending || a.name.localeCompare(b.name))
}

export function searchChequeCustomerSummaries(
  summaries: ChequeCustomerSummary[],
  query: string,
): ChequeCustomerSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return summaries
  return summaries.filter((summary) => summary.name.toLowerCase().includes(q))
}

export function buildChequeOverview(data: AppData): ChequeOverview {
  const customers = filterCustomersWithCheque(buildChequeCustomerSummaries(data)).map((summary) => ({
    name: summary.name,
    pendingAmount: summary.totalChequePending,
    openBillCount: summary.openChequeCount,
    lastChequeDate: summary.chequeBills[0]?.date ?? summary.lastPurchaseDate,
    lastChequeLabel: summary.chequeBills[0]?.dateLabel ?? summary.lastPurchaseLabel,
  }))

  return {
    totalPending: customers.reduce((sum, customer) => sum + customer.pendingAmount, 0),
    customerCount: customers.length,
    openBillCount: customers.reduce((sum, customer) => sum + customer.openBillCount, 0),
    customers,
  }
}

export function getChequeCustomerSummary(
  summaries: ChequeCustomerSummary[],
  name: string,
): ChequeCustomerSummary | undefined {
  const trimmed = name.trim()
  return summaries.find((summary) => summary.name === trimmed)
}
