import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import { useAppPageBack } from '../hooks/useAppPageBack'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { usePageEscape } from '../hooks/usePageEscape'
import { formatDate, formatMoney, parseAmount } from '../utils/format'
import {
  buildMonthCalendarGrid,
  formatLeaveDateLabel,
  attendanceMenuItemsForDate,
  attendanceMenuOptionLabel,
  attendanceMenuPlacement,
  attendanceStatusLabel,
  calendarTagForDate,
  shouldShowAttendanceTag,
  staffAttendanceStatusForDate,
  todayIsoDate,
  weekdayLabelsForCalendar,
  type AttendanceMenuItem,
} from '../utils/staffAttendance'
import {
  buildStaffMonthSummaries,
  buildStaffOverview,
  clampStaffYear,
  currentSalaryMonth,
  formatSalaryMonthLabel,
  getStaffSalaryPayments,
  listMonthOptionsForYear,
  listSalaryMonthPickerOptions,
  parseSalaryMonth,
  salaryMonthFromDate,
  searchStaffSummaries,
  staffDefaultYear,
  STAFF_MIN_YEAR,
  type SalaryMonthKey,
} from '../utils/staffLedger'
import { printStaffSalaryReport } from '../utils/staffSalaryReport'
import './Staff.css'

export default function Staff() {
  const goBack = useAppPageBack()
  const {
    data,
    addStaff,
    updateStaff,
    removeStaff,
    setStaffAttendance,
    removeStaffLeave,
    applyStaffSalaryAdvance,
    updateExpenseStaffSalaryMonth,
  } = useCash()
  const now = new Date()
  const [year, setYear] = useState(staffDefaultYear(now))
  const [monthKey, setMonthKey] = useState<SalaryMonthKey>(currentSalaryMonth())
  const { value: query, setValue: setQuery, deferredValue: deferredQuery } = useDeferredSearch()
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSalary, setNewSalary] = useState('')
  const [editSalary, setEditSalary] = useState('')
  const [formError, setFormError] = useState('')
  const [showSalaryEdit, setShowSalaryEdit] = useState(false)
  const [pendingRemoveStaffId, setPendingRemoveStaffId] = useState<string | null>(null)
  const [inlineEditStaffId, setInlineEditStaffId] = useState<string | null>(null)
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const [editingPaymentMonth, setEditingPaymentMonth] = useState<SalaryMonthKey>(currentSalaryMonth())
  const [showAttendanceModal, setShowAttendanceModal] = useState(false)
  const [attendanceMenuDate, setAttendanceMenuDate] = useState<string | null>(null)
  const [attendanceFocusedDate, setAttendanceFocusedDate] = useState<string | null>(null)
  const [attendanceMenuHighlight, setAttendanceMenuHighlight] = useState(0)
  const [editingSalaryDays, setEditingSalaryDays] = useState(false)
  const [editSalaryDays, setEditSalaryDays] = useState('30')
  const attendanceModalRef = useRef<HTMLDivElement>(null)
  const attendanceDayButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const calendarGrid = useMemo(() => buildMonthCalendarGrid(monthKey), [monthKey])
  const weekdayLabels = useMemo(() => weekdayLabelsForCalendar(), [])
  const calendarDatesInMonth = useMemo(
    () => calendarGrid.flatMap((cell) => (cell.date ? [cell.date] : [])),
    [calendarGrid],
  )
  const calendarDateGridIndex = useMemo(() => {
    const map = new Map<string, number>()
    calendarGrid.forEach((cell, index) => {
      if (cell.date) map.set(cell.date, index)
    })
    return map
  }, [calendarGrid])

  const defaultAttendanceFocusedDate = useCallback((): string | null => {
    if (calendarDatesInMonth.length === 0) return null
    const today = todayIsoDate()
    if (today.startsWith(monthKey) && calendarDatesInMonth.includes(today)) return today
    return calendarDatesInMonth[0] ?? null
  }, [calendarDatesInMonth, monthKey])

  const focusAttendanceDate = useCallback((date: string | null) => {
    if (!date) return
    window.requestAnimationFrame(() => {
      attendanceDayButtonRefs.current[date]?.focus()
    })
  }, [])

  const monthOptions = useMemo(() => listMonthOptionsForYear(year), [year])
  const salaryMonthPickerOptions = useMemo(() => listSalaryMonthPickerOptions(), [])
  const monthSummaries = useMemo(() => buildStaffMonthSummaries(data, monthKey), [data, monthKey])
  const summaries = useMemo(
    () => searchStaffSummaries(monthSummaries, deferredQuery),
    [monthSummaries, deferredQuery],
  )
  const overview = useMemo(() => buildStaffOverview(data, monthKey), [data, monthKey])
  const selectedSummary = useMemo(
    () => summaries.find((row) => row.staffId === selectedStaffId) ?? null,
    [summaries, selectedStaffId],
  )
  const selectedPayments = useMemo(
    () => (selectedStaffId ? getStaffSalaryPayments(data, selectedStaffId, monthKey) : []),
    [data, selectedStaffId, monthKey],
  )
  const selectedAdvanceFromMonth = useMemo(() => {
    if (!selectedStaffId || !selectedSummary?.advanceIn) return null
    const row = (data.staffSalaryAdvances ?? []).find(
      (advance) => advance.staffId === selectedStaffId && advance.toMonth === monthKey,
    )
    return row ? formatSalaryMonthLabel(row.fromMonth as SalaryMonthKey) : null
  }, [data.staffSalaryAdvances, selectedStaffId, monthKey, selectedSummary?.advanceIn])

  useEffect(() => {
    setAttendanceMenuDate(null)
    setAttendanceMenuHighlight(0)
    setAttendanceFocusedDate(defaultAttendanceFocusedDate())
  }, [monthKey, selectedStaffId, defaultAttendanceFocusedDate])

  useEffect(() => {
    if (!showAttendanceModal) {
      setAttendanceMenuDate(null)
      setAttendanceMenuHighlight(0)
      setAttendanceFocusedDate(null)
      return
    }
    setAttendanceFocusedDate((current) => current ?? defaultAttendanceFocusedDate())
  }, [showAttendanceModal, defaultAttendanceFocusedDate])

  useEffect(() => {
    if (!showAttendanceModal || !attendanceFocusedDate || attendanceMenuDate) return
    focusAttendanceDate(attendanceFocusedDate)
  }, [showAttendanceModal, attendanceFocusedDate, attendanceMenuDate, focusAttendanceDate])

  useEffect(() => {
    setEditingSalaryDays(false)
    if (selectedSummary) {
      setEditSalaryDays(String(selectedSummary.salaryDaysPerMonth))
    }
  }, [selectedStaffId, selectedSummary?.salaryDaysPerMonth])

  useEffect(() => {
    if (!attendanceMenuDate || !showAttendanceModal) return
    const menuItem = attendanceModalRef.current?.querySelector(
      `[data-attendance-menu-date="${attendanceMenuDate}"] [data-attendance-menu-index="${attendanceMenuHighlight}"]`,
    ) as HTMLButtonElement | null
    menuItem?.focus()
  }, [attendanceMenuDate, attendanceMenuHighlight, showAttendanceModal])

  useEffect(() => {
    if (!showAttendanceModal) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (attendanceMenuDate) {
        event.preventDefault()
        setAttendanceMenuDate(null)
        setAttendanceMenuHighlight(0)
        focusAttendanceDate(attendanceFocusedDate ?? attendanceMenuDate)
        return
      }
      setShowAttendanceModal(false)
      setAttendanceMenuDate(null)
      setAttendanceMenuHighlight(0)
      setAttendanceFocusedDate(null)
      setFormError('')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showAttendanceModal, attendanceMenuDate, attendanceFocusedDate, focusAttendanceDate])

  function handleMonthPick(nextKey: SalaryMonthKey) {
    setMonthKey(nextKey)
    const { year: nextYear } = parseSalaryMonth(nextKey)
    setYear(clampStaffYear(nextYear))
  }

  function startEditPaymentMonth(expenseId: string, currentMonth: SalaryMonthKey) {
    setEditingPaymentId(expenseId)
    setEditingPaymentMonth(currentMonth)
    setFormError('')
  }

  function savePaymentMonth(expenseId: string) {
    if (!editingPaymentMonth) return
    updateExpenseStaffSalaryMonth(expenseId, editingPaymentMonth)
    setEditingPaymentId(null)
    setFormError('')
  }

  function handleApplyToNextMonth() {
    if (!selectedStaffId) return
    const error = applyStaffSalaryAdvance({ staffId: selectedStaffId, fromMonth: monthKey })
    setFormError(error ?? '')
  }

  function handleCreateStaff() {
    const name = newName.trim()
    const salary = parseAmount(newSalary)
    if (!name) {
      setFormError('Enter staff name.')
      return
    }
    if (!(salary >= 0)) {
      setFormError('Enter monthly salary.')
      return
    }
    const ok = addStaff({ name, monthlySalary: salary, linkExisting: true })
    if (!ok) {
      setFormError('Staff already exists or could not save.')
      return
    }
    setNewName('')
    setNewSalary('')
    setFormError('')
    setShowCreate(false)
  }

  function openSalaryEdit(staffId: string, salary: number) {
    setSelectedStaffId(staffId)
    setEditSalary(String(salary))
    setFormError('')
    setShowSalaryEdit(true)
    setInlineEditStaffId(null)
  }

  function startInlineSalaryEdit(staffId: string, salary: number) {
    setInlineEditStaffId(staffId)
    setEditSalary(String(salary))
    setFormError('')
    setShowSalaryEdit(false)
  }

  function saveInlineSalary(staffId: string) {
    const salary = parseAmount(editSalary)
    if (!(salary >= 0)) {
      setFormError('Enter a valid salary.')
      return
    }
    updateStaff(staffId, { monthlySalary: salary })
    setInlineEditStaffId(null)
    setFormError('')
  }

  function handleSaveSalary() {
    if (!selectedStaffId) return
    const salary = parseAmount(editSalary)
    if (!(salary >= 0)) {
      setFormError('Enter a valid salary.')
      return
    }
    updateStaff(selectedStaffId, { monthlySalary: salary })
    setFormError('')
    setShowSalaryEdit(false)
  }

  function saveSalaryDays() {
    if (!selectedStaffId) return
    const days = Math.round(parseAmount(editSalaryDays))
    if (!(days >= 1 && days <= 31)) {
      setFormError('Enter days between 1 and 31.')
      return
    }
    updateStaff(selectedStaffId, { salaryDaysPerMonth: days })
    setEditingSalaryDays(false)
    setFormError('')
  }

  const pendingRemoveStaff = useMemo(
    () => (data.staff ?? []).find((member) => member.id === pendingRemoveStaffId) ?? null,
    [data.staff, pendingRemoveStaffId],
  )

  function requestRemoveStaff(staffId: string | null = selectedStaffId) {
    if (!staffId) return
    setPendingRemoveStaffId(staffId)
  }

  function cancelRemoveStaff() {
    setPendingRemoveStaffId(null)
  }

  function confirmRemoveStaff() {
    if (!pendingRemoveStaffId) return
    removeStaff(pendingRemoveStaffId)
    if (selectedStaffId === pendingRemoveStaffId) {
      setSelectedStaffId(null)
      setShowSalaryEdit(false)
    }
    setPendingRemoveStaffId(null)
    setFormError('')
  }

  function handleDownloadSalaryReport() {
    printStaffSalaryReport(data, monthKey)
  }

  function closeAttendanceModal() {
    setShowAttendanceModal(false)
    setAttendanceMenuDate(null)
    setAttendanceMenuHighlight(0)
    setAttendanceFocusedDate(null)
    setFormError('')
  }

  function openAttendanceModal() {
    const initialDate = defaultAttendanceFocusedDate()
    setShowAttendanceModal(true)
    setAttendanceMenuDate(null)
    setAttendanceMenuHighlight(0)
    setAttendanceFocusedDate(initialDate)
    setFormError('')
    focusAttendanceDate(initialDate)
  }

  function openAttendanceMenuForDate(date: string) {
    setFormError('')
    setAttendanceFocusedDate(date)
    setAttendanceMenuDate(date)
    setAttendanceMenuHighlight(0)
  }

  function closeAttendanceMenu() {
    const date = attendanceMenuDate ?? attendanceFocusedDate
    setAttendanceMenuDate(null)
    setAttendanceMenuHighlight(0)
    if (date) focusAttendanceDate(date)
  }

  const moveAttendanceFocusedDate = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      if (!attendanceFocusedDate) return
      const currentIndex = calendarDateGridIndex.get(attendanceFocusedDate)
      if (currentIndex == null) return

      let nextIndex = currentIndex
      if (direction === 'left') nextIndex -= 1
      if (direction === 'right') nextIndex += 1
      if (direction === 'up') nextIndex -= 7
      if (direction === 'down') nextIndex += 7

      const nextDate = calendarGrid[nextIndex]?.date
      if (!nextDate) return

      setAttendanceFocusedDate(nextDate)
      setAttendanceMenuDate(null)
      setAttendanceMenuHighlight(0)
      focusAttendanceDate(nextDate)
    },
    [attendanceFocusedDate, calendarDateGridIndex, calendarGrid, focusAttendanceDate],
  )

  function handleAttendanceDateClick(date: string) {
    setFormError('')
    setAttendanceFocusedDate(date)
    if (attendanceMenuDate === date) {
      closeAttendanceMenu()
      return
    }
    openAttendanceMenuForDate(date)
  }

  function handleAttendancePick(date: string, type: AttendanceMenuItem['type']) {
    if (!selectedStaffId) return
    const error = setStaffAttendance({ staffId: selectedStaffId, date, type })
    if (error) {
      setFormError(error)
      return
    }
    setFormError('')
    setAttendanceMenuDate(null)
    setAttendanceMenuHighlight(0)
    focusAttendanceDate(date)
  }

  function handleCalendarDayKeyDown(
    event: React.KeyboardEvent,
    date: string,
    menuOpen: boolean,
    menuItems: AttendanceMenuItem[],
  ) {
    if (menuOpen) {
      handleAttendanceMenuKeyDown(event, date, menuItems)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAttendanceMenuForDate(date)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveAttendanceFocusedDate('left')
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveAttendanceFocusedDate('right')
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveAttendanceFocusedDate('up')
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveAttendanceFocusedDate('down')
    }
  }

  function handleAttendanceMenuKeyDown(
    event: React.KeyboardEvent,
    date: string,
    items: AttendanceMenuItem[],
  ) {
    const count = items.length
    if (count === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAttendanceMenuHighlight((index) => (index + 1) % count)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAttendanceMenuHighlight((index) => (index - 1 + count) % count)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setAttendanceMenuHighlight(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setAttendanceMenuHighlight(count - 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAttendanceMenu()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleAttendancePick(date, items[attendanceMenuHighlight]?.type ?? items[0].type)
      return
    }
    const shortcut = Number(event.key)
    if (Number.isInteger(shortcut) && shortcut >= 1 && shortcut <= count) {
      event.preventDefault()
      handleAttendancePick(date, items[shortcut - 1].type)
    }
  }

  function handleAttendanceMenuPick(
    event: React.MouseEvent,
    date: string,
    item: AttendanceMenuItem,
  ) {
    event.stopPropagation()
    event.preventDefault()
    handleAttendancePick(date, item.type)
  }

  const handlePageBack = useCallback(() => {
    if (showAttendanceModal) {
      setShowAttendanceModal(false)
      setAttendanceMenuDate(null)
      return
    }
    if (showCreate) {
      setShowCreate(false)
      setNewName('')
      setNewSalary('')
      setFormError('')
      return
    }
    if (selectedStaffId) {
      setSelectedStaffId(null)
      setShowSalaryEdit(false)
      setPendingRemoveStaffId(null)
      setInlineEditStaffId(null)
      return
    }
    goBack()
  }, [goBack, selectedStaffId, showAttendanceModal, showCreate])

  usePageEscape(handlePageBack)

  return (
    <div className="staff-page page-shell">
      <PageCorners
        left={<PageBackButton onClick={handlePageBack} ariaLabel="Back" />}
        right={
          selectedStaffId ? (
            <>
              <button
                type="button"
                className={`staff-page-corner-btn staff-page-corner-btn--attendance ${showAttendanceModal ? 'staff-page-corner-btn--active' : ''}`}
                onClick={openAttendanceModal}
              >
                <span aria-hidden="true">📅</span>
                <span>Attendance</span>
              </button>
              <button
                type="button"
                className={`staff-page-corner-btn staff-page-corner-btn--salary ${showSalaryEdit ? 'staff-page-corner-btn--active' : ''}`}
                onClick={() => {
                  if (selectedSummary) {
                    setEditSalary(String(selectedSummary.monthlySalary))
                  }
                  setShowSalaryEdit((open) => !open)
                  setFormError('')
                }}
              >
                <span aria-hidden="true">₹</span>
                <span>Salary</span>
              </button>
              <button
                type="button"
                className="staff-page-corner-btn staff-page-corner-btn--remove"
                onClick={() => requestRemoveStaff()}
              >
                <span aria-hidden="true">✕</span>
                <span>Remove</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`staff-page-corner-btn staff-page-corner-btn--add ${showCreate ? 'staff-page-corner-btn--active' : ''}`}
              onClick={() => {
                setShowCreate((open) => !open)
                setFormError('')
              }}
            >
              <span aria-hidden="true">+</span>
              <span>{showCreate ? 'Close' : 'Add staff'}</span>
            </button>
          )
        }
      />

      <header className="staff-page-head page-head--corners">
        <div className="staff-page-head-text">
          <h1>Staff & Salary</h1>
          <p>{formatSalaryMonthLabel(monthKey)} · monthly salary tracking</p>
        </div>
      </header>

      <div className="staff-page-toolbar">
        <div className="staff-page-year">
          <button
            type="button"
            disabled={year <= STAFF_MIN_YEAR}
            onClick={() => setYear((value) => clampStaffYear(value - 1))}
            aria-label="Previous year"
          >
            ‹
          </button>
          <strong>{year}</strong>
          <button
            type="button"
            onClick={() => setYear((value) => clampStaffYear(value + 1))}
            aria-label="Next year"
          >
            ›
          </button>
        </div>
        <div className="staff-page-months">
          {monthOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`staff-page-month-chip ${monthKey === option.key ? 'staff-page-month-chip--active' : ''}`}
              onClick={() => handleMonthPick(option.key)}
            >
              {option.label.split(' ')[0].slice(0, 3)}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="staff-page-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search staff"
          aria-label="Search staff"
        />
      </div>

      <div className="staff-page-summary">
        <div className="staff-page-summary-card">
          <span>Gross salary</span>
          <strong>{formatMoney(overview.totalSalary)}</strong>
          <small>{overview.staffCount} staff</small>
        </div>
        <div className="staff-page-summary-card staff-page-summary-card--leave">
          <span>Deduction</span>
          <strong>{formatMoney(overview.totalDeductions)}</strong>
          <small>{overview.totalDeductions > 0 ? 'Leave marked' : 'No leave'}</small>
        </div>
        <div className="staff-page-summary-card staff-page-summary-card--net">
          <span>Net salary</span>
          <strong>{formatMoney(overview.totalNetSalary)}</strong>
          <small>To receive this month</small>
        </div>
        <div className="staff-page-summary-card">
          <span>Paid</span>
          <strong>{formatMoney(overview.totalPaid)}</strong>
        </div>
        <div className="staff-page-summary-card staff-page-summary-card--due">
          <span>Remaining</span>
          <strong>{formatMoney(overview.totalRemaining)}</strong>
        </div>
      </div>

      <div className="staff-page-actions">
        {selectedStaffId ? (
          <button
            type="button"
            className="staff-page-btn staff-page-btn--ghost"
            onClick={() => {
              setSelectedStaffId(null)
              setShowSalaryEdit(false)
              setFormError('')
            }}
          >
            ← All staff
          </button>
        ) : null}
      </div>

      {showSalaryEdit && selectedSummary ? (
        <section className="staff-page-salary-panel">
          <div className="staff-page-salary-panel-head">
            <strong>Update salary · {selectedSummary.name}</strong>
            <button
              type="button"
              className="staff-page-salary-panel-close"
              onClick={() => {
                setShowSalaryEdit(false)
                setFormError('')
              }}
              aria-label="Close salary editor"
            >
              ✕
            </button>
          </div>
          <label>
            <span>Monthly salary</span>
            <input
              type="text"
              inputMode="decimal"
              value={editSalary}
              onChange={(e) => setEditSalary(e.target.value)}
              placeholder="Amount"
            />
          </label>
          {formError ? <p className="staff-page-error">{formError}</p> : null}
          <button type="button" className="staff-page-btn staff-page-btn--primary" onClick={handleSaveSalary}>
            Save salary
          </button>
        </section>
      ) : null}

      {showCreate ? (
        <section className="staff-page-form">
          <label>
            <span>Name</span>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Staff name" />
          </label>
          <label>
            <span>Monthly salary</span>
            <input
              type="text"
              inputMode="decimal"
              value={newSalary}
              onChange={(e) => setNewSalary(e.target.value)}
              placeholder="Amount"
            />
          </label>
          <p className="staff-page-form-note">
            Existing general expenses with the same name will link to this staff member automatically.
          </p>
          {formError ? <p className="staff-page-error">{formError}</p> : null}
          <button type="button" className="staff-page-btn staff-page-btn--primary" onClick={handleCreateStaff}>
            Save staff
          </button>
        </section>
      ) : null}

      <div className="staff-page-body">
        {!selectedStaffId ? (
          summaries.length === 0 ? (
            <p className="staff-page-empty">No staff yet. Add a staff member to track salary.</p>
          ) : (
            <>
              <div className="staff-page-list-head">
                <button
                  type="button"
                  className="staff-page-download-btn"
                  onClick={handleDownloadSalaryReport}
                >
                  Download PDF
                </button>
                <h2 className="staff-page-list-title">Salaried Staff</h2>
              </div>
            <ul className="staff-page-list">
              {summaries.map((row) => (
                <li key={row.staffId}>
                  <div className="staff-page-row-wrap">
                    <button
                      type="button"
                      className="staff-page-row"
                      onClick={() => {
                        if (inlineEditStaffId === row.staffId) return
                        setSelectedStaffId(row.staffId)
                        setEditSalary(String(row.monthlySalary))
                        setShowSalaryEdit(false)
                        setInlineEditStaffId(null)
                        setFormError('')
                      }}
                    >
                      <div className="staff-page-row-copy">
                        <strong>{row.name}</strong>
                        <small>
                          Paid {formatMoney(row.paidTotal)}
                          {row.advanceIn > 0 ? ` (incl. ${formatMoney(row.advanceIn)} prev.)` : ''}
                          {row.deductionTotal > 0
                            ? ` · Deduction −${formatMoney(row.deductionTotal)}`
                            : ' · Deduction ₹0'}
                          {` · Net ${formatMoney(row.netSalary)}`} ·{' '}
                          {row.canApplyToNextMonth
                            ? `Overpaid ${formatMoney(row.overpaidAmount)}`
                            : `Remaining ${formatMoney(row.remaining)}`}
                          {row.advanceOut > 0
                            ? ` · Applied ${formatMoney(row.advanceOut)} to ${formatSalaryMonthLabel(row.nextMonthKey)}`
                            : ''}{' '}
                          · {row.paymentCount} payment
                          {row.paymentCount === 1 ? '' : 's'}
                        </small>
                      </div>
                      {inlineEditStaffId === row.staffId ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="staff-page-row-amount-input"
                          value={editSalary}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditSalary(e.target.value)}
                          onBlur={() => saveInlineSalary(row.staffId)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveInlineSalary(row.staffId)
                            }
                            if (e.key === 'Escape') {
                              setInlineEditStaffId(null)
                            }
                          }}
                          autoFocus
                          aria-label={`Edit salary for ${row.name}`}
                        />
                      ) : (
                        <button
                          type="button"
                          className="staff-page-row-amount staff-page-row-amount--edit"
                          onClick={(e) => {
                            e.stopPropagation()
                            startInlineSalaryEdit(row.staffId, row.monthlySalary)
                          }}
                          aria-label={`Edit salary for ${row.name}`}
                        >
                          {formatMoney(row.monthlySalary)}
                        </button>
                      )}
                    </button>
                    <div className="staff-page-row-actions">
                      <button
                        type="button"
                        className="staff-page-row-action staff-page-row-action--salary"
                        aria-label={`Update salary for ${row.name}`}
                        onClick={() => openSalaryEdit(row.staffId, row.monthlySalary)}
                      >
                        ₹
                      </button>
                      <button
                        type="button"
                        className="staff-page-row-action staff-page-row-action--remove"
                        aria-label={`Remove ${row.name}`}
                        onClick={() => requestRemoveStaff(row.staffId)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            </>
          )
        ) : selectedSummary ? (
          <section className="staff-page-detail">
            <div className="staff-page-detail-head">
              <h2>{selectedSummary.name}</h2>
              <p>{formatSalaryMonthLabel(monthKey)}</p>
            </div>
            <div className="staff-page-detail-grid">
              <div>
                <span>Monthly salary</span>
                <strong>{formatMoney(selectedSummary.monthlySalary)}</strong>
              </div>
              <div>
                <span>Daily rate</span>
                <strong>{formatMoney(selectedSummary.dailyRate)}</strong>
                {editingSalaryDays ? (
                  <label className="staff-page-days-edit">
                    <span>÷</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="staff-page-days-input"
                      value={editSalaryDays}
                      onChange={(e) => setEditSalaryDays(e.target.value)}
                      onBlur={saveSalaryDays}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveSalaryDays()
                        }
                        if (e.key === 'Escape') {
                          setEditingSalaryDays(false)
                          setEditSalaryDays(String(selectedSummary.salaryDaysPerMonth))
                        }
                      }}
                      autoFocus
                      aria-label="Salary days per month"
                    />
                    <span>days</span>
                  </label>
                ) : (
                  <button
                    type="button"
                    className="staff-page-days-link"
                    onClick={() => {
                      setEditSalaryDays(String(selectedSummary.salaryDaysPerMonth))
                      setEditingSalaryDays(true)
                      setFormError('')
                    }}
                  >
                    ÷ {selectedSummary.salaryDaysPerMonth} days
                  </button>
                )}
              </div>
              <div>
                <span>Deduction</span>
                <strong>{formatMoney(selectedSummary.deductionTotal)}</strong>
                <small>
                  {selectedSummary.deductionTotal > 0
                    ? `${selectedSummary.halfDayCount} half · ${selectedSummary.notPaidCount} unpaid`
                    : 'No leave marked'}
                </small>
              </div>
              <div>
                <span>Net salary</span>
                <strong>{formatMoney(selectedSummary.netSalary)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <strong>{formatMoney(selectedSummary.paidTotal)}</strong>
                {selectedSummary.advanceIn > 0 ? (
                  <small>
                    {formatMoney(selectedSummary.expensePaid)} expenses +{' '}
                    {formatMoney(selectedSummary.advanceIn)} from {selectedAdvanceFromMonth ?? 'prev. month'}
                  </small>
                ) : selectedSummary.expensePaid !== selectedSummary.paidTotal ? (
                  <small>{formatMoney(selectedSummary.expensePaid)} from expenses</small>
                ) : null}
              </div>
              <div>
                <span>Remaining</span>
                <strong
                  className={
                    selectedSummary.remaining < 0 ? 'staff-page-remaining--overpaid' : undefined
                  }
                >
                  {formatMoney(selectedSummary.remaining)}
                </strong>
              </div>
            </div>
            {selectedSummary.canApplyToNextMonth ? (
              <div className="staff-page-overpaid">
                <p>
                  Overpaid by {formatMoney(selectedSummary.overpaidAmount)}. Apply to{' '}
                  {formatSalaryMonthLabel(selectedSummary.nextMonthKey)} so it counts as paid there.
                </p>
                <button
                  type="button"
                  className="staff-page-btn staff-page-btn--primary"
                  onClick={handleApplyToNextMonth}
                >
                  Apply {formatMoney(selectedSummary.overpaidAmount)} to next month
                </button>
              </div>
            ) : null}
            {selectedSummary.advanceOut > 0 ? (
              <p className="staff-page-advance-note">
                {formatMoney(selectedSummary.advanceOut)} applied to{' '}
                {formatSalaryMonthLabel(selectedSummary.nextMonthKey)}.
              </p>
            ) : null}
            {formError && !showSalaryEdit && !showAttendanceModal ? (
              <p className="staff-page-error">{formError}</p>
            ) : null}

            <div className="staff-page-detail-actions">
              <button type="button" className="staff-page-btn staff-page-btn--primary" onClick={openAttendanceModal}>
                Attendance
              </button>
            </div>

            <h3 className="staff-page-payments-title">Salary payments · {formatSalaryMonthLabel(monthKey)}</h3>
            {selectedPayments.length === 0 && selectedSummary.advanceIn <= 0 ? (
              <p className="staff-page-empty staff-page-empty--inline">No linked salary payments for this month.</p>
            ) : (
              <ul className="staff-page-payments">
                {selectedSummary.advanceIn > 0 ? (
                  <li className="staff-page-payment staff-page-payment--advance">
                    <div className="staff-page-payment-main">
                      <strong>From {selectedAdvanceFromMonth ?? 'previous month'}</strong>
                      <span>{formatMoney(selectedSummary.advanceIn)}</span>
                    </div>
                    <div className="staff-page-payment-meta">
                      <small>Overpaid amount applied to this month</small>
                    </div>
                  </li>
                ) : null}
                {selectedPayments.map((expense) => {
                  const countedMonth =
                    expense.staffSalaryMonth ?? salaryMonthFromDate(expense.createdAt)
                  return (
                  <li key={expense.id} className="staff-page-payment">
                    <div className="staff-page-payment-main">
                      <strong>{expense.name}</strong>
                      <span>{formatMoney(expense.amount)}</span>
                    </div>
                    <div className="staff-page-payment-meta">
                      <small>
                        Paid {formatDate(expense.createdAt)} · {expense.payType}
                      </small>
                      {editingPaymentId === expense.id ? (
                        <label className="staff-page-payment-month-edit">
                          <span>Salary month</span>
                          <select
                            value={editingPaymentMonth}
                            onChange={(e) => setEditingPaymentMonth(e.target.value)}
                            autoFocus
                          >
                            {salaryMonthPickerOptions.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <div className="staff-page-payment-month-actions">
                            <button
                              type="button"
                              className="staff-page-btn staff-page-btn--primary"
                              onClick={() => savePaymentMonth(expense.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="staff-page-btn staff-page-btn--ghost"
                              onClick={() => setEditingPaymentId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </label>
                      ) : (
                        <button
                          type="button"
                          className="staff-page-payment-month-btn"
                          onClick={() => startEditPaymentMonth(expense.id, countedMonth)}
                        >
                          Counted for {formatSalaryMonthLabel(countedMonth)} · Edit month
                        </button>
                      )}
                    </div>
                  </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {showAttendanceModal && selectedSummary && selectedStaffId ? (
        <div
          className="staff-attendance-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-attendance-title"
        >
          <button
            type="button"
            className="staff-attendance-backdrop"
            aria-label="Close attendance"
            onClick={closeAttendanceModal}
          />
          <div ref={attendanceModalRef} className="staff-attendance-panel">
            <div className="staff-attendance-panel-head">
              <div>
                <h2 id="staff-attendance-title">Attendance</h2>
                <p>
                  {selectedSummary.name} · {formatSalaryMonthLabel(monthKey)}
                </p>
              </div>
              <button
                type="button"
                className="staff-attendance-panel-close"
                aria-label="Close attendance"
                onClick={closeAttendanceModal}
              >
                ✕
              </button>
            </div>

            <p className="staff-attendance-panel-note">
              Arrow keys move the selected date. Enter opens the menu. Esc closes the menu. In the
              menu use ↑↓ or 1–4, then Enter to pick.
            </p>

            {formError ? <p className="staff-page-error staff-page-error--modal">{formError}</p> : null}

            <div className="staff-attendance-calendar">
              <div className="staff-attendance-calendar-weekdays">
                {weekdayLabels.map((label) => (
                  <span key={label} className="staff-attendance-calendar-weekday">
                    {label}
                  </span>
                ))}
              </div>
              <div className="staff-attendance-calendar-grid">
                {calendarGrid.map((cell, index) => {
                  if (!cell.date || cell.day == null) {
                    return (
                      <div
                        key={`pad-${index}`}
                        className="staff-attendance-calendar-cell staff-attendance-calendar-cell--empty"
                        aria-hidden="true"
                      />
                    )
                  }

                  const status = staffAttendanceStatusForDate(data, selectedStaffId, cell.date)
                  const menuOpen = attendanceMenuDate === cell.date
                  const dateFocused = attendanceFocusedDate === cell.date
                  const menuItems = attendanceMenuItemsForDate(cell.date!)
                  const menuPlacement = attendanceMenuPlacement(cell.date!)

                  return (
                    <div
                      key={cell.date}
                      className={`staff-attendance-calendar-cell ${dateFocused ? 'staff-attendance-calendar-cell--focused' : ''} ${menuOpen ? 'staff-attendance-calendar-cell--menu-open' : ''}`}
                    >
                      <button
                        type="button"
                        className="staff-attendance-calendar-day"
                        ref={(node) => {
                          attendanceDayButtonRefs.current[cell.date!] = node
                        }}
                        onClick={() => handleAttendanceDateClick(cell.date!)}
                        onKeyDown={(event) =>
                          handleCalendarDayKeyDown(event, cell.date!, menuOpen, menuItems)
                        }
                        aria-expanded={menuOpen}
                        aria-haspopup="menu"
                        aria-controls={menuOpen ? `staff-attendance-menu-${cell.date}` : undefined}
                        tabIndex={dateFocused ? 0 : -1}
                      >
                        <span className="staff-attendance-calendar-day-num">{cell.day}</span>
                        {shouldShowAttendanceTag(data, selectedStaffId, cell.date!, status) ? (
                          <span className="staff-attendance-calendar-day-tag">
                            {calendarTagForDate(data, selectedStaffId, cell.date!, status)}
                          </span>
                        ) : null}
                      </button>
                      {menuOpen ? (
                        <ul
                          id={`staff-attendance-menu-${cell.date}`}
                          data-attendance-menu-date={cell.date}
                          className={`staff-attendance-menu staff-attendance-menu--${menuPlacement}`}
                          role="menu"
                          aria-label={`Attendance options for ${cell.date}`}
                          onMouseDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) =>
                            handleAttendanceMenuKeyDown(event, cell.date!, menuItems)
                          }
                        >
                          {menuItems.map((item, itemIndex) => (
                            <li key={item.type} role="none">
                              <button
                                type="button"
                                role="menuitem"
                                data-attendance-menu-index={itemIndex}
                                tabIndex={itemIndex === attendanceMenuHighlight ? 0 : -1}
                                className={`staff-attendance-menu-item ${itemIndex === attendanceMenuHighlight ? 'staff-attendance-menu-item--highlight' : ''}`}
                                aria-label={`${attendanceMenuOptionLabel(item)}, press ${itemIndex + 1}`}
                                onMouseEnter={() => setAttendanceMenuHighlight(itemIndex)}
                                onClick={(event) =>
                                  handleAttendanceMenuPick(event, cell.date!, item)
                                }
                              >
                                <span>{attendanceMenuOptionLabel(item)}</span>
                                <span className="staff-attendance-menu-shortcut" aria-hidden="true">
                                  {itemIndex + 1}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="staff-attendance-summary">
              <div>
                <span>Deduction</span>
                <strong>{formatMoney(selectedSummary.deductionTotal)}</strong>
              </div>
              <div>
                <span>Net salary</span>
                <strong>{formatMoney(selectedSummary.netSalary)}</strong>
              </div>
            </div>

            {selectedSummary.attendance.length === 0 ? (
              <p className="staff-page-empty staff-page-empty--inline">
                No deductions this month. Mark Leave, Half Day, or Unpaid (Sunday) to deduct.
              </p>
            ) : (
              <>
                <h3 className="staff-page-payments-title">Leave deductions</h3>
              <ul className="staff-page-leave-list staff-page-leave-list--modal">
                {selectedSummary.attendance.map((row) => (
                  <li key={row.leaveId} className="staff-page-leave-row">
                    <div className="staff-page-leave-row-main">
                      <strong>{formatLeaveDateLabel(row.date)}</strong>
                      <span>{attendanceStatusLabel(row.status)}</span>
                    </div>
                    <div className="staff-page-leave-row-meta">
                      <span>−{formatMoney(row.dayDeduction)}</span>
                      <button
                        type="button"
                        className="staff-page-leave-remove"
                        aria-label={`Remove attendance on ${row.date}`}
                        onClick={() => removeStaffLeave(row.leaveId)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              </>
            )}

            <div className="staff-attendance-panel-actions">
              <button type="button" className="staff-page-btn staff-page-btn--ghost" onClick={closeAttendanceModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingRemoveStaff ? (
        <div className="staff-remove-overlay" role="dialog" aria-modal="true" aria-labelledby="staff-remove-title">
          <button
            type="button"
            className="staff-remove-backdrop"
            aria-label="Cancel remove staff"
            onClick={cancelRemoveStaff}
          />
          <div className="staff-remove-panel">
            <h2 id="staff-remove-title" className="staff-remove-title">
              Remove staff?
            </h2>
            <p className="staff-remove-copy">
              Remove <strong>{pendingRemoveStaff.name}</strong> from the staff list? Their payments stay in
              expense history as normal expenses and will no longer count toward salary.
            </p>
            <div className="staff-remove-actions">
              <button type="button" className="staff-page-btn staff-page-btn--ghost" onClick={cancelRemoveStaff}>
                Cancel
              </button>
              <button type="button" className="staff-page-btn staff-page-btn--danger" onClick={confirmRemoveStaff}>
                Yes, remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
