import { useEffect, useMemo, useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { formatMoney } from '../utils/format'
import {
  buildChequeCustomerSummaries,
  buildChequeOverview,
  filterCustomersWithCheque,
  getChequeCustomerSummary,
  searchChequeCustomerSummaries,
  type ChequeCustomerSummary,
} from '../utils/chequeLedger'
import { getCustomerReminderAt } from '../utils/customerReminders'
import { evaluateBillReminderAlert, getReminderAlertSettings } from '../utils/billReminders'
import CustomerReminderControl from './CustomerReminderControl'
import './CustomerDashboard.css'

export type ChequeListFilter = 'all' | 'cheque'

interface ChequeDashboardProps {
  open: boolean
  onClose: () => void
  data: AppData
  initialCustomer?: string
  initialFilter?: ChequeListFilter
  onSetCustomerReminder: (
    customerName: string,
    kind: 'credit' | 'cheque',
    reminderAt: string | null,
  ) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
}

export default function ChequeDashboard({
  open,
  onClose,
  data,
  initialCustomer,
  initialFilter = 'cheque',
  onSetCustomerReminder,
  onSaveAlertSettings,
}: ChequeDashboardProps) {
  const [query, setQuery] = useState('')
  const [listFilter, setListFilter] = useState<ChequeListFilter>(initialFilter)
  const [selectedName, setSelectedName] = useState<string | null>(initialCustomer ?? null)

  useEffect(() => {
    if (!open) return
    setListFilter(initialFilter)
    setSelectedName(initialCustomer ?? null)
    if (!initialCustomer) setQuery('')
  }, [open, initialFilter, initialCustomer])

  const chequeOverview = useMemo(() => buildChequeOverview(data), [data])
  const summaries = useMemo(() => buildChequeCustomerSummaries(data), [data])
  const baseList = useMemo(
    () => (listFilter === 'cheque' ? filterCustomersWithCheque(summaries) : summaries),
    [summaries, listFilter],
  )
  const filtered = useMemo(() => searchChequeCustomerSummaries(baseList, query), [baseList, query])
  const selected = useMemo(
    () => (selectedName ? getChequeCustomerSummary(summaries, selectedName) : undefined),
    [summaries, selectedName],
  )

  if (!open) return null

  return (
    <div className="customer-overlay" role="dialog" aria-modal="true" aria-label="Cheques">
      <div className="customer-panel">
        <header className="customer-head">
          <h1 className="customer-title">Cheque Dashboard</h1>
          <button type="button" className="customer-close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="customer-total-banner customer-total-banner--cheque">
          <span>Total cheque open</span>
          <strong>{formatMoney(chequeOverview.totalPending)}</strong>
          <small>
            {chequeOverview.customerCount} customers · {chequeOverview.openBillCount} unpaid bills
            · Set date &amp; time reminder on each customer below
          </small>
        </div>

        {!selected ? (
          <>
            <div className="customer-filter-bar">
              <button
                type="button"
                className={`customer-filter-chip ${listFilter === 'all' ? 'customer-filter-chip--active' : ''}`}
                onClick={() => setListFilter('all')}
              >
                All cheque customers
              </button>
              <button
                type="button"
                className={`customer-filter-chip ${listFilter === 'cheque' ? 'customer-filter-chip--active' : ''}`}
                onClick={() => setListFilter('cheque')}
              >
                Cheque due
              </button>
            </div>

            <div className="customer-search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  listFilter === 'cheque'
                    ? 'Search customers with open cheque…'
                    : 'Search customer name…'
                }
                aria-label="Search cheque customers"
              />
            </div>

            <div className="customer-body">
              {filtered.length === 0 ? (
                <p className="customer-empty">
                  {listFilter === 'cheque' ? 'No customers with open cheque.' : 'No cheque customers found.'}
                </p>
              ) : (
                <ul className="customer-list">
                  {filtered.map((summary) => (
                    <ChequeListItem
                      key={summary.name}
                      summary={summary}
                      data={data}
                      showInlineReminder={listFilter === 'cheque'}
                      onSelect={() => setSelectedName(summary.name)}
                      onSetCustomerReminder={onSetCustomerReminder}
                      onSaveAlertSettings={onSaveAlertSettings}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <ChequeCustomerDetail
            summary={selected}
            data={data}
            onBack={() => setSelectedName(null)}
            onSetCustomerReminder={onSetCustomerReminder}
            onSaveAlertSettings={onSaveAlertSettings}
          />
        )}
      </div>
    </div>
  )
}

function ChequeListItem({
  summary,
  data,
  showInlineReminder,
  onSelect,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: ChequeCustomerSummary
  data: AppData
  showInlineReminder: boolean
  onSelect: () => void
  onSetCustomerReminder: ChequeDashboardProps['onSetCustomerReminder']
  onSaveAlertSettings?: ChequeDashboardProps['onSaveAlertSettings']
}) {
  const reminderAt = getCustomerReminderAt(data, summary.name, 'cheque')
  const alertInfo = reminderAt
    ? evaluateBillReminderAlert(reminderAt, 'cheque', getReminderAlertSettings(data))
    : null
  const canSetReminder = showInlineReminder && summary.totalChequePending > 0

  return (
    <li className={`customer-list-row ${canSetReminder ? 'customer-list-row--stack' : ''}`}>
      <button
        type="button"
        className={`customer-list-btn ${summary.totalChequePending > 0 ? 'customer-list-btn--credit' : ''}`}
        onClick={onSelect}
      >
        <strong>{summary.name}</strong>
        <small>
          {summary.purchaseCount} bills · Paid {formatMoney(summary.totalPaid)}
          {summary.totalChequePending > 0
            ? ` · Cheque ${formatMoney(summary.totalChequePending)}`
            : ''}{' '}
          · Last {summary.lastPurchaseLabel}
          {alertInfo?.isAlertActive ? ' · 🔔 Alert' : reminderAt ? ' · 🔔 Reminder set' : ''}
        </small>
      </button>
      {canSetReminder ? (
        <CustomerReminderControl
          customerName={summary.name}
          reminderAt={reminderAt}
          billKind="cheque"
          data={data}
          onSet={onSetCustomerReminder}
          onSaveAlertSettings={onSaveAlertSettings}
          compact
        />
      ) : null}
    </li>
  )
}

function ChequeCustomerDetail({
  summary,
  data,
  onBack,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: ChequeCustomerSummary
  data: AppData
  onBack: () => void
  onSetCustomerReminder: ChequeDashboardProps['onSetCustomerReminder']
  onSaveAlertSettings?: ChequeDashboardProps['onSaveAlertSettings']
}) {
  const chequeReminderAt = getCustomerReminderAt(data, summary.name, 'cheque')

  return (
    <>
      <button type="button" className="customer-back-btn" onClick={onBack}>
        ← All customers
      </button>

      <div className="customer-detail-head">
        <h2>{summary.name}</h2>
        <p>
          {summary.purchaseCount} purchases · {summary.chequeTimes} cheque bills · Last visit{' '}
          {summary.lastPurchaseLabel}
        </p>
      </div>

      <div className="customer-summary-grid">
        <div className="customer-summary-card customer-summary-card--alert">
          <span>Cheque open</span>
          <strong>{formatMoney(summary.totalChequePending)}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Open cheque bills</span>
          <strong>{summary.openChequeCount}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Total paid</span>
          <strong>{formatMoney(summary.totalPaid)}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Bill total</span>
          <strong>{formatMoney(summary.totalBillAmount)}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Cheque times</span>
          <strong>{summary.chequeTimes}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Purchases</span>
          <strong>{summary.purchaseCount}</strong>
        </div>
      </div>

      {summary.totalChequePending > 0 ? (
        <CustomerReminderControl
          customerName={summary.name}
          reminderAt={chequeReminderAt}
          billKind="cheque"
          data={data}
          onSet={onSetCustomerReminder}
          onSaveAlertSettings={onSaveAlertSettings}
          compact
        />
      ) : null}

      <div className="customer-body">
        {summary.chequeBills.length > 0 ? (
          <>
            <h3 className="customer-section-title customer-section-title--alert">
              Open cheque · {formatMoney(summary.totalChequePending)}
            </h3>
            {summary.chequeBills.map((purchase) => (
              <div key={purchase.id} className="customer-purchase-item customer-purchase-item--credit">
                <div className="customer-purchase-head">
                  <strong>{purchase.dateLabel}</strong>
                  <span>{formatMoney(purchase.chequePending)}</span>
                </div>
                <div className="customer-purchase-meta">{purchase.payDetail}</div>
              </div>
            ))}
          </>
        ) : (
          <p className="customer-empty customer-empty--inline">No open cheque for this customer.</p>
        )}

        <h3 className="customer-section-title">All cheque purchases</h3>
        {summary.purchases.length === 0 ? (
          <p className="customer-empty">No cheque history.</p>
        ) : (
          summary.purchases.map((purchase) => (
            <div
              key={purchase.id}
              className={`customer-purchase-item ${purchase.chequePending > 0 ? 'customer-purchase-item--credit' : ''}`}
            >
              <div className="customer-purchase-head">
                <strong>{purchase.dateLabel}</strong>
                <span>{formatMoney(purchase.billAmount)}</span>
              </div>
              <div className="customer-purchase-meta">{purchase.payDetail}</div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
