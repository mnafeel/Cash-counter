import { useMemo, useState } from 'react'
import type { AppData } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
  summarizeNormalExpenses,
  type NormalExpenseDateFilter,
} from '../utils/normalExpenseHistory'
import './PurchaseHistoryPanel.css'

const DATE_OPTIONS: { id: NormalExpenseDateFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
]

interface ExpenseHistoryPanelProps {
  open: boolean
  onClose: () => void
  data: AppData
}

export default function ExpenseHistoryPanel({ open, onClose, data }: ExpenseHistoryPanelProps) {
  const [dateFilter, setDateFilter] = useState<NormalExpenseDateFilter>('today')
  const [selectedDate, setSelectedDate] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const allItems = useMemo(() => buildNormalExpenseHistoryItems(data), [data])
  const items = useMemo(
    () => filterNormalExpenseHistoryItems(allItems, dateFilter, selectedDate),
    [allItems, dateFilter, selectedDate],
  )
  const summary = useMemo(() => summarizeNormalExpenses(items), [items])

  if (!open) return null

  function handleClose() {
    setExpandedId(null)
    onClose()
  }

  return (
    <div className="purchase-hist-overlay" role="dialog" aria-modal="true">
      <div className="purchase-hist-panel">
        <div className="purchase-hist-head">
          <h3>Expense History</h3>
          <button type="button" className="purchase-hist-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="purchase-hist-dates">
          {DATE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`purchase-hist-date-chip ${dateFilter === opt.id ? 'purchase-hist-date-chip--active' : ''}`}
              onClick={() => {
                setDateFilter(opt.id)
                setSelectedDate('')
              }}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="date"
            className={`purchase-hist-date-input ${dateFilter === 'date' ? 'purchase-hist-date-input--active' : ''}`}
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value)
              if (e.target.value) setDateFilter('date')
            }}
            aria-label="Pick date for expense history"
          />
        </div>

        <div className="purchase-hist-summary-top">
          <div className="purchase-hist-summary-row purchase-hist-summary-row--total">
            <span>Total</span>
            <strong>{formatMoney(summary.total)}</strong>
          </div>
          <span className="purchase-hist-summary-count">{summary.count} items</span>
        </div>

        {items.length === 0 ? (
          <p className="purchase-hist-empty">No normal expenses for this period.</p>
        ) : (
          <ul className="purchase-hist-list">
            {items.map((item) => {
              const expanded = expandedId === item.id
              return (
                <li key={item.id} className={`purchase-hist-item ${expanded ? 'purchase-hist-item--expanded' : ''}`}>
                  <button
                    type="button"
                    className="purchase-hist-item-btn"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                  >
                    <div className="purchase-hist-item-info">
                      <div className="purchase-hist-item-top">
                        <span className="purchase-hist-item-label">{item.name}</span>
                        <span className="purchase-hist-item-amount">-{formatMoney(item.amount)}</span>
                      </div>
                      <span className="purchase-hist-item-meta">
                        {item.payLabel} · {formatDate(item.date)}
                      </span>
                    </div>
                  </button>
                  {expanded ? (
                    <div className="purchase-hist-item-detail">
                      <div className="purchase-hist-item-detail-row purchase-hist-item-detail-row--total">
                        <span>Amount</span>
                        <strong>{formatMoney(item.amount)}</strong>
                      </div>
                      <p className="purchase-hist-item-detail-pay">{item.payDetail}</p>
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
