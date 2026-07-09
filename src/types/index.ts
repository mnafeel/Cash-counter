export type PayType = 'cash' | 'bank' | 'split'

export interface Sale {
  id: string
  billAmount: number
  originalBillAmount?: number
  paidAmount: number
  changeAmount: number
  payType?: PayType
  cashAmount?: number
  bankAmount?: number
  customerName?: string
  createdAt: string
}

export interface Expense {
  id: string
  amount: number
  note: string
  createdAt: string
}

export interface AppData {
  openingBalance: number
  sales: Sale[]
  expenses: Expense[]
}

export const STORAGE_KEY = 'cash-counter-data'
