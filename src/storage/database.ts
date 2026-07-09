import type { AppData, Expense, Sale } from '../types'
import { STORAGE_KEY } from '../types'
import { normalizePin } from '../utils/numpad'

const defaultData: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  homePin: '0000',
  sales: [],
  expenses: [],
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultData }
    const parsed = JSON.parse(raw) as AppData
    return {
      openingBalance: parsed.openingBalance ?? 0,
      openingBankBalance: parsed.openingBankBalance ?? 0,
      homePin: normalizePin(parsed.homePin, '0000'),
      sales: parsed.sales ?? [],
      expenses: (parsed.expenses ?? []).map((e) => ({
        ...e,
        name: e.name ?? e.note ?? 'Expense',
        payType: e.payType === 'bank' ? 'bank' : 'cash',
        kind: e.kind === 'add' ? 'add' : 'expense',
      })),
    }
  } catch {
    return { ...defaultData }
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function saleCashToDrawer(sale: Sale): number {
  if (sale.status === 'pending') return 0
  if (sale.payType === 'bank' || sale.payType === 'credit') return 0
  if (sale.payType === 'split') return sale.cashAmount ?? 0
  return sale.billAmount
}

export function getPendingBills(data: AppData): Sale[] {
  return data.sales.filter((s) => s.status === 'pending')
}

function expenseCashToDrawer(expense: Expense): number {
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
    status: sale.status ?? (sale.payType === 'credit' ? 'pending' : 'paid'),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, sales: [newSale, ...data.sales] }
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
