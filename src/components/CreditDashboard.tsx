import { useEffect, useMemo, useState } from 'react'
import type { AppData, ReminderAlertSettings, Sale, SaleReturnEntry } from '../types'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { formatMoney, formatDate } from '../utils/format'
import {
  buildChequeCustomerSummaries,
  getChequeCustomerSummary,
  type ChequeCustomerSummary,
} from '../utils/chequeLedger'
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
import BillReminderControl from './BillReminderControl'
import SaleReturnModal from './SaleReturnModal'
import SaleReturnCancelConfirm from './SaleReturnCancelConfirm'
import DetailDateFilter, { type DetailDateFilterMode } from './DetailDateFilter'
import { filterByDetailDate } from '../utils/detailDateFilter'
import { toInputDate } from '../utils/salesReport'
import { printCreditDuesReport } from '../utils/duesReport'
import {
  formatSaleReturnLine,
  saleBalanceAfterReturns,
  saleBillGroupPaidTotal,
  saleBillPaymentLines,
  saleCreditBalanceDue,
  saleGrossBillAmount,
  saleReturnTotal,
} from '../utils/saleReturns'
import './CustomerDashboard.css'
import Portal from './Portal'
import { PageBackButton, PageCloseButton, PageCorners } from './PageCorners'

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
  onSetBillReminder: (saleId: string, reminderAt: string | null, reminderNote?: string | null) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
  onApplySaleReturn: (
    saleId: string,
    input: { itemName: string; quantity: number; rate: number },
  ) => void
  onCancelSaleReturn: (saleId: string, returnId: string) => void
}

