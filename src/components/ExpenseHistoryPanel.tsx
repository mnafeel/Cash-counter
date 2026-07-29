import { useMemo, useState } from 'react'
import type { AppData } from '../types'
import { NO1_EXPENSE_LABEL } from '../utils/expenseBillLabels'
import { downloadExpenseAndNo1PurchaseSpreadsheet, filterNo1PurchaseItems } from '../utils/expenseRangeExport'
import { formatDate, formatMoney, formatTime } from '../utils/format'
import {
  buildExpenseTimelineEntries,
  expenseTimelineKindLabel,
  summarizeExpenseTimeline,
  type ExpenseTimelineKind,
  type ExpenseTimelineSort,
} from '../utils/expenseTimeline'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
} from '../utils/normalExpenseHistory'
import { buildPurchaseHistoryItems, filterPurchaseHistoryItems } from '../utils/purchaseHistory'
import { toInputDate } from '../utils/salesReport'
import './PurchaseHistoryPanel.css'

interface ExpenseHistoryPanelProps {
  open: boolean
  onClose: () => void
  data: AppData
}

const SORT_OPTIONS: { id: ExpenseTimelineSort; label: string }[] = [
  { id: 'time-desc', label: 'Latest first' },
  { id: 'time-asc', label: 'Oldest first' },
]

function expensePeriodLabel(fromDate: string, toDate: string): string {
  if (!fromDate && !toDate) return 'All'
  if (fromDate === toDate || !toDate) return formatDate(fromDate || toDate)
  return `${formatDate(fromDate)} – ${formatDate(toDate)}`
}

function timelineIcon(kind: ExpenseTimelineKind): string {
  if (kind === 'expense') return '📤'
  if (kind === 'no1-purchase') return '🧾'
  return '🛒'
}

