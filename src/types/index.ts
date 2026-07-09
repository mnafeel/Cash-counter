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

export type ExpensePayType = Extract<PayType, 'cash' | 'bank'>
export type ExpenseKind = 'expense' | 'add'

export interface Expense {
  id: string
  amount: number
  name: string
  payType: ExpensePayType
  kind?: ExpenseKind
  /** @deprecated legacy field — migrated to name */
  note?: string
  createdAt: string
}

export interface AppData {
  openingBalance: number
  openingBankBalance?: number
  homePin?: string
  sales: Sale[]
  expenses: Expense[]
}

export const STORAGE_KEY = 'cash-counter-data'
