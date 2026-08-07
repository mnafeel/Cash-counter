import type { AppData, AppTheme, Expense, ExpensePayType, Loan, LoanKind, LoanPaySource, PayType, ReminderAlertSettings, Sale, StaffLeave, StaffLeaveType, StaffMember, StaffSalaryAdvance, SupplierEntry, TransferDirection, CustomerReminderMap } from '../types'
import { DEFAULT_REMINDER_ALERTS, LOCAL_UPDATED_AT_KEY, LOCAL_USER_UID_KEY, STORAGE_KEY } from '../types'
import { collectSplitNameTargets } from '../utils/saleCustomerName'
import { stripExpenseBillSuffix, isPurchaseExpense } from '../utils/expenseBillLabels'
import {
  buildCreditPaymentUpdate,
  isPurchaseCreditExpense,
  purchaseCreditAmount,
  purchasePaidComponents,
  type CreditPaymentInput,
} from '../utils/purchaseHistory'
import { notifyDataChanged, notifyDataChangedImmediate } from '../firebase/sync'
import { markLocalBackupTime } from '../firebase/backup'
import { queueLocalBackupSnapshot } from './localBackup'
import { applyStoredCustomerReminderToSale, listOpenBillIdsForCustomer } from '../utils/customerReminders'
import type { BillReminderKind } from '../utils/billReminders'
import {
  appendSalePaymentEvent,
  buildIncrementalPaymentEvent,
  buildPaidSalePaymentEvents,
  clearSalePaymentCaches,
  normalizeCollectedBreakdown,
  normalizePaymentEvent,
  paymentEventFromCollectedBreakdown,
  migrateSalePaymentEvents,
  repairSalePaymentEvents,
  saleCollectedAmount,
  saleCollectedComponentBreakdown,
  saleCollectionTimestamp,
  salePendingCreditPaidBreakdown,
  salePendingRawCollectedParts,
  saleActiveCollectedParts,
  sanitizeSplitParentChildChequeOverlap,
} from '../utils/salePayment'
import type { SalePaymentEvent } from '../types'
import { normalizePin } from '../utils/numpad'
import { normalizeTheme } from '../utils/theme'
import { loanBankToBalance, loanCashToDrawer, loanRemainingAmount } from '../utils/loanLedger'
import { getStaffMonthSummary, isStaffLinkableExpense, salaryMonthFromDate, type SalaryMonthKey } from '../utils/staffLedger'
import { validateStaffLeaveInput, resolveStaffSalaryDays, normalizeStaffLeaveTypeValue, isSundayDate, isRedundantStaffLeaveRecord } from '../utils/staffAttendance'
import { isoToDateInputValue } from '../utils/format'

const defaultData: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  homePin: '0000',
  theme: 'premium',
  suppliers: [],
  sales: [],
  expenses: [],
  loans: [],
  staff: [],
  staffLeaves: [],
  staffSalaryAdvances: [],
}

function normalizeItemList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    seen.set(trimmed.toLowerCase(), trimmed)
  }
  return Array.from(seen.values())
}

export function normalizeSuppliers(raw: unknown): SupplierEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, SupplierEntry>()
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, { name: trimmed, items: [] })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<SupplierEntry>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    const prev = seen.get(key)
    const items = normalizeItemList(record.items)
    const mergedItems = new Map<string, string>()
    for (const label of [...(prev?.items ?? []), ...items]) {
      mergedItems.set(label.toLowerCase(), label)
    }
    seen.set(key, { name, items: Array.from(mergedItems.values()) })
  }
  return Array.from(seen.values())
}

export function ensureSupplierInData(data: AppData, rawName: string): AppData {
  const name = stripExpenseBillSuffix(rawName.trim())
  if (!name) return data
  const key = name.toLowerCase()
  const existing = normalizeSuppliers(data.suppliers)
  if (existing.some((supplier) => supplier.name.toLowerCase() === key)) return data
  return { ...data, suppliers: [{ name, items: [] }, ...existing] }
}

export function addSupplier(data: AppData, rawName: string): AppData {
  const next = ensureSupplierInData(data, rawName)
  if (next === data) return data
  saveData(next)
  return next
}

export function addSupplierItem(data: AppData, rawName: string, item: string): AppData {
  const supplierName = stripExpenseBillSuffix(rawName.trim())
  const itemLabel = item.trim()
  if (!supplierName || !itemLabel) return data

  const key = supplierName.toLowerCase()
  const itemKey = itemLabel.toLowerCase()
  let suppliers = normalizeSuppliers(data.suppliers)
  const index = suppliers.findIndex((supplier) => supplier.name.toLowerCase() === key)

  if (index < 0) {
    suppliers = [{ name: supplierName, items: [itemLabel] }, ...suppliers]
  } else {
    const entry = suppliers[index]
    const items = entry.items ?? []
    if (items.some((label) => label.toLowerCase() === itemKey)) return data
    suppliers = [...suppliers]
    suppliers[index] = { ...entry, items: [itemLabel, ...items] }
  }

  const next = { ...data, suppliers }
  saveData(next)
  return next
}

function normalizeCustomerReminders(raw: unknown): CustomerReminderMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const map: CustomerReminderMap = {}
  for (const [name, entry] of Object.entries(raw as CustomerReminderMap)) {
    const trimmed = name.trim()
    if (!trimmed || !entry || typeof entry !== 'object') continue
    const creditReminderAt =
      typeof entry.creditReminderAt === 'string' ? entry.creditReminderAt : undefined
    const creditReminderNote =
      typeof entry.creditReminderNote === 'string' ? entry.creditReminderNote.trim() || undefined : undefined
    const chequeReminderAt =
      typeof entry.chequeReminderAt === 'string' ? entry.chequeReminderAt : undefined
    const chequeReminderNote =
      typeof entry.chequeReminderNote === 'string' ? entry.chequeReminderNote.trim() || undefined : undefined
    if (!creditReminderAt && !chequeReminderAt) continue
    map[trimmed] = {
      creditReminderAt,
      creditReminderNote,
      chequeReminderAt,
      chequeReminderNote,
    }
  }
  return Object.keys(map).length > 0 ? map : undefined
}

function normalizeExpensePayType(payType: unknown): ExpensePayType {
  if (
    payType === 'bank' ||
    payType === 'split' ||
    payType === 'credit' ||
    payType === 'cheque'
  ) {
    return payType
  }
  return 'cash'
}

function normalizeExpense(expense: Expense): Expense {
  return {
    ...expense,
    name: expense.name ?? expense.note ?? 'Expense',
    payType: normalizeExpensePayType(expense.payType),
    kind:
      expense.kind === 'add' ? 'add' : expense.kind === 'transfer' ? 'transfer' : 'expense',
    transferDirection:
      expense.kind === 'transfer'
        ? expense.transferDirection === 'bank-to-cash'
          ? 'bank-to-cash'
          : 'cash-to-bank'
        : undefined,
  }
}

function recordTimestamp(iso?: string): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function sortRecordsNewestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return items.sort(
    (a, b) => recordTimestamp(b.createdAt) - recordTimestamp(a.createdAt),
  )
}

function isPendingSale(sale: Sale): boolean {
  return sale.status === 'pending'
}

function saleHasCollectionProof(sale: Sale): boolean {
  if (sale.status === 'paid') return true
  if ((sale.paymentEvents?.length ?? 0) > 0) return true
  return false
}

/** Prefer open pending bills unless the other copy clearly collected payment. */
function mergeSalePair(local: Sale, remote: Sale): Sale {
  const localTime = recordTimestamp(local.updatedAt ?? local.createdAt)
  const remoteTime = recordTimestamp(remote.updatedAt ?? remote.createdAt)
  const localPending = isPendingSale(local)
  const remotePending = isPendingSale(remote)

  if (localPending && !remotePending) {
    if (!saleHasCollectionProof(remote) || remoteTime <= localTime) return local
    return remote
  }
  if (!localPending && remotePending) {
    if (!saleHasCollectionProof(local) || localTime <= remoteTime) return remote
    return local
  }

  return localTime >= remoteTime ? local : remote
}

function mergeSaleLists(local: Sale[], remote: Sale[]): Sale[] {
  const byId = new Map<string, Sale>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const other = byId.get(item.id)
    byId.set(item.id, other ? mergeSalePair(item, other) : item)
  }
  return sortRecordsNewestFirst(Array.from(byId.values()))
}

function expenseHasOpenBalance(expense: Expense): boolean {
  if (isPurchaseCreditExpense(expense)) return purchaseCreditAmount(expense) > 0
  if (expense.payType === 'cheque' && !expense.chequeApproved) return true
  if (
    expense.payType === 'split' &&
    (expense.chequeAmount ?? 0) > 0 &&
    !expense.chequeApproved
  ) {
    return true
  }
  return false
}

function expenseBalanceSettled(expense: Expense): boolean {
  if (isPurchaseCreditExpense(expense)) return purchaseCreditAmount(expense) <= 0
  if (expense.payType === 'cheque') return Boolean(expense.chequeApproved)
  if (
    expense.payType === 'split' &&
    (expense.chequeAmount ?? 0) > 0
  ) {
    return Boolean(expense.chequeApproved)
  }
  return true
}

/** Prefer open purchase credit / pending cheque unless the other copy clearly settled. */
function mergeExpensePair(local: Expense, remote: Expense): Expense {
  const localTime = recordTimestamp(local.updatedAt ?? local.createdAt)
  const remoteTime = recordTimestamp(remote.updatedAt ?? remote.createdAt)
  const localOpen = expenseHasOpenBalance(local)
  const remoteOpen = expenseHasOpenBalance(remote)

  if (localOpen && !remoteOpen) {
    if (!expenseBalanceSettled(remote) || remoteTime <= localTime) return local
    if (purchaseCreditAmount(local) > purchaseCreditAmount(remote)) return local
    return remote
  }
  if (!localOpen && remoteOpen) {
    if (!expenseBalanceSettled(local) || localTime <= remoteTime) return remote
    return local
  }

  return localTime >= remoteTime ? local : remote
}

function mergeExpenseLists(local: Expense[], remote: Expense[]): Expense[] {
  const byId = new Map<string, Expense>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const other = byId.get(item.id)
    byId.set(item.id, other ? mergeExpensePair(item, other) : item)
  }
  return sortRecordsNewestFirst(Array.from(byId.values()))
}

function mergeLoanLists(local: Loan[], remote: Loan[]): Loan[] {
  const byId = new Map<string, Loan>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const other = byId.get(item.id)
    if (!other) {
      byId.set(item.id, item)
      continue
    }
    const localTime = new Date(item.settledAt ?? item.createdAt).getTime()
    const remoteTime = new Date(other.settledAt ?? other.createdAt).getTime()
    byId.set(item.id, localTime >= remoteTime ? item : other)
  }
  return sortRecordsNewestFirst(Array.from(byId.values()))
}

function mergeStaffLists(local: StaffMember[], remote: StaffMember[]): StaffMember[] {
  const byId = new Map<string, StaffMember>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const other = byId.get(item.id)
    if (!other) {
      byId.set(item.id, item)
      continue
    }
    const localTime = new Date(item.createdAt).getTime()
    const remoteTime = new Date(other.createdAt).getTime()
    byId.set(item.id, localTime >= remoteTime ? item : other)
  }
  return sortRecordsNewestFirst(Array.from(byId.values()))
}

function mergeStaffSalaryAdvanceLists(
  local: StaffSalaryAdvance[],
  remote: StaffSalaryAdvance[],
): StaffSalaryAdvance[] {
  const byId = new Map<string, StaffSalaryAdvance>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const other = byId.get(item.id)
    if (!other) {
      byId.set(item.id, item)
      continue
    }
    const localTime = new Date(item.createdAt).getTime()
    const remoteTime = new Date(other.createdAt).getTime()
    byId.set(item.id, localTime >= remoteTime ? item : other)
  }
  return sortRecordsNewestFirst(Array.from(byId.values()))
}

function mergeStaffLeaveLists(local: StaffLeave[], remote: StaffLeave[]): StaffLeave[] {
  const byId = new Map<string, StaffLeave>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const other = byId.get(item.id)
    if (!other) {
      byId.set(item.id, item)
      continue
    }
    const localTime = new Date(item.createdAt).getTime()
    const remoteTime = new Date(other.createdAt).getTime()
    byId.set(item.id, localTime >= remoteTime ? item : other)
  }
  return sortRecordsNewestFirst(Array.from(byId.values()))
}

function countPendingSales(data: AppData): number {
  return data.sales.filter((sale) => sale.status === 'pending').length
}

function countOpenPurchaseBalances(data: AppData): number {
  return data.expenses.filter((expense) => expenseHasOpenBalance(expense)).length
}

export function mergeCloudAppData(local: AppData, remote: AppData): AppData {
  const normalizedRemote = normalizeData(remote)
  const normalizedLocal = normalizeData(local)
  return normalizeData({
    ...normalizedRemote,
    sales: mergeSaleLists(normalizedLocal.sales, normalizedRemote.sales),
    expenses: mergeExpenseLists(normalizedLocal.expenses, normalizedRemote.expenses),
    loans: mergeLoanLists(normalizedLocal.loans ?? [], normalizedRemote.loans ?? []),
    staff: mergeStaffLists(normalizedLocal.staff ?? [], normalizedRemote.staff ?? []),
    staffLeaves: mergeStaffLeaveLists(normalizedLocal.staffLeaves ?? [], normalizedRemote.staffLeaves ?? []),
    staffSalaryAdvances: mergeStaffSalaryAdvanceLists(
      normalizedLocal.staffSalaryAdvances ?? [],
      normalizedRemote.staffSalaryAdvances ?? [],
    ),
    suppliers: normalizeSuppliers([
      ...(normalizedRemote.suppliers ?? []),
      ...(normalizedLocal.suppliers ?? []),
    ]),
    customerReminders: {
      ...(normalizedRemote.customerReminders ?? {}),
      ...(normalizedLocal.customerReminders ?? {}),
    },
  })
}

