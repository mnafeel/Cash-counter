import type { AppData, Sale } from '../types'
import { buildBankActivityItems } from '../utils/bankActivity'
import { buildCashActivityItems } from '../utils/cashActivity'
import { buildChequeCustomerSummaries } from '../utils/chequeLedger'
import { buildCustomerSummaries } from '../utils/customerLedger'
import { getBankBalance, getCurrentBalance } from '../storage/database'
import { saleCreditPendingAmount, saleChequePendingAmount } from '../utils/salesReport'

export const WEBSITE_EXPORT_VERSION = 1 as const

/** One customer sale row for the external website. */
export interface WebsiteSaleRow {
  id: string
  customerName: string
  billAmount: number
  paidAmount: number
  creditPending: number
  chequePending: number
  payType: string
  status: string
  createdAt: string
  updatedAt?: string
}

/** Aggregated customer profile for the website. */
export interface WebsiteCustomerRow {
  name: string
  billCount: number
  totalPaid: number
  totalBillAmount: number
  creditOpen: number
  chequeOpen: number
  lastPurchaseAt: string
}

/** Cash or bank visit / movement for the website. */
export interface WebsiteVisitRow {
  id: string
  label: string
  amount: number
  direction: 'in' | 'out'
  at: string
  name?: string
}

export interface WebsiteExportPayload {
  version: typeof WEBSITE_EXPORT_VERSION
  exportedAt: string
  storeId: string
  totals: {
    cash: number
    bank: number
    salesCount: number
    customerCount: number
    cashVisitCount: number
    bankVisitCount: number
  }
  sales: WebsiteSaleRow[]
  customers: WebsiteCustomerRow[]
  cashVisits: WebsiteVisitRow[]
  bankVisits: WebsiteVisitRow[]
  /**
   * Compact publisher rows for external ads sites that look up spots by API key.
   * Same store customers, shaped for ad-network fetch.
   */
  adSpots: WebsiteAdSpotRow[]
  /** True when lists were shortened to fit Firestore’s 1 MiB document limit. */
  trimmed?: boolean
  trimNote?: string
}

/** Publisher spot row consumed by the ads site. */
export interface WebsiteAdSpotRow {
  id: string
  name: string
  label: string
  billCount: number
  totalPaid: number
  creditOpen: number
  chequeOpen: number
  lastAt: string
}

/** Firestore practical limit for a single document (~1 MiB). Leave headroom for field wrappers. */
export const WEBSITE_EXPORT_MAX_BODY_BYTES = 900_000

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function buildAdSpots(customers: WebsiteCustomerRow[]): WebsiteAdSpotRow[] {
  return customers.map((row, index) => ({
    id: `spot-${index + 1}-${row.name.trim().toLowerCase().replace(/\s+/g, '-') || 'customer'}`,
    name: row.name,
    label: row.name,
    billCount: row.billCount,
    totalPaid: row.totalPaid,
    creditOpen: row.creditOpen,
    chequeOpen: row.chequeOpen,
    lastAt: row.lastPurchaseAt,
  }))
}

/**
 * Serialize export JSON under Firestore’s document size limit.
 * Drops visit detail first, then newest→oldest sales/customers until it fits.
 */
