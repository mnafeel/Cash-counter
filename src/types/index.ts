export type PayType = 'cash' | 'bank' | 'credit' | 'split' | 'cheque'
export type SaleStatus = 'pending' | 'paid'

export interface SalePaymentEvent {
  at: string
  amount: number
  cash?: number
  bank?: number
  cheque?: number
}

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
  /** Per payment collection — used so later credit pay-down only counts on that day. */
  paymentEvents?: SalePaymentEvent[]
  /** Follow-up date to remind about collecting this pending bill. */
  reminderAt?: string
  /** Optional note shown with reminder alerts. */
  reminderNote?: string
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
  /** Set when bill or credit balance is updated (e.g. partial credit payment). */
  updatedAt?: string
}

export interface SupplierEntry {
  name: string
  items?: string[]
}

/** Global alert timing for credit & cheque bill reminders. */
export interface ReminderAlertSettings {
  /** Days before reminder date/time to start credit alerts. */
  creditDaysBefore: number
  /** Days before reminder date/time to start cheque collect alerts. */
  chequeDaysBefore: number
  /** Repeat alert every N days while in the alert window (1 = daily). */
  alertIntervalDays: number
  /** Seconds to show top notification (0 = until manually closed). */
  notificationShowSeconds: number
  /** Play a short notification sound when alerts appear. */
  notificationSoundEnabled: boolean
}

/** Per-customer follow-up reminder (applies to all open credit/cheque bills). */
export interface CustomerReminderEntry {
  creditReminderAt?: string
  creditReminderNote?: string
  chequeReminderAt?: string
  chequeReminderNote?: string
}

export type CustomerReminderMap = Record<string, CustomerReminderEntry>

export const DEFAULT_REMINDER_ALERTS: ReminderAlertSettings = {
  creditDaysBefore: 3,
  chequeDaysBefore: 7,
  alertIntervalDays: 1,
  notificationShowSeconds: 0,
  notificationSoundEnabled: true,
}

/** Top notification auto-hide duration options (0 = manual close). */
export const NOTIFICATION_SHOW_SECOND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300] as const

export interface AppData {
  openingBalance: number
  openingBankBalance?: number
  homePin?: string
  theme?: AppTheme
  /** Saved purchase suppliers and their item descriptions. */
  suppliers?: SupplierEntry[]
  reminderAlerts?: ReminderAlertSettings
  /** Customer-level credit/cheque collection reminders. */
  customerReminders?: CustomerReminderMap
  sales: Sale[]
  expenses: Expense[]
}

export const STORAGE_KEY = 'cash-counter-data'
