import type { AppData, Expense, Sale } from '../types'
import { STORAGE_KEY } from '../types'

const defaultData: AppData = {
  openingBalance: 0,
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
      sales: parsed.sales ?? [],
      expenses: parsed.expenses ?? [],
    }
  } catch {
    return { ...defaultData }
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function getCurrentBalance(data: AppData): number {
  const salesTotal = data.sales.reduce((sum, s) => sum + s.billAmount, 0)
  const expensesTotal = data.expenses.reduce((sum, e) => sum + e.amount, 0)
  return data.openingBalance + salesTotal - expensesTotal
}

export function addSale(data: AppData, sale: Omit<Sale, 'id' | 'createdAt'>): AppData {
  const newSale: Sale = {
    ...sale,
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
