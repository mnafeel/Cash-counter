import type { AppData, CustomerReminderEntry, Sale } from '../types'
import { UNNAMED_CREDIT_CUSTOMER } from './customerLedger'
import { UNNAMED_CHEQUE_CUSTOMER } from './chequeLedger'
import { getSaleCustomerName } from './saleCustomerName'
import { getSaleReminderKind, type BillReminderKind } from './billReminders'

function isPendingCreditSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'credit' || sale.payType === 'credit')
  )
}

function isPendingChequeSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'cheque' || sale.payType === 'cheque')
  )
}

export function getCustomerReminderEntry(
  data: AppData,
  customerName: string,
): CustomerReminderEntry | undefined {
  return data.customerReminders?.[customerName.trim()]
}

export function getCustomerReminderAt(
  data: AppData,
  customerName: string,
  kind: BillReminderKind,
): string | undefined {
  if (kind !== 'credit' && kind !== 'cheque') return undefined
  const entry = getCustomerReminderEntry(data, customerName)
  if (!entry) return undefined
  return kind === 'credit' ? entry.creditReminderAt : entry.chequeReminderAt
}

export function getCustomerReminderNote(
  data: AppData,
  customerName: string,
  kind: BillReminderKind,
): string | undefined {
  if (kind !== 'credit' && kind !== 'cheque') return undefined
  const entry = getCustomerReminderEntry(data, customerName)
  if (!entry) return undefined
  const note = kind === 'credit' ? entry.creditReminderNote : entry.chequeReminderNote
  return note?.trim() || undefined
}

export function resolveSaleCustomerLabel(sale: Sale, allSales: Sale[]): string | null {
  const name = getSaleCustomerName(sale, allSales)?.trim()
  if (name) return name
  if (isPendingCreditSale(sale)) return UNNAMED_CREDIT_CUSTOMER
  if (isPendingChequeSale(sale)) return UNNAMED_CHEQUE_CUSTOMER
  return null
}

export function listOpenBillIdsForCustomer(
  data: AppData,
  customerName: string,
  kind: BillReminderKind,
): string[] {
  const trimmed = customerName.trim()
  return data.sales
    .filter((sale) => {
      if (sale.status !== 'pending') return false
      const label = resolveSaleCustomerLabel(sale, data.sales)
      if (label !== trimmed) return false
      return getSaleReminderKind(sale) === kind
    })
    .map((sale) => sale.id)
}

export function getEffectiveSaleReminderAt(data: AppData, sale: Sale): string | undefined {
  if (sale.reminderAt) return sale.reminderAt
  if (sale.status !== 'pending') return undefined
  const label = resolveSaleCustomerLabel(sale, data.sales)
  if (!label) return undefined
  const kind = getSaleReminderKind(sale)
  if (kind !== 'credit' && kind !== 'cheque') return undefined
  return getCustomerReminderAt(data, label, kind)
}

export function getEffectiveSaleReminderNote(data: AppData, sale: Sale): string | undefined {
  if (sale.reminderNote?.trim()) return sale.reminderNote.trim()
  if (sale.status !== 'pending') return undefined
  const label = resolveSaleCustomerLabel(sale, data.sales)
  if (!label) return undefined
  const kind = getSaleReminderKind(sale)
  if (kind !== 'credit' && kind !== 'cheque') return undefined
  return getCustomerReminderNote(data, label, kind)
}

export function applyStoredCustomerReminderToSale(
  data: AppData,
  sale: Sale,
): Sale {
  if (sale.status !== 'pending') return sale
  const label = resolveSaleCustomerLabel(sale, data.sales)
  if (!label) return sale
  const kind = getSaleReminderKind(sale)
  if (kind !== 'credit' && kind !== 'cheque') return sale
  const reminderAt = getCustomerReminderAt(data, label, kind)
  if (!reminderAt || sale.reminderAt) return sale
  const reminderNote = getCustomerReminderNote(data, label, kind)
  return { ...sale, reminderAt, reminderNote }
}
