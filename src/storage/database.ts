import type { AppData, AppTheme, Expense, PayType, Sale, SupplierEntry, TransferDirection } from '../types'
import { STORAGE_KEY } from '../types'
import { collectSplitNameTargets } from '../utils/saleCustomerName'
import { stripExpenseBillSuffix } from '../utils/expenseBillLabels'
import { notifyDataChanged } from '../firebase/sync'
import { normalizePin } from '../utils/numpad'
import { normalizeTheme } from '../utils/theme'

const defaultData: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  homePin: '0000',
  theme: 'premium',
  suppliers: [],
  sales: [],
  expenses: [],
}

function normalizeItemList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    seen.set(trimmed.toLowerCase(), trimmed)
  }
  return Array.from(seen.values())
}

export function normalizeSuppliers(raw: unknown): SupplierEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, SupplierEntry>()
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, { name: trimmed, items: [] })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<SupplierEntry>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    const prev = seen.get(key)
    const items = normalizeItemList(record.items)
    const mergedItems = new Map<string, string>()
    for (const label of [...(prev?.items ?? []), ...items]) {
      mergedItems.set(label.toLowerCase(), label)
    }
    seen.set(key, { name, items: Array.from(mergedItems.values()) })
  }
  return Array.from(seen.values())
}

export function ensureSupplierInData(data: AppData, rawName: string): AppData {
  const name = stripExpenseBillSuffix(rawName.trim())
  if (!name) return data
  const key = name.toLowerCase()
  const existing = normalizeSuppliers(data.suppliers)
  if (existing.some((supplier) => supplier.name.toLowerCase() === key)) return data
  return { ...data, suppliers: [{ name, items: [] }, ...existing] }
}

export function addSupplier(data: AppData, rawName: string): AppData {
  const next = ensureSupplierInData(data, rawName)
  if (next === data) return data
  saveData(next)
  return next
}

export function addSupplierItem(data: AppData, rawName: string, item: string): AppData {
  const supplierName = stripExpenseBillSuffix(rawName.trim())
  const itemLabel = item.trim()
  if (!supplierName || !itemLabel) return data

  const key = supplierName.toLowerCase()
  const itemKey = itemLabel.toLowerCase()
  let suppliers = normalizeSuppliers(data.suppliers)
  const index = suppliers.findIndex((supplier) => supplier.name.toLowerCase() === key)

  if (index < 0) {
    suppliers = [{ name: supplierName, items: [itemLabel] }, ...suppliers]
  } else {
    const entry = suppliers[index]
    const items = entry.items ?? []
    if (items.some((label) => label.toLowerCase() === itemKey)) return data
    suppliers = [...suppliers]
    suppliers[index] = { ...entry, items: [itemLabel, ...items] }
  }

  const next = { ...data, suppliers }
  saveData(next)
  return next
}

export function normalizeData(parsed: Partial<AppData>): AppData {
  return {
    openingBalance: parsed.openingBalance ?? 0,
    openingBankBalance: parsed.openingBankBalance ?? 0,
    homePin: normalizePin(parsed.homePin, '0000'),
    theme: normalizeTheme(parsed.theme),
    suppliers: normalizeSuppliers(parsed.suppliers),
    sales: parsed.sales ?? [],
    expenses: (parsed.expenses ?? []).map((e) => ({
      ...e,
      name: e.name ?? e.note ?? 'Expense',
      payType: e.payType === 'bank' ? 'bank' : 'cash',
      kind:
        e.kind === 'add' ? 'add' : e.kind === 'transfer' ? 'transfer' : 'expense',
      transferDirection:
        e.kind === 'transfer'
          ? e.transferDirection === 'bank-to-cash'
            ? 'bank-to-cash'
            : 'cash-to-bank'
          : undefined,
    })),
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultData }
    return normalizeData(JSON.parse(raw) as AppData)
  } catch {
    return { ...defaultData }
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  notifyDataChanged(data)
}

export function replaceData(data: AppData): AppData {
  const next = normalizeData(data)
  saveData(next)
  return next
}

