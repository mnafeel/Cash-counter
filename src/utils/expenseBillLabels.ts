import type { Expense } from '../types'

export type ExpenseBillMode = 'no1' | 'no2'

export const EXPENSE_BILL_MODES: ExpenseBillMode[] = ['no1', 'no2']

export function parseExpenseBillMode(value: string | null | undefined): ExpenseBillMode | null {
  if (!value) return null
  return EXPENSE_BILL_MODES.includes(value as ExpenseBillMode) ? (value as ExpenseBillMode) : null
}

export function expenseBillModeHref(mode: ExpenseBillMode): string {
  return `/purchase?bill=${mode}`
}

export function expenseBillModeTo(mode: ExpenseBillMode) {
  return { pathname: '/purchase', search: `?bill=${mode}` } as const
}

export function isGstExpense(name: string, billNumber?: 1 | 2): boolean {
  if (billNumber === 1) return true
  const trimmed = name.trim()
  return (
    trimmed.endsWith(GST_BILL_SUFFIX) ||
    trimmed.endsWith(LEGACY_ONE_BILL_SUFFIX) ||
    trimmed.endsWith(LEGACY_GST_BILL_SUFFIX)
  )
}

export function isNoGstExpense(name: string, billNumber?: 1 | 2): boolean {
  if (billNumber === 2) return true
  const trimmed = name.trim()
  return trimmed.endsWith(NO_GST_BILL_SUFFIX) || trimmed.endsWith(LEGACY_NO_GST_BILL_SUFFIX)
}

export function isPurchaseExpense(
  expense: Pick<Expense, 'kind' | 'name' | 'billNumber'>,
): boolean {
  if (expense.kind === 'add' || expense.kind === 'transfer') return false
  if (expense.billNumber === 1 || expense.billNumber === 2) return true
  const trimmed = expense.name.trim()
  return (
    trimmed.endsWith(GST_BILL_SUFFIX) ||
    trimmed.endsWith(NO_GST_BILL_SUFFIX) ||
    trimmed.endsWith(LEGACY_ONE_BILL_SUFFIX) ||
    trimmed.endsWith(LEGACY_GST_BILL_SUFFIX) ||
    trimmed.endsWith(LEGACY_NO_GST_BILL_SUFFIX)
  )
}

export const GST_BILL_LABEL = 'Single Bill'
export const NO_GST_BILL_LABEL = 'Two Bill'
export const NO1_BILL_LABEL = 'No 1'
export const NO2_BILL_LABEL = 'No 2'
export const NO1_EXPENSE_LABEL = 'No 1 Expense'
export const NO2_EXPENSE_LABEL = 'No 2 Expense'

export function purchaseBillLabel(billNumber: 1 | 2): string {
  return billNumber === 1
    ? `${NO1_BILL_LABEL} · ${GST_BILL_LABEL}`
    : `${NO2_BILL_LABEL} · ${NO_GST_BILL_LABEL}`
}

export const GST_BILL_SUFFIX = ' · Single Bill'
export const NO_GST_BILL_SUFFIX = ' · Two Bill'

const LEGACY_GST_BILL_SUFFIX = ' · GST'
const LEGACY_NO_GST_BILL_SUFFIX = ' · No GST'
const LEGACY_ONE_BILL_SUFFIX = ' · One Bill'

const BILL_SUFFIX_RE =
  / · (Single Bill|One Bill|Two Bill|GST|No GST|Without GST|Bill 1|Bill 2)$/

export function expenseBillSuffix(billNumber: 1 | 2): string {
  return billNumber === 1 ? GST_BILL_SUFFIX : NO_GST_BILL_SUFFIX
}

export function expenseBillTag(billNumber: 1 | 2): string {
  return billNumber === 1 ? NO1_BILL_LABEL : NO2_BILL_LABEL
}

export function stripExpenseBillSuffix(name: string): string {
  return name.trim().replace(BILL_SUFFIX_RE, '')
}