export default function CreditDashboard({
  open,
  onClose,
  data,
  initialCustomer,
  initialFilter = 'credit',
  onSetCustomerReminder,
  onSetBillReminder,
  onSaveAlertSettings,
  onApplySaleReturn,
  onCancelSaleReturn,
}: CreditDashboardProps) {
  const { value: query, setValue: setQuery, deferredValue: deferredQuery } = useDeferredSearch()
  const [listFilter, setListFilter] = useState<CreditListFilter>(initialFilter)
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

  return (
    <Portal>
    <div className="customer-overlay" role="dialog" aria-modal="true" aria-label="Credit">
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
          <h1 className="customer-title">{selected?.name ?? 'Credit Dashboard'}</h1>
        </header>

        {!selected ? (
          <>
            <div className="customer-total-banner customer-total-banner--credit">
              <span>Total credit open</span>
              <strong>{formatMoney(creditOverview.totalPending)}</strong>
              <small>
                {creditOverview.customerCount} customers · {creditOverview.openBillCount} unpaid bills
                · Set date &amp; time reminder on each customer below
              </small>
              <button
                type="button"
                className="customer-dues-pdf-btn"
                disabled={creditOverview.openBillCount === 0}
                onClick={() => printCreditDuesReport(data)}
              >
                PDF / Print all dues
              </button>
            </div>

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
                      chequePending={chequePendingByName.get(summary.name.trim().toLowerCase()) ?? 0}
                      showInlineReminder={summary.totalCreditPending > 0}
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
              <CreditCustomerDetail
                summary={filteredSelected}
                data={data}
                chequeSummary={selectedCheque}
                onSetCustomerReminder={onSetCustomerReminder}
                onSetBillReminder={onSetBillReminder}
                onSaveAlertSettings={onSaveAlertSettings}
                onApplySaleReturn={onApplySaleReturn}
                onCancelSaleReturn={onCancelSaleReturn}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
    </Portal>
  )
}

function CreditListItem({
  summary,
  data,
  chequePending,
  showInlineReminder,
  onSelect,
  onSetCustomerReminder,
  onSaveAlertSettings,
}: {
  summary: CustomerSummary
  data: AppData
  chequePending: number
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
            : ''}
          {chequePending > 0 ? ` · Cheque ${formatMoney(chequePending)}` : ''}{' '}
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
  chequeSummary,
  onSetCustomerReminder,
  onSetBillReminder,
  onSaveAlertSettings,
  onApplySaleReturn,
  onCancelSaleReturn,
}: {
  summary: CustomerSummary
  data: AppData
  chequeSummary?: ChequeCustomerSummary
  onSetCustomerReminder: CreditDashboardProps['onSetCustomerReminder']
  onSetBillReminder: CreditDashboardProps['onSetBillReminder']
  onSaveAlertSettings?: CreditDashboardProps['onSaveAlertSettings']
  onApplySaleReturn: CreditDashboardProps['onApplySaleReturn']
  onCancelSaleReturn: CreditDashboardProps['onCancelSaleReturn']
}) {
  const creditReminderAt = getCustomerReminderAt(data, summary.name, 'credit')
  const [returnSale, setReturnSale] = useState<Sale | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{ saleId: string; entry: SaleReturnEntry } | null>(
    null,
  )
  const chequePending = chequeSummary?.totalChequePending ?? 0

  return (
    <>
      <div className="customer-detail-head">
        <h2>{summary.name}</h2>
        <p>
          {summary.purchaseCount} purchases in period · {summary.creditTimes} credit bills
          {chequeSummary && chequeSummary.chequeTimes > 0
            ? ` · ${chequeSummary.chequeTimes} cheque bills`
            : ''}{' '}
          · Last visit {summary.lastPurchaseLabel}
        </p>
        {summary.totalCreditPending > 0 ? (
          <button
            type="button"
            className="customer-dues-pdf-btn customer-dues-pdf-btn--inline"
            onClick={() => printCreditDuesReport(data, summary.name)}
          >
            PDF / Print this party
          </button>
        ) : null}
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
              {creditReminderAt ? ` · 🔔 ${formatDate(creditReminderAt)}` : ''}
            </h3>
            {summary.creditBills.map((purchase) => {
              const sale = data.sales.find((entry) => entry.id === purchase.id)
              const returnTotal = sale ? saleReturnTotal(sale) : 0
              const paidSoFar = sale ? saleBillGroupPaidTotal(sale, data.sales) : 0
              const gross = sale ? saleGrossBillAmount(sale) : purchase.billAmount
              const toPay = sale
                ? saleCreditBalanceDue(sale, data.sales)
                : purchase.creditPending
              const showBreakdown =
                returnTotal > 0 || paidSoFar > 0 || gross !== toPay
              return (
              <div key={purchase.id} className="customer-purchase-item customer-purchase-item--credit customer-purchase-item--stack customer-purchase-item--returnable">
                <button
                  type="button"
                  className="customer-purchase-return-btn"
                  onClick={() => sale && setReturnSale(sale)}
                  disabled={!sale || saleBalanceAfterReturns(sale, data.sales) <= 0}
                >
                  Return
                </button>
                <div className="customer-purchase-head">
                  <strong>Bill {purchase.billDateLabel}</strong>
                  <span>{formatMoney(toPay)}</span>
                </div>
                {showBreakdown ? (
                  <div className="customer-purchase-meta customer-purchase-meta--return">
                    Original {formatMoney(gross)}
                    {paidSoFar > 0 ? ` · Paid ${formatMoney(paidSoFar)}` : ''}
                    {returnTotal > 0 ? ` · Return −${formatMoney(returnTotal)}` : ''}
                    {' · Credit '}
                    {formatMoney(toPay)}
                  </div>
                ) : null}
                {sale?.returns?.map((row) => (
                  <div key={row.id} className="customer-purchase-meta customer-purchase-meta--muted customer-purchase-return-row">
                    <span>
                      ↩ {formatSaleReturnLine(row)} · {formatMoney(row.amount)}
                    </span>
                    <button
                      type="button"
                      className="customer-purchase-return-cancel"
                      onClick={() => setCancelTarget({ saleId: purchase.id, entry: row })}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
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
                  billKind="credit"
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
          <p className="customer-empty customer-empty--inline">No open credit for this customer.</p>
        )}

        {chequePending > 0 && chequeSummary && chequeSummary.chequeBills.length > 0 ? (
          <>
            <h3 className="customer-section-title customer-section-title--peer">
              Also open cheque · {formatMoney(chequePending)}
            </h3>
            {chequeSummary.chequeBills.map((purchase) => (
              <div key={purchase.id} className="customer-purchase-item customer-purchase-item--cheque">
                <div className="customer-purchase-head">
                  <strong>Bill {purchase.billDateLabel}</strong>
                  <span>{formatMoney(purchase.chequePending)}</span>
                </div>
                <div className="customer-purchase-meta">{purchase.payDetail}</div>
              </div>
            ))}
          </>
        ) : null}

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

      {returnSale ? (
        <SaleReturnModal
          open
          onClose={() => setReturnSale(null)}
          customerName={summary.name}
          originalBill={saleGrossBillAmount(returnSale)}
          paidSoFar={saleBillGroupPaidTotal(returnSale, data.sales)}
          paymentLines={saleBillPaymentLines(returnSale, data.sales)}
          existingReturns={returnSale.returns ?? []}
          maxReturnable={saleCreditBalanceDue(returnSale, data.sales)}
          onCancelReturn={(returnId) => {
            onCancelSaleReturn(returnSale.id, returnId)
            setReturnSale(null)
          }}
          onDone={(draft) => {
            onApplySaleReturn(returnSale.id, draft)
            setReturnSale(null)
          }}
        />
      ) : null}

      <SaleReturnCancelConfirm
        open={Boolean(cancelTarget)}
        entry={cancelTarget?.entry ?? null}
        onClose={() => setCancelTarget(null)}
        onConfirm={(returnId) => {
          if (!cancelTarget) return
          onCancelSaleReturn(cancelTarget.saleId, returnId)
          setCancelTarget(null)
        }}
      />
    </>
  )
}
