import { useEffect, useMemo, useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { formatMoney } from '../utils/format'
import {
  buildCreditOverview,
  buildCustomerSummaries,
  filterCustomersWithCredit,
  getCustomerSummary,
  searchCustomerSummaries,
  type CustomerSummary,
} from '../utils/customerLedger'
import {
  buildChequeCustomerSummaries,
  getChequeCustomerSummary,
  type ChequeCustomerSummary,
} from '../utils/chequeLedger'
import { getCustomerReminderAt } from '../utils/customerReminders'
import { evaluateBillReminderAlert, getReminderAlertSettings } from '../utils/billReminders'
import CustomerReminderControl from './CustomerReminderControl'
import DetailDateFilter, { type DetailDateFilterMode } from './DetailDateFilter'
import { filterByDetailDate } from '../utils/detailDateFilter'
import { findExistingCustomerName } from '../storage/database'
import { toInputDate } from '../utils/salesReport'
import Portal from './Portal'
import { PageBackButton, PageCloseButton, PageCorners } from './PageCorners'
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
  onRenameCustomer?: (fromName: string, toName: string) => boolean
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
}

export default function CustomerDashboard({
  open,
  onClose,
  data,
  initialCustomer,
  initialFilter = 'all',
  onSetCustomerReminder,
  onRenameCustomer,
  onSaveAlertSettings,
}: CustomerDashboardProps) {
  const { value: query, setValue: setQuery, deferredValue: deferredQuery } = useDeferredSearch()
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
  const chequeSummaries = useMemo(() => buildChequeCustomerSummaries(data), [data])
  const chequePendingByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of chequeSummaries) {
      map.set(row.name.trim().toLowerCase(), row.totalChequePending)
    }
    return map
  }, [chequeSummaries])
  const baseList = useMemo(
    () => (listFilter === 'credit' ? filterCustomersWithCredit(summaries) : summaries),
    [summaries, listFilter],
  )
  const filtered = useMemo(() => searchCustomerSummaries(baseList, deferredQuery), [baseList, deferredQuery])
  const selected = useMemo(
    () => (selectedName ? getCustomerSummary(summaries, selectedName) : undefined),
    [summaries, selectedName],
  )
  const selectedCheque = useMemo(
    () => (selectedName ? getChequeCustomerSummary(chequeSummaries, selectedName) : undefined),
    [chequeSummaries, selectedName],
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
          <h1 className="customer-title">{selected?.name ?? title}</h1>
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
                      chequePending={chequePendingByName.get(summary.name.trim().toLowerCase()) ?? 0}
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
                chequeSummary={selectedCheque}
                onSetCustomerReminder={onSetCustomerReminder}
                onRenameCustomer={onRenameCustomer}
                onRenamed={(nextName) => setSelectedName(nextName)}
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
  chequePending,
  showCredit,
  showInlineReminder,
  onSelect,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  chequePending: number
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
        className={`customer-list-btn ${summary.totalCreditPending > 0 || chequePending > 0 ? 'customer-list-btn--credit' : ''}`}
        onClick={onSelect}
      >
        <strong>{summary.name}</strong>
        <small>
          {summary.purchaseCount} bills · Paid {formatMoney(summary.totalPaid)}
          {summary.totalCreditPending > 0
            ? ` · Credit ${formatMoney(summary.totalCreditPending)}`
            : ''}
          {chequePending > 0 ? ` · Cheque ${formatMoney(chequePending)}` : ''}{' '}
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
  chequeSummary,
  onSetCustomerReminder,
  onRenameCustomer,
  onRenamed,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  chequeSummary?: ChequeCustomerSummary
  onSetCustomerReminder: CustomerDashboardProps['onSetCustomerReminder']
  onRenameCustomer?: CustomerDashboardProps['onRenameCustomer']
  onRenamed?: (name: string) => void
  onSaveAlertSettings?: CustomerDashboardProps['onSaveAlertSettings']
}) {
  const creditReminderAt = getCustomerReminderAt(data, summary.name, 'credit')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(summary.name)
  const chequePending = chequeSummary?.totalChequePending ?? 0
  const openChequeBills = chequeSummary?.chequeBills ?? []

  useEffect(() => {
    if (!editingName) setNameDraft(summary.name)
  }, [summary.name, editingName])

  function saveCustomerRename() {
    const next = nameDraft.trim()
    if (!next || next === summary.name) {
      setEditingName(false)
      return
    }
    if (!onRenameCustomer) return

    const existing = findExistingCustomerName(data, next)
    if (
      existing &&
      existing.trim().toLowerCase() !== summary.name.trim().toLowerCase()
    ) {
      const ok = window.confirm(
        `A customer named "${existing}" already exists. Merge all bills and reminders into that profile?`,
      )
      if (!ok) return
    }

    const saved = onRenameCustomer(summary.name, next)
    if (saved) {
      const canonical =
        existing &&
        existing.trim().toLowerCase() !== summary.name.trim().toLowerCase()
          ? existing
          : next
      onRenamed?.(canonical)
      setEditingName(false)
    }
  }

  return (
    <>
      <div className="customer-detail-head">
        {editingName ? (
          <form
            className="customer-rename-form"
            onSubmit={(e) => {
              e.preventDefault()
              saveCustomerRename()
            }}
          >
            <input
              type="text"
              className="customer-rename-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              aria-label="Customer name"
              autoFocus
            />
            <button type="submit" className="customer-rename-save" aria-label="Save name">
              ✓
            </button>
            <button
              type="button"
              className="customer-rename-cancel"
              onClick={() => {
                setNameDraft(summary.name)
                setEditingName(false)
              }}
              aria-label="Cancel rename"
            >
              ✕
            </button>
          </form>
        ) : (
          <div className="customer-detail-title-row">
            <h2>{summary.name}</h2>
            {onRenameCustomer ? (
              <button
                type="button"
                className="customer-rename-btn"
                onClick={() => setEditingName(true)}
                aria-label="Edit customer name"
              >
                ✎
              </button>
            ) : null}
          </div>
        )}
        <p>
          {summary.purchaseCount} purchases in period · {summary.creditTimes} credit bills
          {chequeSummary && chequeSummary.chequeTimes > 0
            ? ` · ${chequeSummary.chequeTimes} cheque bills`
            : ''}{' '}
          · Last visit {summary.lastPurchaseLabel}
        </p>
      </div>

      <div className="customer-summary-grid">
        <div className="customer-summary-card customer-summary-card--alert">
          <span>Credit open</span>
          <strong>{formatMoney(summary.totalCreditPending)}</strong>
        </div>
        {chequePending > 0 ? (
          <div className="customer-summary-card customer-summary-card--peer">
            <span>Cheque open</span>
            <strong>{formatMoney(chequePending)}</strong>
          </div>
        ) : null}
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
                  <strong>Bill {purchase.billDateLabel}</strong>
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

        {openChequeBills.length > 0 ? (
          <>
            <h3 className="customer-section-title customer-section-title--peer">
              Open cheque · {formatMoney(chequePending)}
            </h3>
            {openChequeBills.map((purchase) => (
              <div key={purchase.id} className="customer-purchase-item customer-purchase-item--cheque">
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
              </div>
            ))}
          </>
        ) : null}

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