export function packWebsiteExportBody(payload: WebsiteExportPayload): {
  body: string
  trimmed: boolean
  byteLength: number
} {
  const baseTotals = { ...payload.totals }
  let sales = payload.sales
  let customers = payload.customers
  let cashVisits = payload.cashVisits
  let bankVisits = payload.bankVisits
  let trimmed = false
  let trimNote: string | undefined

  const pack = (): string => {
    const adSpots = buildAdSpots(customers)
    const next: WebsiteExportPayload = {
      version: payload.version,
      exportedAt: payload.exportedAt,
      storeId: payload.storeId,
      totals: {
        ...baseTotals,
        salesCount: sales.length,
        customerCount: customers.length,
        cashVisitCount: cashVisits.length || baseTotals.cashVisitCount,
        bankVisitCount: bankVisits.length || baseTotals.bankVisitCount,
      },
      sales,
      customers,
      cashVisits,
      bankVisits,
      adSpots,
      ...(trimmed ? { trimmed: true, trimNote } : {}),
    }
    // Keep totals as full store counts even when lists are shortened.
    next.totals.salesCount = baseTotals.salesCount
    next.totals.customerCount = baseTotals.customerCount
    next.totals.cashVisitCount = baseTotals.cashVisitCount
    next.totals.bankVisitCount = baseTotals.bankVisitCount
    return JSON.stringify(next)
  }

  let body = pack()
  if (utf8Bytes(body) <= WEBSITE_EXPORT_MAX_BODY_BYTES) {
    return { body, trimmed: false, byteLength: utf8Bytes(body) }
  }

  trimmed = true
  cashVisits = []
  bankVisits = []
  trimNote = 'Visit detail omitted to fit API size limit'
  body = pack()
  if (utf8Bytes(body) <= WEBSITE_EXPORT_MAX_BODY_BYTES) {
    return { body, trimmed: true, byteLength: utf8Bytes(body) }
  }

  // Drop older sales / customers until under limit (keep newest first).
  sales = [...sales].sort(
    (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime(),
  )
  customers = [...customers].sort(
    (a, b) => new Date(b.lastPurchaseAt).getTime() - new Date(a.lastPurchaseAt).getTime(),
  )

  while (utf8Bytes(body) > WEBSITE_EXPORT_MAX_BODY_BYTES && (sales.length > 50 || customers.length > 50)) {
    if (sales.length >= customers.length && sales.length > 50) {
      sales = sales.slice(0, Math.max(50, Math.floor(sales.length * 0.7)))
    } else if (customers.length > 50) {
      customers = customers.slice(0, Math.max(50, Math.floor(customers.length * 0.7)))
    } else {
      break
    }
    trimNote = `Showing newest ${sales.length} sales and ${customers.length} customers (full counts in totals)`
    body = pack()
  }

  // Last resort: customers/adSpots only.
  if (utf8Bytes(body) > WEBSITE_EXPORT_MAX_BODY_BYTES) {
    sales = []
    while (utf8Bytes(body) > WEBSITE_EXPORT_MAX_BODY_BYTES && customers.length > 20) {
      customers = customers.slice(0, Math.max(20, Math.floor(customers.length * 0.7)))
      trimNote = `Customers/ad spots only · newest ${customers.length}`
      body = pack()
    }
  }

  const byteLength = utf8Bytes(body)
  if (byteLength > WEBSITE_EXPORT_MAX_BODY_BYTES) {
    throw new Error(
      `Website export is too large to publish (${Math.round(byteLength / 1024)} KB). Reduce history or contact support.`,
    )
  }
  return { body, trimmed: true, byteLength }
}

/** Cheap counts for Settings — does not build cash/bank activity or ledgers. */
export interface WebsiteExportQuickStats {
  salesCount: number
  customerCount: number
  expenseCount: number
}

export function buildWebsiteExportQuickStats(data: AppData): WebsiteExportQuickStats {
  const names = new Set<string>()
  for (const sale of data.sales) {
    const name = sale.customerName?.trim().toLowerCase()
    if (name) names.add(name)
  }
  return {
    salesCount: data.sales.length,
    customerCount: names.size,
    expenseCount: data.expenses.length,
  }
}

/**
 * Cheap change fingerprint so auto-push can skip identical snapshots.
 * Avoids rebuilding the full export payload when nothing meaningful changed.
 */
export function websiteExportFingerprint(data: AppData): string {
  const lastSale = data.sales[0]
  const lastExpense = data.expenses[0]
  const lastLoan = data.loans?.[0]
  return [
    data.sales.length,
    data.expenses.length,
    data.loans?.length ?? 0,
    data.openingBalance ?? 0,
    data.openingBankBalance ?? 0,
    lastSale?.id ?? '',
    lastSale?.updatedAt ?? lastSale?.createdAt ?? '',
    lastSale?.billAmount ?? 0,
    lastSale?.paidAmount ?? 0,
    lastSale?.status ?? '',
    lastExpense?.id ?? '',
    lastExpense?.createdAt ?? '',
    lastExpense?.amount ?? 0,
    lastLoan?.id ?? '',
    lastLoan?.createdAt ?? '',
  ].join('|')
}

function mapSale(sale: Sale): WebsiteSaleRow {
  return {
    id: sale.id,
    customerName: sale.customerName?.trim() || '',
    billAmount: sale.billAmount,
    paidAmount: sale.paidAmount,
    creditPending: saleCreditPendingAmount(sale),
    chequePending: saleChequePendingAmount(sale),
    payType: sale.payType ?? sale.pendingPayType ?? 'cash',
    status: sale.status ?? 'paid',
    createdAt: sale.createdAt,
    ...(sale.updatedAt ? { updatedAt: sale.updatedAt } : {}),
  }
}

function mapVisit(item: {
  id: string
  label: string
  amount: number
  direction: 'in' | 'out'
  date: string
  name?: string
}): WebsiteVisitRow {
  return {
    id: item.id,
    label: item.label,
    amount: item.amount,
    direction: item.direction,
    at: item.date,
    ...(item.name ? { name: item.name } : {}),
  }
}

/** Build the read-only JSON payload the new website will consume. */
export function buildWebsiteExportPayload(
  data: AppData,
  storeId: string,
  exportedAt = new Date().toISOString(),
): WebsiteExportPayload {
  const customerSummaries = buildCustomerSummaries(data)
  const chequeByName = new Map<string, number>()
  for (const row of buildChequeCustomerSummaries(data)) {
    chequeByName.set(row.name.trim().toLowerCase(), row.totalChequePending)
  }

  const customers: WebsiteCustomerRow[] = customerSummaries.map((summary) => ({
    name: summary.name,
    billCount: summary.purchaseCount,
    totalPaid: summary.totalPaid,
    totalBillAmount: summary.totalBillAmount,
    creditOpen: summary.totalCreditPending,
    chequeOpen: chequeByName.get(summary.name.trim().toLowerCase()) ?? 0,
    lastPurchaseAt: summary.lastPurchaseDate,
  }))

  const cashVisits = buildCashActivityItems(data).map(mapVisit)
  const bankVisits = buildBankActivityItems(data).map(mapVisit)
  const sales = data.sales.map(mapSale)

  return {
    version: WEBSITE_EXPORT_VERSION,
    exportedAt,
    storeId,
    totals: {
      cash: getCurrentBalance(data),
      bank: getBankBalance(data),
      salesCount: sales.length,
      customerCount: customers.length,
      cashVisitCount: cashVisits.length,
      bankVisitCount: bankVisits.length,
    },
    sales,
    customers,
    cashVisits,
    bankVisits,
    adSpots: buildAdSpots(customers),
  }
}
