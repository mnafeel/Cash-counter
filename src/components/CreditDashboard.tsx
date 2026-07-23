import { useEffect, useMemo, useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { formatMoney } from '../utils/format'
import {
  buildCreditOverview,
  buildCustomerSummaries,
  filterCustomersWithCredit,
  getCustomerSummary,
  searchCustomerSummaries,
  type CustomerSummary,
} from '../utils/customerLedger'
import { getCustomerReminderAt } from '../utils/customerReminders'
import { evaluateBillReminderAlert, getReminderAlertSettings } from '../utils/billReminders'
import CustomerReminderControl from './CustomerReminderControl'
import './CustomerDashboard.css'

export type CreditListFilter = 'all' | 'credit'

interface CreditDashboardProps {
  open: boolean
  onClose: () => void
  data: AppData
  initialCustomer?: string
  initialFilter?: CreditListFilter
  onSetCustomerReminder: (
    customerName: string,
    kind: 'credit' | 'cheque',
    reminderAt: string | null,
    reminderNote?: string | null,
  ) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
}

export default function CreditDashboard({
  open,
  onClose,
  data,
  initialCustomer,
  initialFilter = 'credit',
  onSetCustomerReminder,
  onSaveAlertSettings,
}: CreditDashboardProps) {
  const [query, setQuery] = useState('')
  const [listFilter, setListFilter] = useState<CreditListFilter>(initialFilter)
  const [selectedName, setSelectedName] = useState<string | null>(initialCustomer ?? null)

  useEffect(() => {
    if (!open) return
    setListFilter(initialFilter)
    setSelectedName(initialCustomer ?? null)
    if (!initialCustomer) setQuery('')
  }, [open, initialFilter, initialCustomer])

  const creditOverview = useMemo(() => buildCreditOverview(data), [data])
  const summaries = useMemo(() => buildCustomerSummaries(data), [data])
  const baseList = useMemo(
    () => (listFilter === 'credit' ? filterCustomersWithCredit(summaries) : summaries),
    [summaries, listFilter],
  )
  const filtered = useMemo(() => searchCustomerSummaries(baseList, query), [baseList, query])
  const selected = useMemo(
    () => (selectedName ? getCustomerSummary(summaries, selectedName) : undefined),
    [summaries, selectedName],
  )

  if (!open) return null

  return (
    <div className="customer-overlay" role="dialog" aria-modal="true" aria-label="Credit">
      <div className="customer-panel">
        <header className="customer-head">
          <h1 className="customer-title">Credit Dashboard</h1>
          <button type="button" className="customer-close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="customer-total-banner customer-total-banner--credit">
          <span>Total credit open</span>
          <strong>{formatMoney(creditOverview.totalPending)}</strong>
          <small>
            {creditOverview.customerCount} customers · {creditOverview.openBillCount} unpaid bills
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
                All credit customers
              </button>
              <button
                type="button"
                className={`customer-filter-chip ${listFilter === 'credit' ? 'customer-filter-chip--active' : ''}`}
                onClick={() => setListFilter('credit')}
              >
                Credit due
              </button>
            </div>

            <div className="customer-search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  listFilter === 'credit'
                    ? 'Search customers with open credit…'
                    : 'Search customer name…'
                }
                aria-label="Search credit customers"
              />
            </div>

            <div className="customer-body">
              {filtered.length === 0 ? (
                <p className="customer-empty">
                  {listFilter === 'credit' ? 'No customers with open credit.' : 'No credit customers found.'}
                </p>
              ) : (
                <ul className="customer-list">
                  {filtered.map((summary) => (
                    <CreditListItem
                      key={summary.name}
                      summary={summary}
                      data={data}
                      showInlineReminder={listFilter === 'credit'}
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
          <CreditCustomerDetail
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

function CreditListItem({
  summary,
  data,
  showInlineReminder,
  onSelect,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  showInlineReminder: boolean
  onSelect: () => void
  onSetCustomerReminder: CreditDashboardProps['onSetCustomerReminder']
  onSaveAlertSettings?: CreditDashboardProps['onSaveAlertSettings']
}) {
  const reminderAt = getCustomerReminderAt(data, summary.name, 'credit')
  const alertInfo = reminderAt
    ? evaluateBillReminderAlert(reminderAt, 'credit', getReminderAlertSettings(data))
    : null
  const canSetReminder = showInlineReminder && summary.totalCreditPending > 0

  return (
    <li className={`customer-list-row ${canSetReminder ? 'customer-list-row--stack' : ''}`}>
      <button
        type="button"
        className={`customer-list-btn ${summary.totalCreditPending > 0 ? 'customer-list-btn--credit' : ''}`}
        onClick={onSelect}
      >
        <strong>{summary.name}</strong>
        <small>
          {summary.purchaseCount} bills · Paid {formatMoney(summary.totalPaid)}
          {summary.totalCreditPending > 0
            ? ` · Credit ${formatMoney(summary.totalCreditPending)}`
            : ''}{' '}
          · Last {summary.lastPurchaseLabel}
          {alertInfo?.isAlertActive ? ' · 🔔 Alert' : reminderAt ? ' · 🔔 Reminder set' : ''}
        </small>
      </button>
      {canSetReminder ? (
        <CustomerReminderControl
          customerName={summary.name}
          reminderAt={reminderAt}
          billKind="credit"
          data={data}
          onSet={onSetCustomerReminder}
          onSaveAlertSettings={onSaveAlertSettings}
          compact
        />
      ) : null}
    </li>
  )
}

function CreditCustomerDetail({
  summary,
  data,
  onBack,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  onBack: () => void
  onSetCustomerReminder: CreditDashboardProps['onSetCustomerReminder']
  onSaveAlertSettings?: CreditDashboardProps['onSaveAlertSettings']
}) {
  const creditReminderAt = getCustomerReminderAt(data, summary.name, 'credit')

  return (
    <>
      <button type="button" className="customer-back-btn" onClick={onBack}>
        ← All customers
      </button>

      <div className="customer-detail-head">
        <h2>{summary.name}</h2>
        <p>
          {summary.purchaseCount} purchases · {summary.creditTimes} credit bills · Last visit{' '}
          {summary.lastPurchaseLabel}
        </p>
      </div>

      <div className="customer-summary-grid">
        <div className="customer-summary-card customer-summary-card--alert">
          <span>Credit open</span>
          <strong>{formatMoney(summary.totalCreditPending)}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Open credit bills</span>
          <strong>{summary.openCreditCount}</strong>
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
          <span>Credit times</span>
          <strong>{summary.creditTimes}</strong>
        </div>
        <div className="customer-summary-card">
          <span>Purchases</span>
          <strong>{summary.purchaseCount}</strong>
        </div>
      </div>

      {summary.totalCreditPending > 0 ? (
        <CustomerReminderControl
          customerName={summary.name}
          reminderAt={creditReminderAt}
          billKind="credit"
          data={data}
          onSet={onSetCustomerReminder}
          onSaveAlertSettings={onSaveAlertSettings}
          compact
        />
      ) : null}

      <div className="customer-body">
        {summary.creditBills.length > 0 ? (
          <>
            <h3 className="customer-section-title customer-section-title--alert">
              Open credit · {formatMoney(summary.totalCreditPending)}
            </h3>
            {summary.creditBills.map((purchase) => (
              <div key={purchase.id} className="customer-purchase-item customer-purchase-item--credit">
                <div className="customer-purchase-head">
                  <strong>{purchase.dateLabel}</strong>
                  <span>{formatMoney(purchase.creditPending)}</span>
                </div>
                <div className="customer-purchase-meta">{purchase.payDetail}</div>
              </div>
            ))}
          </>
        ) : (
          <p className="customer-empty customer-empty--inline">No open credit for this customer.</p>
        )}

        <h3 className="customer-section-title">All credit purchases</h3>
        {summary.purchases.length === 0 ? (
          <p className="customer-empty">No credit history.</p>
        ) : (
          summary.purchases.map((purchase) => (
            <div
              key={purchase.id}
              className={`customer-purchase-item ${purchase.creditPending > 0 ? 'customer-purchase-item--credit' : ''}`}
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
