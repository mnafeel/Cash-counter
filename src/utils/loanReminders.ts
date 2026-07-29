import type { AppData } from '../types'
import { formatDate } from './format'
import {
  evaluateBillReminderAlert,
  getReminderAlertSettings,
  isReminderDue,
  type BillReminderPhase,
} from './billReminders'
import type { ReminderSoundStyle } from './reminderNotificationSound'

export interface LoanReminderItem {
  loanId: string
  personName: string
  amount: number
  kind: 'lend' | 'borrow'
  reminderAt: string
  reminderNote?: string
  reminderUrgent: boolean
  soundStyle: ReminderSoundStyle
  reminderDateLabel: string
  isDue: boolean
  isOverdue: boolean
  isAlertActive: boolean
  phase: BillReminderPhase
  alertLabel: string
  daysUntilDue: number
}

function loanActionLabel(kind: 'lend' | 'borrow', text: string): string {
  return text.replace(/^Collect/, kind === 'lend' ? 'Collect' : 'Return')
}

function buildLoanReminderItem(
  loan: NonNullable<AppData['loans']>[number],
  data: AppData,
  now: Date,
): LoanReminderItem {
  const reminderAt = loan.reminderAt as string
  const settings = getReminderAlertSettings(data)
  const alert = evaluateBillReminderAlert(reminderAt, 'loan', settings, now)
  const due = isReminderDue(reminderAt, now)
  const urgent = loan.reminderUrgent === true || alert.phase === 'overdue'
  return {
    loanId: loan.id,
    personName: loan.personName,
    amount: loan.amount,
    kind: loan.kind,
    reminderAt,
    reminderNote: loan.reminderNote,
    reminderUrgent: loan.reminderUrgent === true,
    soundStyle: urgent ? 'urgent' : 'normal',
    reminderDateLabel: formatDate(reminderAt),
    isDue: due,
    isOverdue: alert.phase === 'overdue',
    isAlertActive: alert.isAlertActive,
    phase: alert.phase,
    alertLabel: loanActionLabel(loan.kind, alert.alertLabel),
    daysUntilDue: alert.daysUntilDue,
  }
}

export function buildLoanReminders(data: AppData, now = new Date()): LoanReminderItem[] {
  return (data.loans ?? [])
    .filter((loan) => loan.status === 'pending' && loan.reminderAt)
    .map((loan) => buildLoanReminderItem(loan, data, now))
    .sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime())
}

export function buildActiveLoanReminders(data: AppData, now = new Date()): LoanReminderItem[] {
  return buildLoanReminders(data, now).filter((item) => item.isAlertActive)
}

export function countActiveLoanReminders(data: AppData, now = new Date()): number {
  return buildActiveLoanReminders(data, now).length
}
