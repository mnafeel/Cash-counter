import type { AppData, AppTheme, Expense, PayType, Sale, TransferDirection } from '../types'
import { STORAGE_KEY } from '../types'
import { collectSplitNameTargets } from '../utils/saleCustomerName'
import { notifyDataChanged } from '../firebase/sync'
import { normalizePin } from '../utils/numpad'
import { normalizeTheme } from '../utils/theme'

const defaultData: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  homePin: '0000',
  theme: 'premium',
  sales: [],
  expenses: [],
}

export function normalizeData(parsed: Partial<AppData>): AppData {
  return {
    openingBalance: parsed.openingBalance ?? 0,
    openingBankBalance: parsed.openingBankBalance ?? 0,
    homePin: normalizePin(parsed.homePin, '0000'),
    theme: normalizeTheme(parsed.theme),
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

function expenseCashToDrawer(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return expense.amount
    if (expense.transferDirection === 'bank-to-cash') return -expense.amount
    return 0
  }
  if (expense.payType === 'bank') return 0
  if (expense.payType === 'split') {
    const cash = expense.cashAmount ?? 0
    return expense.kind === 'add' ? -cash : cash
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

function saleBankToBalance(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank' || sale.payType === 'cheque') return sale.billAmount
  if (sale.payType === 'split') return sale.bankAmount ?? 0
  return 0
}

function expenseBankToBalance(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return -expense.amount
    if (expense.transferDirection === 'bank-to-cash') return expense.amount
    return 0
  }
  if (expense.payType === 'cash') return 0
  if (expense.payType === 'split') {
    const bank = expense.bankAmount ?? 0
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
  const newSale: Sale = {
    ...rest,
    status: rest.status ?? 'paid',
    id: presetId ?? crypto.randomUUID(),
    createdAt: new Date().toISOString(),
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
  const next = { ...data, homePin: pin }
  saveData(next)
  return next
}

export function setOpeningBalance(data: AppData, amount: number): AppData {
  const next = { ...data, openingBalance: amount }
  saveData(next)
  return next
}

export function deleteSale(data: AppData, id: string): AppData {
  const next = { ...data, sales: data.sales.filter((s) => s.id !== id) }
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
            ...(s.status === 'pending' ? { updatedAt: now } : {}),
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
