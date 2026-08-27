export type PayType = 'cash' | 'bank' | 'credit' | 'split' | 'cheque'
export type SaleStatus = 'pending' | 'paid'

export interface SalePaymentEvent {
  at: string
  amount: number
  cash?: number
  bank?: number
  cheque?: number
  /** Set when this cheque/bank approval is cancelled in Settings. */
  cancelled?: boolean
  cancelledAt?: string
}

/** Item returned against a sales / credit bill — reduces amount due. */
export interface SaleReturnEntry {
  id: string
  itemName: string
  quantity: number
  rate: number
  /** quantity × rate */
  amount: number
  createdAt: string
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
  /** Sales / credit item returns deducted from the bill. */
  returns?: SaleReturnEntry[]
  /** Origin when imported from Tally Prime (deduped by sourceId). */
  source?: 'tally'
  sourceId?: string
  createdAt: string
  updatedAt?: string
  /** Per payment collection — used so later credit pay-down only counts on that day. */
  paymentEvents?: SalePaymentEvent[]
  /** Open credit balance cleared via Settings / History cancel (partial collection kept). */
  creditCancelledAt?: string
  creditCancelledAmount?: number
  /** Follow-up date to remind about collecting this pending bill. */
  reminderAt?: string
  /** Optional note shown with reminder alerts. */
  reminderNote?: string
}

export type ExpensePayType = Extract<PayType, 'cash' | 'bank' | 'credit' | 'split' | 'cheque'>
export type ExpenseKind = 'expense' | 'add' | 'transfer'
export type TransferDirection = 'cash-to-bank' | 'bank-to-cash'
export type AppTheme = 'brown' | 'navy' | 'light' | 'premium'

/** One cash/bank/cheque payment against purchase credit (dated when money left). */
export interface ExpenseCreditPayment {
  id: string
  at: string
  cash: number
  bank: number
  cheque: number
  chequeApproved?: boolean
}

export interface Expense {
  id: string
  amount: number
  name: string
  /** Purchase item or expense description. */
  description?: string
  /** Supplier invoice / bill reference number (purchase). */
  billNo?: string
  /** Supplier bill date (YYYY-MM-DD) — used for purchase history ordering. */
  billDate?: string
  payType: ExpensePayType
  cashAmount?: number
  bankAmount?: number
  creditAmount?: number
  chequeAmount?: number
  /** Split/cheque expense: cheque portion approved to bank. */
  chequeApproved?: boolean
  /**
   * Ledger of payments that cleared credit (and any cash/bank paid with the bill).
   * Expense reports use these dates — unpaid credit never appears until paid here.
   */
  creditPayments?: ExpenseCreditPayment[]
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
  /** Links general expense to a staff member's salary record. */
  staffId?: string
  /** YYYY-MM — which salary month this payment applies to. */
  staffSalaryMonth?: string
  /** When false, expense is recorded but does not reduce salary balance. */
  staffSalaryLink?: boolean
}

export interface SupplierEntry {
  name: string
  items?: string[]
}

/** Global alert timing for credit, cheque & loan reminders. */
export interface ReminderAlertSettings {
  /** Days before reminder date/time to start credit alerts. */
  creditDaysBefore: number
  /** Days before reminder date/time to start cheque collect alerts. */
  chequeDaysBefore: number
  /** Days before reminder date/time to start loan alerts. */
  loanDaysBefore: number
  /** Repeat alert every N days while in the alert window (1 = daily). */
  alertIntervalDays: number
  /** Seconds to show top notification (0 = until manually closed). */
  notificationShowSeconds: number
  /** Play a short notification sound when alerts appear. */
  notificationSoundEnabled: boolean
  /** once = single ping; interval = repeat every N seconds; continuous = ring until stopped. */
  notificationSoundMode: 'once' | 'interval' | 'continuous'
  /** Seconds between sounds when notificationSoundMode is interval. */
  notificationSoundRepeatSeconds: number
}

export type NotificationSoundMode = ReminderAlertSettings['notificationSoundMode']

