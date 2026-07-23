import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppData } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import { formatSalesBreakdown, toInputDate } from '../utils/salesReport'
import {
  buildChequeReportItems,
  buildCreditReportItems,
  filterChequeReportItems,
  filterCreditReportItems,
  formatReportPresetLabel,
  salesBillsForPreset,
  summarizeChequeItems,
  summarizeCreditItems,
  summarizeNormalExpenses,
  summarizePurchases,
  type ReportDatePreset,
} from '../utils/reportsHub'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
} from '../utils/normalExpenseHistory'
import {
  buildPurchaseHistoryItems,
  filterPurchaseHistoryItems,
} from '../utils/purchaseHistory'
import '../pages/Reports.css'

export type ReportSection = 'sales' | 'purchase' | 'expense' | 'credit' | 'cheque'

const DATE_PRESETS: { id: ReportDatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
]

interface ReportsPanelProps {
  open: boolean
  onClose: () => void
  data: AppData
  initialPreset?: ReportDatePreset
  initialSection?: ReportSection
}

export default function ReportsPanel({
  open,
  onClose,
  data,
  initialPreset = 'today',
  initialSection,
}: ReportsPanelProps) {
  const [datePreset, setDatePreset] = useState<ReportDatePreset>(initialPreset)
  const [selectedDate, setSelectedDate] = useState(toInputDate())
  const bodyRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Partial<Record<ReportSection, HTMLElement | null>>>({})

  useEffect(() => {
    if (!open) return
    setDatePreset(initialPreset)
    if (initialPreset === 'date') setSelectedDate(toInputDate())
  }, [open, initialPreset])

  useEffect(() => {
    if (!open || !initialSection) return
    const timer = window.setTimeout(() => {
      const section = sectionRefs.current[initialSection]
      const body = bodyRef.current
      if (section && body) {
        body.scrollTop = section.offsetTop - 4
      }
    }, 50)
    return () => window.clearTimeout(timer)
  }, [open, initialSection, datePreset])

  const salesBills = useMemo(
    () => salesBillsForPreset(data, datePreset, selectedDate),
    [data, datePreset, selectedDate],
  )
  const salesTotals = useMemo(
    () =>
      salesBills.reduce(
        (acc, row) => {
          acc.totalBills += row.collectedTotal
          acc.billTotal += row.billAmount
          acc.cashTotal += row.cashTotal
          acc.bankTotal += row.bankTotal
          acc.creditPending += row.creditPending
          acc.billCount += 1
          return acc
        },
        { totalBills: 0, billTotal: 0, cashTotal: 0, bankTotal: 0, creditPending: 0, billCount: 0 },
      ),
    [salesBills],
  )

  const purchaseItems = useMemo(() => {
    const items = buildPurchaseHistoryItems(data)
    return filterPurchaseHistoryItems(items, datePreset, selectedDate)
  }, [data, datePreset, selectedDate])
  const purchaseTotals = useMemo(() => summarizePurchases(purchaseItems), [purchaseItems])

  const expenseItems = useMemo(() => {
    const items = buildNormalExpenseHistoryItems(data)
    return filterNormalExpenseHistoryItems(items, datePreset, selectedDate)
  }, [data, datePreset, selectedDate])
  const expenseTotals = useMemo(() => summarizeNormalExpenses(expenseItems), [expenseItems])

  const creditItems = useMemo(() => {
    const items = buildCreditReportItems(data)
    return filterCreditReportItems(items, datePreset, selectedDate)
  }, [data, datePreset, selectedDate])
  const creditTotals = useMemo(() => summarizeCreditItems(creditItems), [creditItems])

  const chequeItems = useMemo(() => {
    const items = buildChequeReportItems(data)
    return filterChequeReportItems(items, datePreset, selectedDate)
  }, [data, datePreset, selectedDate])
  const chequeTotals = useMemo(() => summarizeChequeItems(chequeItems), [chequeItems])

  const periodLabel = formatReportPresetLabel(datePreset, selectedDate)

  if (!open) return null

  function setSectionRef(section: ReportSection) {
    return (node: HTMLElement | null) => {
      sectionRefs.current[section] = node
    }
  }

  return (
    <div className="reports-overlay" role="dialog" aria-modal="true" aria-label="Reports">
      <div className="reports-page reports-panel">
        <div className="reports-top">
          <header className="reports-head">
            <div className="reports-head-text">
              <h1 className="reports-title">All Reports</h1>
              <p className="reports-sub">{periodLabel} · Sales · Purchase · Expense · Credit · Cheque</p>
            </div>
            <button type="button" className="reports-home-btn" onClick={onClose} aria-label="Close reports">
              ✕
            </button>
          </header>

          <div className="reports-controls">
            <div className="reports-date-bar">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`reports-date-chip ${datePreset === preset.id ? 'reports-date-chip--active' : ''}`}
                  onClick={() => setDatePreset(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`reports-date-chip ${datePreset === 'date' ? 'reports-date-chip--active' : ''}`}
                onClick={() => setDatePreset('date')}
              >
                Pick
              </button>
            </div>

            {datePreset === 'date' ? (
              <label className="reports-date-pick">
                <span>Date</span>
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
              </label>
            ) : null}

            <div className="reports-summary reports-summary--all">
              <div className="reports-summary-card reports-summary-card--green">
                <span>Sales</span>
                <strong>{formatMoney(salesTotals.totalBills)}</strong>
                <small>
                  Collected · {salesTotals.billCount} bills ·{' '}
                  {formatSalesBreakdown(salesTotals.cashTotal, salesTotals.bankTotal)}
                  {salesTotals.creditPending > 0
                    ? ` · Credit ${formatMoney(salesTotals.creditPending)}`
                    : ''}
                </small>
              </div>
              <div className="reports-summary-card reports-summary-card--orange">
                <span>Purchase</span>
                <strong>{formatMoney(purchaseTotals.total)}</strong>
                <small>{purchaseTotals.count} · GST {formatMoney(purchaseTotals.gstTotal)}</small>
              </div>
              <div className="reports-summary-card reports-summary-card--orange">
                <span>Expense</span>
                <strong>{formatMoney(expenseTotals.total)}</strong>
                <small>{expenseTotals.count} items</small>
              </div>
              <div className="reports-summary-card">
                <span>Credit</span>
                <strong>{formatMoney(creditTotals.total)}</strong>
                <small>
                  Pending {formatMoney(creditTotals.pendingTotal)} · {creditTotals.pendingCount} open
                </small>
              </div>
              <div className="reports-summary-card">
                <span>Cheque</span>
                <strong>{formatMoney(chequeTotals.total)}</strong>
                <small>
                  Pending {formatMoney(chequeTotals.pendingTotal)} · {chequeTotals.pendingCount} waiting
                </small>
              </div>
            </div>
          </div>
        </div>

        <div ref={bodyRef} className="reports-body">
          <section ref={setSectionRef('sales')} className="reports-section">
            <div className="reports-section-head">
              <h2>💰 Sales</h2>
              <strong>{formatMoney(salesTotals.totalBills)}</strong>
            </div>
            {salesTotals.creditPending > 0 ? (
              <p className="reports-section-note">
                Collected {formatMoney(salesTotals.totalBills)} · Credit open{' '}
                {formatMoney(salesTotals.creditPending)} · Bills{' '}
                {formatMoney(salesTotals.billTotal)}
              </p>
            ) : null}
            {salesBills.length === 0 ? (
              <p className="reports-empty">No sales for this period.</p>
            ) : (
              <ul className="reports-list">
                {salesBills.map((row) => (
                  <li key={row.id} className="reports-item">
                    <div className="reports-item-head">
                      <span className="reports-item-title">{row.customerName || 'Sale'}</span>
                      <span className="reports-item-amount">{formatMoney(row.billAmount)}</span>
                    </div>
                    <div className="reports-item-meta">
                      Created {row.createdDateLabel} · Paid {row.dateLabel} · Collected{' '}
                      {formatMoney(row.collectedTotal)} ·{' '}
                      {formatSalesBreakdown(row.cashTotal, row.bankTotal)}
                    </div>
                    <div className="reports-item-meta reports-item-meta--detail">
                      {row.detailLabel}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section ref={setSectionRef('purchase')} className="reports-section">
            <div className="reports-section-head">
              <h2>🛒 Purchase</h2>
              <strong>{formatMoney(purchaseTotals.total)}</strong>
            </div>
            {purchaseItems.length === 0 ? (
              <p className="reports-empty">No purchases for this period.</p>
            ) : (
              <ul className="reports-list">
                {purchaseItems.map((row) => (
                  <li key={row.id} className="reports-item">
                    <div className="reports-item-head">
                      <span className="reports-item-title">{row.shopName}</span>
                      <span className="reports-item-amount">{formatMoney(row.amount)}</span>
                    </div>
                    <div className="reports-item-meta">
                      {formatDate(row.date)} · {row.billLabel} · {row.payDetail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section ref={setSectionRef('expense')} className="reports-section">
            <div className="reports-section-head">
              <h2>📤 Expense</h2>
              <strong>{formatMoney(expenseTotals.total)}</strong>
            </div>
            {expenseItems.length === 0 ? (
              <p className="reports-empty">No expenses for this period.</p>
            ) : (
              <ul className="reports-list">
                {expenseItems.map((row) => (
                  <li key={row.id} className="reports-item">
                    <div className="reports-item-head">
                      <span className="reports-item-title">{row.name}</span>
                      <span className="reports-item-amount">{formatMoney(row.amount)}</span>
                    </div>
                    <div className="reports-item-meta">
                      {formatDate(row.date)} · {row.payDetail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section ref={setSectionRef('credit')} className="reports-section">
            <div className="reports-section-head">
              <h2>💳 Credit</h2>
              <strong>{formatMoney(creditTotals.total)}</strong>
            </div>
            {creditItems.length === 0 ? (
              <p className="reports-empty">No credit records for this period.</p>
            ) : (
              <ul className="reports-list">
                {creditItems.map((row) => (
                  <li key={row.id} className="reports-item">
                    <div className="reports-item-head">
                      <span className="reports-item-title">{row.name}</span>
                      <span className="reports-item-amount">{formatMoney(row.amount)}</span>
                    </div>
                    <div className="reports-item-meta">
                      {formatDate(row.date)} · {row.kind === 'sale' ? 'Sale' : 'Purchase'} · {row.status} ·{' '}
                      {row.payDetail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section ref={setSectionRef('cheque')} className="reports-section">
            <div className="reports-section-head">
              <h2>🧾 Cheque</h2>
              <strong>{formatMoney(chequeTotals.total)}</strong>
            </div>
            {chequeItems.length === 0 ? (
              <p className="reports-empty">No cheque records for this period.</p>
            ) : (
              <ul className="reports-list">
                {chequeItems.map((row) => (
                  <li key={row.id} className="reports-item">
                    <div className="reports-item-head">
                      <span className="reports-item-title">{row.name}</span>
                      <span className="reports-item-amount">{formatMoney(row.amount)}</span>
                    </div>
                    <div className="reports-item-meta">
                      {formatDate(row.date)} · {row.kind} · {row.approved ? 'Approved' : 'Pending'} ·{' '}
                      {row.payDetail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
