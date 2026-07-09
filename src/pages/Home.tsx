import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount, formatDate } from '../utils/format'
import { applyNumpadAction, applyPinAction, normalizePin, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import type { ExpensePayType, TransferDirection } from '../types'
import {
  buildHistoryItems,
  getHistoryTypeLabel,
  matchesHistorySearch,
  type HistoryFilter,
  type HistoryItemType,
} from '../utils/historyItems'
import {
  buildSalesBillList,
  buildSalesReport,
  formatSalesBreakdown,
  getTodaySalesSummary,
  summarizeSales,
  toInputDate,
  type ReportPeriod,
  type ReportSort,
  type SaleDateMode,
} from '../utils/salesReport'
import './Home.css'

const DEFAULT_PIN = '0000'

type PanelField = 'note' | 'amount'

export default function Home() {
  const { balance, bankBalance, data, recordExpense, recordTransfer, removeSale, removeExpense } =
    useCash()
  const [unlocked, setUnlocked] = useState(false)
  const [pinStr, setPinStr] = useState('')
  const [pinError, setPinError] = useState(false)
  const [addTarget, setAddTarget] = useState<ExpensePayType | null>(null)
  const [transferDirection, setTransferDirection] = useState<TransferDirection | null>(null)
  const [panelNote, setPanelNote] = useState('')
  const [panelAmountStr, setPanelAmountStr] = useState('')
  const [panelField, setPanelField] = useState<PanelField>('note')
  const [panelSaved, setPanelSaved] = useState(false)
  const [panelError, setPanelError] = useState('')
  const [showDeleteRecords, setShowDeleteRecords] = useState(false)
  const [showSalesReport, setShowSalesReport] = useState(false)
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('day')
  const [reportSort, setReportSort] = useState<ReportSort>('date-desc')
  const [reportDateMode, setReportDateMode] = useState<SaleDateMode>('collected')
  const [reportFromDate, setReportFromDate] = useState('')
  const [reportToDate, setReportToDate] = useState('')
  const [reportView, setReportView] = useState<'summary' | 'bills'>('summary')
  const [deleteRecordSearch, setDeleteRecordSearch] = useState('')
  const [deleteRecordFilter, setDeleteRecordFilter] = useState<HistoryFilter>('all')
  const noteInputRef = useRef<HTMLInputElement>(null)

  const homePin = normalizePin(data.homePin, DEFAULT_PIN)
  const panelAmount = parseAmount(panelAmountStr)
  const panelNoteValid = panelNote.trim().length > 0
  const panelAmountValid = panelAmount > 0

  const transferSourceBalance =
    transferDirection === 'cash-to-bank'
      ? balance
      : transferDirection === 'bank-to-cash'
        ? bankBalance
        : 0

  const hasEnoughForTransfer =
    !transferDirection || !panelAmountValid || panelAmount <= transferSourceBalance

  const panelValid =
    panelNoteValid &&
    panelAmountValid &&
    (transferDirection ? hasEnoughForTransfer : true)

  useEffect(() => {
    return () => {
      setUnlocked(false)
      setPinStr('')
    }
  }, [])

  useEffect(() => {
    if (addTarget || transferDirection) noteInputRef.current?.focus()
  }, [addTarget, transferDirection])

  const today = new Date().toDateString()
  const todaySalesSummary = useMemo(() => getTodaySalesSummary(data), [data])
  const todayExpenses = data.expenses.filter(
    (e) => new Date(e.createdAt).toDateString() === today && e.kind === 'expense',
  )
  const todayExpensesTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0)

  const reportFilter = useMemo(
    () => ({
      fromDate: reportFromDate || undefined,
      toDate: reportToDate || undefined,
      dateMode: reportDateMode,
    }),
    [reportFromDate, reportToDate, reportDateMode],
  )

  const salesReportRows = useMemo(
    () => buildSalesReport(data, reportPeriod, reportSort, reportFilter),
    [data, reportPeriod, reportSort, reportFilter],
  )

  const salesBillRows = useMemo(
    () => buildSalesBillList(data, reportSort, reportFilter),
    [data, reportSort, reportFilter],
  )

  const reportTotals = useMemo(() => {
    if (reportView === 'bills') {
      return {
        billCount: salesBillRows.length,
        totalBills: salesBillRows.reduce((sum, row) => sum + row.billAmount, 0),
        cashTotal: salesBillRows.reduce((sum, row) => sum + row.cashTotal, 0),
        bankTotal: salesBillRows.reduce((sum, row) => sum + row.bankTotal, 0),
      }
    }
    return summarizeSales(salesReportRows)
  }, [reportView, salesBillRows, salesReportRows])

  function openSalesReport() {
    const today = toInputDate()
    setReportFromDate(today)
    setReportToDate(today)
    setReportDateMode('collected')
    setReportView('summary')
    setReportPeriod('day')
    setReportSort('date-desc')
    setShowSalesReport(true)
  }

  function setReportRange(from: string, to: string) {
    setReportFromDate(from)
    setReportToDate(to)
  }

  const recordsForDelete = useMemo(() => {
    return buildHistoryItems(data)
      .filter((item) => deleteRecordFilter === 'all' || item.type === deleteRecordFilter)
      .filter((item) => matchesHistorySearch(item, deleteRecordSearch))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [data, deleteRecordFilter, deleteRecordSearch])

  function handleDeleteRecord(type: HistoryItemType, id: string) {
    if (!confirm('Delete this record? Balances will be updated.')) return
    if (type === 'sale') removeSale(id)
    else removeExpense(id)
  }

  function tryUnlock(nextPin: string) {
    if (nextPin === homePin) {
      setUnlocked(true)
      setPinStr('')
      setPinError(false)
      return
    }
    setPinError(true)
    setPinStr('')
  }

  function handlePinNumpad(action: NumpadAction) {
    if (action === 'enter') {
      if (pinStr.length === 4) tryUnlock(pinStr)
      return
    }
    if (action === 'clear') {
      setPinStr('')
      setPinError(false)
      return
    }

    const next = applyPinAction(pinStr, action)
    setPinStr(next)
    setPinError(false)
    if (next.length === 4) tryUnlock(next)
  }

  function resetPanel() {
    setPanelNote('')
    setPanelAmountStr('')
    setPanelField('note')
    setPanelSaved(false)
    setPanelError('')
  }

  function openAdd(target: ExpensePayType) {
    setTransferDirection(null)
    setAddTarget(target)
    resetPanel()
  }

  function openTransfer(direction: TransferDirection) {
    setAddTarget(null)
    setTransferDirection(direction)
    resetPanel()
  }

  function closePanel() {
    setAddTarget(null)
    setTransferDirection(null)
    resetPanel()
  }

  function handlePanelSave() {
    if (!panelValid || panelSaved) return

    if (transferDirection) {
      if (!hasEnoughForTransfer) {
        setPanelError(
          transferDirection === 'cash-to-bank'
            ? 'Not enough cash in drawer.'
            : 'Not enough bank balance.',
        )
        return
      }
      recordTransfer({
        amount: panelAmount,
        name: panelNote.trim(),
        direction: transferDirection,
      })
    } else if (addTarget) {
      recordExpense({
        amount: panelAmount,
        name: panelNote.trim(),
        payType: addTarget,
        kind: 'add',
      })
    } else {
      return
    }

    setPanelSaved(true)
    setTimeout(closePanel, 700)
  }

  function handlePanelNumpad(action: NumpadAction) {
    if (action === 'enter') {
      setPanelField((f) => (f === 'note' ? 'amount' : 'note'))
      return
    }
    if (panelField === 'amount') {
      setPanelAmountStr((prev) => applyNumpadAction(prev, action))
      setPanelError('')
    }
  }

  const pinHandlerRef = useRef(handlePinNumpad)
  pinHandlerRef.current = handlePinNumpad
  const panelHandlerRef = useRef(handlePanelNumpad)
  panelHandlerRef.current = handlePanelNumpad
  const panelOpen = addTarget !== null || transferDirection !== null

  useNumpadKeyboard(
    (action) => {
      if (!unlocked) pinHandlerRef.current(action)
      else if (panelOpen && !panelSaved) panelHandlerRef.current(action)
    },
    !unlocked || (panelOpen && !panelSaved),
  )

  const panelTitle = transferDirection
    ? transferDirection === 'cash-to-bank'
      ? 'Cash → Bank Transfer'
      : 'Bank → Cash Transfer'
    : addTarget === 'bank'
      ? 'Add to Bank'
      : 'Add to Counter'

  const panelAmountLabel = transferDirection ? 'Transfer Amount' : 'Amount to Add'

  const panelSaveLabel = panelSaved
    ? '✓ Saved'
    : transferDirection
      ? 'Transfer'
      : addTarget === 'bank'
        ? 'Add to Bank'
        : 'Add to Counter'

  const cards = [
    {
      to: '/counter',
      title: 'Cash Counter',
      desc: 'Bill amount, customer pay & return change',
      icon: '💵',
      color: 'green',
    },
    {
      to: '/expenses',
      title: 'Expenses',
      desc: 'Record cash or bank expenses',
      icon: '📤',
      color: 'orange',
    },
    {
      to: '/history',
      title: 'History',
      desc: 'Search, filter & sort records',
      icon: '📋',
      color: 'blue',
    },
    {
      to: '/settings',
      title: 'Settings',
      desc: 'Opening balances & home PIN',
      icon: '⚙️',
      color: 'gray',
    },
  ]

  if (!unlocked) {
    return (
      <div className="home home--locked">
        <section className="home-pin">
          <p className="home-pin-label">Enter 4-digit PIN</p>
          <div className={`home-pin-dots ${pinError ? 'home-pin-dots--error' : ''}`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`home-pin-dot ${pinStr.length > i ? 'home-pin-dot--filled' : ''}`}
              />
            ))}
          </div>
          {pinError && <p className="home-pin-error">Wrong PIN. Try again.</p>}
          <div className="home-pin-keyboard">
            <NumberKeyboard onPress={handlePinNumpad} showEnter={false} />
          </div>
          <p className="home-pin-hint">Default PIN: 0000 — change in Settings</p>
        </section>
      </div>
    )
  }

  return (
    <div className="home">
      <section className="home-balances">
        <div className="home-balance-row">
          <div className="home-balance-card">
            <div className="home-balance-head">
              <p className="home-hero-label">💵 Cash in Drawer</p>
              <button type="button" className="home-add-btn" onClick={() => openAdd('cash')}>
                + Add
              </button>
            </div>
            <BigAmount label="" value={balance} variant="primary" size="lg" />
          </div>
          <div className="home-balance-card home-balance-card--bank">
            <div className="home-balance-head">
              <p className="home-hero-label">🏦 Bank Balance</p>
              <button type="button" className="home-add-btn" onClick={() => openAdd('bank')}>
                + Add
              </button>
            </div>
            <BigAmount label="" value={bankBalance} variant="primary" size="lg" />
          </div>
        </div>

        <div className="home-transfers">
          <button
            type="button"
            className="home-transfer-btn"
            onClick={() => openTransfer('cash-to-bank')}
          >
            💵 → 🏦 Cash to Bank
          </button>
          <button
            type="button"
            className="home-transfer-btn"
            onClick={() => openTransfer('bank-to-cash')}
          >
            🏦 → 💵 Bank to Cash
          </button>
          <button
            type="button"
            className="home-transfer-btn home-transfer-btn--delete"
            onClick={() => {
              closePanel()
              setDeleteRecordSearch('')
              setDeleteRecordFilter('all')
              setShowDeleteRecords(true)
            }}
          >
            🗑 Delete
          </button>
        </div>
      </section>

      <section className="home-stats">
        <button
          type="button"
          className="stat-card stat-card--action"
          onClick={openSalesReport}
        >
          <span className="stat-label">Today Sales</span>
          <span className="stat-value stat-value--green">
            {formatMoney(todaySalesSummary.totalBills)}
          </span>
          <span className="stat-meta stat-meta--breakdown">
            {formatSalesBreakdown(todaySalesSummary.cashTotal, todaySalesSummary.bankTotal)}
          </span>
          <span className="stat-meta">
            {todaySalesSummary.billCount} bills · Report →
          </span>
        </button>
        <div className="stat-card">
          <span className="stat-label">Today Expenses</span>
          <span className="stat-value stat-value--orange">{formatMoney(todayExpensesTotal)}</span>
          <span className="stat-meta">{todayExpenses.length} items</span>
        </div>
      </section>

      <section className="home-grid">
        {cards.map((card) => (
          <Link key={card.to} to={card.to} className={`home-card home-card--${card.color}`}>
            <span className="home-card-icon">{card.icon}</span>
            <div className="home-card-text">
              <h2>{card.title}</h2>
              <p>{card.desc}</p>
            </div>
            <span className="home-card-arrow">→</span>
          </Link>
        ))}
      </section>

      {showSalesReport && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel home-report-panel">
            <div className="home-add-panel-head">
              <h3>Sales Report</h3>
              <button
                type="button"
                className="home-add-close"
                onClick={() => setShowSalesReport(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="home-report-summary">
              <div className="home-report-summary-item">
                <span>Total Bills</span>
                <strong>{formatMoney(reportTotals.totalBills)}</strong>
              </div>
              <div className="home-report-summary-item">
                <span>💵 Cash</span>
                <strong>{formatMoney(reportTotals.cashTotal)}</strong>
              </div>
              <div className="home-report-summary-item">
                <span>🏦 Bank</span>
                <strong>{formatMoney(reportTotals.bankTotal)}</strong>
              </div>
              <div className="home-report-summary-item">
                <span>Bills</span>
                <strong>{reportTotals.billCount}</strong>
              </div>
            </div>

            <div className="home-report-dates">
              <label className="home-report-date-field">
                <span>From</span>
                <input
                  type="date"
                  value={reportFromDate}
                  onChange={(e) => setReportFromDate(e.target.value)}
                />
              </label>
              <label className="home-report-date-field">
                <span>To</span>
                <input
                  type="date"
                  value={reportToDate}
                  min={reportFromDate || undefined}
                  onChange={(e) => setReportToDate(e.target.value)}
                />
              </label>
            </div>

            <div className="home-delete-filters">
              {(
                [
                  ['today', 'Today'],
                  ['week', '7 Days'],
                  ['month', 'This Month'],
                  ['all', 'All'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="home-delete-chip"
                  onClick={() => {
                    const today = toInputDate()
                    if (id === 'today') setReportRange(today, today)
                    else if (id === 'week') {
                      const start = new Date()
                      start.setDate(start.getDate() - 6)
                      setReportRange(toInputDate(start), today)
                    } else if (id === 'month') {
                      const start = new Date()
                      start.setDate(1)
                      setReportRange(toInputDate(start), today)
                    } else setReportRange('', '')
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="home-delete-filters">
              {(
                [
                  ['collected', 'Sale Take'],
                  ['created', 'Bill Created'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`home-delete-chip ${reportDateMode === id ? 'home-delete-chip--active' : ''}`}
                  onClick={() => setReportDateMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="home-delete-filters">
              {(
                [
                  ['summary', 'By Period'],
                  ['bills', 'Each Bill'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`home-delete-chip ${reportView === id ? 'home-delete-chip--active' : ''}`}
                  onClick={() => setReportView(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="home-delete-filters">
              {(
                [
                  ['day', 'Day'],
                  ['week', 'Week'],
                  ['month', 'Month'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`home-delete-chip ${reportPeriod === id ? 'home-delete-chip--active' : ''}`}
                  onClick={() => setReportPeriod(id)}
                  disabled={reportView === 'bills'}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="home-delete-filters">
              {(
                [
                  ['date-desc', 'By Date ↓'],
                  ['date-asc', 'By Date ↑'],
                  ['amount-desc', 'Amount ↓'],
                  ['amount-asc', 'Amount ↑'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`home-delete-chip ${reportSort === id ? 'home-delete-chip--active' : ''}`}
                  onClick={() => setReportSort(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {reportView === 'summary' ? (
              salesReportRows.length === 0 ? (
                <p className="home-delete-empty">No sales in this date range.</p>
              ) : (
                <ul className="home-report-list">
                  {salesReportRows.map((row) => (
                    <li key={row.key} className="home-report-item">
                      <div className="home-report-item-head">
                        <span className="home-report-period">{row.label}</span>
                        <span className="home-report-total">{formatMoney(row.totalBills)}</span>
                      </div>
                      <div className="home-report-item-meta">
                        <span>{formatSalesBreakdown(row.cashTotal, row.bankTotal)}</span>
                        <span>{row.billCount} bills</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : salesBillRows.length === 0 ? (
              <p className="home-delete-empty">No sales in this date range.</p>
            ) : (
              <ul className="home-report-list">
                {salesBillRows.map((row) => (
                  <li key={row.id} className="home-report-item">
                    <div className="home-report-item-head">
                      <span className="home-report-period">
                        {row.customerName || 'Bill'} · {row.dateLabel}
                      </span>
                      <span className="home-report-total">{formatMoney(row.billAmount)}</span>
                    </div>
                    <div className="home-report-item-meta">
                      <span>{formatSalesBreakdown(row.cashTotal, row.bankTotal)}</span>
                      <span>{row.payLabel}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showDeleteRecords && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel home-delete-panel">
            <div className="home-add-panel-head">
              <h3>Delete History</h3>
              <button
                type="button"
                className="home-add-close"
                onClick={() => setShowDeleteRecords(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <input
              type="search"
              className="home-delete-search"
              value={deleteRecordSearch}
              onChange={(e) => setDeleteRecordSearch(e.target.value)}
              placeholder="Search bills, expenses, notes, amount…"
              autoComplete="off"
            />

            <div className="home-delete-filters">
              {(
                [
                  ['all', 'All'],
                  ['sale', 'Bills'],
                  ['expense', 'Expenses'],
                  ['deposit', 'Added'],
                  ['transfer', 'Transfer'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`home-delete-chip ${deleteRecordFilter === id ? 'home-delete-chip--active' : ''}`}
                  onClick={() => setDeleteRecordFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {recordsForDelete.length === 0 ? (
              <p className="home-delete-empty">No records found.</p>
            ) : (
              <ul className="home-delete-list">
                {recordsForDelete.map((item) => (
                  <li key={item.id} className="home-delete-item">
                    <div className="home-delete-info">
                      <div className="home-delete-top">
                        <span className="home-delete-type">{getHistoryTypeLabel(item.type)}</span>
                        <span className="home-delete-amount">{formatMoney(item.amount)}</span>
                      </div>
                      <span className="home-delete-meta">
                        {item.name ? `${item.name} · ` : ''}
                        {item.sub} · {formatDate(item.date)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="home-delete-btn"
                      onClick={() => handleDeleteRecord(item.type, item.id)}
                      aria-label="Delete record"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel">
            <div className="home-add-panel-head">
              <h3>{panelTitle}</h3>
              <button type="button" className="home-add-close" onClick={closePanel} aria-label="Close">
                ✕
              </button>
            </div>

            {transferDirection && (
              <p className="home-panel-available">
                Available: {formatMoney(transferSourceBalance)}
              </p>
            )}

            <label className="home-add-note">
              <span className="home-add-note-label">Note</span>
              <input
                ref={noteInputRef}
                type="text"
                className={`home-add-note-input ${panelField === 'note' ? 'home-add-note-input--active' : ''}`}
                value={panelNote}
                onChange={(e) => setPanelNote(e.target.value)}
                onFocus={() => setPanelField('note')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    setPanelField('amount')
                  }
                }}
                placeholder={
                  transferDirection
                    ? 'Required — e.g. Deposit to bank, Withdraw cash'
                    : 'Required — e.g. Opening cash, Bank deposit'
                }
                autoComplete="off"
              />
            </label>

            <AmountDisplay
              label={panelAmountLabel}
              value={panelAmountStr}
              active={panelField === 'amount'}
              onSelect={() => setPanelField('amount')}
              compact
            />

            {panelError && <p className="home-panel-error">{panelError}</p>}

            <div className="home-add-keyboard">
              <NumberKeyboard onPress={handlePanelNumpad} />
            </div>

            <div className="home-add-actions">
              <button type="button" className="btn btn-secondary" onClick={closePanel}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${transferDirection ? 'btn-primary' : 'btn-success'} ${panelSaved ? 'btn-saved' : ''}`}
                onClick={handlePanelSave}
                disabled={!panelValid || panelSaved}
              >
                {panelSaveLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