function cloudDataPreservedLocalRecords(local: AppData, remote: AppData, merged: AppData): boolean {
  const remoteExpenseIds = new Set(remote.expenses.map((e) => e.id))
  const remoteSaleIds = new Set(remote.sales.map((s) => s.id))
  const remoteLoanIds = new Set((remote.loans ?? []).map((loan) => loan.id))
  const remoteStaffIds = new Set((remote.staff ?? []).map((member) => member.id))
  const remoteStaffLeaveIds = new Set((remote.staffLeaves ?? []).map((leave) => leave.id))
  const remoteStaffSalaryAdvanceIds = new Set((remote.staffSalaryAdvances ?? []).map((row) => row.id))
  const localOnlyExpenses = local.expenses.some((e) => !remoteExpenseIds.has(e.id))
  const localOnlySales = local.sales.some((s) => !remoteSaleIds.has(s.id))
  const localOnlyLoans = (local.loans ?? []).some((loan) => !remoteLoanIds.has(loan.id))
  const localOnlyStaff = (local.staff ?? []).some((member) => !remoteStaffIds.has(member.id))
  const localOnlyStaffLeaves = (local.staffLeaves ?? []).some((leave) => !remoteStaffLeaveIds.has(leave.id))
  const localOnlyStaffSalaryAdvances = (local.staffSalaryAdvances ?? []).some(
    (row) => !remoteStaffSalaryAdvanceIds.has(row.id),
  )
  return (
    localOnlyExpenses ||
    localOnlySales ||
    localOnlyLoans ||
    localOnlyStaff ||
    localOnlyStaffLeaves ||
    localOnlyStaffSalaryAdvances ||
    merged.expenses.length > remote.expenses.length ||
    merged.sales.length > remote.sales.length ||
    (merged.loans?.length ?? 0) > (remote.loans?.length ?? 0) ||
    (merged.staff?.length ?? 0) > (remote.staff?.length ?? 0) ||
    (merged.staffLeaves?.length ?? 0) > (remote.staffLeaves?.length ?? 0) ||
    (merged.staffSalaryAdvances?.length ?? 0) > (remote.staffSalaryAdvances?.length ?? 0) ||
    countPendingSales(merged) > countPendingSales(remote) ||
    countOpenPurchaseBalances(merged) > countOpenPurchaseBalances(remote)
  )
}

export function normalizeData(parsed: Partial<AppData>): AppData {
  const alerts = parsed.reminderAlerts
  const normalizedExpenses = (parsed.expenses ?? []).map((expense) => normalizeExpense(expense))
  return {
    openingBalance: parsed.openingBalance ?? 0,
    openingBankBalance: parsed.openingBankBalance ?? 0,
    homePin: normalizePin(parsed.homePin, '0000'),
    theme: normalizeTheme(parsed.theme),
    suppliers: normalizeSuppliers(parsed.suppliers),
    reminderAlerts: {
      creditDaysBefore: Math.max(0, alerts?.creditDaysBefore ?? DEFAULT_REMINDER_ALERTS.creditDaysBefore),
      chequeDaysBefore: Math.max(0, alerts?.chequeDaysBefore ?? DEFAULT_REMINDER_ALERTS.chequeDaysBefore),
      loanDaysBefore: Math.max(0, alerts?.loanDaysBefore ?? DEFAULT_REMINDER_ALERTS.loanDaysBefore),
      alertIntervalDays: Math.max(1, alerts?.alertIntervalDays ?? DEFAULT_REMINDER_ALERTS.alertIntervalDays),
      notificationShowSeconds: Math.max(
        0,
        alerts?.notificationShowSeconds ?? DEFAULT_REMINDER_ALERTS.notificationShowSeconds,
      ),
      notificationSoundEnabled:
        alerts?.notificationSoundEnabled ?? DEFAULT_REMINDER_ALERTS.notificationSoundEnabled,
    },
    customerReminders: normalizeCustomerReminders(parsed.customerReminders),
    sales: sanitizeSplitParentChildChequeOverlap(parsed.sales ?? []).map((sale) =>
      repairSalePaymentEvents(sale),
    ),
    expenses: normalizedExpenses,
    loans: (parsed.loans ?? []).map((loan) => normalizeLoan(loan)),
    staff: (parsed.staff ?? []).map((member) => normalizeStaffMember(member)),
    staffLeaves: (parsed.staffLeaves ?? [])
      .map((leave) => normalizeStaffLeave(leave))
      .filter((leave) => !isRedundantStaffLeaveRecord(leave.date, leave.type)),
    staffSalaryAdvances: (parsed.staffSalaryAdvances ?? []).map((row) => normalizeStaffSalaryAdvance(row)),
  }
}

function normalizeStaffSalaryAdvance(raw: Partial<StaffSalaryAdvance>): StaffSalaryAdvance {
  return {
    id: raw.id ?? crypto.randomUUID(),
    staffId: raw.staffId ?? '',
    fromMonth: typeof raw.fromMonth === 'string' ? raw.fromMonth.trim().slice(0, 7) : '',
    toMonth: typeof raw.toMonth === 'string' ? raw.toMonth.trim().slice(0, 7) : '',
    amount: Math.max(0, Number(raw.amount) || 0),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  }
}

function normalizeStaffLeaveType(raw: unknown): StaffLeaveType {
  return normalizeStaffLeaveTypeValue(raw) ?? 'present'
}

function normalizeStaffLeave(raw: Partial<StaffLeave>): StaffLeave {
  const date = typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : ''
  return {
    id: raw.id ?? crypto.randomUUID(),
    staffId: raw.staffId ?? '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10),
    type: normalizeStaffLeaveType(raw.type),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  }
}

function normalizeStaffMember(raw: Partial<StaffMember>): StaffMember {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: (raw.name ?? 'Staff').trim() || 'Staff',
    monthlySalary: Math.max(0, Number(raw.monthlySalary) || 0),
    salaryDaysPerMonth: resolveStaffSalaryDays(raw.salaryDaysPerMonth),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  }
}

function normalizeLoan(raw: Partial<Loan>): Loan {
  const kind: LoanKind = raw.kind === 'borrow' ? 'borrow' : 'lend'
  const paySource: LoanPaySource = raw.paySource === 'bank' ? 'bank' : 'cash'
  const settlementPaySource =
    raw.settlementPaySource === 'bank'
      ? 'bank'
      : raw.settlementPaySource === 'cash'
        ? 'cash'
        : undefined
  const amount = Math.max(0, Number(raw.amount) || 0)
  const settlementEvents = Array.isArray(raw.settlementEvents)
    ? raw.settlementEvents.map((event) => ({
        id: typeof event.id === 'string' ? event.id : crypto.randomUUID(),
        at: typeof event.at === 'string' ? event.at : new Date().toISOString(),
        amount: Math.max(0, Number(event.amount) || 0),
        paySource: event.paySource === 'bank' ? ('bank' as const) : ('cash' as const),
      }))
    : undefined
  const eventPaid = settlementEvents?.reduce((sum, event) => sum + event.amount, 0) ?? 0
  const paidAmount = Math.max(0, Number(raw.paidAmount) || eventPaid || 0)
  const legacyPaid =
    raw.status === 'settled' && paidAmount <= 0 && (!settlementEvents || settlementEvents.length === 0)
      ? amount
      : paidAmount
  const status = legacyPaid >= amount && amount > 0 ? ('settled' as const) : ('pending' as const)
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    kind,
    personName: typeof raw.personName === 'string' ? raw.personName.trim() : 'Unknown',
    amount,
    paySource,
    status,
    note: typeof raw.note === 'string' ? raw.note.trim() || undefined : undefined,
    reminderAt: typeof raw.reminderAt === 'string' ? raw.reminderAt : undefined,
    reminderNote: typeof raw.reminderNote === 'string' ? raw.reminderNote.trim() || undefined : undefined,
    reminderUrgent: raw.reminderUrgent === true ? true : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    paidAmount: legacyPaid > 0 ? legacyPaid : undefined,
    settlementEvents,
    settledAt: typeof raw.settledAt === 'string' ? raw.settledAt : undefined,
    settlementPaySource,
  }
}

export function getLocalUserUid(): string | null {
  try {
    return localStorage.getItem(LOCAL_USER_UID_KEY)
  } catch {
    return null
  }
}

export function setLocalUserUid(uid: string): void {
  localStorage.setItem(LOCAL_USER_UID_KEY, uid)
}

export function clearLocalUserUid(): void {
  localStorage.removeItem(LOCAL_USER_UID_KEY)
}

export function isLocalDataOwnedByUser(uid: string): boolean {
  const stored = getLocalUserUid()
  return stored === uid
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultData }
    const parsed = JSON.parse(raw) as AppData
    return normalizeData(parsed)
  } catch {
    return { ...defaultData }
  }
}

let pendingSaveData: AppData | null = null
let saveDataTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 100

/** Force pending localStorage write — call on page hide / before cloud push. */
export function flushSaveData(options?: { cloudImmediate?: boolean }): void {
  if (saveDataTimer) {
    clearTimeout(saveDataTimer)
    saveDataTimer = null
  }
  if (!pendingSaveData) return
  const data = pendingSaveData
  pendingSaveData = null
  clearSalePaymentCaches()
  const serialized = JSON.stringify(data)
  localStorage.setItem(STORAGE_KEY, serialized)
  localStorage.setItem(LOCAL_UPDATED_AT_KEY, new Date().toISOString())
  queueLocalBackupSnapshot(data)
  if (options?.cloudImmediate) notifyDataChangedImmediate(data)
  else notifyDataChanged(data)
}

export function saveData(data: AppData, options?: { cloudImmediate?: boolean; immediate?: boolean }): void {
  pendingSaveData = data
  if (options?.immediate || options?.cloudImmediate) {
    flushSaveData(options)
    return
  }
  if (saveDataTimer) clearTimeout(saveDataTimer)
  saveDataTimer = setTimeout(() => flushSaveData(options), SAVE_DEBOUNCE_MS)
}

/** Persist locally without cloud backup — used for migrations and cloud restore. */
export function saveLocalData(data: AppData): void {
  const serialized = JSON.stringify(data)
  localStorage.setItem(STORAGE_KEY, serialized)
  queueLocalBackupSnapshot(data)
}

export function getLocalDataUpdatedAt(): string | null {
  try {
    return localStorage.getItem(LOCAL_UPDATED_AT_KEY)
  } catch {
    return null
  }
}

export function markLocalDataSynced(at: string): void {
  localStorage.setItem(LOCAL_UPDATED_AT_KEY, at)
  markLocalBackupTime(at)
}

export function isLocalDataEmpty(data: AppData): boolean {
  return (
    data.sales.length === 0 &&
    data.expenses.length === 0 &&
    (data.loans?.length ?? 0) === 0 &&
    (data.openingBalance ?? 0) === 0 &&
    (data.openingBankBalance ?? 0) === 0
  )
}

/** Backfill paymentEvents and strip erroneous cheque→cash / parent+child doubles. */
export function scheduleSalePaymentEventsMigration(data: AppData): void {
  // Probe RAW localStorage — loadData()/normalizeData already sanitize in memory,
  // so checking only `data` would skip persisting cleanup of dirty stored rows.
  let stored: AppData | null = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) stored = JSON.parse(raw) as AppData
  } catch {
    stored = null
  }
  const probe = stored?.sales ?? data.sales

  const needsMigration = probe.some((sale) => {
    const paidMissingEvents =
      sale.status === 'paid' && (!sale.paymentEvents || sale.paymentEvents.length === 0)
    const chequeHasCash =
      (sale.payType === 'cheque' || sale.pendingPayType === 'cheque') &&
      sale.payType !== 'split' &&
      ((sale.cashAmount ?? 0) > 0 ||
        (sale.paymentEvents ?? []).some((event) => (event.cash ?? 0) > 0))
    const splitChequeDupCash =
      sale.payType === 'split' &&
      sale.chequeApproved === true &&
      (sale.cashAmount ?? 0) > 0 &&
      (sale.chequeAmount ?? 0) > 0 &&
      Math.abs((sale.cashAmount ?? 0) - (sale.chequeAmount ?? 0)) < 0.01
    const chequeChildren = probe.filter(
      (child) =>
        child.parentSplitId === sale.id &&
        (child.payType === 'cheque' || child.pendingPayType === 'cheque'),
    )
    const splitParentWithChequeFields =
      !sale.parentSplitId &&
      chequeChildren.length > 0 &&
      ((sale.chequeAmount ?? 0) > 0 || sale.chequeApproved === true)
    const paidChequeChildTotal = chequeChildren.reduce((sum, child) => {
      if (child.status === 'pending') return sum
      const childCheque =
        child.chequeApproved && (child.chequeAmount ?? 0) > 0 ? child.chequeAmount ?? 0 : 0
      let childBank = child.bankAmount ?? 0
      if (childCheque > 0) childBank = Math.max(0, childBank - childCheque)
      const collected = (child.cashAmount ?? 0) + childBank + childCheque
      return sum + (collected > 0 ? collected : child.billAmount)
    }, 0)
    const parentCash =
      (sale.cashAmount ?? 0) > 0
        ? sale.cashAmount ?? 0
        : (sale.paymentEvents ?? []).reduce((sum, e) => sum + (e.cash ?? 0), 0)
    const parentBank = sale.bankAmount ?? 0
    const splitParentCashDupChequeChild =
      !sale.parentSplitId &&
      chequeChildren.length > 0 &&
      paidChequeChildTotal > 0 &&
      parentCash > 0 &&
      Math.abs(parentCash - paidChequeChildTotal) < 0.01 &&
      (Math.abs(parentBank - paidChequeChildTotal) < 0.01 ||
        ((sale.originalBillAmount ?? 0) > 0 &&
          (Math.abs((sale.originalBillAmount ?? 0) - paidChequeChildTotal) < 0.01 ||
            parentCash + parentBank + paidChequeChildTotal > (sale.originalBillAmount ?? 0) + 0.01)))
    return (
      paidMissingEvents ||
      chequeHasCash ||
      splitChequeDupCash ||
      splitParentWithChequeFields ||
      splitParentCashDupChequeChild
    )
  })
  if (!needsMigration) return

  const run = () => {
    let parsed: AppData
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      parsed = JSON.parse(raw) as AppData
    } catch {
      return
    }
    const before = parsed.sales ?? []
    const sales = sanitizeSplitParentChildChequeOverlap(before).map((sale) =>
      migrateSalePaymentEvents(sale),
    )
    const changed = sales.some((sale, index) => {
      try {
        return JSON.stringify(sale) !== JSON.stringify(before[index])
      } catch {
        return sale !== before[index]
      }
    })
    if (changed) {
      clearSalePaymentCaches()
      saveLocalData(normalizeData({ ...parsed, sales }))
    }
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 8000 })
  } else {
    setTimeout(run, 2000)
  }
}

