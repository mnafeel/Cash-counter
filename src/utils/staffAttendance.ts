import type { AppData, StaffLeave, StaffLeaveType } from '../types'

export type SalaryMonthKey = string

/** Default days when staff has no custom setting. */
export const SALARY_DAYS_PER_MONTH = 30

export function resolveStaffSalaryDays(days: number | undefined): number {
  const n = Math.round(Number(days) || SALARY_DAYS_PER_MONTH)
  return Math.min(31, Math.max(1, n))
}

export function staffDailyRate(monthlySalary: number, daysPerMonth = SALARY_DAYS_PER_MONTH): number {
  const days = resolveStaffSalaryDays(daysPerMonth)
  return Math.max(0, monthlySalary) / days
}

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

export function isSundayDate(isoDate: string): boolean {
  const date = parseLeaveDate(isoDate)
  if (Number.isNaN(date.getTime())) return false
  return isSunday(date)
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

export type StaffAttendanceStatus = StaffLeaveType | 'unset'

/** Pay weight for one calendar day (0, 0.5, or 1). */
export function attendanceDayWeight(status: StaffAttendanceStatus): number {
  if (status === 'unset') return 0
  if (status === 'present' || status === 'off') return 1
  if (status === 'half') return 0.5
  return 0
}

/** Leave deduction for one explicitly marked day. */
export function leaveDeductionForStatus(dailyRate: number, status: StaffAttendanceStatus): number {
  if (status === 'half') return dailyRate / 2
  if (status === 'not_paid' || status === 'leave') return dailyRate
  return 0
}

export function attendanceDayDeduction(
  dailyRate: number,
  status: StaffAttendanceStatus,
): number {
  return leaveDeductionForStatus(dailyRate, status)
}

export function hasLeaveDeduction(status: StaffAttendanceStatus): boolean {
  return leaveDeductionForStatus(1, status) > 0
}

export interface MonthAttendanceTotals {
  paidDays: number
  fullDayCount: number
  halfDayCount: number
  notPaidCount: number
  offCount: number
  unsetCount: number
}

export function computeMonthAttendanceTotals(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
): MonthAttendanceTotals {
  let paidDays = 0
  let fullDayCount = 0
  let halfDayCount = 0
  let notPaidCount = 0
  let offCount = 0
  let unsetCount = 0

  for (const cell of buildMonthCalendarGrid(monthKey)) {
    if (!cell.date) continue
    const status = staffAttendanceStatusForDate(data, staffId, cell.date)
    paidDays += attendanceDayWeight(status)
    if (status === 'present') fullDayCount += 1
    else if (status === 'half') halfDayCount += 1
    else if (status === 'not_paid' || status === 'leave') notPaidCount += 1
    else if (status === 'off') offCount += 1
    else unsetCount += 1
  }

  return { paidDays, fullDayCount, halfDayCount, notPaidCount, offCount, unsetCount }
}

/** Sum leave deductions from explicitly marked days only. */
export function computeMonthLeaveDeduction(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
  dailyRate: number,
): number {
  return getStaffLeavesForMonth(data, staffId, monthKey).reduce((sum, leave) => {
    const status = staffLeaveTypeToStatus(leave.type)
    return sum + leaveDeductionForStatus(dailyRate, status)
  }, 0)
}

export function computeLeaveNetSalary(monthlySalary: number, leaveDeductionTotal: number): number {
  return Math.max(0, monthlySalary - leaveDeductionTotal)
}

export interface StaffAttendanceRow {
  leaveId: string
  date: string
  type: StaffLeaveType
  status: StaffAttendanceStatus
  dayWeight: number
  dayPay: number
  dayDeduction: number
}

export function buildStaffAttendanceRows(
  monthlySalary: number,
  leaves: StaffLeave[],
  salaryDaysPerMonth = SALARY_DAYS_PER_MONTH,
): StaffAttendanceRow[] {
  const dailyRate = staffDailyRate(monthlySalary, salaryDaysPerMonth)
  return leaves
    .map((leave) => {
      const status = staffLeaveTypeToStatus(leave.type)
      const dayWeight = attendanceDayWeight(status)
      const dayDeduction = leaveDeductionForStatus(dailyRate, status)
      return {
        leaveId: leave.id,
        date: leave.date,
        type: leave.type,
        status,
        dayWeight,
        dayPay: Math.max(0, dailyRate - dayDeduction),
        dayDeduction,
      }
    })
    .filter((row) => row.dayDeduction > 0)
}

const LEGACY_LEAVE_TYPES: Record<string, StaffLeaveType> = {
  full: 'present',
  present: 'present',
  half: 'half',
  off: 'off',
  not_paid: 'not_paid',
  leave: 'leave',
  leave_full: 'leave',
  leave_half: 'half',
  leave_off: 'off',
  unpaid_full: 'not_paid',
  unpaid_half: 'half',
  unpaid_off: 'off',
  unpaid_leave: 'not_paid',
}

export function normalizeStaffLeaveTypeValue(raw: unknown): StaffLeaveType | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return null
  if (LEGACY_LEAVE_TYPES[value]) return LEGACY_LEAVE_TYPES[value]
  const canonical: StaffLeaveType[] = ['present', 'half', 'off', 'leave', 'not_paid']
  if (canonical.includes(value as StaffLeaveType)) return value as StaffLeaveType
  return null
}