export default function ExpenseHistoryPanel({ open, onClose, data }: ExpenseHistoryPanelProps) {
  const [rangeFrom, setRangeFrom] = useState(() => toInputDate())
  const [rangeTo, setRangeTo] = useState(() => toInputDate())
  const [sort, setSort] = useState<ExpenseTimelineSort>('time-desc')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState('')

  const normalItems = useMemo(
    () => filterNormalExpenseHistoryItems(buildNormalExpenseHistoryItems(data), 'range', rangeFrom, rangeTo),
    [data, rangeFrom, rangeTo],
  )
  const purchaseItems = useMemo(
    () => filterPurchaseHistoryItems(buildPurchaseHistoryItems(data), 'range', rangeFrom, rangeTo),
    [data, rangeFrom, rangeTo],
  )
  const no1PurchaseItems = useMemo(
    () => filterNo1PurchaseItems(purchaseItems),
    [purchaseItems],
  )
  const timeline = useMemo(
    () => buildExpenseTimelineEntries(normalItems, no1PurchaseItems, sort),
    [normalItems, no1PurchaseItems, sort],
  )
  const summary = useMemo(() => summarizeExpenseTimeline(timeline), [timeline])
  const periodLabel = expensePeriodLabel(rangeFrom, rangeTo)

  if (!open) return null

  function handleClose() {
    setExpandedKey(null)
    setExportStatus('')
    onClose()
  }

  function setPreset(fromDate: string, toDate: string) {
    setRangeFrom(fromDate)
    setRangeTo(toDate)
  }

  function setToday() {
    const today = toInputDate()
    setPreset(today, today)
  }

  function setYesterday() {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const d = toInputDate(y)
    setPreset(d, d)
  }

  function setThisWeek() {
    const today = toInputDate()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    setPreset(toInputDate(start), today)
  }

  function handleDownloadSpreadsheet() {
    if (!rangeFrom || !rangeTo) {
      setExportStatus('Pick from and to dates first')
      return
    }
    const filenameLabel = periodLabel.replace(/\s+/g, '-').toLowerCase()
    downloadExpenseAndNo1PurchaseSpreadsheet(
      normalItems,
      purchaseItems,
      periodLabel,
      `cash-counter-expenses-${filenameLabel}`,
      sort === 'time-desc' ? 'time-desc' : 'time-asc',
    )
    setExportStatus(
      `Excel downloaded · ${normalItems.length} expenses · ${no1PurchaseItems.length} No 1 purchases`,
    )
  }

  const today = toInputDate()
  const yesterday = (() => {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    return toInputDate(y)
  })()

  return (
    <div className="purchase-hist-overlay" role="dialog" aria-modal="true">
      <div className="purchase-hist-panel">
        <div className="purchase-hist-head">
          <h3>Expense History</h3>
          <button type="button" className="purchase-hist-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="purchase-hist-range-section">
          <span className="purchase-hist-range-title">From date → To date</span>
          <div className="purchase-hist-range-pick purchase-hist-range-pick--primary">
            <label className="purchase-hist-date-pick">
              <span>From</span>
              <input
                type="date"
                className="purchase-hist-date-input purchase-hist-date-input--active"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                aria-label="Expense from date"
              />
            </label>
            <label className="purchase-hist-date-pick">
              <span>To</span>
              <input
                type="date"
                className="purchase-hist-date-input purchase-hist-date-input--active"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                aria-label="Expense to date"
              />
            </label>
          </div>
          <div className="purchase-hist-dates">
            <button
              type="button"
              className={`purchase-hist-date-chip ${rangeFrom === today && rangeTo === today ? 'purchase-hist-date-chip--active' : ''}`}
              onClick={setToday}
            >
              Today
            </button>
            <button
              type="button"
              className={`purchase-hist-date-chip ${rangeFrom === yesterday && rangeTo === yesterday ? 'purchase-hist-date-chip--active' : ''}`}
              onClick={setYesterday}
            >
              Yesterday
            </button>
            <button type="button" className="purchase-hist-date-chip" onClick={setThisWeek}>
              Week
            </button>
          </div>
        </div>

        <div className="purchase-hist-dates">
          <span className="purchase-hist-range-title">Sort by time</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`purchase-hist-date-chip ${sort === opt.id ? 'purchase-hist-date-chip--active' : ''}`}
              onClick={() => setSort(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="purchase-hist-export-bar">
          <button type="button" className="purchase-hist-export-btn" onClick={handleDownloadSpreadsheet}>
            Download Excel
          </button>
          {exportStatus ? <span className="purchase-hist-export-status">{exportStatus}</span> : null}
        </div>

        <div className="purchase-hist-summary-top">
          <div className="purchase-hist-summary-row purchase-hist-summary-row--total">
            <span>Total · {periodLabel}</span>
            <strong>{formatMoney(summary.expenseTotal + summary.no1Total)}</strong>
          </div>
          <span className="purchase-hist-summary-count">
            {summary.expenseCount} expenses · {summary.no1Count} {NO1_EXPENSE_LABEL}
          </span>
        </div>

        {timeline.length === 0 ? (
          <p className="purchase-hist-empty">No expenses or purchases for this date range.</p>
        ) : (
          <ul className="purchase-hist-list">
            {timeline.map((entry) => {
              const key = `${entry.kind}:${entry.id}`
              const expanded = expandedKey === key
              return (
                <li key={key} className={`purchase-hist-item ${expanded ? 'purchase-hist-item--expanded' : ''}`}>
                  <button
                    type="button"
                    className="purchase-hist-item-btn"
                    onClick={() => setExpandedKey(expanded ? null : key)}
                  >
                    <div className="purchase-hist-item-info">
                      <div className="purchase-hist-item-top">
                        <span className="purchase-hist-item-label">
                          {timelineIcon(entry.kind)} {entry.title}
                        </span>
                        <span className="purchase-hist-item-amount">-{formatMoney(entry.amount)}</span>
                      </div>
                      <span className="purchase-hist-item-meta">
                        {expenseTimelineKindLabel(entry.kind)} · {entry.payLabel} · {formatDate(entry.date)}{' '}
                        {formatTime(entry.date)}
                      </span>
                    </div>
                  </button>
                  {expanded ? (
                    <div className="purchase-hist-item-detail">
                      <div className="purchase-hist-item-detail-row">
                        <span>Type</span>
                        <strong>{expenseTimelineKindLabel(entry.kind)}</strong>
                      </div>
                      {entry.detail ? (
                        <div className="purchase-hist-item-detail-row">
                          <span>Details</span>
                          <strong>{entry.detail}</strong>
                        </div>
                      ) : null}
                      {entry.no1Amount && entry.no1Amount > 0 && entry.kind !== 'no1-purchase' ? (
                        <div className="purchase-hist-item-detail-row">
                          <span>No 1</span>
                          <strong>{formatMoney(entry.no1Amount)}</strong>
                        </div>
                      ) : null}
                      <div className="purchase-hist-item-detail-row purchase-hist-item-detail-row--total">
                        <span>Amount</span>
                        <strong>{formatMoney(entry.amount)}</strong>
                      </div>
                      <p className="purchase-hist-item-detail-pay">{entry.payDetail}</p>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