/** Login restore — replace local with full cloud copy (no merge). */
export function applyFullRemoteCloudData(data: AppData, backupAt: string, uid?: string): AppData {
  const next = normalizeData(data)
  clearSalePaymentCaches()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(LOCAL_UPDATED_AT_KEY, backupAt)
  markLocalBackupTime(backupAt)
  if (uid) setLocalUserUid(uid)
  scheduleSalePaymentEventsMigration(next)
  return next
}

export function applyRemoteCloudData(
  data: AppData,
  backupAt: string,
): { data: AppData; preservedLocal: boolean } {
  const local = loadData()
  const remote = normalizeData(data)
  const merged = mergeCloudAppData(local, remote)
  const preservedLocal = cloudDataPreservedLocalRecords(local, remote, merged)
  const next = preservedLocal
    ? merged
    : normalizeData({
        ...merged,
        openingBalance: remote.openingBalance,
        openingBankBalance: remote.openingBankBalance,
        homePin: remote.homePin,
        theme: remote.theme,
        reminderAlerts: remote.reminderAlerts,
      })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(LOCAL_UPDATED_AT_KEY, preservedLocal ? new Date().toISOString() : backupAt)
  markLocalBackupTime(backupAt)
  return { data: next, preservedLocal }
}

export function replaceData(data: AppData): AppData {
  const next = normalizeData(data)
  saveData(next)
  return next
}

/** Wipe local counter data — used on cloud logout / account switch. Does not trigger cloud backup. */
export function clearAllLocalData(): AppData {
  const next = { ...defaultData }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(LOCAL_UPDATED_AT_KEY, new Date().toISOString())
  clearLocalUserUid()
  return next
}

function collectionTimestampFromSale(sale: Sale): string {
  return saleCollectionTimestamp(sale)
}

function paymentEventFromCollected(
  at: string,
  cash: number,
  bank: number,
  cheque: number,
): SalePaymentEvent {
  return paymentEventFromCollectedBreakdown(at, {
    cash,
    bank,
    cheque,
    total: cash + bank + cheque,
  })
}

export interface PaidSalePaymentEdit {
  originalBillAmount: number
  billAmount: number
  paidAmount: number
  changeAmount: number
  payType: PayType
  cashAmount?: number
  bankAmount?: number
  chequeAmount?: number
  creditAmount?: number
  chequeApproved?: boolean
  customerName?: string
  creditPending?: number
  chequePending?: number
}

/** Rewrite a paid bill's payment split — can reopen open credit/cheque balance. */
export function editPaidSalePayment(
  data: AppData,
  id: string,
  payment: PaidSalePaymentEdit,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || sale.status === 'pending') return data

  const collectionAt = collectionTimestampFromSale(sale)
  const originalBillAmount = payment.originalBillAmount
  const creditPending = payment.creditPending ?? 0
  const chequePending = payment.chequePending ?? 0
  const cash = payment.cashAmount ?? 0
  const bank = payment.bankAmount ?? 0
  const cheque =
    payment.chequeApproved && (payment.chequeAmount ?? 0) > 0 ? payment.chequeAmount ?? 0 : 0
  const collectedTotal = normalizeCollectedBreakdown({
    cash,
    bank,
    cheque,
    total: cash + bank + cheque,
  }).total
  const correctedEvent = paymentEventFromCollected(collectionAt, cash, bank, cheque)
  const isSplit = payment.payType === 'split'

  const nameTargets = new Set<string>([id])
  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((s) => s.id === saleId)) nameTargets.add(saleId)
    }
  }

  let next: AppData = {
    ...data,
    sales: data.sales.map((s) => {
      if (!nameTargets.has(s.id) && s.id !== id) return s
      if (s.id !== id) {
        return payment.customerName !== undefined
          ? { ...s, customerName: payment.customerName.trim() || undefined }
          : s
      }

      if ((creditPending > 0 || chequePending > 0) && !isSplit) {
        const openAmount = creditPending > 0 ? creditPending : chequePending
        const isCheque = chequePending > 0
        return {
          ...s,
          status: 'pending' as const,
          payType: isCheque ? ('cheque' as const) : ('credit' as const),
          pendingPayType: isCheque ? ('cheque' as const) : ('credit' as const),
          billAmount: openAmount,
          originalBillAmount,
          paidAmount: collectedTotal,
          changeAmount: payment.changeAmount,
          cashAmount: cash > 0 ? cash : undefined,
          bankAmount: bank > 0 ? bank : undefined,
          chequeAmount: cheque > 0 ? cheque : undefined,
          creditAmount: undefined,
          chequeApproved: cheque > 0 ? true : undefined,
          customerName: payment.customerName?.trim() || s.customerName,
          paymentEvents: collectedTotal > 0 ? [correctedEvent] : [],
          updatedAt: collectionAt,
        }
      }

      const settledPayType = isSplit
        ? ('split' as const)
        : payTypeFromCollectedTotals(cash, bank, cheque, payment.payType)
      const parentBillAmount = isSplit ? collectedTotal : payment.billAmount

      return {
        ...s,
        status: 'paid' as const,
        payType: settledPayType,
        billAmount: parentBillAmount,
        originalBillAmount,
        paidAmount: payment.paidAmount,
        changeAmount: payment.changeAmount,
        cashAmount: cash > 0 ? cash : undefined,
        bankAmount: bank > 0 ? bank : undefined,
        chequeAmount: cheque > 0 ? cheque : undefined,
        creditAmount:
          payment.creditAmount && payment.creditAmount > 0 ? payment.creditAmount : undefined,
        chequeApproved:
          cheque > 0 ? true : settledPayType === 'cheque' ? true : undefined,
        pendingPayType: undefined,
        customerName: payment.customerName?.trim() || s.customerName,
        paymentEvents: collectedTotal > 0 ? [correctedEvent] : [],
        updatedAt: collectionAt,
      }
    }),
  }

  if (isSplit) {
    const existingCredit = next.sales.find(
      (s) => s.parentSplitId === id && isPendingCreditSale(s),
    )
    const existingCheque = next.sales.find(
      (s) => s.parentSplitId === id && isPendingChequeSale(s),
    )

    if (creditPending > 0) {
      if (existingCredit) {
        next = updatePendingBill(next, existingCredit.id, {
          billAmount: creditPending,
          originalBillAmount,
          customerName: payment.customerName?.trim() || existingCredit.customerName,
          payType: 'credit',
          pendingPayType: 'credit',
        })
      } else {
        const parent = next.sales.find((s) => s.id === id)
        next = addSale(next, {
          billAmount: creditPending,
          originalBillAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'credit',
          pendingPayType: 'credit',
          customerName: payment.customerName?.trim() || parent?.customerName,
          parentSplitId: id,
          status: 'pending',
        })
      }
    } else if (existingCredit) {
      next = deleteSale(next, existingCredit.id)
    }

    if (chequePending > 0) {
      if (existingCheque) {
        next = updatePendingBill(next, existingCheque.id, {
          billAmount: chequePending,
          originalBillAmount,
          customerName: payment.customerName?.trim() || existingCheque.customerName,
          payType: 'cheque',
          pendingPayType: 'cheque',
        })
      } else {
        const parent = next.sales.find((s) => s.id === id)
        next = addSale(next, {
          billAmount: chequePending,
          originalBillAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'cheque',
          pendingPayType: 'cheque',
          customerName: payment.customerName?.trim() || parent?.customerName,
          parentSplitId: id,
          status: 'pending',
        })
      }
    } else if (existingCheque) {
      next = deleteSale(next, existingCheque.id)
    }
  }

  saveData(next)
  return next
}

export interface DrawerBalances {
  cash: number
  bank: number
}

