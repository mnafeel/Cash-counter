import type { ExpensePayType } from '../types'
import type { AppData } from '../types'
import type { ExpenseBillMode } from './expenseBillLabels'
import { expenseBillSuffix } from './expenseBillLabels'
import { buildPurchaseHistoryItems } from './purchaseHistory'
import { parseAmount } from './format'

export type BulkPurchasePayType = 'cash' | 'bank' | 'cheque' | 'credit'

export interface BulkPurchaseRow {
  id: string
  description: string
  billNo: string
  billDate: string
  /** When true, row bill date follows the master bill date field. */
  usesMasterBillDate: boolean
  amount: string
}

export interface BulkPurchaseExpensePayload {
  amount: number
  name: string
  description?: string
  billNo?: string
  billDate?: string
  payType: ExpensePayType
  bankAmount?: number
  creditAmount?: number
  chequeAmount?: number
  chequeApproved?: boolean
  billNumber: 1 | 2
  kind: 'expense'
}

export function createEmptyBulkRow(masterBillDate = ''): BulkPurchaseRow {
  return {
    id: crypto.randomUUID(),
    description: '',
    billNo: '',
    billDate: masterBillDate,
    usesMasterBillDate: true,
    amount: '',
  }
}

export function billModeToSlot(mode: ExpenseBillMode): 1 | 2 {
  return mode === 'no1' ? 1 : 2
}

export function resolveBulkRowBillDate(row: BulkPurchaseRow, masterBillDate: string): string {
  if (row.usesMasterBillDate) return masterBillDate.trim()
  return row.billDate.trim() || masterBillDate.trim()
}

export function buildBulkPurchaseExpensePayload(
  billMode: ExpenseBillMode,
  supplierName: string,
  row: BulkPurchaseRow,
  masterBillDate: string,
  payType: BulkPurchasePayType,
): BulkPurchaseExpensePayload | null {
  const amount = parseAmount(row.amount)
  if (amount <= 0) return null

  const slot = billModeToSlot(billMode)
  const displayName = `${supplierName.trim()}${expenseBillSuffix(slot)}`
  const description = row.description.trim() || undefined
  const billNo = row.billNo.trim() || undefined
  const billDateValue = resolveBulkRowBillDate(row, masterBillDate) || undefined

  if (payType === 'cash') {
    return {
      amount,
      name: displayName,
      description,
      billNo,
      billDate: billDateValue,
      payType: 'cash',
      billNumber: slot,
      kind: 'expense',
    }
  }

  if (payType === 'bank') {
    return {
      amount,
      name: displayName,
      description,
      billNo,
      billDate: billDateValue,
      payType: 'bank',
      bankAmount: amount,
      billNumber: slot,
      kind: 'expense',
    }
  }

  if (payType === 'credit') {
    return {
      amount,
      name: displayName,
      description,
      billNo,
      billDate: billDateValue,
      payType: 'credit',
      creditAmount: amount,
      billNumber: slot,
      kind: 'expense',
    }
  }

  return {
    amount,
    name: displayName,
    description,
    billNo,
    billDate: billDateValue,
    payType: 'cheque',
    chequeAmount: amount,
    chequeApproved: true,
    billNumber: slot,
    kind: 'expense',
  }
}

export function buildBulkPurchasePayloads(
  billMode: ExpenseBillMode,
  supplierName: string,
  masterBillDate: string,
  payType: BulkPurchasePayType,
  rows: BulkPurchaseRow[],
): BulkPurchaseExpensePayload[] {
  const payloads: BulkPurchaseExpensePayload[] = []
  for (const row of rows) {
    const payload = buildBulkPurchaseExpensePayload(
      billMode,
      supplierName,
      row,
      masterBillDate,
      payType,
    )
    if (payload) payloads.push(payload)
  }
  return payloads
}

export function applyMasterBillDateToRows(
  rows: BulkPurchaseRow[],
  masterBillDate: string,
): BulkPurchaseRow[] {
  return rows.map((row) =>
    row.usesMasterBillDate ? { ...row, billDate: masterBillDate } : row,
  )
}

export function getSupplierBulkHistoryRows(
  data: AppData,
  supplierName: string,
  billMode: ExpenseBillMode,
  masterBillDate = '',
  limit = 20,
): BulkPurchaseRow[] {
  const supplierKey = supplierName.trim().toLowerCase()
  if (!supplierKey) return []

  const seen = new Set<string>()
  const rows: BulkPurchaseRow[] = []

  const items = buildPurchaseHistoryItems(data)
    .filter((item) => item.shopName.trim().toLowerCase() === supplierKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  for (const item of items) {
    const amount = billMode === 'no1' ? item.no1Amount : item.no2Amount
    if (amount <= 0) continue
    if (billMode === 'no1' && item.billType === 'no-gst') continue
    if (billMode === 'no2' && item.billType === 'gst') continue

    const description = item.description?.trim() ?? ''
    const dedupeKey = `${description.toLowerCase()}|${item.billNo?.trim().toLowerCase() ?? ''}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const historyBillDate = item.billDate?.trim() ?? ''
    rows.push({
      id: crypto.randomUUID(),
      description,
      billNo: item.billNo?.trim() ?? '',
      billDate: historyBillDate || masterBillDate,
      usesMasterBillDate: !historyBillDate,
      amount: String(amount),
    })
    if (rows.length >= limit) break
  }

  return rows
}

export function validateBulkPurchaseDraft(
  supplierName: string,
  rows: BulkPurchaseRow[],
): { ok: boolean; message?: string } {
  if (!supplierName.trim()) {
    return { ok: false, message: 'Select a supplier name.' }
  }

  const validRows = rows.filter((row) => parseAmount(row.amount) > 0)
  if (validRows.length === 0) {
    return { ok: false, message: 'Add at least one bill with an amount.' }
  }

  const missingDescription = validRows.some((row) => !row.description.trim())
  if (missingDescription) {
    return { ok: false, message: 'Each bill needs an item / description.' }
  }

  return { ok: true }
}
