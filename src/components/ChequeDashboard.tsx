import { useEffect, useMemo, useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { formatMoney, formatDate } from '../utils/format'
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
import BillReminderControl from './BillReminderControl'
import DetailDateFilter, { type DetailDateFilterMode } from './DetailDateFilter'
import { filterByDetailDate } from '../utils/detailDateFilter'
import { toInputDate } from '../utils/salesReport'
import './CustomerDashboard.css'
import Portal from './Portal'
import { PageBackButton, PageCloseButton, PageCorners } from './PageCorners'

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
  onSetBillReminder: (saleId: string, reminderAt: string | null, reminderNote?: string | null) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
}

export default function ChequeDashboard({
  open,
  onClose,
  data,
  initialCustomer,
  initialFilter = 'cheque',
  onSetCustomerReminder,
  onSetBillReminder,
  onSaveAlertSettings,
}: ChequeDashboardProps) {
  const { value: query, setValue: setQuery, deferredValue: deferredQuery } = useDeferredSearch()
  const [listFilter, setListFilter] = useState<ChequeListFilter>(initialFilter)
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

  const chequeOverview = useMemo(() => buildChequeOverview(data), [data])
  const summaries = useMemo(() => buildChequeCustomerSummaries(data), [data])
  const baseList = useMemo(
    () => (listFilter === 'cheque' ? filterCustomersWithCheque(summaries) : summaries),
    [summaries, listFilter],
  )
  const filtered = useMemo(() => searchChequeCustomerSummaries(baseList, deferredQuery), [baseList, deferredQuery])
  const selected = useMemo(
    () => (selectedName ? getChequeCustomerSummary(summaries, selectedName) : undefined),
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
    const chequeBills = filterByDetailDate(
      selected.chequeBills,
      detailDateMode,
      detailSelectedDate,
      detailRangeTo,
    )
    return {
      ...selected,
      purchases,
      chequeBills,
      purchaseCount: purchases.length,
      openChequeCount: chequeBills.length,
    }
  }, [selected, detailDateMode, detailSelectedDate, detailRangeTo])

  if (!open) return null

  return (
    <Portal>
    <div className="customer-overlay" role="dialog" aria-modal="true" aria-label="Cheques">
      <div className="customer-panel page-shell">
        <PageCorners
        left={
          selected ? (
            <PageBackButton onClick={() => setSelectedName(null)} ariaLabel="Back to customers" />
          ) : (
            <PageBackButton onClick={onClose} ariaLabel="Back" />
          )
        }
          right={<PageCloseButton onClick={onClose} />}
        />
        <header className="customer-head page-head--corners">
          <h1 className="customer-title">{selected?.name ?? 'Cheque Dashboard'}</h1>
        </header>

        {!selected ? (
          <>
        <div className="customer-total-banner customer-total-banner--cheque">
          <span>Total cheque open</span>
          <strong>{formatMoney(chequeOverview.totalPending)}</strong>
          <small>
            {chequeOverview.customerCount} customers · {chequeOverview.openBillCount} unpaid bills
            · Set date &amp; time reminder on each customer below
          </small>
        </div>

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
                      showInlineReminder={summary.totalChequePending > 0}
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
              <ChequeCustomerDetail
                summary={filteredSelected}
                data={data}
                onSetCustomerReminder={onSetCustomerReminder}
                onSetBillReminder={onSetBillReminder}
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
          {alertInfo?.isAlertActive
            ? ` · 🔔 Alert`
            : reminderAt
              ? ` · 🔔 ${formatDate(reminderAt)}`
              : ''}
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
  onSetCustomerReminder,
  onSetBillReminder,
  onSaveAlertSettings,
}: {
  summary: ChequeCustomerSummary
  data: AppData
  onSetCustomerReminder: ChequeDashboardProps['onSetCustomerReminder']
  onSetBillReminder: ChequeDashboardProps['onSetBillReminder']
  onSaveAlertSettings?: ChequeDashboardProps['onSaveAlertSettings']
}) {
  const chequeReminderAt = getCustomerReminderAt(data, summary.name, 'cheque')

  return (
    <>
      <div className="customer-detail-head">
        <h2>{summary.name}</h2>
        <p>
          {summary.purchaseCount} purchases in period · {summary.chequeTimes} cheque bills · Last visit{' '}
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
              {chequeReminderAt ? ` · 🔔 ${formatDate(chequeReminderAt)}` : ''}
            </h3>
            {summary.chequeBills.map((purchase) => {
              const sale = data.sales.find((entry) => entry.id === purchase.id)
              return (
              <div key={purchase.id} className="customer-purchase-item customer-purchase-item--credit customer-purchase-item--stack">
                <div className="customer-purchase-head">
                  <strong>Bill {purchase.billDateLabel}</strong>
                  <span>{formatMoney(purchase.chequePending)}</span>
                </div>
                <div className="customer-purchase-meta">{purchase.payDetail}</div>
              {purchase.paymentHistory ? (
                <div className="customer-purchase-meta customer-purchase-meta--muted">
                  {purchase.paymentHistory}
                </div>
              ) : null}
                <BillReminderControl
                  saleId={purchase.id}
                  reminderAt={sale?.reminderAt}
                  reminderNote={sale?.reminderNote}
                  billKind="cheque"
                  billLabel={`${summary.name} · ${purchase.billDateLabel}`}
                  data={data}
                  onSet={onSetBillReminder}
                  onSaveAlertSettings={onSaveAlertSettings}
                  perBill
                  compact
                />
              </div>
              )
            })}
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
                <strong>Bill {purchase.billDateLabel}</strong>
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