/** Single pass over sales/expenses/loans — used for header balances. */
export function computeDrawerBalances(data: AppData): DrawerBalances {
  // Dedupe split parent cheque copies so cash/bank headers stay correct live.
  const sales = sanitizeSplitParentChildChequeOverlap(data.sales)
  let salesCash = 0
  let salesBank = 0
  for (const sale of sales) {
    const breakdown = saleCollectedComponentBreakdown(sale)
    salesCash += breakdown.cash
    salesBank += breakdown.bank + breakdown.cheque
  }

  let expenseCash = 0
  let expenseBank = 0
  for (const expense of data.expenses) {
    expenseCash += expenseCashToDrawer(expense)
    expenseBank += expenseBankToBalance(expense)
  }

  let loanCash = 0
  let loanBank = 0
  for (const loan of data.loans ?? []) {
    loanCash += loanCashToDrawer(loan)
    loanBank += loanBankToBalance(loan)
  }

  return {
    cash: data.openingBalance + salesCash - expenseCash + loanCash,
    bank: (data.openingBankBalance ?? 0) + salesBank - expenseBank + loanBank,
  }
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

function splitExpenseBankAmount(expense: Expense): number {
  const bank = expense.bankAmount ?? 0
  const cheque = expense.chequeAmount ?? 0
  if (!expense.chequeApproved || cheque <= 0) return bank
  const bankOnly = bank >= cheque ? bank - cheque : bank
  return bankOnly + cheque
}

function expenseCashToDrawer(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return expense.amount
    if (expense.transferDirection === 'bank-to-cash') return -expense.amount
    return 0
  }
  if (isPurchaseExpense(expense)) {
    const { cash } = purchasePaidComponents(expense)
    return expense.kind === 'add' ? -cash : cash
  }
  if (expense.payType === 'bank' || expense.payType === 'cheque' || expense.payType === 'credit') return 0
  if (expense.payType === 'split') {
    const cash = expense.cashAmount ?? 0
    return expense.kind === 'add' ? -cash : cash
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

function expenseBankToBalance(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return -expense.amount
    if (expense.transferDirection === 'bank-to-cash') return expense.amount
    return 0
  }
  if (isPurchaseExpense(expense)) {
    const { bank, cheque } = purchasePaidComponents(expense)
    const paid = bank + cheque
    return expense.kind === 'add' ? -paid : paid
  }
  if (expense.payType === 'cash' || expense.payType === 'credit') return 0
  if (expense.payType === 'cheque') {
    if (!expense.chequeApproved) return 0
    const cheque = expense.chequeAmount ?? expense.amount
    return expense.kind === 'add' ? -cheque : cheque
  }
  if (expense.payType === 'split') {
    const bank = splitExpenseBankAmount(expense)
    return expense.kind === 'add' ? -bank : bank
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

export function getBankBalance(data: AppData): number {
  return computeDrawerBalances(data).bank
}

export function getCurrentBalance(data: AppData): number {
  return computeDrawerBalances(data).cash
}

export function addSale(
  data: AppData,
  sale: Omit<Sale, 'id' | 'createdAt'> & { id?: string },
): AppData {
  const presetId = sale.id
  const { id: _id, ...rest } = sale
  const now = new Date().toISOString()
  const newSale: Sale = applyStoredCustomerReminderToSale(data, {
    ...rest,
    status: rest.status ?? 'paid',
    id: presetId ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  })
  const withEvents =
    newSale.status !== 'pending'
      ? { ...newSale, paymentEvents: buildPaidSalePaymentEvents(newSale, now) }
      : newSale
  const next = { ...data, sales: [withEvents, ...data.sales] }
  saveData(next)
  return next
}

/**
 * Import a Tally sales voucher as a pending bill (party name + amount).
 * De-duplicates on sourceId. Does not persist — use importTallyBills for batch save.
 */
export function addTallyPendingBill(
  data: AppData,
  bill: { sourceId: string; billAmount: number; customerName?: string; createdAt?: string },
): AppData {
  if (!bill.sourceId || !(bill.billAmount > 0)) return data
  if (data.sales.some((s) => s.source === 'tally' && s.sourceId === bill.sourceId)) {
    return data
  }
  const now = new Date().toISOString()
  const newSale: Sale = {
    id: crypto.randomUUID(),
    billAmount: bill.billAmount,
    paidAmount: 0,
    changeAmount: 0,
    status: 'pending',
    payType: 'credit',
    pendingPayType: 'credit',
    customerName: bill.customerName?.trim() || undefined,
    source: 'tally',
    sourceId: bill.sourceId,
    createdAt: bill.createdAt ?? now,
    updatedAt: now,
  }
  return { ...data, sales: [newSale, ...data.sales] }
}

export function importTallyBills(
  data: AppData,
  bills: { sourceId: string; billAmount: number; customerName?: string; createdAt?: string }[],
): AppData {
  let next = data
  for (const bill of bills) {
    next = addTallyPendingBill(next, bill)
  }
  if (next !== data) saveData(next)
  return next
}

function mergePreservedTallyPending(local: AppData, restored: AppData): AppData {
  const restoredIds = new Set(
    restored.sales
      .filter((s) => s.source === 'tally' && s.sourceId)
      .map((s) => s.sourceId as string),
  )
  const extra = local.sales.filter(
    (s) =>
      s.status === 'pending' &&
      s.source === 'tally' &&
      s.sourceId &&
      !restoredIds.has(s.sourceId),
  )
  if (extra.length === 0) return restored
  return { ...restored, sales: [...extra, ...restored.sales] }
}

export function replaceDataPreservingTallyPending(local: AppData, restored: AppData): AppData {
  return replaceData(mergePreservedTallyPending(local, restored))
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

export function addLoan(
  data: AppData,
  loan: {
    kind: LoanKind
    personName: string
    amount: number
    paySource?: LoanPaySource
    note?: string
    reminderAt?: string
    reminderNote?: string
  },
): AppData {
  const amount = loan.amount
  if (!(amount > 0)) return data
  const personName = loan.personName.trim()
  if (!personName) return data

  const kind = loan.kind
  const paySource: LoanPaySource =
    kind === 'borrow' ? 'cash' : loan.paySource === 'bank' ? 'bank' : 'cash'

  if (kind === 'lend') {
    if (paySource === 'cash' && getCurrentBalance(data) < amount) return data
    if (paySource === 'bank' && getBankBalance(data) < amount) return data
  }

  const newLoan: Loan = {
    id: crypto.randomUUID(),
    kind,
    personName,
    amount,
    paySource,
    status: 'pending',
    note: loan.note?.trim() || undefined,
    reminderAt: loan.reminderAt,
    reminderNote: loan.reminderNote?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, loans: [newLoan, ...(data.loans ?? [])] }
  saveData(next)
  return next
}

export function settleLoan(
  data: AppData,
  id: string,
  settlementPaySource: LoanPaySource,
  options?: { amount?: number; settledAt?: string },
): AppData {
  const loan = (data.loans ?? []).find((entry) => entry.id === id)
  if (!loan) return data

  const remaining = loanRemainingAmount(loan)
  if (remaining <= 0) return data

  const payAmount = Math.min(Math.max(0, options?.amount ?? remaining), remaining)
  if (payAmount <= 0) return data

  if (loan.kind === 'borrow') {
    if (settlementPaySource === 'cash' && getCurrentBalance(data) < payAmount) return data
    if (settlementPaySource === 'bank' && getBankBalance(data) < payAmount) return data
  }

  const at = options?.settledAt ?? new Date().toISOString()
  const event = {
    id: crypto.randomUUID(),
    at,
    amount: payAmount,
    paySource: settlementPaySource,
  }
  const priorEvents = loan.settlementEvents ?? []
  const newPaid = (loan.paidAmount ?? 0) + payAmount
  const fullySettled = newPaid >= loan.amount

  const nextLoans = (data.loans ?? []).map((entry) =>
    entry.id === id
      ? {
          ...entry,
          paidAmount: newPaid,
          settlementEvents: [...priorEvents, event],
          status: fullySettled ? ('settled' as const) : ('pending' as const),
          settledAt: fullySettled ? at : entry.settledAt,
          settlementPaySource,
        }
      : entry,
  )
  const next = { ...data, loans: nextLoans }
  saveData(next)
  return next
}

export function setLoanReminder(
  data: AppData,
  id: string,
  reminderAt: string | null,
  reminderNote?: string | null,
  reminderUrgent?: boolean | null,
): AppData {
  const nextLoans = (data.loans ?? []).map((loan) => {
    if (loan.id !== id) return loan
    return {
      ...loan,
      reminderAt: reminderAt ?? undefined,
      reminderNote: reminderNote?.trim() ? reminderNote.trim() : undefined,
      reminderUrgent: reminderUrgent === true ? true : reminderUrgent === false ? undefined : loan.reminderUrgent,
    }
  })
  const next = { ...data, loans: nextLoans }
  saveData(next)
  return next
}

export function addExpenseBatch(
  data: AppData,
  expenses: (Omit<Expense, 'id' | 'createdAt' | 'pairedExpenseId'> & { createdAt?: string })[],
): AppData {
  if (expenses.length === 0) return data
  const now = new Date().toISOString()
  const ids = expenses.map(() => crypto.randomUUID())
  const newExpenses: Expense[] = expenses.map((expense, index) => ({
    ...expense,
    id: ids[index],
    createdAt: expense.createdAt ?? now,
    billNumber:
      expense.billNumber ??
      (expenses.length > 1 ? ((index === 0 ? 1 : 2) as 1 | 2) : undefined),
    pairedExpenseId: expenses.length > 1 ? ids[1 - index] : undefined,
  }))
  const next = { ...data, expenses: [...newExpenses, ...data.expenses] }
  const supplierName = stripExpenseBillSuffix(expenses[0]?.name?.trim() ?? '')
  const withSupplier = supplierName ? ensureSupplierInData(next, supplierName) : next
  const description = expenses[0]?.description?.trim()
  const withItem =
    supplierName && description
      ? addSupplierItem(withSupplier, supplierName, description)
      : withSupplier
  saveData(withItem)
  return withItem
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
  const next = { ...data, homePin: normalizePin(pin, '0000') }
  saveData(next)
  return next
}

export function setOpeningBalance(data: AppData, amount: number): AppData {
  const next = { ...data, openingBalance: amount }
  saveData(next)
  return next
}

export function deleteSale(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const idsToRemove = new Set<string>()

  function addSaleTree(saleId: string) {
    if (!saleId || saleId.startsWith('split-group-')) return
    const sale = data.sales.find((s) => s.id === saleId)
    if (!sale || idsToRemove.has(saleId)) return
    idsToRemove.add(saleId)
    for (const child of data.sales) {
      if (child.parentSplitId === saleId) addSaleTree(child.id)
    }
  }

  if (relatedSaleIds?.length) {
    for (const saleId of relatedSaleIds) addSaleTree(saleId)
  } else {
    addSaleTree(id)
  }

  // Orphan split children share a parentSplitId with no parent sale — remove the whole group.
  for (const saleId of [...idsToRemove]) {
    const sale = data.sales.find((s) => s.id === saleId)
    const parentId = sale?.parentSplitId
    if (!parentId || data.sales.some((s) => s.id === parentId)) continue
    for (const sibling of data.sales) {
      if (sibling.parentSplitId === parentId) addSaleTree(sibling.id)
    }
  }

  if (idsToRemove.size === 0) return data

  const next = { ...data, sales: data.sales.filter((s) => !idsToRemove.has(s.id)) }
  saveData(next, { cloudImmediate: true })
  return next
}

export function deleteExpense(data: AppData, id: string): AppData {
  const next = { ...data, expenses: data.expenses.filter((e) => e.id !== id) }
  saveData(next, { cloudImmediate: true })
  return next
}

export function deleteLoan(data: AppData, id: string): AppData {
  if (!(data.loans ?? []).some((loan) => loan.id === id)) return data
  const next = { ...data, loans: (data.loans ?? []).filter((loan) => loan.id !== id) }
  saveData(next, { cloudImmediate: true })
  return next
}

export function ensureStaffMember(
  data: AppData,
  name: string,
  monthlySalary = 0,
): { data: AppData; staffId: string | null } {
  const key = name.trim().toLowerCase()
  if (!key) return { data, staffId: null }
  const existing = (data.staff ?? []).find((member) => member.name.trim().toLowerCase() === key)
  if (existing) return { data, staffId: existing.id }
  const next = addStaffMember(data, { name: name.trim(), monthlySalary, linkExisting: true })
  if (next === data) return { data, staffId: null }
  const created = (next.staff ?? []).find((member) => member.name.trim().toLowerCase() === key)
  return { data: next, staffId: created?.id ?? null }
}

export function addExpenseWithOptionalStaff(
  data: AppData,
  expense: Omit<Expense, 'id' | 'createdAt'>,
  options?: {
    staffId?: string
    staffSalaryMonth?: string
    staffSalaryLink?: boolean
    createStaffIfMissing?: boolean
  },
): { data: AppData; ok: boolean } {
  let next = data
  let staffId = options?.staffId
  const linkSalary = options?.staffSalaryLink === true

  if (linkSalary) {
    if (!staffId) {
      const key = expense.name.trim().toLowerCase()
      const existing = (next.staff ?? []).find((member) => member.name.trim().toLowerCase() === key)
      if (existing) {
        staffId = existing.id
      } else if (options?.createStaffIfMissing) {
        const ensured = ensureStaffMember(next, expense.name, 0)
        next = ensured.data
        staffId = ensured.staffId ?? undefined
      }
    }
    if (!staffId) return { data, ok: false }
    const newExpense: Expense = {
      ...expense,
      staffId,
      staffSalaryMonth: options?.staffSalaryMonth,
      staffSalaryLink: true,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    next = { ...next, expenses: [newExpense, ...next.expenses] }
    saveData(next, { cloudImmediate: true })
    return { data: next, ok: true }
  }

  next = addExpense(next, {
    ...expense,
    staffId: staffId || undefined,
    staffSalaryMonth: undefined,
    staffSalaryLink: options?.staffSalaryLink,
  })
  return { data: next, ok: true }
}

export function linkExistingExpensesToStaff(
  data: AppData,
  staffId: string,
  staffName: string,
): AppData {
  const key = staffName.trim().toLowerCase()
  if (!key) return data
  let changed = false
  const expenses = data.expenses.map((expense) => {
    if (!isStaffLinkableExpense(expense)) return expense
    if (expense.staffId) return expense
    if (expense.name.trim().toLowerCase() !== key) return expense
    changed = true
    return {
      ...expense,
      staffId,
      staffSalaryLink: true,
      staffSalaryMonth: salaryMonthFromDate(expense.createdAt),
    }
  })
  if (!changed) return data
  const next = { ...data, expenses }
  saveData(next, { cloudImmediate: true })
  return next
}

export function addStaffMember(
  data: AppData,
  input: { name: string; monthlySalary: number; linkExisting?: boolean },
): AppData {
  const name = input.name.trim()
  if (!name) return data
  const exists = (data.staff ?? []).some((member) => member.name.trim().toLowerCase() === name.toLowerCase())
  if (exists) return data
  const member: StaffMember = {
    id: crypto.randomUUID(),
    name,
    monthlySalary: Math.max(0, input.monthlySalary),
    createdAt: new Date().toISOString(),
  }
  let next: AppData = { ...data, staff: [member, ...(data.staff ?? [])] }
  if (input.linkExisting !== false) {
    next = linkExistingExpensesToStaff(next, member.id, member.name)
  }
  saveData(next, { cloudImmediate: true })
  return next
}

export function updateStaffMember(
  data: AppData,
  id: string,
  updates: { name?: string; monthlySalary?: number; salaryDaysPerMonth?: number },
): AppData {
  const current = (data.staff ?? []).find((member) => member.id === id)
  if (!current) return data
  const nextName = updates.name !== undefined ? updates.name.trim() : current.name
  if (!nextName) return data
  const nextSalary =
    updates.monthlySalary !== undefined ? Math.max(0, updates.monthlySalary) : current.monthlySalary
  const nextDays =
    updates.salaryDaysPerMonth !== undefined
      ? resolveStaffSalaryDays(updates.salaryDaysPerMonth)
      : resolveStaffSalaryDays(current.salaryDaysPerMonth)
  const nextStaff = (data.staff ?? []).map((member) =>
    member.id === id
      ? { ...member, name: nextName, monthlySalary: nextSalary, salaryDaysPerMonth: nextDays }
      : member,
  )
  let next: AppData = { ...data, staff: nextStaff }
  if (nextName.toLowerCase() !== current.name.trim().toLowerCase()) {
    next = linkExistingExpensesToStaff(next, id, nextName)
  }
  saveData(next, { cloudImmediate: true })
  return next
}

export function updateExpenseStaffSalaryMonth(
  data: AppData,
  expenseId: string,
  staffSalaryMonth: string,
): AppData {
  const existing = data.expenses.find((expense) => expense.id === expenseId)
  if (!existing?.staffId) return data
  const next = {
    ...data,
    expenses: data.expenses.map((expense) =>
      expense.id === expenseId
        ? {
            ...expense,
            staffSalaryMonth,
            staffSalaryLink: true,
            updatedAt: new Date().toISOString(),
          }
        : expense,
    ),
  }
  saveData(next, { cloudImmediate: true })
  return next
}

export function deleteStaffMember(data: AppData, id: string): AppData {
  if (!(data.staff ?? []).some((member) => member.id === id)) return data
  const expenses = data.expenses.map((expense) =>
    expense.staffId === id
      ? {
          ...expense,
          staffId: undefined,
          staffSalaryMonth: undefined,
          staffSalaryLink: undefined,
        }
      : expense,
  )
  const next = {
    ...data,
    staff: (data.staff ?? []).filter((member) => member.id !== id),
    staffLeaves: (data.staffLeaves ?? []).filter((leave) => leave.staffId !== id),
    staffSalaryAdvances: (data.staffSalaryAdvances ?? []).filter((row) => row.staffId !== id),
    expenses,
  }
  saveData(next, { cloudImmediate: true })
  return next
}

export function applyStaffSalaryAdvance(
  data: AppData,
  input: { staffId: string; fromMonth: SalaryMonthKey },
): { data: AppData; ok: boolean; error?: string } {
  const summary = getStaffMonthSummary(data, input.staffId, input.fromMonth)
  if (!summary) return { data, ok: false, error: 'Staff not found.' }
  if (!summary.canApplyToNextMonth || summary.overpaidAmount <= 0) {
    return { data, ok: false, error: 'Nothing to apply to next month.' }
  }
  const alreadyApplied = (data.staffSalaryAdvances ?? []).some(
    (row) => row.staffId === input.staffId && row.fromMonth === input.fromMonth,
  )
  if (alreadyApplied) {
    return { data, ok: false, error: 'Already applied to next month.' }
  }

  const advance: StaffSalaryAdvance = {
    id: crypto.randomUUID(),
    staffId: input.staffId,
    fromMonth: input.fromMonth,
    toMonth: summary.nextMonthKey,
    amount: summary.overpaidAmount,
    createdAt: new Date().toISOString(),
  }
  const next = {
    ...data,
    staffSalaryAdvances: [advance, ...(data.staffSalaryAdvances ?? [])],
  }
  saveData(next, { cloudImmediate: true })
  return { data: next, ok: true }
}

export function addStaffLeave(
  data: AppData,
  input: { staffId: string; date: string; type: StaffLeaveType },
): { data: AppData; ok: boolean; error?: string } {
  if (!(data.staff ?? []).some((member) => member.id === input.staffId)) {
    return { data, ok: false, error: 'Staff not found.' }
  }
  const date = input.date.trim().slice(0, 10)
  const error = validateStaffLeaveInput(data, input.staffId, date)
  if (error) return { data, ok: false, error }
  const leave: StaffLeave = {
    id: crypto.randomUUID(),
    staffId: input.staffId,
    date,
    type: normalizeStaffLeaveType(input.type),
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, staffLeaves: [leave, ...(data.staffLeaves ?? [])] }
  saveData(next, { cloudImmediate: true })
  return { data: next, ok: true }
}

export function deleteStaffLeave(data: AppData, leaveId: string): AppData {
  if (!(data.staffLeaves ?? []).some((leave) => leave.id === leaveId)) return data
  const next = {
    ...data,
    staffLeaves: (data.staffLeaves ?? []).filter((leave) => leave.id !== leaveId),
  }
  saveData(next, { cloudImmediate: true })
  return next
}

export function setStaffAttendance(
  data: AppData,
  input: { staffId: string; date: string; type: StaffLeaveType | 'unset' },
): { data: AppData; ok: boolean; error?: string } {
  if (!(data.staff ?? []).some((member) => member.id === input.staffId)) {
    return { data, ok: false, error: 'Staff not found.' }
  }

  const date = input.date.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { data, ok: false, error: 'Pick a valid date.' }
  }

  const existing = (data.staffLeaves ?? []).find(
    (leave) => leave.staffId === input.staffId && leave.date === date,
  )

  if (input.type === 'unset') {
    if (!existing) return { data, ok: true }
    const next = deleteStaffLeave(data, existing.id)
    return { data: next, ok: true }
  }

  if (input.type === 'present' && !isSundayDate(date)) {
    if (!existing) return { data, ok: true }
    const next = deleteStaffLeave(data, existing.id)
    return { data: next, ok: true }
  }

  if (input.type === 'off' && isSundayDate(date)) {
    if (!existing) return { data, ok: true }
    const next = deleteStaffLeave(data, existing.id)
    return { data: next, ok: true }
  }

  if (input.type === 'not_paid' && !isSundayDate(date)) {
    return { data, ok: false, error: 'Unpaid is only for Sundays.' }
  }

  if (input.type === 'leave' && isSundayDate(date)) {
    return { data, ok: false, error: 'Leave is not marked on Sundays — Sunday is Off by default.' }
  }

  const normalized = normalizeStaffLeaveTypeValue(input.type)
  if (!normalized) {
    return { data, ok: false, error: 'Pick a valid attendance type.' }
  }
  const leaveType = normalized

  if (existing) {
    if (existing.type === leaveType) return { data, ok: true }
    const next = {
      ...data,
      staffLeaves: (data.staffLeaves ?? []).map((leave) =>
        leave.id === existing.id ? { ...leave, type: leaveType } : leave,
      ),
    }
    saveData(next, { cloudImmediate: true })
    return { data: next, ok: true }
  }

  return addStaffLeave(data, { staffId: input.staffId, date, type: leaveType })
}

export function updateSaleCustomerName(
  data: AppData,
  id: string,
  customerName: string,
  relatedSaleIds?: string[],
): AppData {
  const trimmed = customerName.trim()
  const targets = new Set<string>()

  if (data.sales.some((sale) => sale.id === id)) {
    for (const saleId of collectSplitNameTargets(data, id)) targets.add(saleId)
  }

  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((sale) => sale.id === saleId)) {
        for (const relatedId of collectSplitNameTargets(data, saleId)) {
          targets.add(relatedId)
        }
      }
    }
  }

  if (targets.size === 0) return data

  const next = {
    ...data,
    sales: data.sales.map((s) =>
      targets.has(s.id)
        ? {
            ...s,
            customerName: trimmed || undefined,
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
    payType?: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    creditAmount?: number
    pendingPayType?: PayType
    paidAmount?: number
  },
): AppData {
  const next = {
    ...data,
    sales: data.sales.map((s) => {
      if (s.id !== id || s.status !== 'pending') return s

      const isBalanceBill =
        s.payType === 'credit' ||
        s.payType === 'cheque' ||
        s.pendingPayType === 'credit' ||
        s.pendingPayType === 'cheque' ||
        updates.payType === 'credit' ||
        updates.payType === 'cheque' ||
        (s.paymentEvents?.length ?? 0) > 0
      const priorCollected = isBalanceBill ? salePendingCreditPaidBreakdown(s) : null

      const patched = {
        ...s,
        billAmount: updates.billAmount,
        originalBillAmount: updates.originalBillAmount ?? s.originalBillAmount,
        customerName: updates.customerName ?? s.customerName,
        payType: updates.payType ?? s.payType,
        pendingPayType: updates.pendingPayType ?? s.pendingPayType,
        cashAmount:
          updates.cashAmount !== undefined
            ? updates.cashAmount
            : updates.payType === 'split'
              ? updates.cashAmount
              : updates.payType === 'credit' || s.payType === 'credit' || isBalanceBill
                ? s.cashAmount ?? (priorCollected && priorCollected.cash > 0 ? priorCollected.cash : undefined)
                : undefined,
        bankAmount:
          updates.bankAmount !== undefined
            ? updates.bankAmount
            : updates.payType === 'split'
              ? updates.bankAmount
              : updates.payType === 'credit' || s.payType === 'credit' || isBalanceBill
                ? s.bankAmount ??
                  (priorCollected && priorCollected.bank + priorCollected.cheque > 0
                    ? priorCollected.bank + priorCollected.cheque
                    : undefined)
                : undefined,
        chequeAmount:
          updates.chequeAmount !== undefined
            ? updates.chequeAmount
            : updates.payType === 'split'
              ? updates.chequeAmount
              : updates.payType === 'cheque' ||
                  (updates.payType == null &&
                    (s.payType === 'cheque' || s.pendingPayType === 'cheque'))
                ? // Open cheque face = remaining due only when nothing has been collected yet.
                  priorCollected && priorCollected.total > 0
                  ? s.chequeApproved
                    ? s.chequeAmount
                    : undefined
                  : updates.billAmount
                : updates.payType === 'credit' || s.payType === 'credit'
                  ? s.chequeAmount
                  : undefined,
        creditAmount:
          updates.creditAmount !== undefined
            ? updates.creditAmount
            : updates.payType === 'split'
              ? updates.creditAmount
              : updates.payType === 'credit' ||
                  (updates.payType == null &&
                    (s.payType === 'credit' || s.pendingPayType === 'credit'))
                ? updates.billAmount
                : undefined,
        chequeApproved:
          updates.payType === 'cheque' ||
          (updates.payType == null && (s.payType === 'cheque' || s.pendingPayType === 'cheque'))
            ? s.chequeApproved
            : updates.payType === 'credit'
              ? undefined
              : s.chequeApproved,
        paidAmount:
          updates.paidAmount ??
          (priorCollected && priorCollected.total > 0 ? priorCollected.total : s.paidAmount),
      }

      const financialChanged =
        patched.billAmount !== s.billAmount ||
        patched.originalBillAmount !== s.originalBillAmount ||
        patched.paidAmount !== s.paidAmount ||
        (patched.cashAmount ?? 0) !== (s.cashAmount ?? 0) ||
        (patched.bankAmount ?? 0) !== (s.bankAmount ?? 0) ||
        (patched.chequeAmount ?? 0) !== (s.chequeAmount ?? 0) ||
        (patched.creditAmount ?? 0) !== (s.creditAmount ?? 0) ||
        patched.payType !== s.payType ||
        patched.pendingPayType !== s.pendingPayType

      return financialChanged
        ? { ...patched, updatedAt: new Date().toISOString() }
        : { ...patched, updatedAt: patched.updatedAt ?? new Date().toISOString() }
    }),
  }
  const updated = next.sales.find((s) => s.id === id)
  if (
    updated &&
    updated.parentSplitId &&
    isCreditPendingSale(updated)
  ) {
    const synced = syncParentSplitCreditAmount(next, updated, updates.billAmount)
    saveData(synced)
    return synced
  }
  saveData(next)
  return next
}

export function setSaleReminder(
  data: AppData,
  id: string,
  reminderAt: string | null,
  reminderNote?: string | null,
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || sale.status !== 'pending') return data

  const next: AppData = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id
        ? {
            ...s,
            reminderAt: reminderAt ?? undefined,
            reminderNote: reminderAt ? reminderNote?.trim() || undefined : undefined,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

export function setCustomerReminder(
  data: AppData,
  customerName: string,
  kind: Extract<BillReminderKind, 'credit' | 'cheque'>,
  reminderAt: string | null,
  reminderNote?: string | null,
): AppData {
  const trimmed = customerName.trim()
  if (!trimmed) return data

  const trimmedNote = reminderNote?.trim() || undefined

  const existing = { ...(data.customerReminders ?? {}) }
  const entry = { ...(existing[trimmed] ?? {}) }
  if (kind === 'credit') {
    if (reminderAt) {
      entry.creditReminderAt = reminderAt
      entry.creditReminderNote = trimmedNote
    } else {
      delete entry.creditReminderAt
      delete entry.creditReminderNote
    }
  } else {
    if (reminderAt) {
      entry.chequeReminderAt = reminderAt
      entry.chequeReminderNote = trimmedNote
    } else {
      delete entry.chequeReminderAt
      delete entry.chequeReminderNote
    }
  }

  if (!entry.creditReminderAt && !entry.chequeReminderAt) delete existing[trimmed]
  else existing[trimmed] = entry

  let next: AppData = {
    ...data,
    customerReminders: Object.keys(existing).length > 0 ? existing : undefined,
  }

  const billIds = new Set(listOpenBillIdsForCustomer(next, trimmed, kind))
  if (billIds.size > 0) {
    next = {
      ...next,
      sales: next.sales.map((s) =>
        billIds.has(s.id)
          ? {
              ...s,
              reminderAt: reminderAt ?? undefined,
              reminderNote: reminderAt ? trimmedNote : undefined,
            }
          : s,
      ),
    }
  }

  saveData(next)
  return next
}

export function setReminderAlertSettings(
  data: AppData,
  settings: ReminderAlertSettings,
): AppData {
  const next: AppData = {
    ...data,
    reminderAlerts: {
      creditDaysBefore: Math.max(0, settings.creditDaysBefore),
      chequeDaysBefore: Math.max(0, settings.chequeDaysBefore),
      loanDaysBefore: Math.max(0, settings.loanDaysBefore),
      alertIntervalDays: Math.max(1, settings.alertIntervalDays),
      notificationShowSeconds: Math.max(0, settings.notificationShowSeconds),
      notificationSoundEnabled: settings.notificationSoundEnabled,
    },
  }
  saveData(next)
  return next
}

export function isApprovedChequeSale(sale: Sale): boolean {
  return getApprovedChequeAmount(sale) > 0
}

export function getApprovedChequeAmount(sale: Sale): number {
  const events = (sale.paymentEvents ?? []).filter((event) => !event.cancelled && event.amount > 0)
  const isChequeOrigin =
    sale.payType === 'cheque' ||
    sale.pendingPayType === 'cheque' ||
    sale.chequeApproved === true
  if (events.length > 0 && isChequeOrigin) {
    return events.reduce((sum, event) => {
      const cheque = event.cheque ?? 0
      if (cheque > 0) return sum + cheque
      if ((event.bank ?? 0) > 0 && (event.cash ?? 0) <= 0) {
        return sum + event.amount
      }
      return sum
    }, 0)
  }
  if (sale.chequeApproved && (sale.chequeAmount ?? 0) > 0) {
    return sale.chequeAmount ?? 0
  }
  if (sale.status === 'paid' && sale.payType === 'cheque') {
    return sale.chequeAmount ?? sale.billAmount
  }
  return 0
}

export interface ApprovedChequeEntry {
  /** Unique row id for Settings list. */
  id: string
  saleId: string
  /** Index in sale.paymentEvents; null = legacy whole-sale cheque. */
  eventIndex: number | null
  amount: number
  at: string
  customerName?: string
  openBalance: number
  billTotal: number
  label: string
  partLabel?: string
}

/** One row per approved cheque slice (supports 2–3 partial approvals on one bill). */
export function listApprovedChequeEntries(data: AppData): ApprovedChequeEntry[] {
  const entries: ApprovedChequeEntry[] = []

  for (const sale of data.sales) {
    const isChequeOrigin =
      sale.payType === 'cheque' ||
      sale.pendingPayType === 'cheque' ||
      sale.chequeApproved === true
    if (!isChequeOrigin && sale.payType !== 'split') continue

    const events = sale.paymentEvents ?? []
    const chequeEvents = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => {
        if (event.cancelled || event.amount <= 0) return false
        const cheque = event.cheque ?? 0
        const bank = event.bank ?? 0
        const cash = event.cash ?? 0
        // Prefer explicit cheque marker; fall back to legacy bank-only approvals.
        if (cheque > 0) return true
        if (!isChequeOrigin) return false
        return bank > 0 && cash <= 0
      })

    const billTotal =
      sale.originalBillAmount ??
      (sale.status === 'pending'
        ? sale.billAmount + saleCollectedAmount(sale)
        : sale.billAmount)
    const openBalance = sale.status === 'pending' ? sale.billAmount : 0
    const name = sale.customerName

    if (chequeEvents.length > 0 && (isChequeOrigin || sale.payType === 'split')) {
      const listable =
        sale.payType === 'split'
          ? chequeEvents.filter(
              ({ event }) =>
                (event.cheque ?? 0) > 0 ||
                sale.chequeApproved ||
                (sale.chequeAmount ?? 0) > 0,
            )
          : chequeEvents
      listable.forEach(({ event, index }, part) => {
        const ordinal =
          part === 0 ? '1st' : part === 1 ? '2nd' : part === 2 ? '3rd' : `${part + 1}th`
        const sliceAmount =
          (event.cheque ?? 0) > 0 ? event.cheque! : event.amount
        entries.push({
          id: `${sale.id}:${index}`,
          saleId: sale.id,
          eventIndex: index,
          amount: sliceAmount,
          at: event.at,
          customerName: name,
          openBalance,
          billTotal,
          label:
            sale.status === 'pending'
              ? 'Cheque → bank · open'
              : sale.payType === 'split'
                ? 'Split · cheque → bank'
                : 'Cheque → bank',
          partLabel: `${ordinal} cheque`,
        })
      })
      continue
    }

    const amount = getApprovedChequeAmount(sale)
    if (amount <= 0) continue
    entries.push({
      id: sale.id,
      saleId: sale.id,
      eventIndex: null,
      amount,
      at: sale.updatedAt ?? sale.createdAt,
      customerName: name,
      openBalance,
      billTotal,
      label:
        sale.status === 'pending'
          ? sale.payType === 'credit' || sale.pendingPayType === 'credit'
            ? 'Credit · cheque → bank'
            : 'Cheque → bank · open'
          : sale.payType === 'split'
            ? 'Split · cheque → bank'
            : 'Cheque → bank',
      partLabel: '1st cheque',
    })
  }

  return entries.sort((a, b) => {
    const nameCmp = (a.customerName || '').localeCompare(b.customerName || '', undefined, {
      sensitivity: 'base',
    })
    if (nameCmp !== 0) return nameCmp
    return new Date(a.at).getTime() - new Date(b.at).getTime()
  })
}

export function listApprovedCheques(data: AppData): Sale[] {
  return data.sales
    .filter(isApprovedChequeSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

export function listPendingCreditSales(data: AppData): Sale[] {
  return data.sales
    .filter(isPendingCreditSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

/** Fully paid bill that originated as customer credit (not cheque). */
export function isPaidCreditOriginSale(sale: Sale): boolean {
  if (sale.status !== 'paid') return false
  if (getApprovedChequeAmount(sale) > 0 && sale.pendingPayType !== 'credit') return false
  return sale.pendingPayType === 'credit' || sale.payType === 'credit'
}

export function listPaidCreditSales(data: AppData): Sale[] {
  return data.sales
    .filter(isPaidCreditOriginSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

export function listPendingChequeSales(data: AppData): Sale[] {
  return data.sales
    .filter(isPendingChequeSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

/** Clear open customer credit — deletes unpaid bills or finalizes partial collections. */
export function cancelSaleCredit(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isPendingCreditSale(sale)) return data

  const collected = saleCollectedAmount(sale)
  if (collected <= 0) {
    let next = deleteSale(data, id, relatedSaleIds)
    if (sale.parentSplitId) {
      next = syncParentSplitCreditAmount(next, sale, 0)
      saveData(next)
    }
    return next
  }

  const cash = sale.cashAmount ?? 0
  const bank = sale.bankAmount ?? 0
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  const originalBillAmount = sale.originalBillAmount ?? sale.billAmount + collected
  const openCredit = sale.billAmount
  const now = new Date().toISOString()

  const next = collectPendingBill(data, id, {
    billAmount: originalBillAmount,
    originalBillAmount,
    paidAmount: collected,
    changeAmount: 0,
    payType: payTypeFromCollectedTotals(cash, bank, cheque, 'cash'),
    cashAmount: cash || undefined,
    bankAmount: bank || undefined,
    chequeAmount: cheque || undefined,
    chequeApproved: cheque > 0 ? true : undefined,
    customerName: sale.customerName,
  })

  if (openCredit <= 0) return next

  return {
    ...next,
    sales: next.sales.map((s) =>
      s.id === id
        ? {
            ...s,
            creditCancelledAt: now,
            creditCancelledAmount: openCredit,
          }
        : s,
    ),
  }
}

/**
 * Full credit cancel as if nothing was paid:
 * removes the bill and all its credit collections from cash/bank / History.
 */
export function cancelSaleCreditAsUnpaid(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale) return data

  const creditInvolved =
    isPendingCreditSale(sale) ||
    isPaidCreditOriginSale(sale) ||
    sale.pendingPayType === 'credit' ||
    sale.payType === 'credit'
  if (!creditInvolved) return data

  return deleteSale(data, id, relatedSaleIds)
}

/** Clear open cheque bill — keeps collections; remaining becomes credit balance (not cheque pending). */
export function cancelSaleCheque(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isPendingChequeSale(sale)) return data

  const collected = saleCollectedAmount(sale)
  const remaining = sale.billAmount
  const originalBillAmount = sale.originalBillAmount ?? remaining + collected
  const now = new Date().toISOString()
  const prior = salePendingCreditPaidBreakdown(sale)

  // Nothing collected — same as unpaid credit cancel: remove the bill.
  if (collected <= 0) {
    return deleteSale(data, id, relatedSaleIds)
  }

  // Partial collections kept; open cheque remainder becomes credit balance.
  if (remaining > 0) {
    const next: AppData = {
      ...data,
      sales: data.sales.map((s) =>
        s.id === id
          ? {
              ...s,
              payType: 'credit',
              pendingPayType: 'credit',
              billAmount: remaining,
              originalBillAmount,
              creditAmount: remaining,
              cashAmount: prior.cash > 0 ? prior.cash : undefined,
              bankAmount: prior.bank + prior.cheque > 0 ? prior.bank + prior.cheque : undefined,
              chequeAmount: undefined,
              chequeApproved: undefined,
              paidAmount: collected,
              updatedAt: now,
            }
          : s,
      ),
    }
    saveData(next)
    return next
  }

  // Fully collected already — finalize as paid.
  return collectPendingBill(data, id, {
    billAmount: originalBillAmount,
    originalBillAmount,
    paidAmount: collected,
    changeAmount: 0,
    payType: payTypeFromCollectedTotals(prior.cash, prior.bank, prior.cheque, 'cheque'),
    cashAmount: prior.cash || undefined,
    bankAmount: prior.bank + prior.cheque > 0 ? prior.bank + prior.cheque : undefined,
    chequeAmount: prior.cheque || undefined,
    chequeApproved: prior.cheque > 0 ? true : undefined,
    customerName: sale.customerName,
  })
}

/**
 * Full cheque cancel as if nothing was paid:
 * removes the bill and all its cheque approvals from bank / History.
 */
export function cancelSaleChequeAsUnpaid(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale) return data

  const chequeInvolved =
    isPendingChequeSale(sale) ||
    isApprovedChequeSale(sale) ||
    sale.payType === 'cheque' ||
    sale.pendingPayType === 'cheque' ||
    sale.chequeApproved === true ||
    (sale.paymentEvents ?? []).some(
      (event) =>
        !event.cancelled && ((event.cheque ?? 0) > 0 || ((event.bank ?? 0) > 0 && (event.cash ?? 0) <= 0)),
    )
  if (!chequeInvolved) return data

  return deleteSale(data, id, relatedSaleIds)
}

function revertPendingPayTypes(sale: Sale): { payType: PayType; pendingPayType: PayType } {
  if (sale.pendingPayType === 'credit') {
    return { payType: 'credit', pendingPayType: 'credit' }
  }
  return { payType: 'cheque', pendingPayType: 'cheque' }
}

function syncSaleFieldsFromActiveEvents(sale: Sale): Sale {
  const prior = saleActiveCollectedParts(sale)
  const originalBillAmount =
    sale.originalBillAmount ??
    (sale.status === 'pending' ? sale.billAmount + prior.total : sale.billAmount)
  const remaining = Math.max(0, originalBillAmount - prior.total)
  const activeCheque = prior.cheque

  if (remaining <= 0 && prior.total > 0) {
    return {
      ...sale,
      status: 'paid',
      billAmount: originalBillAmount,
      originalBillAmount,
      paidAmount: prior.total,
      cashAmount: prior.cash > 0 ? prior.cash : undefined,
      bankAmount: prior.bank + prior.cheque > 0 ? prior.bank + prior.cheque : undefined,
      chequeAmount: activeCheque > 0 ? activeCheque : undefined,
      chequeApproved: activeCheque > 0 ? true : undefined,
      creditAmount: undefined,
    }
  }

  const keepAsCredit =
    sale.pendingPayType === 'credit' || sale.payType === 'credit'
  return {
    ...sale,
    status: 'pending',
    billAmount: remaining,
    originalBillAmount,
    paidAmount: prior.total,
    cashAmount: prior.cash > 0 ? prior.cash : undefined,
    bankAmount: prior.bank + prior.cheque > 0 ? prior.bank + prior.cheque : undefined,
    // chequeAmount = still-approved cheque total only — never the open balance.
    chequeAmount: activeCheque > 0 ? activeCheque : undefined,
    chequeApproved: activeCheque > 0 ? true : undefined,
    creditAmount: keepAsCredit ? remaining : undefined,
    payType: keepAsCredit ? 'credit' : 'cheque',
    pendingPayType: keepAsCredit ? 'credit' : 'cheque',
  }
}

/** Cancel one approved cheque slice (or whole legacy cheque) and reopen that amount as balance. */
export function cancelApprovedChequeEntry(
  data: AppData,
  saleId: string,
  eventIndex: number | null,
): AppData {
  const sale = data.sales.find((s) => s.id === saleId)
  if (!sale) return data
  const now = new Date().toISOString()

  if (eventIndex != null && sale.paymentEvents && sale.paymentEvents[eventIndex]) {
    const target = sale.paymentEvents[eventIndex]
    if (target.cancelled || target.amount <= 0) return data

    const events = sale.paymentEvents.map((event, index) =>
      index === eventIndex
        ? { ...event, cancelled: true, cancelledAt: now }
        : event,
    )

    const priorBefore = saleActiveCollectedParts(sale)
    const originalBillAmount =
      sale.originalBillAmount ??
      (sale.status === 'pending'
        ? sale.billAmount + priorBefore.total
        : sale.billAmount)

    let patched: Sale = {
      ...sale,
      paymentEvents: events,
      originalBillAmount,
      updatedAt: now,
      // Cancelling an approved cheque always returns that slice as cheque balance
      // (not credit), so it can be re-approved later.
      payType: 'cheque',
      pendingPayType: 'cheque',
      creditAmount: undefined,
    }
    patched = syncSaleFieldsFromActiveEvents(patched)

    const next = {
      ...data,
      sales: data.sales.map((s) => (s.id === saleId ? patched : s)),
    }
    saveData(next)
    return next
  }

  return cancelApprovedCheque(data, saleId)
}

/**
 * Move one approved cheque slice (or every active slice) to a different calendar day.
 * Updates paymentEvents[].at so History / Today Sales / bank activity all use the new date.
 */
export function updateApprovedChequeEntryDate(
  data: AppData,
  saleId: string,
  eventIndex: number | null,
  atIso: string,
  options?: { applyToAll?: boolean },
): AppData {
  const sale = data.sales.find((s) => s.id === saleId)
  if (!sale) return data
  if (Number.isNaN(new Date(atIso).getTime())) return data

  // Normalize to local noon so the calendar day is stable across timezones.
  const localDay = isoToDateInputValue(atIso)
  const [y, mo, d] = localDay.split('-').map(Number)
  if (!y || !mo || !d) return data
  const at = new Date(y, mo - 1, d, 12, 0, 0, 0).toISOString()
  const now = new Date().toISOString()
  const applyToAll = options?.applyToAll === true

  const isChequeEvent = (event: SalePaymentEvent) =>
    !event.cancelled &&
    event.amount > 0 &&
    ((event.cheque ?? 0) > 0 ||
      (((event.bank ?? 0) > 0 || (event.cheque ?? 0) > 0) && (event.cash ?? 0) <= 0))

  let patched: Sale
  const events = [...(sale.paymentEvents ?? [])]

  if (applyToAll) {
    let changed = false
    const nextEvents = events.map((event) => {
      if (!isChequeEvent(event)) return event
      if (isoToDateInputValue(event.at) === localDay) return event
      changed = true
      return { ...event, at }
    })
    if (!changed) {
      if (events.length > 0) return data
      const amount = getApprovedChequeAmount(sale)
      if (amount <= 0) return data
      patched = {
        ...sale,
        paymentEvents: [
          normalizePaymentEvent({
            at,
            amount,
            bank: amount,
            cheque: amount,
          }),
        ],
        chequeApproved: true,
        updatedAt: now,
      }
    } else {
      patched = { ...sale, paymentEvents: nextEvents, updatedAt: now }
    }
  } else if (eventIndex != null && events[eventIndex]) {
    const target = events[eventIndex]
    if (target.cancelled || target.amount <= 0) return data
    if (isoToDateInputValue(target.at) === localDay) return data
    patched = {
      ...sale,
      paymentEvents: events.map((event, index) =>
        index === eventIndex ? { ...event, at } : event,
      ),
      updatedAt: now,
    }
  } else {
    const amount = getApprovedChequeAmount(sale)
    if (amount <= 0) return data

    const chequeIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isChequeEvent(event))

    if (chequeIndexes.length >= 1) {
      // No index: move every active cheque slice (safer than updating only one).
      let changed = false
      const nextEvents = events.map((event) => {
        if (!isChequeEvent(event)) return event
        if (isoToDateInputValue(event.at) === localDay) return event
        changed = true
        return { ...event, at }
      })
      if (!changed) return data
      patched = { ...sale, paymentEvents: nextEvents, updatedAt: now }
    } else {
      const created = normalizePaymentEvent({
        at,
        amount,
        bank: amount,
        cheque: amount,
      })
      patched = {
        ...sale,
        paymentEvents: [...events, created],
        chequeApproved: true,
        updatedAt: now,
      }
    }
  }

  clearSalePaymentCaches()
  const next = {
    ...data,
    sales: data.sales.map((s) => (s.id === saleId ? patched : s)),
  }
  saveData(next)
  return next
}

export function cancelApprovedCheque(data: AppData, id: string): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isApprovedChequeSale(sale)) return data

  const now = new Date().toISOString()
  const chequeAmt = getApprovedChequeAmount(sale)
  if (chequeAmt <= 0) return data

  // Prefer cancelling via payment events when multiple approvals exist.
  const events = sale.paymentEvents ?? []
  const activeChequeIndexes = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        !event.cancelled &&
        event.amount > 0 &&
        ((event.bank ?? 0) > 0 || (event.cheque ?? 0) > 0) &&
        (event.cash ?? 0) <= 0,
    )
  if (activeChequeIndexes.length > 0) {
    // Cancel the latest approval slice first (Settings row without index).
    const latest = activeChequeIndexes[activeChequeIndexes.length - 1]
    return cancelApprovedChequeEntry(data, id, latest.index)
  }

  if (sale.status === 'pending' && sale.chequeApproved) {
    const cash = sale.cashAmount ?? 0
    const bank = Math.max(0, (sale.bankAmount ?? 0) - chequeAmt)
    const totalPaid = cash + bank
    let next: AppData = {
      ...data,
      sales: data.sales.map((s) =>
        s.id === id
          ? {
              ...s,
              chequeAmount: undefined,
              chequeApproved: undefined,
              bankAmount: bank > 0 ? bank : undefined,
              paidAmount: totalPaid,
              billAmount: s.billAmount + chequeAmt,
              updatedAt: now,
            }
          : s,
      ),
    }
    const updated = next.sales.find((s) => s.id === id)
    if (updated?.parentSplitId && isPendingCreditSale(updated)) {
      next = syncParentSplitCreditAmount(next, updated, updated.billAmount)
    }
    saveData(next)
    return next
  }

  if (sale.payType === 'split') {
    const bankOnly = Math.max(0, (sale.bankAmount ?? 0) - chequeAmt)
    const pendingCheque: Sale = {
      id: crypto.randomUUID(),
      billAmount: chequeAmt,
      originalBillAmount: sale.originalBillAmount ?? sale.billAmount,
      paidAmount: 0,
      changeAmount: 0,
      payType: 'cheque',
      pendingPayType: 'cheque',
      parentSplitId: sale.id,
      customerName: sale.customerName,
      status: 'pending',
      createdAt: sale.createdAt,
      updatedAt: now,
    }

    const next = {
      ...data,
      sales: [
        pendingCheque,
        ...data.sales.map((s) =>
          s.id === id
            ? {
                ...s,
                bankAmount: bankOnly > 0 ? bankOnly : undefined,
                chequeAmount: undefined,
                chequeApproved: undefined,
                updatedAt: now,
              }
            : s,
        ),
      ],
    }
    saveData(next)
    return next
  }

  const revert = revertPendingPayTypes(sale)
  const priorCollected = saleCollectedAmount(sale) - chequeAmt
  const originalBillAmount = sale.originalBillAmount ?? sale.billAmount
  const reopenDue = Math.max(0, originalBillAmount - Math.max(0, priorCollected))
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id
        ? {
            ...s,
            status: 'pending' as const,
            payType: revert.payType,
            pendingPayType: revert.pendingPayType,
            billAmount: reopenDue > 0 ? reopenDue : chequeAmt,
            originalBillAmount,
            paidAmount: Math.max(0, priorCollected),
            changeAmount: 0,
            chequeApproved: undefined,
            bankAmount: undefined,
            cashAmount: undefined,
            chequeAmount: revert.payType === 'cheque' ? (reopenDue > 0 ? reopenDue : chequeAmt) : undefined,
            creditAmount: revert.pendingPayType === 'credit' ? (reopenDue > 0 ? reopenDue : chequeAmt) : undefined,
            paymentEvents: (s.paymentEvents ?? []).map((event) =>
              !event.cancelled &&
              ((event.bank ?? 0) > 0 || (event.cheque ?? 0) > 0) &&
              (event.cash ?? 0) <= 0
                ? { ...event, cancelled: true, cancelledAt: now }
                : event,
            ),
            updatedAt: now,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

/** Record a partial collection against a pending credit sale — keeps balance open. */
function payTypeFromCollectedTotals(
  cash: number,
  bank: number,
  cheque: number,
  fallback: PayType,
): PayType {
  const modes = [cash > 0, bank > 0, cheque > 0].filter(Boolean).length
  if (modes > 1) return 'split'
  if (cash > 0) return 'cash'
  if (bank > 0) return 'bank'
  if (cheque > 0) return 'cheque'
  return fallback
}

function syncParentSplitCreditAmount(
  data: AppData,
  creditSale: Sale,
  remainingCredit: number,
): AppData {
  if (!creditSale.parentSplitId) return data

  const now = new Date().toISOString()
  return {
    ...data,
    sales: data.sales.map((s) =>
      s.id === creditSale.parentSplitId
        ? {
            ...s,
            creditAmount: remainingCredit > 0 ? remainingCredit : undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
}

export function isPendingCreditSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'credit' || sale.payType === 'credit')
  )
}

export function isPendingChequeSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'cheque' || sale.payType === 'cheque')
  )
}

export function isPendingBalanceSale(sale: Sale): boolean {
  return isPendingCreditSale(sale) || isPendingChequeSale(sale)
}

export type BillCreatePayType = Extract<PayType, 'cash' | 'bank' | 'credit' | 'cheque'>

export function saleBillCreatePayType(sale: Sale): BillCreatePayType {
  if (sale.pendingPayType === 'credit' || (sale.status === 'pending' && sale.payType === 'credit')) {
    return 'credit'
  }
  if (sale.pendingPayType === 'cheque' || (sale.status === 'pending' && sale.payType === 'cheque')) {
    return 'cheque'
  }
  if (sale.payType === 'bank') return 'bank'
  if (sale.payType === 'cheque') return 'cheque'
  if (sale.payType === 'credit') return 'credit'
  return 'cash'
}

function applyPaidBillPayType(sale: Sale, payType: BillCreatePayType, billAmount: number): Sale {
  const amount = billAmount
  const paidAmount = sale.paidAmount > 0 ? sale.paidAmount : amount
  const collectionAt = saleCollectionTimestamp(sale)
  const base: Sale = {
    ...sale,
    payType,
    billAmount: amount,
    paidAmount,
    pendingPayType: undefined,
    status: 'paid',
    cashAmount: undefined,
    bankAmount: undefined,
    chequeAmount: undefined,
    creditAmount: undefined,
    chequeApproved: undefined,
    updatedAt: collectionAt,
  }

  let patched: Sale
  if (payType === 'cash') {
    patched = { ...base, changeAmount: Math.max(0, paidAmount - amount) }
  } else if (payType === 'bank') {
    patched = { ...base, bankAmount: amount, changeAmount: 0 }
  } else if (payType === 'cheque') {
    patched = {
      ...base,
      bankAmount: amount,
      chequeAmount: amount,
      chequeApproved: true,
      changeAmount: 0,
    }
  } else {
    patched = { ...base, changeAmount: 0 }
  }

  const events = buildPaidSalePaymentEvents(patched, collectionAt)
  return events.length > 0 ? { ...patched, paymentEvents: events } : patched
}

function isCreditPendingSale(sale: Sale): boolean {
  return isPendingCreditSale(sale)
}

export function applyPartialBalanceSaleCollection(
  data: AppData,
  id: string,
  payment: {
    collected: number
    payType: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    chequeApproved?: boolean
    customerName?: string
    changeAmount?: number
  },
): AppData {
  const sale = data.sales.find((s) => s.id === id && s.status === 'pending')
  if (!sale || !isPendingBalanceSale(sale)) return data

  const isCheque = isPendingChequeSale(sale)

  const due = sale.billAmount
  const collected = Math.min(Math.max(0, payment.collected), due)
  if (collected <= 0) return data

  const remaining = due - collected
  const now = new Date().toISOString()
  // Prefer paymentEvents when bill edits wiped cash/bank fields on the pending row.
  // Use raw parts so cumulative chequeAmount stays correct across partial approvals.
  const prior = salePendingRawCollectedParts(sale)
  const prevCash = prior.cash
  const prevBank = prior.bank
  const prevCheque = prior.cheque

  const addCash = payment.cashAmount ?? (payment.payType === 'cash' ? collected : 0)
  const addBankRaw = payment.bankAmount ?? (payment.payType === 'bank' ? collected : 0)
  const addCheque =
    payment.payType === 'cheque' && payment.chequeApproved
      ? payment.chequeAmount ?? collected
      : payment.chequeApproved
        ? payment.chequeAmount ?? 0
        : 0
  // Avoid double-counting when Counter sends bankAmount = chequeAmount on approve.
  const addBank = addCheque > 0 ? Math.max(0, addBankRaw - addCheque) : addBankRaw

  const totalCash = prevCash + addCash
  const totalBank = prevBank + addBank
  const totalCheque = prevCheque + addCheque
  const totalPaid = normalizeCollectedBreakdown({
    cash: totalCash,
    bank: totalBank,
    cheque: totalCheque,
    total: totalCash + totalBank + totalCheque,
  }).total
  const paymentEvent = normalizePaymentEvent({
    at: now,
    amount: collected,
    cash: addCash,
    bank: addBank,
    cheque: addCheque,
  })

  if (remaining <= 0) {
    const originalBillAmount = sale.originalBillAmount ?? due + (totalPaid - collected)
    const settledPayType = payTypeFromCollectedTotals(
      totalCash,
      totalBank,
      totalCheque,
      payment.payType,
    )
    return collectPendingBill(data, id, {
      billAmount: originalBillAmount,
      originalBillAmount,
      paidAmount: totalPaid,
      changeAmount: payment.changeAmount ?? 0,
      payType: settledPayType,
      cashAmount: totalCash || undefined,
      // Store approved cheque inside bankAmount as well so field totals match events.
      bankAmount: totalBank + totalCheque > 0 ? totalBank + totalCheque : undefined,
      chequeAmount: totalCheque || undefined,
      chequeApproved: totalCheque > 0 ? true : undefined,
      customerName: payment.customerName,
    }, paymentEvent)
  }

  const balancePayType = isCheque ? 'cheque' : 'credit'
  const patched: Sale = appendSalePaymentEvent(
    {
      ...sale,
      billAmount: remaining,
      originalBillAmount: sale.originalBillAmount ?? remaining + totalPaid,
      paidAmount: totalPaid,
      payType: balancePayType,
      pendingPayType: balancePayType,
      cashAmount: totalCash || undefined,
      bankAmount: totalBank + totalCheque > 0 ? totalBank + totalCheque : undefined,
      // Keep approved cheque amount separate from remaining open balance.
      chequeAmount: totalCheque || undefined,
      chequeApproved: totalCheque > 0 ? true : undefined,
      creditAmount: isCheque ? undefined : remaining,
      customerName: payment.customerName ?? sale.customerName,
      status: 'pending',
      updatedAt: now,
    },
    paymentEvent,
  )

  let next: AppData = {
    ...data,
    sales: data.sales.map((s) => (s.id === id ? patched : s)),
  }
  if (!isCheque) {
    next = syncParentSplitCreditAmount(next, patched, remaining)
  }
  saveData(next)
  return next
}

/** @deprecated Use applyPartialBalanceSaleCollection */
export const applyPartialCreditSaleCollection = applyPartialBalanceSaleCollection

function applyCreditPaymentFields(expense: Expense, updates: Partial<Expense>): Expense {
  const payType = updates.payType ?? expense.payType
  const patched: Expense = {
    ...expense,
    ...updates,
    payType,
    updatedAt: new Date().toISOString(),
  }

  if (payType === 'cash') {
    patched.cashAmount = undefined
    patched.bankAmount = undefined
    patched.creditAmount = undefined
    patched.chequeAmount = undefined
    patched.chequeApproved = undefined
    return patched
  }

  if (payType === 'bank') {
    patched.bankAmount = updates.bankAmount ?? expense.amount
    patched.cashAmount = undefined
    patched.creditAmount = undefined
    patched.chequeAmount = undefined
    patched.chequeApproved = undefined
    return patched
  }

  if (payType === 'cheque') {
    patched.chequeAmount = updates.chequeAmount ?? expense.amount
    patched.chequeApproved = updates.chequeApproved ?? true
    patched.cashAmount = undefined
    patched.bankAmount = undefined
    patched.creditAmount = undefined
    return patched
  }

  if (payType === 'split') {
    patched.cashAmount = updates.cashAmount
    patched.bankAmount = updates.bankAmount
    patched.creditAmount = updates.creditAmount
    patched.chequeAmount = updates.chequeAmount
    patched.chequeApproved = updates.chequeApproved
  }

  return patched
}

/** Apply supplier credit pay-down — merges paid cash/bank/cheque correctly. */
export function applyPurchaseCreditPayment(
  data: AppData,
  id: string,
  payment: CreditPaymentInput,
): AppData {
  const expense = data.expenses.find((e) => e.id === id)
  if (!expense || !isPurchaseExpense(expense) || !isPurchaseCreditExpense(expense)) {
    return data
  }

  const updates = buildCreditPaymentUpdate(expense, payment)
  const patched = applyCreditPaymentFields(expense, { ...updates, amount: expense.amount })

  let next: AppData = {
    ...data,
    expenses: data.expenses.map((e) => (e.id === id ? patched : e)),
  }

  const supplierName = stripExpenseBillSuffix(patched.name?.trim() ?? '')
  if (supplierName) next = ensureSupplierInData(next, supplierName)
  const item = patched.description?.trim()
  if (supplierName && item) next = addSupplierItem(next, supplierName, item)

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
    chequeAmount?: number
    creditAmount?: number
    chequeApproved?: boolean
    customerName?: string
  },
  paymentEvent?: Omit<SalePaymentEvent, 'amount'> & { amount: number },
): AppData {
  const original = data.sales.find((s) => s.id === id && s.status === 'pending')
  const now = new Date().toISOString()
  const next = {
    ...data,
    sales: data.sales.map((s) => {
      if (s.id !== id || s.status !== 'pending') return s

      const prior = salePendingCreditPaidBreakdown(s)
      const addCash = sale.cashAmount ?? 0
      const addBank = sale.bankAmount ?? 0
      const addCheque =
        sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
      const incoming = normalizeCollectedBreakdown({
        cash: addCash,
        bank: addBank,
        cheque: addCheque,
        total: addCash + addBank + addCheque,
      })
      const clearlyCumulative = incoming.total > prior.total + 0.01
      const matchesPriorOnly = Math.abs(incoming.total - prior.total) < 0.01
      const originalBill =
        sale.originalBillAmount ?? s.originalBillAmount ?? s.billAmount + prior.total
      const settledAsFullOriginal = Math.abs(sale.billAmount - originalBill) < 0.01
      // Incoming already covers prior totals → caller passed cumulative fields.
      // Incoming equal to prior while settling only the remaining due → this payment only.
      const alreadyIncludesPrior =
        prior.total <= 0 ||
        clearlyCumulative ||
        (matchesPriorOnly && settledAsFullOriginal)

      const totalCash = alreadyIncludesPrior ? incoming.cash : prior.cash + incoming.cash
      const totalBank = alreadyIncludesPrior ? incoming.bank : prior.bank + incoming.bank
      const totalCheque = alreadyIncludesPrior
        ? addCheque
        : prior.cheque + addCheque
      const totalPaid = normalizeCollectedBreakdown({
        cash: totalCash,
        bank: totalBank,
        cheque: totalCheque,
        total: totalCash + totalBank + totalCheque,
      }).total

      const originalBillAmount =
        sale.originalBillAmount ??
        s.originalBillAmount ??
        (prior.total > 0 ? s.billAmount + prior.total : sale.billAmount)
      const settledBillAmount =
        sale.originalBillAmount ??
        (prior.total > 0 && sale.billAmount + 0.01 < originalBillAmount
          ? originalBillAmount
          : sale.billAmount)

      const settledFields = {
        ...sale,
        billAmount: settledBillAmount,
        originalBillAmount,
        paidAmount: Math.max(sale.paidAmount, totalPaid),
        cashAmount: totalCash || undefined,
        bankAmount: totalBank || undefined,
        chequeAmount: totalCheque || undefined,
        chequeApproved:
          totalCheque > 0
            ? sale.chequeApproved ?? true
            : sale.payType === 'cheque'
              ? sale.chequeApproved
              : undefined,
      }

      const settled: Sale = {
        ...s,
        ...settledFields,
        pendingPayType:
          s.pendingPayType ??
          (s.payType === 'credit' || s.payType === 'cheque' ? s.payType : undefined),
        status: 'paid' as const,
        creditAmount: settledFields.payType === 'split' ? settledFields.creditAmount : undefined,
        chequeApproved:
          settledFields.payType === 'split' || settledFields.payType === 'cheque'
            ? settledFields.chequeApproved ??
              (settledFields.payType === 'cheque' ? true : undefined)
            : undefined,
        updatedAt: now,
      }

      const priorEvents = original?.paymentEvents ?? []

      if (priorEvents.length > 0) {
        const event =
          paymentEvent ??
          (alreadyIncludesPrior
            ? buildIncrementalPaymentEvent(original, settledFields, now)
            : paymentEventFromCollected(now, addCash, addBank, addCheque))
        if (event.amount > 0) {
          return appendSalePaymentEvent({ ...settled, paymentEvents: priorEvents }, event)
        }
        return { ...settled, paymentEvents: priorEvents }
      }

      const correctedEvent = paymentEventFromCollected(now, totalCash, totalBank, totalCheque)
      return {
        ...settled,
        paymentEvents: correctedEvent.amount > 0 ? [correctedEvent] : [],
      }
    }),
  }
  const settled = next.sales.find((s) => s.id === id)
  const synced =
    original?.parentSplitId && isCreditPendingSale(original) && settled
      ? syncParentSplitCreditAmount(next, settled, 0)
      : next
  saveData(synced)
  return synced
}

function defaultExpenseName(expense: Expense): string {
  if (expense.kind === 'add') return 'Added'
  if (expense.kind === 'transfer') return 'Transfer'
  return 'Expense'
}

function collectBillDateTargets(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): Set<string> {
  const targets = new Set<string>([id])
  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((s) => s.id === saleId)) targets.add(saleId)
    }
  }
  const sale = data.sales.find((s) => s.id === id)
  if (sale?.parentSplitId) targets.add(sale.parentSplitId)
  for (const child of data.sales) {
    if (child.parentSplitId === id) targets.add(child.id)
  }
  return targets
}

