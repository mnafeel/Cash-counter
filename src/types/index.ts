export type PayType = 'cash' | 'bank' | 'credit' | 'split' | 'cheque'
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
  chequeAmount?: number
  creditAmount?: number
  /** Split sale: cheque portion approved straight to bank (not pending). */
  chequeApproved?: boolean
  /** Pending credit/cheque bill created from a split sale. */
  parentSplitId?: string
  /** Original bill kind when a credit/cheque pending bill is collected another way. */
  pendingPayType?: PayType
  status?: SaleStatus
  customerName?: string
  /** Origin when imported from Tally Prime (deduped by sourceId). */
  source?: 'tally'
  sourceId?: string
  createdAt: string
  updatedAt?: string
}

export type ExpensePayType = Extract<PayType, 'cash' | 'bank'>
export type ExpenseKind = 'expense' | 'add' | 'transfer'
export type TransferDirection = 'cash-to-bank' | 'bank-to-cash'
export type AppTheme = 'brown' | 'navy' | 'light' | 'premium'

export interface Expense {
  id: string
  amount: number
  name: string
  payType: ExpensePayType
  kind?: ExpenseKind
  transferDirection?: TransferDirection
  /** @deprecated legacy field — migrated to name */
  note?: string
  createdAt: string
}

export interface AppData {
  openingBalance: number
  openingBankBalance?: number
  homePin?: string
  theme?: AppTheme
  sales: Sale[]
  expenses: Expense[]
}

export const STORAGE_KEY = 'cash-counter-data'
