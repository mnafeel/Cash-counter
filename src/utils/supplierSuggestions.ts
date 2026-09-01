import type { AppData } from '../types'
import { isPurchaseExpense, stripExpenseBillSuffix } from './expenseBillLabels'

const DRAFT_SUPPLIERS_KEY = 'purchase-draft-supplier-names'

function supplierKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Remove legacy draft supplier names — suggestions are bill-backed only now. */
export function clearDraftSupplierNames(): void {
  try {
    localStorage.removeItem(DRAFT_SUPPLIERS_KEY)
  } catch {
    // ignore
  }
}

/** Supplier names that appear on at least one purchase bill. */
export function buildPurchaseSupplierOptions(data: AppData): string[] {
  const seen = new Map<string, string>()

  for (const expense of data.expenses) {
    if (!isPurchaseExpense(expense)) continue
    const raw = stripExpenseBillSuffix(expense.name ?? '').trim()
    if (!raw) continue
    const key = supplierKey(raw)
    if (!seen.has(key)) seen.set(key, raw)
  }

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function supplierNamesWithPurchaseBills(data: AppData): Set<string> {
  const keys = new Set<string>()
  for (const expense of data.expenses) {
    if (!isPurchaseExpense(expense)) continue
    const raw = stripExpenseBillSuffix(expense.name ?? '').trim()
    if (!raw) continue
    keys.add(supplierKey(raw))
  }
  return keys
}

/** Item names previously used for a supplier (saved items + purchase history). */
export function buildSupplierItemOptions(data: AppData, supplierName: string): string[] {
  const supplierKeyValue = supplierKey(supplierName)
  if (!supplierKeyValue) return []

  const seen = new Map<string, string>()
  const entry = (data.suppliers ?? []).find(
    (supplier) => supplier.name.trim().toLowerCase() === supplierKeyValue,
  )
  for (const item of entry?.items ?? []) {
    const trimmed = item.trim()
    if (trimmed) seen.set(trimmed.toLowerCase(), trimmed)
  }
  for (const expense of data.expenses) {
    if (!isPurchaseExpense(expense)) continue
    const expenseSupplier = stripExpenseBillSuffix(expense.name ?? '').trim().toLowerCase()
    if (expenseSupplier !== supplierKeyValue) continue
    const desc = expense.description?.trim()
    if (desc) seen.set(desc.toLowerCase(), desc)
  }

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function buildAllPurchaseItemOptions(data: AppData): string[] {
  const seen = new Map<string, string>()
  for (const supplier of data.suppliers ?? []) {
    for (const item of supplier.items ?? []) {
      const trimmed = item.trim()
      if (trimmed) seen.set(trimmed.toLowerCase(), trimmed)
    }
  }
  for (const expense of data.expenses) {
    if (!isPurchaseExpense(expense)) continue
    const desc = expense.description?.trim()
    if (desc) seen.set(desc.toLowerCase(), desc)
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function filterPurchaseItemSuggestions(query: string, options: string[], limit = 12): string[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return options
  return options
    .filter((item) => {
      const lower = item.toLowerCase()
      return lower.includes(trimmed) && lower !== trimmed
    })
    .slice(0, limit)
}