function applyBillCreatedAt(
  data: AppData,
  id: string,
  createdAt: string,
  relatedSaleIds?: string[],
): AppData {
  const targets = collectBillDateTargets(data, id, relatedSaleIds)
  const anchorSale = data.sales.find((s) => s.id === id)
  const oldCreatedAt = anchorSale?.createdAt
  return {
    ...data,
    sales: data.sales.map((s) => {
      if (!targets.has(s.id)) return s
      let patched: Sale = { ...s, createdAt }
      if (oldCreatedAt && s.paymentEvents && s.paymentEvents.length > 0) {
        patched = {
          ...patched,
          paymentEvents: s.paymentEvents.map((event) => {
            const anchor = s.updatedAt ?? oldCreatedAt
            if (event.at === oldCreatedAt || event.at === anchor) {
              return { ...event, at: createdAt }
            }
            return event
          }),
        }
      }
      if (s.id === id || targets.has(s.id)) {
        patched = { ...patched, updatedAt: saleCollectionTimestamp(patched) }
      }
      return patched
    }),
  }
}

export function updateSaleBill(
  data: AppData,
  id: string,
  updates: {
    customerName?: string
    billAmount?: number
    originalBillAmount?: number
    paidCollected?: number
    payType?: BillCreatePayType
    pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
    createdAt?: string
  },
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale) return data

  let working = updates.createdAt
    ? applyBillCreatedAt(data, id, updates.createdAt, relatedSaleIds)
    : data

  const customerName =
    updates.customerName !== undefined
      ? updates.customerName.trim() || undefined
      : sale.customerName

  const targetPayType = updates.payType ?? updates.pendingPayType

  if (sale.status === 'pending') {
    if (targetPayType === 'cash' || targetPayType === 'bank') {
      const total =
        updates.originalBillAmount != null && updates.originalBillAmount > 0
          ? updates.originalBillAmount
          : updates.billAmount != null && updates.billAmount > 0
            ? updates.billAmount
            : sale.originalBillAmount ?? sale.billAmount
      return collectPendingBill(working, id, {
        billAmount: total,
        originalBillAmount: total,
        paidAmount: total,
        changeAmount: 0,
        payType: targetPayType,
        cashAmount: targetPayType === 'cash' ? total : undefined,
        bankAmount: targetPayType === 'bank' ? total : undefined,
        customerName,
      })
    }

    const pendingPayType =
      targetPayType ??
      updates.pendingPayType ??
      sale.pendingPayType ??
      sale.payType
    const payType = targetPayType ?? updates.pendingPayType ?? sale.payType
    const isBalance = isPendingBalanceSale(sale) || payType === 'credit' || payType === 'cheque'

    let billAmount =
      updates.billAmount != null && updates.billAmount >= 0
        ? updates.billAmount
        : sale.billAmount
    let originalBillAmount =
      updates.originalBillAmount != null && updates.originalBillAmount > 0
        ? updates.originalBillAmount
        : sale.originalBillAmount ?? sale.billAmount

    let paidAmount = sale.paidAmount
    let cashAmount = sale.cashAmount
    let bankAmount = sale.bankAmount
    let chequeAmount = sale.chequeAmount
    let creditAmount: number | undefined

    if (isBalance && updates.paidCollected != null && updates.paidCollected >= 0) {
      const paid = Math.min(updates.paidCollected, originalBillAmount)
      paidAmount = paid
      if (paid !== saleCollectedAmount(sale)) {
        const prev = salePendingCreditPaidBreakdown(sale)
        if (prev.total > 0) {
          cashAmount = prev.cash > 0 ? Math.round((prev.cash / prev.total) * paid) : undefined
          bankAmount = prev.bank > 0 ? Math.round((prev.bank / prev.total) * paid) : undefined
          chequeAmount =
            prev.cheque > 0 ? Math.round((prev.cheque / prev.total) * paid) : undefined
          const sum = (cashAmount ?? 0) + (bankAmount ?? 0) + (chequeAmount ?? 0)
          if (sum !== paid) {
            if (bankAmount != null && bankAmount > 0) bankAmount += paid - sum
            else if (cashAmount != null && cashAmount > 0) cashAmount += paid - sum
            else cashAmount = paid
          }
        } else {
          cashAmount = paid > 0 ? paid : undefined
          bankAmount = undefined
          chequeAmount = undefined
        }
      }
      if (updates.billAmount == null) {
        billAmount = Math.max(0, originalBillAmount - paid)
      }
    }

    if (isBalance && updates.originalBillAmount != null && updates.originalBillAmount > 0) {
      originalBillAmount = updates.originalBillAmount
      if (updates.paidCollected == null && updates.billAmount == null) {
        billAmount = Math.max(0, originalBillAmount - saleCollectedAmount(sale))
      }
    }

    if (isBalance && updates.billAmount != null && updates.billAmount >= 0) {
      billAmount = updates.billAmount
      if (updates.originalBillAmount == null && updates.paidCollected == null) {
        const collected = saleCollectedAmount(sale)
        originalBillAmount = Math.max(billAmount + collected, billAmount)
      }
    }

    const resolvedPayType =
      payType === 'credit' || payType === 'cheque'
        ? payType
        : sale.payType === 'credit' || sale.payType === 'cheque'
          ? sale.payType
          : sale.payType
    const resolvedPending =
      pendingPayType === 'credit' || pendingPayType === 'cheque'
        ? pendingPayType
        : sale.pendingPayType

    if (resolvedPayType === 'credit') {
      creditAmount = billAmount
      chequeAmount = undefined
    } else if (resolvedPayType === 'cheque') {
      creditAmount = undefined
      const alreadyCollected = saleCollectedAmount(sale)
      // Remaining due lives in billAmount. Do not overwrite approved/collected cheque fields.
      if (alreadyCollected > 0 || (sale.paymentEvents?.length ?? 0) > 0) {
        chequeAmount = sale.chequeApproved ? sale.chequeAmount : undefined
        if (bankAmount == null && alreadyCollected > 0) {
          const prior = salePendingCreditPaidBreakdown(sale)
          bankAmount =
            prior.bank + prior.cheque > 0 ? prior.bank + prior.cheque : alreadyCollected
          cashAmount = prior.cash > 0 ? prior.cash : cashAmount
          paidAmount = Math.max(paidAmount, alreadyCollected)
        }
      } else {
        chequeAmount = billAmount
      }
    }

    return updatePendingBill(working, id, {
      billAmount,
      originalBillAmount,
      customerName,
      paidAmount,
      cashAmount,
      bankAmount,
      chequeAmount,
      creditAmount,
      payType: resolvedPayType,
      pendingPayType: resolvedPending,
    })
  }

  if (targetPayType) {
    const billAmount =
      updates.billAmount != null && updates.billAmount > 0
        ? updates.billAmount
        : sale.billAmount
    const nameTargets = new Set<string>()
    for (const saleId of collectSplitNameTargets(working, id)) nameTargets.add(saleId)
    if (relatedSaleIds) {
      for (const saleId of relatedSaleIds) {
        if (working.sales.some((s) => s.id === saleId)) {
          for (const relatedId of collectSplitNameTargets(working, saleId)) {
            nameTargets.add(relatedId)
          }
        }
      }
    }
    if (nameTargets.size === 0) nameTargets.add(id)

    const next = {
      ...working,
      sales: working.sales.map((s) => {
        if (!nameTargets.has(s.id) && s.id !== id) return s
        if (s.id !== id) {
          return customerName !== undefined ? { ...s, customerName } : s
        }
        let patched = applyPaidBillPayType(s, targetPayType, billAmount)
        if (customerName !== undefined) patched = { ...patched, customerName }
        if (updates.originalBillAmount != null && updates.originalBillAmount > 0) {
          patched = { ...patched, originalBillAmount: updates.originalBillAmount }
        }
        return patched
      }),
    }
    saveData(next)
    return next
  }

  const billAmount =
    updates.billAmount != null && updates.billAmount > 0 ? updates.billAmount : sale.billAmount

  const isSplitParent =
    sale.payType === 'split' || working.sales.some((s) => s.parentSplitId === sale.id)

  if (isSplitParent) {
    if (updates.customerName !== undefined) {
      return updateSaleCustomerName(working, id, updates.customerName, relatedSaleIds)
    }
    if (updates.createdAt) {
      saveData(working)
      return working
    }
    return data
  }

  const nameTargets = new Set<string>()
  for (const saleId of collectSplitNameTargets(working, id)) nameTargets.add(saleId)
  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (working.sales.some((s) => s.id === saleId)) {
        for (const relatedId of collectSplitNameTargets(working, saleId)) {
          nameTargets.add(relatedId)
        }
      }
    }
  }
  if (nameTargets.size === 0) nameTargets.add(id)

  const next = {
    ...working,
    sales: working.sales.map((s) => {
      if (!nameTargets.has(s.id) && s.id !== id) return s

      let patched: Sale = { ...s }
      let touched = false
      if (nameTargets.has(s.id) && updates.customerName !== undefined) {
        patched = { ...patched, customerName }
        touched = true
      }
      if (s.id === id && updates.billAmount != null && updates.billAmount > 0) {
        const collectionAt = saleCollectionTimestamp(s)
        patched = {
          ...patched,
          billAmount,
          updatedAt: collectionAt,
        }
        touched = true
        if (s.payType === 'cash' || !s.payType) {
          patched.changeAmount = Math.max(0, s.paidAmount - billAmount)
        }
        if (s.payType === 'bank') {
          patched.bankAmount = billAmount
        }
        if (s.payType === 'cheque') {
          patched.chequeAmount = billAmount
          patched.bankAmount = billAmount
        }
        const events = buildPaidSalePaymentEvents(patched, collectionAt)
        if (events.length > 0) patched = { ...patched, paymentEvents: events }
      } else if (touched) {
        patched = { ...patched, updatedAt: saleCollectionTimestamp(patched) }
      }
      return patched
    }),
  }
  saveData(next)
  return next
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

