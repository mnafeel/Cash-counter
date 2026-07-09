export type PayType = 'cash' | 'bank' | 'credit' | 'split'
export type SaleStatus = 'pending' | 'paid'

export interface Sale {
  id: string
  billAmount: number
  originalBillAmount?: number
  paidAmount: number
  changeAmount: number
  payType?: PayType
  cashAmount?: number
  bankAmount?: number
  creditAmount?: number
  status?: SaleStatus
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
