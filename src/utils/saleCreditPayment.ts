import type { AppData, PayType } from '../types'
import {
  buildCustomerSummaries,
  filterCustomersWithCredit,
  type CustomerSummary,
} from './customerLedger'
import { saleCreditBalanceDue } from './saleReturns'

export interface SaleCreditPaySelection {
  id: string
  amount: number
  customerName: string
}

export interface SaleCreditItem {
  id: string
  customerName: string
  amount: number
  billDateLabel: string
  date: string
}

export interface SaleCreditPaymentInput {
  dueAmount: number
  collected: number
  payType: PayType
  cashAmount?: number
  bankAmount?: number
  chequeAmount?: number
  chequeApproved?: boolean
  customerName?: string
}

export interface SaleCreditPartyGroup {
  customerName: string
  selections: SaleCreditPaySelection[]
  total: number
}

export function buildOpenSaleCreditItems(data: AppData): SaleCreditItem[] {
  const summaries = filterCustomersWithCredit(buildCustomerSummaries(data))
  const items: SaleCreditItem[] = []
  for (const summary of summaries) {
    for (const bill of summary.creditBills) {
      const sale = data.sales.find((entry) => entry.id === bill.id)
      const amount = sale ? saleCreditBalanceDue(sale, data.sales) : bill.creditPending
      if (amount <= 0) continue
      items.push({
        id: bill.id,
        customerName: summary.name,
        amount,
        billDateLabel: bill.billDateLabel,
        date: bill.date,
      })
    }
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function groupSaleCreditSelectionsByParty(
  selections: SaleCreditPaySelection[],
): SaleCreditPartyGroup[] {
  const map = new Map<string, SaleCreditPaySelection[]>()
  for (const row of selections) {
    const key = row.customerName.trim() || 'Unknown'
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return [...map.entries()]
    .map(([customerName, partySelections]) => ({
      customerName,
      selections: partySelections,
      total: partySelections.reduce((sum, row) => sum + row.amount, 0),
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName))
}

/** Build per-bill sale credit payments for bulk bill clear. */
export function buildBulkSaleCreditPaymentPlan(
  selections: SaleCreditPaySelection[],
  mode: 'cash' | 'bank' | 'cheque' | 'split',
  split?: { cash: number; bank: number; cheque: number; chequeApproved?: boolean },
): Array<{ id: string; payment: SaleCreditPaymentInput }> {
  const ordered = [...selections].filter((row) => row.amount > 0)
  if (ordered.length === 0) return []

  if (mode === 'cash' || mode === 'bank' || mode === 'cheque') {
    return ordered.map((row) => ({
      id: row.id,
      payment: {
        dueAmount: row.amount,
        collected: row.amount,
        payType: mode,
        cashAmount: mode === 'cash' ? row.amount : undefined,
        bankAmount: mode === 'bank' ? row.amount : undefined,
        chequeAmount: mode === 'cheque' ? row.amount : undefined,
        chequeApproved: mode === 'cheque' ? true : undefined,
        customerName: row.customerName,
      },
    }))
  }

  let cashLeft = Math.max(0, split?.cash ?? 0)
  let bankLeft = Math.max(0, split?.bank ?? 0)
  let chequeLeft = split?.chequeApproved === false ? 0 : Math.max(0, split?.cheque ?? 0)
  const chequeApproved = split?.chequeApproved ?? true
  const out: Array<{ id: string; payment: SaleCreditPaymentInput }> = []

  for (const row of ordered) {
    let due = row.amount
    const fromCash = Math.min(due, cashLeft)
    cashLeft -= fromCash
    due -= fromCash
    const fromBank = Math.min(due, bankLeft)
    bankLeft -= fromBank
    due -= fromBank
    const fromCheque = Math.min(due, chequeLeft)
    chequeLeft -= fromCheque
    due -= fromCheque
    const paid = fromCash + fromBank + fromCheque
    if (paid <= 0) continue

    const modes = [fromCash > 0, fromBank > 0, fromCheque > 0].filter(Boolean).length
    const payType: PayType =
      modes > 1 ? 'split' : fromCash > 0 ? 'cash' : fromBank > 0 ? 'bank' : 'cheque'

    out.push({
      id: row.id,
      payment: {
        dueAmount: row.amount,
        collected: paid,
        payType,
        cashAmount: fromCash || undefined,
        bankAmount: fromBank || undefined,
        chequeAmount: fromCheque || undefined,
        chequeApproved: fromCheque > 0 ? chequeApproved : undefined,
        customerName: row.customerName,
      },
    })
  }

  return out
}

export function formatSaleCreditPayModeLabel(mode: 'cash' | 'bank' | 'cheque' | 'split'): string {
  if (mode === 'cash') return 'Cash'
  if (mode === 'bank') return 'Bank'
  if (mode === 'cheque') return 'Cheque'
  return 'Split'
}

export function searchSaleCreditItems(items: SaleCreditItem[], query: string): SaleCreditItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (row) =>
      row.customerName.toLowerCase().includes(q) ||
      row.billDateLabel.toLowerCase().includes(q) ||
      String(row.amount).includes(q),
  )
}

export function getPartySummaryFromSummaries(
  summaries: CustomerSummary[],
  name: string,
): CustomerSummary | undefined {
  const key = name.trim().toLowerCase()
  return summaries.find((row) => row.name.trim().toLowerCase() === key)
}