export function updateExpense(
  data: AppData,
  id: string,
  updates: Partial<Omit<Expense, 'id'>>,
): AppData {
  const existing = data.expenses.find((e) => e.id === id)
  if (!existing) return data

  const patched: Expense = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    name: updates.name !== undefined ? updates.name.trim() || defaultExpenseName(existing) : existing.name,
    description:
      updates.description !== undefined
        ? updates.description.trim() || undefined
        : existing.description,
    billNo:
      updates.billNo !== undefined ? updates.billNo.trim() || undefined : existing.billNo,
    billDate:
      updates.billDate !== undefined ? updates.billDate.trim() || undefined : existing.billDate,
    createdAt:
      updates.createdAt !== undefined && updates.createdAt.trim()
        ? updates.createdAt
        : existing.createdAt,
  }

  let next: AppData = {
    ...data,
    expenses: data.expenses.map((e) => (e.id === id ? patched : e)),
  }

  const supplierName = stripExpenseBillSuffix(patched.name?.trim() ?? '')
  if (supplierName) next = ensureSupplierInData(next, supplierName)
  const item = patched.description?.trim()
  if (supplierName && item) next = addSupplierItem(next, supplierName, item)

  saveData(next)
  return next
}

/** Clear open supplier credit on a purchase — keeps the bill, removes credit balance. */
export function cancelPurchaseCredit(data: AppData, id: string): AppData {
  const expense = data.expenses.find((e) => e.id === id)
  if (!expense || !isPurchaseExpense(expense)) return data
  if (expense.payType === 'credit') {
    return updateExpense(data, id, { creditAmount: 0 })
  }
  if (expense.payType === 'split' && (expense.creditAmount ?? 0) > 0) {
    return updateExpense(data, id, { creditAmount: 0 })
  }
  return data
}
