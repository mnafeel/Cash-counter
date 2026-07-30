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
import DetailDateFilter, { type DetailDateFilterMode } from './DetailDateFilter'
import { filterByDetailDate } from '../utils/detailDateFilter'
import { toInputDate } from '../utils/salesReport'
import Portal from './Portal'
import './CustomerDashboard.css'

export type CustomerListFilter = 'all' | 'credit'

interface CustomerDashboardProps {
  open: boolean
  onClose: () => void
  data: AppData
  initialCustomer?: string
  initialFilter?: CustomerListFilter
  onSetCustomerReminder: (
    customerName: string,
    kind: 'credit' | 'cheque',
    reminderAt: string | null,
  ) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
}

export default function CustomerDashboard({
  open,
  onClose,
  data,
  initialCustomer,
  initialFilter = 'all',
  onSetCustomerReminder,
  onSaveAlertSettings,
}: CustomerDashboardProps) {
  const [query, setQuery] = useState('')
  const [listFilter, setListFilter] = useState<CustomerListFilter>(initialFilter)
  const [selectedName, setSelectedName] = useState<string | null>(initialCustomer ?? null)
  const [detailDateMode, setDetailDateMode] = useState<DetailDateFilterMode>('all')
  const [detailSelectedDate, setDetailSelectedDate] = useState('')
  const [detailRangeTo, setDetailRangeTo] = useState(() => toInputDate())

  useEffect(() => {
    if (!open) return
    setListFilter(initialFilter)
    setSelectedName(initialCustomer ?? null)
    if (!initialCustomer) setQuery('')
    setDetailDateMode('all')
    setDetailSelectedDate('')
    setDetailRangeTo(toInputDate())
  }, [open, initialFilter, initialCustomer])

  useEffect(() => {
    if (!selectedName) return
    setDetailDateMode('all')
    setDetailSelectedDate('')
    setDetailRangeTo(toInputDate())
  }, [selectedName])

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
  const filteredSelected = useMemo(() => {
    if (!selected) return undefined
    const purchases = filterByDetailDate(
      selected.purchases,
      detailDateMode,
      detailSelectedDate,
      detailRangeTo,
    )
    const creditBills = filterByDetailDate(
      selected.creditBills,
      detailDateMode,
      detailSelectedDate,
      detailRangeTo,
    )
    return {
      ...selected,
      purchases,
      creditBills,
      purchaseCount: purchases.length,
      openCreditCount: creditBills.length,
    }
  }, [selected, detailDateMode, detailSelectedDate, detailRangeTo])

  if (!open) return null

  const title = listFilter === 'credit' ? 'Credit Dashboard' : 'Customer Dashboard'

  return (
    <Portal>
    <div className="customer-overlay" role="dialog" aria-modal="true" aria-label="Customers">
      <div className="customer-panel">
        <header className="customer-head">
          {selected ? (
            <button
              type="button"
              className="customer-head-back"
              onClick={() => setSelectedName(null)}
              aria-label="Back to customers"
            >
              ←
            </button>
          ) : null}
          <h1 className="customer-title">{selected?.name ?? title}</h1>
          <button type="button" className="customer-close" onClick={onClose}>
            ✕
          </button>
        </header>

        {!selected ? (
          <>
        {listFilter === 'credit' ? (
          <div className="customer-total-banner customer-total-banner--credit">
            <span>Total credit open</span>
            <strong>{formatMoney(creditOverview.totalPending)}</strong>
            <small>
              {creditOverview.customerCount} customers · {creditOverview.openBillCount} unpaid bills
              · Set date &amp; time reminder on each customer below
            </small>
          </div>
        ) : null}
            <div className="customer-filter-bar">
              <button
                type="button"
                className={`customer-filter-chip ${listFilter === 'all' ? 'customer-filter-chip--active' : ''}`}
                onClick={() => setListFilter('all')}
              >
                All
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
                aria-label="Search customers"
              />
            </div>

            <div className="customer-body">
              {filtered.length === 0 ? (
                <p className="customer-empty">
                  {listFilter === 'credit' ? 'No customers with open credit.' : 'No customers found.'}
                </p>
              ) : (
                <ul className="customer-list">
                  {filtered.map((summary) => (
                    <CustomerListItem
                      key={summary.name}
                      summary={summary}
                      data={data}
                      showCredit={listFilter === 'credit' || summary.totalCreditPending > 0}
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
        ) : filteredSelected ? (
          <>
            <DetailDateFilter
              mode={detailDateMode}
              selectedDate={detailSelectedDate}
              rangeTo={detailRangeTo}
              onModeChange={setDetailDateMode}
              onSelectedDateChange={setDetailSelectedDate}
              onRangeToChange={setDetailRangeTo}
            />
            <div className="customer-detail-scroll">
              <CustomerDetail
                summary={filteredSelected}
                data={data}
                onSetCustomerReminder={onSetCustomerReminder}
                onSaveAlertSettings={onSaveAlertSettings}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
    </Portal>
  )
}

function CustomerListItem({
  summary,
  data,
  showCredit,
  showInlineReminder,
  onSelect,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  showCredit: boolean
  showInlineReminder: boolean
  onSelect: () => void
  onSetCustomerReminder: CustomerDashboardProps['onSetCustomerReminder']
  onSaveAlertSettings?: CustomerDashboardProps['onSaveAlertSettings']
}) {
  const reminderAt = getCustomerReminderAt(data, summary.name, 'credit')
  const alertInfo =
    reminderAt && showCredit
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

function CustomerDetail({
  summary,
  data,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  onSetCustomerReminder: CustomerDashboardProps['onSetCustomerReminder']
  onSaveAlertSettings?: CustomerDashboardProps['onSaveAlertSettings']
}) {
  const creditReminderAt = getCustomerReminderAt(data, summary.name, 'credit')

  return (
    <>
      <div className="customer-detail-head">
        <h2>{summary.name}</h2>
        <p>
          {summary.purchaseCount} purchases in period · {summary.creditTimes} credit bills · Last visit{' '}
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
              {purchase.paymentHistory ? (
                <div className="customer-purchase-meta customer-purchase-meta--muted">
                  {purchase.paymentHistory}
                </div>
              ) : null}
              </div>
            ))}
          </>
        ) : (
          <p className="customer-empty customer-empty--inline">No open credit for this customer.</p>
        )}

        <h3 className="customer-section-title">All purchases</h3>
        {summary.purchases.length === 0 ? (
          <p className="customer-empty">No purchase history.</p>
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
              {purchase.paymentHistory ? (
                <div className="customer-purchase-meta customer-purchase-meta--muted">
                  {purchase.paymentHistory}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  )
}