/** Interval options (seconds) for repeating reminder sounds. */
export const NOTIFICATION_SOUND_REPEAT_OPTIONS = [15, 30, 60, 120, 300] as const

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
  loanDaysBefore: 3,
  alertIntervalDays: 1,
  notificationShowSeconds: 0,
  notificationSoundEnabled: true,
  notificationSoundMode: 'once',
  notificationSoundRepeatSeconds: 30,
}

/** Top notification auto-hide duration options (0 = manual close). */
export const NOTIFICATION_SHOW_SECOND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300] as const

export type LoanKind = 'lend' | 'borrow'
export type LoanStatus = 'pending' | 'settled'
export type LoanPaySource = 'cash' | 'bank'

/** One partial or full loan settlement — dated for history and balance activity. */
export interface LoanSettlementEvent {
  id: string
  at: string
  amount: number
  paySource: LoanPaySource
}

/** Zero-interest loan — lend (receivable) or borrow (payable). */
export interface Loan {
  id: string
  kind: LoanKind
  personName: string
  amount: number
  /** Cash or bank used when giving a loan; borrow always adds to cash. */
  paySource: LoanPaySource
  status: LoanStatus
  note?: string
  reminderAt?: string
  reminderNote?: string
  /** Mark loan reminder as urgent — longer, stronger alert sound. */
  reminderUrgent?: boolean
  createdAt: string
  /** Total returned / collected so far (partial settlements supported). */
  paidAmount?: number
  settlementEvents?: LoanSettlementEvent[]
  settledAt?: string
  /** Cash or bank used when settling / returning the loan. */
  settlementPaySource?: LoanPaySource
}

/** Staff member with a fixed monthly salary. */
export interface StaffMember {
  id: string
  name: string
  monthlySalary: number
  /** Days used to divide monthly salary for daily rate (default 30). */
  salaryDaysPerMonth?: number
  createdAt: string
}

export type StaffLeaveType = 'present' | 'half' | 'off' | 'leave' | 'not_paid'

/** Attendance on a calendar day. */
export interface StaffLeave {
  id: string
  staffId: string
  /** Local calendar date YYYY-MM-DD */
  date: string
  type: StaffLeaveType
  createdAt: string
}

export interface AppData {
  openingBalance: number
  openingBankBalance?: number
  /**
   * Sealed cash/bank in the drawer at local 12 AM for each calendar day.
   * Key = YYYY-MM-DD. Once written, Opening (12 AM) for that day stays fixed.
   */
  dayBalances?: Record<string, DayDrawerOpening>
  homePin?: string
  theme?: AppTheme
  /** Saved purchase suppliers and their item descriptions. */
  suppliers?: SupplierEntry[]
  reminderAlerts?: ReminderAlertSettings
  /** Customer-level credit/cheque collection reminders. */
  customerReminders?: CustomerReminderMap
  sales: Sale[]
  expenses: Expense[]
  loans?: Loan[]
  staff?: StaffMember[]
  staffLeaves?: StaffLeave[]
  /** Overpaid salary moved from one month to count as paid in the next. */
  staffSalaryAdvances?: StaffSalaryAdvance[]
  /** Recently deleted records — restore from Settings. */
  trash?: TrashedRecord[]
}

export type TrashKind = 'sale' | 'expense' | 'loan'

export interface TrashedRecord {
  id: string
  kind: TrashKind
  deletedAt: string
  label: string
  amount: number
  snapshot: Sale | Expense | Loan
  /** Split groups — restore/delete together. */
  relatedSaleIds?: string[]
}

/** Cash/bank that was in the drawer at the start of a local calendar day. */
export interface DayDrawerOpening {
  cashOpening: number
  bankOpening: number
  sealedAt: string
}

/** Carry-forward when a month is overpaid — counts as paid in `toMonth`. */
export interface StaffSalaryAdvance {
  id: string
  staffId: string
  fromMonth: string
  toMonth: string
  amount: number
  createdAt: string
}

export const STORAGE_KEY = 'cash-counter-data'
export const LOCAL_UPDATED_AT_KEY = 'cash-counter-local-updated-at'
/** Firebase UID that owns the current local `cash-counter-data` blob. */
export const LOCAL_USER_UID_KEY = 'cash-counter-local-user-uid'