/** Wipe local counter data — used on cloud logout. Does not trigger cloud backup. */
export function clearAllLocalData(): AppData {
  const next = { ...defaultData }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function splitSaleBankAmount(sale: Sale): number {
  const bank = sale.bankAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  if (!sale.chequeApproved || cheque <= 0) return bank
  const bankOnly = bank >= cheque ? bank - cheque : bank
  return bankOnly + cheque
}

function saleCashToDrawer(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank' || sale.payType === 'credit' || sale.payType === 'cheque') return 0
  if (sale.payType === 'split') return sale.cashAmount ?? 0
  return sale.billAmount
}

export function getPendingBills(data: AppData): Sale[] {
  return data.sales
    .filter((s) => s.status === 'pending')
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

function splitExpenseBankAmount(expense: Expense): number {
  const bank = expense.bankAmount ?? 0
  const cheque = expense.chequeAmount ?? 0
  if (!expense.chequeApproved || cheque <= 0) return bank
  const bankOnly = bank >= cheque ? bank - cheque : bank
  return bankOnly + cheque
}

function expenseCashToDrawer(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return expense.amount
    if (expense.transferDirection === 'bank-to-cash') return -expense.amount
    return 0
  }
  if (expense.payType === 'bank' || expense.payType === 'cheque') return 0
  if (expense.payType === 'split') {
    const cash = expense.cashAmount ?? 0
    return expense.kind === 'add' ? -cash : cash
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

function saleBankToBalance(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank' || sale.payType === 'cheque') return sale.billAmount
  if (sale.payType === 'split') return splitSaleBankAmount(sale)
  return 0
}

function expenseBankToBalance(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return -expense.amount
    if (expense.transferDirection === 'bank-to-cash') return expense.amount
    return 0
  }
  if (expense.payType === 'cash') return 0
  if (expense.payType === 'cheque') {
    if (!expense.chequeApproved) return 0
    const cheque = expense.chequeAmount ?? expense.amount
    return expense.kind === 'add' ? -cheque : cheque
  }
  if (expense.payType === 'split') {
    const bank = splitExpenseBankAmount(expense)
    return expense.kind === 'add' ? -bank : bank
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

export function getBankBalance(data: AppData): number {
  const salesTotal = data.sales.reduce((sum, s) => sum + saleBankToBalance(s), 0)
  const expensesTotal = data.expenses.reduce((sum, e) => sum + expenseBankToBalance(e), 0)
  return (data.openingBankBalance ?? 0) + salesTotal - expensesTotal
}

export function getCurrentBalance(data: AppData): number {
  const salesTotal = data.sales.reduce((sum, s) => sum + saleCashToDrawer(s), 0)
  const expensesTotal = data.expenses.reduce((sum, e) => sum + expenseCashToDrawer(e), 0)
  return data.openingBalance + salesTotal - expensesTotal
}

export function addSale(
  data: AppData,
  sale: Omit<Sale, 'id' | 'createdAt'> & { id?: string },
): AppData {
  const presetId = sale.id
  const { id: _id, ...rest } = sale
  const now = new Date().toISOString()
  const newSale: Sale = {
    ...rest,
    status: rest.status ?? 'paid',
    id: presetId ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: (rest.status ?? 'paid') === 'paid' ? now : rest.updatedAt,
  }
  const next = { ...data, sales: [newSale, ...data.sales] }
  saveData(next)
  return next
}

/**
 * Import a Tally sales voucher as a pending bill (party name + amount).
 * De-duplicates on sourceId. Does not persist — use importTallyBills for batch save.
 */
export function addTallyPendingBill(
  data: AppData,
  bill: { sourceId: string; billAmount: number; customerName?: string; createdAt?: string },
): AppData {
  if (!bill.sourceId || !(bill.billAmount > 0)) return data
  if (data.sales.some((s) => s.source === 'tally' && s.sourceId === bill.sourceId)) {
    return data
  }
  const now = new Date().toISOString()
  const newSale: Sale = {
    id: crypto.randomUUID(),
    billAmount: bill.billAmount,
    paidAmount: 0,
    changeAmount: 0,
    status: 'pending',
    payType: 'credit',
    pendingPayType: 'credit',
    customerName: bill.customerName?.trim() || undefined,
    source: 'tally',
    sourceId: bill.sourceId,
    createdAt: bill.createdAt ?? now,
    updatedAt: now,
  }
  return { ...data, sales: [newSale, ...data.sales] }
}

export function importTallyBills(
  data: AppData,
  bills: { sourceId: string; billAmount: number; customerName?: string; createdAt?: string }[],
): AppData {
  let next = data
  for (const bill of bills) {
    next = addTallyPendingBill(next, bill)
  }
  if (next !== data) saveData(next)
  return next
}

function mergePreservedTallyPending(local: AppData, restored: AppData): AppData {
  const restoredIds = new Set(
    restored.sales
      .filter((s) => s.source === 'tally' && s.sourceId)
      .map((s) => s.sourceId as string),
  )
  const extra = local.sales.filter(
    (s) =>
      s.status === 'pending' &&
      s.source === 'tally' &&
      s.sourceId &&
      !restoredIds.has(s.sourceId),
  )
  if (extra.length === 0) return restored
  return { ...restored, sales: [...extra, ...restored.sales] }
}

export function replaceDataPreservingTallyPending(local: AppData, restored: AppData): AppData {
  return replaceData(mergePreservedTallyPending(local, restored))
}

export function addTransfer(
  data: AppData,
  transfer: { amount: number; name: string; direction: TransferDirection },
): AppData {
  const newTransfer: Expense = {
    id: crypto.randomUUID(),
    amount: transfer.amount,
    name: transfer.name.trim(),
    payType: transfer.direction === 'cash-to-bank' ? 'cash' : 'bank',
    kind: 'transfer',
    transferDirection: transfer.direction,
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, expenses: [newTransfer, ...data.expenses] }
  saveData(next)
  return next
}

export function addExpense(data: AppData, expense: Omit<Expense, 'id' | 'createdAt'>): AppData {
  const newExpense: Expense = {
    ...expense,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, expenses: [newExpense, ...data.expenses] }
  saveData(next)
  return next
}

export function addExpenseBatch(
  data: AppData,
  expenses: Omit<Expense, 'id' | 'createdAt' | 'pairedExpenseId'>[],
): AppData {
  if (expenses.length === 0) return data
  const now = new Date().toISOString()
  const ids = expenses.map(() => crypto.randomUUID())
  const newExpenses: Expense[] = expenses.map((expense, index) => ({
    ...expense,
    id: ids[index],
    createdAt: now,
    billNumber:
      expense.billNumber ??
      (expenses.length > 1 ? ((index === 0 ? 1 : 2) as 1 | 2) : undefined),
    pairedExpenseId: expenses.length > 1 ? ids[1 - index] : undefined,
  }))
  const next = { ...data, expenses: [...newExpenses, ...data.expenses] }
  const supplierName = stripExpenseBillSuffix(expenses[0]?.name?.trim() ?? '')
  const withSupplier = supplierName ? ensureSupplierInData(next, supplierName) : next
  const description = expenses[0]?.description?.trim()
  const withItem =
    supplierName && description
      ? addSupplierItem(withSupplier, supplierName, description)
      : withSupplier
  saveData(withItem)
  return withItem
}

export function setTheme(data: AppData, theme: AppTheme): AppData {
  const next = { ...data, theme }
  saveData(next)
  return next
}

export function setOpeningBankBalance(data: AppData, amount: number): AppData {
  const next = { ...data, openingBankBalance: amount }
  saveData(next)
  return next
}

export function setHomePin(data: AppData, pin: string): AppData {
  const next = { ...data, homePin: normalizePin(pin, '0000') }
  saveData(next)
  return next
}

export function setOpeningBalance(data: AppData, amount: number): AppData {
  const next = { ...data, openingBalance: amount }
  saveData(next)
  return next
}

export function deleteSale(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const idsToRemove = new Set<string>()

  function addSaleTree(saleId: string) {
    if (!saleId || saleId.startsWith('split-group-')) return
    const sale = data.sales.find((s) => s.id === saleId)
    if (!sale || idsToRemove.has(saleId)) return
    idsToRemove.add(saleId)
    for (const child of data.sales) {
      if (child.parentSplitId === saleId) addSaleTree(child.id)
    }
  }

  if (relatedSaleIds?.length) {
    for (const saleId of relatedSaleIds) addSaleTree(saleId)
  } else {
    addSaleTree(id)
  }

  // Orphan split children share a parentSplitId with no parent sale — remove the whole group.
  for (const saleId of [...idsToRemove]) {
    const sale = data.sales.find((s) => s.id === saleId)
    const parentId = sale?.parentSplitId
    if (!parentId || data.sales.some((s) => s.id === parentId)) continue
    for (const sibling of data.sales) {
      if (sibling.parentSplitId === parentId) addSaleTree(sibling.id)
    }
  }

  if (idsToRemove.size === 0) return data

  const next = { ...data, sales: data.sales.filter((s) => !idsToRemove.has(s.id)) }
  saveData(next)
  return next
}

export function deleteExpense(data: AppData, id: string): AppData {
  const next = { ...data, expenses: data.expenses.filter((e) => e.id !== id) }
  saveData(next)
  return next
}

export function updateSaleCustomerName(
  data: AppData,
  id: string,
  customerName: string,
  relatedSaleIds?: string[],
): AppData {
  const trimmed = customerName.trim()
  const now = new Date().toISOString()
  const targets = new Set<string>()

  if (data.sales.some((sale) => sale.id === id)) {
    for (const saleId of collectSplitNameTargets(data, id)) targets.add(saleId)
  }

  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((sale) => sale.id === saleId)) {
        for (const relatedId of collectSplitNameTargets(data, saleId)) {
          targets.add(relatedId)
        }
      }
    }
  }

  if (targets.size === 0) return data

  const next = {
    ...data,
    sales: data.sales.map((s) =>
      targets.has(s.id)
        ? {
            ...s,
            customerName: trimmed || undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

export function updatePendingBill(
  data: AppData,
  id: string,
  updates: {
    billAmount: number
    originalBillAmount?: number
    customerName?: string
    payType?: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    creditAmount?: number
    pendingPayType?: PayType
  },
): AppData {
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id && s.status === 'pending'
        ? {
            ...s,
            billAmount: updates.billAmount,
            originalBillAmount: updates.originalBillAmount,
            customerName: updates.customerName,
            payType: updates.payType,
            pendingPayType: updates.pendingPayType ?? s.pendingPayType,
            cashAmount: updates.payType === 'split' ? updates.cashAmount : undefined,
            bankAmount: updates.payType === 'split' ? updates.bankAmount : undefined,
            chequeAmount: updates.payType === 'split' ? updates.chequeAmount : undefined,
            creditAmount: updates.payType === 'split' ? updates.creditAmount : undefined,
            updatedAt: new Date().toISOString(),
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

export function isApprovedChequeSale(sale: Sale): boolean {
  if (sale.status !== 'paid') return false
  if (sale.payType === 'cheque') return true
  if (sale.payType === 'split' && sale.chequeApproved && (sale.chequeAmount ?? 0) > 0) {
    return true
  }
  return false
}

export function getApprovedChequeAmount(sale: Sale): number {
  if (sale.payType === 'split') return sale.chequeAmount ?? 0
  return sale.chequeAmount ?? sale.billAmount
}

export function listApprovedCheques(data: AppData): Sale[] {
  return data.sales
    .filter(isApprovedChequeSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

function revertPendingPayTypes(sale: Sale): { payType: PayType; pendingPayType: PayType } {
  if (sale.pendingPayType === 'credit') {
    return { payType: 'credit', pendingPayType: 'credit' }
  }
  return { payType: 'cheque', pendingPayType: 'cheque' }
}

export function cancelApprovedCheque(data: AppData, id: string): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isApprovedChequeSale(sale)) return data

  const now = new Date().toISOString()

  if (sale.payType === 'split') {
    const chequeAmt = sale.chequeAmount ?? 0
    if (chequeAmt <= 0) return data

    const bankOnly = Math.max(0, (sale.bankAmount ?? 0) - chequeAmt)
    const pendingCheque: Sale = {
      id: crypto.randomUUID(),
      billAmount: chequeAmt,
      originalBillAmount: sale.originalBillAmount ?? sale.billAmount,
      paidAmount: 0,
      changeAmount: 0,
      payType: 'cheque',
      pendingPayType: 'cheque',
      parentSplitId: sale.id,
      customerName: sale.customerName,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }

    const next = {
      ...data,
      sales: [
        pendingCheque,
        ...data.sales.map((s) =>
          s.id === id
            ? {
                ...s,
                bankAmount: bankOnly > 0 ? bankOnly : undefined,
                chequeAmount: undefined,
                chequeApproved: undefined,
                updatedAt: now,
              }
            : s,
        ),
      ],
    }
    saveData(next)
    return next
  }

  const revert = revertPendingPayTypes(sale)
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id
        ? {
            ...s,
            status: 'pending' as const,
            payType: revert.payType,
            pendingPayType: revert.pendingPayType,
            paidAmount: 0,
            changeAmount: 0,
            chequeApproved: undefined,
            bankAmount: undefined,
            chequeAmount: revert.payType === 'cheque' ? s.chequeAmount ?? s.billAmount : undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

export function collectPendingBill(
  data: AppData,
  id: string,
  sale: {
    billAmount: number
    originalBillAmount?: number
    paidAmount: number
    changeAmount: number
    payType: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    creditAmount?: number
    chequeApproved?: boolean
    customerName?: string
  },
): AppData {
  const now = new Date().toISOString()
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id && s.status === 'pending'
        ? {
            ...s,
            ...sale,
            pendingPayType:
              s.pendingPayType ??
              (s.payType === 'credit' || s.payType === 'cheque' ? s.payType : undefined),
            status: 'paid' as const,
            creditAmount: sale.payType === 'split' ? sale.creditAmount : undefined,
            chequeApproved: sale.payType === 'split' ? sale.chequeApproved : undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

function defaultExpenseName(expense: Expense): string {
  if (expense.kind === 'add') return 'Added'
  if (expense.kind === 'transfer') return 'Transfer'
  return 'Expense'
}

export function updateSaleBill(
  data: AppData,
  id: string,
  updates: {
    customerName?: string
    billAmount?: number
    pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
  },
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale) return data

  const billAmount =
    updates.billAmount != null && updates.billAmount > 0 ? updates.billAmount : sale.billAmount
  const customerName =
    updates.customerName !== undefined
      ? updates.customerName.trim() || undefined
      : sale.customerName

  if (sale.status === 'pending') {
    const pendingPayType = updates.pendingPayType ?? sale.pendingPayType ?? sale.payType
    const payType = updates.pendingPayType ?? sale.payType
    return updatePendingBill(data, id, {
      billAmount,
      originalBillAmount: sale.originalBillAmount ?? billAmount,
      customerName,
      payType:
        payType === 'credit' || payType === 'cheque'
          ? payType
          : sale.payType === 'credit' || sale.payType === 'cheque'
            ? sale.payType
            : sale.payType,
      pendingPayType:
        pendingPayType === 'credit' || pendingPayType === 'cheque'
          ? pendingPayType
          : sale.pendingPayType,
    })
  }

  const isSplitParent =
    sale.payType === 'split' || data.sales.some((s) => s.parentSplitId === sale.id)

  if (isSplitParent) {
    if (updates.customerName === undefined) return data
    return updateSaleCustomerName(data, id, updates.customerName, relatedSaleIds)
  }

  const now = new Date().toISOString()
  const nameTargets = new Set<string>()
  for (const saleId of collectSplitNameTargets(data, id)) nameTargets.add(saleId)
  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((s) => s.id === saleId)) {
        for (const relatedId of collectSplitNameTargets(data, saleId)) {
          nameTargets.add(relatedId)
        }
      }
    }
  }
  if (nameTargets.size === 0) nameTargets.add(id)

  const next = {
    ...data,
    sales: data.sales.map((s) => {
      if (!nameTargets.has(s.id) && s.id !== id) return s

      let patched: Sale = { ...s }
      let touched = false
      if (nameTargets.has(s.id) && updates.customerName !== undefined) {
        patched = { ...patched, customerName }
        touched = true
      }
      if (s.id === id && updates.billAmount != null && updates.billAmount > 0) {
        patched = {
          ...patched,
          billAmount,
          updatedAt: now,
        }
        touched = true
        if (s.payType === 'cash' || !s.payType) {
          patched.changeAmount = Math.max(0, s.paidAmount - billAmount)
        }
        if (s.payType === 'cheque') {
          patched.chequeAmount = billAmount
        }
      } else if (touched) {
        patched = { ...patched, updatedAt: now }
      }
      return patched
    }),
  }
  saveData(next)
  return next
}

export function updateExpenseName(data: AppData, id: string, name: string): AppData {
  const trimmed = name.trim()
  const next = {
    ...data,
    expenses: data.expenses.map((e) =>
      e.id === id ? { ...e, name: trimmed || defaultExpenseName(e) } : e,
    ),
  }
  saveData(next)
  return next
}

export function updateExpense(
  data: AppData,
  id: string,
  updates: Partial<Omit<Expense, 'id' | 'createdAt'>>,
): AppData {
  const existing = data.expenses.find((e) => e.id === id)
  if (!existing) return data

  const patched: Expense = {
    ...existing,
    ...updates,
    name: updates.name !== undefined ? updates.name.trim() || defaultExpenseName(existing) : existing.name,
    description:
      updates.description !== undefined
        ? updates.description.trim() || undefined
        : existing.description,
  }

  let next: AppData = {
    ...data,
    expenses: data.expenses.map((e) => (e.id === id ? patched : e)),
  }

  const supplierName = stripExpenseBillSuffix(patched.name?.trim() ?? '')
  if (supplierName) next = ensureSupplierInData(next, supplierName)
  const item = patched.description?.trim()
  if (supplierName && item) next = addSupplierItem(next, supplierName, item)

  saveData(next)
  return next
}
