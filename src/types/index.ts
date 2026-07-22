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

export type ExpensePayType = Extract<PayType, 'cash' | 'bank' | 'credit' | 'split' | 'cheque'>
export type ExpenseKind = 'expense' | 'add' | 'transfer'
export type TransferDirection = 'cash-to-bank' | 'bank-to-cash'
export type AppTheme = 'brown' | 'navy' | 'light' | 'premium'

export interface Expense {
  id: string
  amount: number
  name: string
  /** Purchase item or expense description. */
  description?: string
  payType: ExpensePayType
  cashAmount?: number
  bankAmount?: number
  creditAmount?: number
  chequeAmount?: number
  /** Split/cheque expense: cheque portion approved to bank. */
  chequeApproved?: boolean
  giveAmount?: number
  changeAmount?: number
  /** Dual purchase: 1 = GST bill, 2 = without GST. */
  billNumber?: 1 | 2
  pairedExpenseId?: string
  kind?: ExpenseKind
  transferDirection?: TransferDirection
  /** @deprecated legacy field — migrated to name */
  note?: string
  createdAt: string
}

export interface SupplierEntry {
  name: string
  items?: string[]
}

export interface AppData {
  openingBalance: number
  openingBankBalance?: number
  homePin?: string
  theme?: AppTheme
  /** Saved purchase suppliers and their item descriptions. */
  suppliers?: SupplierEntry[]
  sales: Sale[]
  expenses: Expense[]
}

export const STORAGE_KEY = 'cash-counter-data'
