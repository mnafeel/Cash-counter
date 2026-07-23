import type { AppData, ReminderAlertSettings, Sale } from '../types'
import { DEFAULT_REMINDER_ALERTS } from '../types'
import { formatDate } from './format'
import { getSaleCustomerName } from './saleCustomerName'
import { UNNAMED_CREDIT_CUSTOMER } from './customerLedger'

export type BillReminderKind = 'credit' | 'cheque' | 'other'
export type BillReminderPhase = 'upcoming' | 'due' | 'overdue'

export interface BillReminderItem {
  saleId: string
  customerName: string
  amount: number
  kind: BillReminderKind
  reminderAt: string
  reminderNote?: string
  reminderDateLabel: string
  isDue: boolean
  isOverdue: boolean
  /** Alert is visible now (within days-before window or due). */
  isAlertActive: boolean
  phase: BillReminderPhase
  alertLabel: string
  daysUntilDue: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function getReminderAlertSettings(data: AppData): ReminderAlertSettings {
  return {
    creditDaysBefore: Math.max(0, data.reminderAlerts?.creditDaysBefore ?? DEFAULT_REMINDER_ALERTS.creditDaysBefore),
    chequeDaysBefore: Math.max(0, data.reminderAlerts?.chequeDaysBefore ?? DEFAULT_REMINDER_ALERTS.chequeDaysBefore),
    alertIntervalDays: Math.max(1, data.reminderAlerts?.alertIntervalDays ?? DEFAULT_REMINDER_ALERTS.alertIntervalDays),
    notificationShowSeconds: Math.max(
      0,
      data.reminderAlerts?.notificationShowSeconds ?? DEFAULT_REMINDER_ALERTS.notificationShowSeconds,
    ),
    notificationSoundEnabled:
      data.reminderAlerts?.notificationSoundEnabled ?? DEFAULT_REMINDER_ALERTS.notificationSoundEnabled,
  }
}

export function daysBeforeForKind(kind: BillReminderKind, settings: ReminderAlertSettings): number {
  if (kind === 'cheque') return settings.chequeDaysBefore
  if (kind === 'credit') return settings.creditDaysBefore
  return settings.creditDaysBefore
}

export function formatNotificationShowLabel(seconds: number): string {
  if (seconds <= 0) return 'Until closed'
  if (seconds < 60) return `${seconds}s`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

export function isReminderDue(reminderAt: string, now = new Date()): boolean {
  return new Date(reminderAt).getTime() <= now.getTime()
}

function reminderKind(sale: Sale): BillReminderKind {
  if (sale.payType === 'credit' || sale.pendingPayType === 'credit') return 'credit'
  if (sale.payType === 'cheque' || sale.pendingPayType === 'cheque') return 'cheque'
  return 'other'
}

export function getSaleReminderKind(sale: Sale): BillReminderKind {
  return reminderKind(sale)
}

function localDayTimestamp(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function daysUntilReminder(reminderAt: string, now = new Date()): number {
  const dueDay = localDayTimestamp(reminderAt)
  const today = localDayTimestamp(now.toISOString())
  return Math.round((dueDay - today) / MS_PER_DAY)
}

export function evaluateBillReminderAlert(
  reminderAt: string,
  kind: BillReminderKind,
  settings: ReminderAlertSettings,
  now = new Date(),
): { isAlertActive: boolean; phase: BillReminderPhase; alertLabel: string; daysUntilDue: number } {
  const nowMs = now.getTime()
  const dueMs = new Date(reminderAt).getTime()
  const daysBefore = daysBeforeForKind(kind, settings)
  const alertStartMs = dueMs - daysBefore * MS_PER_DAY
  const daysUntilDue = daysUntilReminder(reminderAt, now)

  if (nowMs < alertStartMs) {
    return {
      isAlertActive: false,
      phase: 'upcoming',
      alertLabel: `Collect in ${daysUntilDue} days`,
      daysUntilDue,
    }
  }

  if (nowMs >= dueMs) {
    const overdueDays = Math.max(0, -daysUntilDue)
    return {
      isAlertActive: true,
      phase: overdueDays > 0 ? 'overdue' : 'due',
      alertLabel: overdueDays > 0 ? `Overdue ${overdueDays} day${overdueDays === 1 ? '' : 's'}` : 'Due now',
      daysUntilDue,
    }
  }

  const daysSinceAlertStart = Math.floor((nowMs - alertStartMs) / MS_PER_DAY)
  const interval = settings.alertIntervalDays
  const showToday = interval <= 1 || daysSinceAlertStart % interval === 0

  return {
    isAlertActive: showToday,
    phase: 'upcoming',
    alertLabel:
      daysUntilDue === 0
        ? 'Due today'
        : daysUntilDue === 1
          ? 'Collect tomorrow'
          : `Collect in ${daysUntilDue} days`,
    daysUntilDue,
  }
}

function buildReminderItem(
  sale: Sale,
  allSales: Sale[],
  settings: ReminderAlertSettings,
  now = new Date(),
): BillReminderItem {
  const reminderAt = sale.reminderAt!
  const kind = reminderKind(sale)
  const alert = evaluateBillReminderAlert(reminderAt, kind, settings, now)
  const due = isReminderDue(reminderAt, now)

  return {
    saleId: sale.id,
    customerName: getSaleCustomerName(sale, allSales) || UNNAMED_CREDIT_CUSTOMER,
    amount: sale.billAmount,
    kind,
    reminderAt,
    reminderNote: sale.reminderNote?.trim() || undefined,
    reminderDateLabel: formatDate(reminderAt),
    isDue: due,
    isOverdue: alert.phase === 'overdue',
    isAlertActive: alert.isAlertActive,
    phase: alert.phase,
    alertLabel: alert.alertLabel,
    daysUntilDue: alert.daysUntilDue,
  }
}

export function buildBillReminders(data: AppData, now = new Date()): BillReminderItem[] {
  const settings = getReminderAlertSettings(data)

  return data.sales
    .filter((sale) => sale.status === 'pending' && sale.reminderAt)
    .map((sale) => buildReminderItem(sale, data.sales, settings, now))
    .sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime())
}

export function buildActiveBillReminders(data: AppData, now = new Date()): BillReminderItem[] {
  return buildBillReminders(data, now).filter((item) => item.isAlertActive)
}

export function buildDueBillReminders(data: AppData, now = new Date()): BillReminderItem[] {
  return buildBillReminders(data, now).filter((item) => item.isDue)
}

export function buildCreditBillReminders(data: AppData, now = new Date()): BillReminderItem[] {
  return buildBillReminders(data, now).filter((item) => item.kind === 'credit')
}

export function buildChequeBillReminders(data: AppData, now = new Date()): BillReminderItem[] {
  return buildBillReminders(data, now).filter((item) => item.kind === 'cheque')
}

export function buildActiveCreditReminders(data: AppData, now = new Date()): BillReminderItem[] {
  return buildActiveBillReminders(data, now).filter((item) => item.kind === 'credit')
}

export function buildActiveChequeReminders(data: AppData, now = new Date()): BillReminderItem[] {
  return buildActiveBillReminders(data, now).filter((item) => item.kind === 'cheque')
}

export function countActiveBillReminders(data: AppData, now = new Date()): number {
  return buildActiveBillReminders(data, now).length
}

/** @deprecated use countActiveBillReminders */
export function countDueBillReminders(data: AppData): number {
  return countActiveBillReminders(data)
}