export function staffLeaveTypeToStatus(type: StaffLeaveType | string): StaffAttendanceStatus {
  const normalized = normalizeStaffLeaveTypeValue(type)
  return normalized ?? 'unset'
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
  if (duplicate) return 'Attendance already recorded for this date.'
  return null
}

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
    const status = staffLeaveTypeToStatus(leave.type)
    if (!isSundayDate(date) && status === 'present') return 'unset'
    if (status !== 'unset') return status
  }
  if (isSundayDate(date)) return 'off'
  return 'unset'
}

export function isAttendanceExplicitlySaved(
  data: AppData,
  staffId: string,
  date: string,
): boolean {
  const leave = findStaffLeaveOnDate(data, staffId, date)
  if (!leave) return false
  const status = staffLeaveTypeToStatus(leave.type)
  if (status === 'unset') return false
  if (!isSundayDate(date) && status === 'present') return false
  if (isSundayDate(date) && status === 'off') return false
  return true
}

export type AttendanceMenuGroup = 'day' | 'leave' | 'unpaid'

export interface AttendanceMenuItem {
  type: StaffLeaveType
  label: string
  group: AttendanceMenuGroup
}

export const ATTENDANCE_MENU_SECTIONS: { group: AttendanceMenuGroup; title: string }[] = [
  { group: 'day', title: 'Day' },
  { group: 'leave', title: 'Leave' },
  { group: 'unpaid', title: '' },
]

export const ATTENDANCE_OPTION_LABELS: Record<StaffLeaveType, string> = {
  present: 'Full Day',
  half: 'Half Day',
  off: 'Off',
  leave: 'Leave',
  not_paid: 'Unpaid',
}

export function attendanceMenuItemsForDate(date: string): AttendanceMenuItem[] {
  const items: AttendanceMenuItem[] = [
    { type: 'present', label: 'Full Day', group: 'day' },
    { type: 'half', label: 'Half Day', group: 'day' },
    { type: 'off', label: 'Off', group: 'day' },
  ]
  if (!isSundayDate(date)) {
    items.push({ type: 'leave', label: 'Leave', group: 'leave' })
  } else {
    items.push({ type: 'not_paid', label: 'Unpaid', group: 'unpaid' })
  }
  return items
}

/** Keep Sunday menus left-aligned, Saturday right-aligned, others centered. */
export function attendanceMenuPlacement(date: string): 'start' | 'center' | 'end' {
  const weekday = parseLeaveDate(date).getDay()
  if (weekday === 0) return 'start'
  if (weekday === 6) return 'end'
  return 'center'
}

export function attendanceMenuOptionLabel(item: AttendanceMenuItem): string {
  return item.label
}

export function attendanceStatusLabel(status: StaffAttendanceStatus): string {
  if (status === 'unset') return 'Unselected'
  return ATTENDANCE_OPTION_LABELS[status]
}

/** Short label for calendar day tags. */
export function calendarAttendanceTagLabel(status: StaffAttendanceStatus): string {
  if (status === 'present') return 'Full'
  if (status === 'half') return 'Half'
  if (status === 'off') return 'Off'
  if (status === 'leave') return 'Leave'
  if (status === 'not_paid') return 'Unpaid'
  return ''
}

export function attendanceCellClassSuffix(status: StaffAttendanceStatus): string {
  if (status === 'unset') return ''
  if (status === 'leave') return 'leave'
  if (status === 'not_paid') return 'not_paid'
  return status
}

export function isAttendanceMenuItemActive(
  data: AppData,
  staffId: string,
  date: string,
  status: StaffAttendanceStatus,
  menuType: StaffLeaveType,
): boolean {
  const saved = isAttendanceExplicitlySaved(data, staffId, date)

  if (!saved) {
    if (menuType === 'off' && isSundayDate(date)) return true
    return false
  }

  return status === menuType
}

export function todayIsoDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** True when the calendar date is today or already passed (local time). */
export function isAttendanceDateReached(isoDate: string, today = todayIsoDate()): boolean {
  return isoDate <= today
}

export function isRedundantStaffLeaveRecord(date: string, type: StaffLeaveType): boolean {
  if (!isSundayDate(date) && type === 'present') return true
  if (isSundayDate(date) && type === 'off') return true
  return false
}

/** Text shown under the date on the calendar cell. */
export function calendarTagForDate(
  data: AppData,
  staffId: string,
  date: string,
  status: StaffAttendanceStatus,
): string | null {
  if (isAttendanceExplicitlySaved(data, staffId, date)) {
    return calendarAttendanceTagLabel(status)
  }
  if (isSundayDate(date)) return 'Off'
  if (isAttendanceDateReached(date) && status === 'unset') return 'Full'
  return null
}

export function shouldShowAttendanceTag(
  data: AppData,
  staffId: string,
  date: string,
  status: StaffAttendanceStatus,
): boolean {
  return calendarTagForDate(data, staffId, date, status) !== null
}
