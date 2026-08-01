import type { AppData, StaffLeave, StaffLeaveType } from '../types'

export type SalaryMonthKey = string

/** Monthly salary is always divided by 30 for the daily rate. */
export const SALARY_DAYS_PER_MONTH = 30

function parseSalaryMonthKey(key: SalaryMonthKey): { year: number; month: number } {
  const [yearStr, monthStr] = key.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return { year, month }
}

export function staffDailyRate(monthlySalary: number): number {
  return Math.max(0, monthlySalary) / SALARY_DAYS_PER_MONTH
}

export function parseLeaveDate(isoDate: string): Date {
  const [yearStr, monthStr, dayStr] = isoDate.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(Number.NaN)
  }
  return new Date(year, month - 1, day)
}

export function isSunday(date: Date): boolean {
  return date.getDay() === 0
}

/** Sundays are paid off days — no salary deduction. */
export function isPaidOffDay(isoDate: string): boolean {
  const date = parseLeaveDate(isoDate)
  if (Number.isNaN(date.getTime())) return false
  return isSunday(date)
}

export function isLeaveDeductible(isoDate: string): boolean {
  return !isPaidOffDay(isoDate)
}

export function leaveDeductionForType(monthlySalary: number, type: StaffLeaveType): number {
  if (type === 'off') return 0
  const daily = staffDailyRate(monthlySalary)
  return type === 'full' ? daily : daily / 2
}

export function leaveDeductionAmount(
  monthlySalary: number,
  leave: Pick<StaffLeave, 'date' | 'type'>,
): number {
  if (leave.type === 'off') return 0
  if (!isLeaveDeductible(leave.date)) return 0
  return leaveDeductionForType(monthlySalary, leave.type)
}

export function leaveDateInMonth(isoDate: string, monthKey: SalaryMonthKey): boolean {
  return isoDate.slice(0, 7) === monthKey
}

export function monthDateBounds(monthKey: SalaryMonthKey): { min: string; max: string } {
  const { year, month } = parseSalaryMonthKey(monthKey)
  const mm = String(month).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const dd = String(lastDay).padStart(2, '0')
  return { min: `${year}-${mm}-01`, max: `${year}-${mm}-${dd}` }
}

export function formatLeaveDateLabel(isoDate: string): string {
  const date = parseLeaveDate(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function getStaffLeavesForMonth(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
): StaffLeave[] {
  return (data.staffLeaves ?? [])
    .filter((leave) => leave.staffId === staffId && leaveDateInMonth(leave.date, monthKey))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface StaffLeaveRow {
  leaveId: string
  date: string
  type: StaffLeaveType
  deduction: number
  deductible: boolean
}

export function buildStaffLeaveRows(monthlySalary: number, leaves: StaffLeave[]): StaffLeaveRow[] {
  return leaves.map((leave) => ({
    leaveId: leave.id,
    date: leave.date,
    type: leave.type,
    deduction: leaveDeductionAmount(monthlySalary, leave),
    deductible: isLeaveDeductible(leave.date),
  }))
}

export function totalLeaveDeduction(monthlySalary: number, leaves: StaffLeave[]): number {
  return leaves.reduce((sum, leave) => sum + leaveDeductionAmount(monthlySalary, leave), 0)
}

export function validateStaffLeaveInput(
  data: AppData,
  staffId: string,
  date: string,
  excludeLeaveId?: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Pick a valid date.'
  const parsed = parseLeaveDate(date)
  if (Number.isNaN(parsed.getTime())) return 'Pick a valid date.'
  const duplicate = (data.staffLeaves ?? []).some(
    (leave) =>
      leave.staffId === staffId && leave.date === date && leave.id !== excludeLeaveId,
  )
  if (duplicate) return 'Leave already recorded for this date.'
  return null
}

export type StaffAttendanceStatus = 'leave' | 'half' | 'present' | 'off'

export interface MonthCalendarCell {
  date: string | null
  day: number | null
  isSunday: boolean
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function weekdayLabelsForCalendar(): string[] {
  return WEEKDAY_LABELS
}

/** Calendar grid for one salary month — padding cells have null date. */
export function buildMonthCalendarGrid(monthKey: SalaryMonthKey): MonthCalendarCell[] {
  const { year, month } = parseSalaryMonthKey(monthKey)
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const lastDay = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  const cells: MonthCalendarCell[] = []

  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ date: null, day: null, isSunday: false })
  }

  for (let day = 1; day <= lastDay; day++) {
    const dd = String(day).padStart(2, '0')
    const date = `${year}-${mm}-${dd}`
    cells.push({ date, day, isSunday: isSunday(parseLeaveDate(date)) })
  }

  return cells
}

export function findStaffLeaveOnDate(
  data: AppData,
  staffId: string,
  date: string,
): StaffLeave | undefined {
  return (data.staffLeaves ?? []).find((leave) => leave.staffId === staffId && leave.date === date)
}

export function staffAttendanceStatusForDate(
  data: AppData,
  staffId: string,
  date: string,
): StaffAttendanceStatus {
  const leave = findStaffLeaveOnDate(data, staffId, date)
  if (leave) {
    if (leave.type === 'off') return 'off'
    if (leave.type === 'half') return 'half'
    return 'leave'
  }
  if (isPaidOffDay(date)) return 'off'
  return 'present'
}
