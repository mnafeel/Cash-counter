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
  }
}
