import { useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import { formatDate, formatMoney, parseAmount } from '../utils/format'
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
import './Staff.css'

export default function Staff() {
  const { data, addStaff, updateStaff, removeStaff, updateExpenseStaffSalaryMonth } = useCash()
  const now = new Date()
  const [year, setYear] = useState(staffDefaultYear(now))
  const [monthKey, setMonthKey] = useState<SalaryMonthKey>(currentSalaryMonth())
  const [query, setQuery] = useState('')
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

  const monthOptions = useMemo(() => listMonthOptionsForYear(year), [year])
  const salaryMonthPickerOptions = useMemo(() => listSalaryMonthPickerOptions(), [])
  const summaries = useMemo(
    () => searchStaffSummaries(buildStaffMonthSummaries(data, monthKey), query),
    [data, monthKey, query],
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

  return (
    <div className="staff-page page-shell">
      <PageCorners
        left={<PageBackButton to="/" />}
        right={
          selectedStaffId ? (
            <>
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
          <span>Total salary</span>
          <strong>{formatMoney(overview.totalSalary)}</strong>
          <small>{overview.staffCount} staff</small>
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
                          Paid {formatMoney(row.paidTotal)} · Remaining {formatMoney(row.remaining)} ·{' '}
                          {row.paymentCount} payment{row.paymentCount === 1 ? '' : 's'}
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
                <span>Paid</span>
                <strong>{formatMoney(selectedSummary.paidTotal)}</strong>
              </div>
              <div>
                <span>Remaining</span>
                <strong>{formatMoney(selectedSummary.remaining)}</strong>
              </div>
            </div>
            {formError && !showSalaryEdit ? <p className="staff-page-error">{formError}</p> : null}
            <h3 className="staff-page-payments-title">Salary payments · {formatSalaryMonthLabel(monthKey)}</h3>
            {selectedPayments.length === 0 ? (
              <p className="staff-page-empty staff-page-empty--inline">No linked salary payments for this month.</p>
            ) : (
              <ul className="staff-page-payments">
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
