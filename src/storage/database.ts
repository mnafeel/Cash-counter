import type { AppData, AppTheme, Expense, PayType, Sale, TransferDirection } from '../types'
import { STORAGE_KEY } from '../types'
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
  if (sale.payType === 'bank' || sale.payType === 'credit') return 0
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
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

function saleBankToBalance(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank') return sale.billAmount
  if (sale.payType === 'split') return sale.bankAmount ?? 0
  return 0
}

function expenseBankToBalance(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return -expense.amount
    if (expense.transferDirection === 'bank-to-cash') return expense.amount
    return 0
  }
  if (expense.payType !== 'bank') return 0
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

export function addSale(data: AppData, sale: Omit<Sale, 'id' | 'createdAt'>): AppData {
  const newSale: Sale = {
    ...sale,
    status: sale.status ?? 'paid',
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, sales: [newSale, ...data.sales] }
  saveData(next)
  return next
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
): AppData {
  const trimmed = customerName.trim()
  const now = new Date().toISOString()
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id
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
            updatedAt: new Date().toISOString(),
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
            status: 'paid' as const,
            creditAmount: undefined,
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
