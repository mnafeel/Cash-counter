import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppData } from '../types'
import { usePageEscape } from '../hooks/usePageEscape'
import { downloadPurchaseExpenseItemsSpreadsheet } from '../utils/expenseRangeExport'
import { formatDate, formatMoney } from '../utils/format'
import { NO1_BILL_LABEL, NO2_BILL_LABEL } from '../utils/expenseBillLabels'
import {
  buildPurchaseCreditItems,
  buildPurchaseHistoryItems,
  filterPurchaseHistoryItems,
  formatPurchaseCreditMonthLabel,
  groupPurchasesBySupplier,
  listPurchaseHistoryMonthOptions,
  matchesPurchaseHistorySearch,
  purchaseItemMatchesPayChannel,
  PURCHASE_CASH_LABEL,
  sortPurchaseSupplierGroups,
  summarizeSupplierPurchaseFile,
  type PurchaseDateFilter,
  type PurchaseHistoryItem,
  type PurchaseSupplierGroup,
  type SupplierPurchaseFileSummary,
} from '../utils/purchaseHistory'
import { toInputDate } from '../utils/salesReport'
import PurchaseCreditPanel, { type PurchaseCreditPanelHandle } from './PurchaseCreditPanel'
import './PurchaseHistoryPanel.css'
import Portal from './Portal'
import { PageBackButton, PageCloseButton, PageCorners } from './PageCorners'

const DATE_OPTIONS: { id: PurchaseDateFilter | 'range'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'range', label: 'Range' },
]

type PurchasePanelDateFilter = PurchaseDateFilter | 'range' | 'monthPick'

interface PurchaseHistoryPanelProps {
  open: boolean
  onClose: () => void
  data: AppData
  variant?: 'modal' | 'fullscreen' | 'embedded'
  onUpdateBill?: (expenseId: string) => void
  embeddedBackLabel?: string
  embeddedActionLabel?: string
}

function billTagClass(billType: PurchaseHistoryItem['billType']): string {
  if (billType === 'gst') return 'purchase-hist-bill-tag--gst'
  if (billType === 'no-gst') return 'purchase-hist-bill-tag--no-gst'
  return 'purchase-hist-bill-tag--both'
}

export default function PurchaseHistoryPanel({
  open,
  onClose,
  data,
  variant = 'modal',
  onUpdateBill,
  embeddedBackLabel = 'Home',
  embeddedActionLabel = 'Open Purchase',
}: PurchaseHistoryPanelProps) {
  const navigate = useNavigate()
  const fullscreen = variant === 'fullscreen'
  const embedded = variant === 'embedded'
  const [dateFilter, setDateFilter] = useState<PurchasePanelDateFilter>('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [rangeFrom, setRangeFrom] = useState(() => toInputDate())
  const [rangeTo, setRangeTo] = useState(() => toInputDate())
  const [search, setSearch] = useState('')
  const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [showCreditPage, setShowCreditPage] = useState(false)
  const [supplierSort, setSupplierSort] = useState<'newest' | 'oldest'>('oldest')
  const [supplierGroupOrder, setSupplierGroupOrder] = useState<'name' | 'spend'>('name')
  const [payChannel, setPayChannel] = useState<'all' | 'cash' | 'bank'>('all')
  const [exportStatus, setExportStatus] = useState('')
  const creditPanelRef = useRef<PurchaseCreditPanelHandle>(null)

  const allItems = useMemo(() => buildPurchaseHistoryItems(data), [data])
  const monthOptions = useMemo(() => listPurchaseHistoryMonthOptions(allItems), [allItems])
  const purchaseCreditItems = useMemo(() => buildPurchaseCreditItems(data), [data])
  const purchaseCreditTotal = useMemo(
    () => purchaseCreditItems.reduce((sum, item) => sum + item.amount, 0),
    [purchaseCreditItems],
  )
  const dateFilteredItems = useMemo(() => {
    if (dateFilter === 'range') {
      return filterPurchaseHistoryItems(allItems, 'range', rangeFrom, rangeTo)
    }
    if (dateFilter === 'monthPick') {
      return filterPurchaseHistoryItems(allItems, 'monthPick', selectedMonth)
    }
    return filterPurchaseHistoryItems(allItems, dateFilter, selectedDate)
  }, [allItems, dateFilter, selectedDate, selectedMonth, rangeFrom, rangeTo])
  const periodSummary = useMemo(
    () => summarizeSupplierPurchaseFile(data, dateFilteredItems),
    [data, dateFilteredItems],
  )
  const allTimeSummary = useMemo(
    () => summarizeSupplierPurchaseFile(data, allItems),
    [data, allItems],
  )
  const allSupplierGroups = useMemo(() => {
    const groups = sortPurchaseSupplierGroups(groupPurchasesBySupplier(allItems), supplierGroupOrder)
    if (!search.trim() || selectedSupplierKey) return groups
    const q = search.toLowerCase().trim()
    return groups.filter(
      (group) =>
        group.shopName.toLowerCase().includes(q) ||
        group.items.some((item) => matchesPurchaseHistorySearch(item, search)),
    )
  }, [allItems, search, selectedSupplierKey, supplierGroupOrder])
  const allSupplierGroupSummaries = useMemo(() => {
    const map = new Map<string, SupplierPurchaseFileSummary>()
    for (const group of allSupplierGroups) {
      map.set(group.shopKey, summarizeSupplierPurchaseFile(data, group.items))
    }
    return map
  }, [allSupplierGroups, data])
  const paymentHistoryItems = useMemo(
    () =>
      [...dateFilteredItems]
        .filter((item) => purchaseItemMatchesPayChannel(data, item, payChannel))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [dateFilteredItems, data, payChannel],
  )
  const selectedSupplier = useMemo((): PurchaseSupplierGroup | null => {
    if (!selectedSupplierKey) return null
    const allGroups = groupPurchasesBySupplier(allItems)
    const fromGroups = allGroups.find((group) => group.shopKey === selectedSupplierKey)
    if (fromGroups) return fromGroups
    const shopItems = allItems.filter((item) => item.shopName.trim().toLowerCase() === selectedSupplierKey)
    if (shopItems.length === 0) {
      const name =
        allItems.find((item) => item.shopName.trim().toLowerCase() === selectedSupplierKey)?.shopName ??
        selectedSupplierKey
      return {
        shopName: name,
        shopKey: selectedSupplierKey,
        total: 0,
        gstTotal: 0,
        noGstTotal: 0,
        count: 0,
        creditTotal: 0,
        creditCount: 0,
        items: [],
      }
    }
    return {
      shopName: shopItems[0].shopName,
      shopKey: selectedSupplierKey,
      total: shopItems.reduce((sum, item) => sum + item.amount, 0),
      gstTotal: shopItems.reduce((sum, item) => sum + item.no1Amount, 0),
      noGstTotal: shopItems.reduce((sum, item) => sum + item.no2Amount, 0),
      count: shopItems.length,
      creditTotal: 0,
      creditCount: 0,
      items: shopItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    }
  }, [selectedSupplierKey, allItems])

  const supplierAllItems = useMemo(() => {
    if (!selectedSupplierKey) return []
    return allItems.filter((item) => item.shopName.trim().toLowerCase() === selectedSupplierKey)
  }, [allItems, selectedSupplierKey])

  const supplierHistoryItems = useMemo(() => {
    if (!selectedSupplierKey) return []
    const items = !search.trim()
      ? supplierAllItems
      : supplierAllItems.filter((item) => matchesPurchaseHistorySearch(item, search))
    return items.filter((item) => purchaseItemMatchesPayChannel(data, item, payChannel))
  }, [selectedSupplierKey, supplierAllItems, search, data, payChannel])

  const supplierAllFileSummary = useMemo(() => {
    if (!selectedSupplierKey || supplierAllItems.length === 0) return null
    return summarizeSupplierPurchaseFile(data, supplierAllItems)
  }, [data, selectedSupplierKey, supplierAllItems])

  const sortedSupplierItems = useMemo(() => {
    if (!selectedSupplierKey) return []
    const list = [...supplierHistoryItems]
    list.sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime()
      return supplierSort === 'newest' ? -diff : diff
    })
    return list
  }, [selectedSupplierKey, supplierHistoryItems, supplierSort])

  const handleClose = useCallback(() => {
    setSelectedSupplierKey(null)
    setExpandedItemId(null)
    setShowCreditPage(false)
    setSearch('')
    setExportStatus('')
    onClose()
  }, [onClose])

  const handleBack = useCallback(() => {
    if (showCreditPage && creditPanelRef.current?.back()) return
    if (showCreditPage) {
      setShowCreditPage(false)
      return
    }
    if (selectedSupplierKey) {
      setSelectedSupplierKey(null)
      setExpandedItemId(null)
      return
    }
    if (embedded) {
      onClose()
      return
    }
    handleClose()
  }, [showCreditPage, selectedSupplierKey, embedded, onClose, handleClose])

  usePageEscape(handleBack, open)

  if (!open) return null

  function purchasePeriodLabel(): string {
    if (dateFilter === 'monthPick' && selectedMonth) return formatPurchaseCreditMonthLabel(selectedMonth)
    if (dateFilter === 'range') {
      if (rangeFrom === rangeTo) return formatDate(rangeFrom)
      return `${formatDate(rangeFrom)} – ${formatDate(rangeTo)}`
    }
    if (dateFilter === 'date' && selectedDate) return formatDate(selectedDate)
    if (dateFilter === 'today') return 'Today'
    if (dateFilter === 'yesterday') return 'Yesterday'
    if (dateFilter === 'week') return 'This week'
    if (dateFilter === 'month') return 'This month'
    return 'All'
  }

  function handleDownloadSpreadsheet() {
    const exportItems = selectedSupplier ? sortedSupplierItems : dateFilteredItems
    const label = purchasePeriodLabel()
    const filenameLabel = selectedSupplier
      ? `${selectedSupplier.shopName}-${label}`.replace(/\s+/g, '-').toLowerCase()
      : label.replace(/\s+/g, '-').toLowerCase()
    downloadPurchaseExpenseItemsSpreadsheet(exportItems, label, `cash-counter-purchases-${filenameLabel}`)
    setExportStatus(`Excel file downloaded · ${exportItems.length} purchases`)
  }

  function handleGoHome() {
    handleClose()
    navigate('/')
  }

  function handleUpdateBill(expenseId: string) {
    handleClose()
    if (onUpdateBill) {
      onUpdateBill(expenseId)
      return
    }
    navigate(`/purchase?edit=${encodeURIComponent(expenseId)}`)
  }

  function renderBillActions(item: PurchaseHistoryItem) {
    const billId = item.openCreditExpenseId ?? item.id
    const creditAction = item.hasOpenCredit
    return (
      <div className="purchase-hist-item-actions purchase-hist-item-actions--credit-only">
        <button
          type="button"
          className={`purchase-hist-action-btn ${creditAction ? 'purchase-hist-action-btn--credit' : 'purchase-hist-action-btn--update'}`}
          onClick={() => handleUpdateBill(billId)}
        >
          {creditAction ? 'Credit Update' : 'Update'}
        </button>
      </div>
    )
  }

  function renderCreditSideButton(expenseId: string) {
    return (
      <button
        type="button"
        className="purchase-hist-side-credit-btn"
        onClick={(e) => {
          e.stopPropagation()
          handleUpdateBill(expenseId)
        }}
      >
        Credit Update
      </button>
    )
  }

  function renderPayStrip(
    cash: number,
    bank: number,
    options?: {
      title?: string
      cheque?: number
      compact?: boolean
    },
  ) {
    const combined = cash + bank + (options?.cheque ?? 0)

    return (
      <div
        className={`purchase-hist-pay-strip ${options?.compact ? 'purchase-hist-pay-strip--compact' : ''}`}
      >
        {options?.title ? <h5 className="purchase-hist-pay-strip-title">{options.title}</h5> : null}
        <div className="purchase-hist-pay-strip-grid">
          <div className="purchase-hist-pay-strip-cell purchase-hist-pay-strip-cell--cash">
            <span>{PURCHASE_CASH_LABEL}</span>
            <strong>{formatMoney(cash)}</strong>
          </div>
          <div className="purchase-hist-pay-strip-cell purchase-hist-pay-strip-cell--bank">
            <span>Bank</span>
            <strong>{formatMoney(bank)}</strong>
          </div>
          <div className="purchase-hist-pay-strip-cell purchase-hist-pay-strip-cell--total">
            <span>Total Paid</span>
            <strong>{formatMoney(combined)}</strong>
          </div>
        </div>
        {options?.cheque && options.cheque > 0 ? (
          <div className="purchase-hist-pay-strip-cheque">
            <span>Cheque</span>
            <strong>{formatMoney(options.cheque)}</strong>
          </div>
        ) : null}
      </div>
    )
  }

  function renderPeriodReport(
    summary: SupplierPurchaseFileSummary,
    label: string,
    options?: { supplierCount?: number },
  ) {
    return (
      <section className="purchase-hist-period-report" aria-label={`${label} purchase summary`}>
        <header className="purchase-hist-period-report-head">
          <div className="purchase-hist-period-report-head-text">
            <span className="purchase-hist-period-report-label">{label}</span>
            <span className="purchase-hist-period-report-meta">
              {summary.billCount} bills
              {options?.supplierCount != null ? ` · ${options.supplierCount} suppliers` : ''}
            </span>
          </div>
          <div className="purchase-hist-period-report-grand">
            <span>Bill total</span>
            <strong>{formatMoney(summary.billTotal)}</strong>
          </div>
        </header>

        <div className="purchase-hist-period-bills">
          <article className="purchase-hist-period-bill purchase-hist-period-bill--no1">
            <div className="purchase-hist-period-bill-head">
              <h4>{NO1_BILL_LABEL}</h4>
              <div className="purchase-hist-period-bill-amount">
                <span>Bill amount</span>
                <strong>{formatMoney(summary.no1BillTotal)}</strong>
              </div>
            </div>
            {renderPayStrip(summary.no1CashTotal, summary.no1BankTotal, {
              compact: true,
            })}
          </article>

          <article className="purchase-hist-period-bill purchase-hist-period-bill--no2">
            <div className="purchase-hist-period-bill-head">
              <h4>{NO2_BILL_LABEL}</h4>
              <div className="purchase-hist-period-bill-amount">
                <span>Bill amount</span>
                <strong>{formatMoney(summary.no2BillTotal)}</strong>
              </div>
            </div>
            {renderPayStrip(summary.no2CashTotal, summary.no2BankTotal, {
              compact: true,
              cheque: summary.no2ChequeTotal,
            })}
          </article>
        </div>
      </section>
    )
  }

  function renderSupplierBalanceDue(
    summary: SupplierPurchaseFileSummary,
    options?: { scope?: 'all' | 'supplier' },
  ) {
    const balanceDue =
      summary.pendingTotal > 0 ? summary.pendingTotal : summary.creditOpenTotal
    if (balanceDue <= 0) return null

    const dueLabel =
      options?.scope === 'all'
        ? summary.creditOpenTotal > 0 && summary.creditOpenBillCount > 0
          ? `${summary.creditOpenBillCount} credit bill${summary.creditOpenBillCount === 1 ? '' : 's'} · all suppliers`
          : summary.pendingBillCount > 0
            ? `${summary.pendingBillCount} pending bill${summary.pendingBillCount === 1 ? '' : 's'} · all suppliers`
            : 'All suppliers'
        : summary.creditOpenTotal > 0 && summary.creditOpenBillCount > 0
          ? `${summary.creditOpenBillCount} bill${summary.creditOpenBillCount === 1 ? '' : 's'} on credit`
          : summary.pendingBillCount > 0
            ? `${summary.pendingBillCount} bill${summary.pendingBillCount === 1 ? '' : 's'} with balance`
            : 'Outstanding balance'

    return (
      <section
        className="purchase-hist-balance-due"
        aria-label={options?.scope === 'all' ? 'Total purchase balance due' : 'Supplier balance due'}
      >
        <div className="purchase-hist-balance-due-copy">
          <span>Balance due</span>
          <small>{dueLabel}</small>
        </div>
        <strong>{formatMoney(balanceDue)}</strong>
      </section>
    )
  }

  function supplierRowMeta(group: PurchaseSupplierGroup): string {
    let pending = 0
    let paid = 0
    for (const item of group.items) {
      if (item.hasOpenCredit || item.paidAmount < item.amount) pending += 1
      else if (item.paidAmount >= item.amount && item.amount > 0) paid += 1
      else pending += 1
    }
    const parts = [`${group.count} purchases`]
    if (paid > 0) parts.push(`${paid} paid`)
    if (pending > 0) parts.push(`${pending} with balance`)
    if (group.creditCount > 0) parts.push(`${formatMoney(group.creditTotal)} on credit`)
    return parts.join(' · ')
  }

  function renderSupplierGroupsList() {
    return (
      <ul className="purchase-hist-list purchase-hist-list--suppliers">
        {allSupplierGroups.map((group) => (
          <li key={group.shopKey} className="purchase-hist-supplier">
            <button
              type="button"
              className="purchase-hist-supplier-btn"
              onClick={() => {
                setSelectedSupplierKey(group.shopKey)
                setExpandedItemId(null)
              }}
            >
              <div className="purchase-hist-supplier-top">
                <span className="purchase-hist-supplier-name">{group.shopName}</span>
                <span className="purchase-hist-supplier-open">Open →</span>
                <span className="purchase-hist-item-amount">-{formatMoney(group.total)}</span>
              </div>
              {(() => {
                const groupSummary = allSupplierGroupSummaries.get(group.shopKey)
                if (!groupSummary) return null
                return (
                  <div className="purchase-hist-supplier-pay-strip">
                    <span>
                      {PURCHASE_CASH_LABEL} {formatMoney(groupSummary.cashTotal)}
                    </span>
                    <span>Bank {formatMoney(groupSummary.bankTotal)}</span>
                    <span className="purchase-hist-supplier-pay-strip-total">
                      Total Paid{' '}
                      {formatMoney(
                        groupSummary.cashTotal + groupSummary.bankTotal + groupSummary.chequeTotal,
                      )}
                    </span>
                    {groupSummary.pendingTotal > 0 || groupSummary.creditOpenTotal > 0 ? (
                      <span className="purchase-hist-supplier-pay-strip-pending">
                        Balance due{' '}
                        {formatMoney(
                          groupSummary.pendingTotal > 0
                            ? groupSummary.pendingTotal
                            : groupSummary.creditOpenTotal,
                        )}
                      </span>
                    ) : null}
                  </div>
                )
              })()}
              <span className="purchase-hist-supplier-meta">{supplierRowMeta(group)}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  function renderPurchaseItem(item: PurchaseHistoryItem) {
    const expanded = expandedItemId === item.id
    const pendingAmount = Math.max(0, item.amount - item.paidAmount)
    const isFullyPaid = pendingAmount <= 0 && item.paidAmount > 0
    const isPending = pendingAmount > 0 || item.hasOpenCredit
    const itemTitle = item.description?.trim() || item.shopName || 'Purchase'

    return (
      <li key={item.id} className={`purchase-hist-item ${expanded ? 'purchase-hist-item--expanded' : ''}${item.hasOpenCredit ? ' purchase-hist-item--credit-row' : ''}`}>
        <div className="purchase-hist-item-row">
          <button
            type="button"
            className="purchase-hist-item-btn"
            onClick={() => setExpandedItemId(expanded ? null : item.id)}
          >
          <div className="purchase-hist-item-info">
            <div className="purchase-hist-item-top">
              <span className="purchase-hist-item-label">
                {itemTitle}
                <span className={`purchase-hist-bill-tag ${billTagClass(item.billType)}`}>
                  {item.billLabel}
                </span>
              </span>
              <span className="purchase-hist-item-amount">-{formatMoney(item.amount)}</span>
            </div>
            <div className="purchase-hist-item-quick">
              {item.billNo ? <span className="purchase-hist-item-chip">Bill {item.billNo}</span> : null}
              <span className="purchase-hist-item-chip">{formatDate(item.date)}</span>
              {item.no1Amount > 0 ? (
                <span className="purchase-hist-item-chip purchase-hist-item-chip--no1">
                  {NO1_BILL_LABEL} {formatMoney(item.no1Amount)}
                </span>
              ) : null}
              {item.no2Amount > 0 ? (
                <span className="purchase-hist-item-chip purchase-hist-item-chip--no2">
                  {NO2_BILL_LABEL} {formatMoney(item.no2Amount)}
                </span>
              ) : null}
            </div>
            <div className="purchase-hist-item-status-row">
              {isFullyPaid ? (
                <span className="purchase-hist-item-status purchase-hist-item-status--paid">
                  Paid {formatMoney(item.paidAmount)}
                </span>
              ) : null}
              {!isFullyPaid && item.paidAmount > 0 ? (
                <span className="purchase-hist-item-status purchase-hist-item-status--partial">
                  Paid {formatMoney(item.paidAmount)}
                </span>
              ) : null}
              {isPending ? (
                <span className="purchase-hist-item-status purchase-hist-item-status--pending">
                  Balance due{' '}
                  {formatMoney(item.hasOpenCredit ? (item.openCreditAmount ?? pendingAmount) : pendingAmount)}
                </span>
              ) : null}
              <span className="purchase-hist-item-meta-inline">{item.payLabel}</span>
            </div>
          </div>
          </button>
          {item.hasOpenCredit
            ? renderCreditSideButton(item.openCreditExpenseId ?? item.id)
            : null}
        </div>
        {expanded ? (
          <div className="purchase-hist-item-detail">
            <div className="purchase-hist-item-detail-grid">
              <div className="purchase-hist-item-detail-row">
                <span>Supplier</span>
                <strong>{item.shopName}</strong>
              </div>
              {item.description ? (
                <div className="purchase-hist-item-detail-row">
                  <span>Item purchased</span>
                  <strong>{item.description}</strong>
                </div>
              ) : null}
              {item.billNo ? (
                <div className="purchase-hist-item-detail-row">
                  <span>Bill No</span>
                  <strong>{item.billNo}</strong>
                </div>
              ) : null}
              <div className="purchase-hist-item-detail-row">
                <span>Date</span>
                <strong>{formatDate(item.date)}</strong>
              </div>
              <div className="purchase-hist-item-detail-row">
                <span>{NO1_BILL_LABEL} bill</span>
                <strong>{formatMoney(item.no1Amount)}</strong>
              </div>
              <div className="purchase-hist-item-detail-row">
                <span>{NO2_BILL_LABEL} bill</span>
                <strong>{formatMoney(item.no2Amount)}</strong>
              </div>
              <div className="purchase-hist-item-detail-row purchase-hist-item-detail-row--total">
                <span>Bill total</span>
                <strong>{formatMoney(item.amount)}</strong>
              </div>
              <div className="purchase-hist-item-detail-row purchase-hist-item-detail-row--paid">
                <span>Paid</span>
                <strong>{formatMoney(item.paidAmount)}</strong>
              </div>
              {pendingAmount > 0 ? (
                <div className="purchase-hist-item-detail-row purchase-hist-item-detail-row--pending">
                  <span>Balance due</span>
                  <strong>{formatMoney(pendingAmount)}</strong>
                </div>
              ) : null}
              {item.paidNo1Amount > 0 ? (
                <div className="purchase-hist-item-detail-row">
                  <span>{NO1_BILL_LABEL} paid</span>
                  <strong>{formatMoney(item.paidNo1Amount)}</strong>
                </div>
              ) : null}
              {item.paidNo2Amount > 0 ? (
                <div className="purchase-hist-item-detail-row">
                  <span>{NO2_BILL_LABEL} paid</span>
                  <strong>{formatMoney(item.paidNo2Amount)}</strong>
                </div>
              ) : null}
            </div>
            <p className="purchase-hist-item-detail-pay">{item.payDetail}</p>
            {renderBillActions(item)}
          </div>
        ) : null}
      </li>
    )
  }

  const panel = (
    <div
      className={`purchase-hist-overlay ${fullscreen ? 'purchase-hist-overlay--fullscreen' : ''} ${embedded ? 'purchase-hist-overlay--embedded' : ''}`}
      role="dialog"
      aria-modal={embedded ? undefined : true}
      onClick={fullscreen || embedded ? undefined : handleClose}
    >
      <div className="purchase-hist-panel page-shell" onClick={(e) => e.stopPropagation()}>
        <PageCorners
        left={
          <PageBackButton
            onClick={handleBack}
            ariaLabel={
              showCreditPage
                ? 'Back to purchase history'
                : selectedSupplierKey
                  ? 'Back to suppliers'
                  : embedded
                    ? `Back to ${embeddedBackLabel.toLowerCase()}`
                    : 'Back'
            }
          />
        }
          right={<PageCloseButton onClick={handleClose} />}
        />
        {showCreditPage ? (
          <PurchaseCreditPanel
            ref={creditPanelRef}
            data={data}
            embedded={embedded}
            onClose={() => setShowCreditPage(false)}
            onUpdateBill={handleUpdateBill}
          />
        ) : (
          <>
        <div className="purchase-hist-top">
          <div className="purchase-hist-head page-head--corners">
            <h3>{selectedSupplier ? selectedSupplier.shopName : 'Purchase History'}</h3>
            {selectedSupplier ? (
              <p className="purchase-hist-supplier-sub">
                {supplierAllFileSummary?.billCount ?? 0} bills · all time · by bill date
              </p>
            ) : null}
          </div>

          <input
            type="search"
            className="purchase-hist-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              selectedSupplier ? 'Search item, amount…' : 'Search supplier, item, amount…'
            }
            aria-label="Search purchase history"
          />

          <div className="purchase-hist-pay-channel">
            <span className="purchase-hist-pay-channel-label">Pay</span>
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'cash', label: '💵 Cash' },
                { id: 'bank', label: '🏦 Bank' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`purchase-hist-date-chip ${payChannel === opt.id ? 'purchase-hist-date-chip--active' : ''}`}
                onClick={() => setPayChannel(opt.id)}
              >
                {opt.label}
              </button>
            ))}
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
                  setSelectedMonth('')
                }}
              >
                {opt.label}
              </button>
            ))}
            <label
              className={`purchase-hist-date-pick purchase-hist-date-pick--month ${dateFilter === 'monthPick' ? 'purchase-hist-date-pick--active' : ''}`}
            >
              <span>Month</span>
              <select
                className="purchase-hist-month-select"
                value={dateFilter === 'monthPick' ? selectedMonth : ''}
                onChange={(e) => {
                  const value = e.target.value
                  if (!value) {
                    setSelectedMonth('')
                    setDateFilter('all')
                    return
                  }
                  setSelectedMonth(value)
                  setDateFilter('monthPick')
                  setSelectedDate('')
                }}
                aria-label="Pick month for purchase history"
              >
                <option value="">All months</option>
                {monthOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className={`purchase-hist-date-pick ${dateFilter === 'date' ? 'purchase-hist-date-pick--active' : ''}`}
            >
              <span>Pick date</span>
              <input
                type="date"
                className="purchase-hist-date-input"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value)
                  setSelectedMonth('')
                  if (e.target.value) setDateFilter('date')
                }}
                aria-label="Pick date for purchase history"
              />
            </label>
          </div>

          {dateFilter === 'range' ? (
            <div className="purchase-hist-range-pick">
              <label className="purchase-hist-date-pick">
                <span>From</span>
                <input
                  type="date"
                  className="purchase-hist-date-input purchase-hist-date-input--active"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  aria-label="Purchase range from date"
                />
              </label>
              <label className="purchase-hist-date-pick">
                <span>To</span>
                <input
                  type="date"
                  className="purchase-hist-date-input purchase-hist-date-input--active"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  aria-label="Purchase range to date"
                />
              </label>
            </div>
          ) : null}

          <div className="purchase-hist-export-bar">
            <button type="button" className="purchase-hist-export-btn" onClick={handleDownloadSpreadsheet}>
              Download Excel
            </button>
            {exportStatus ? <span className="purchase-hist-export-status">{exportStatus}</span> : null}
          </div>
        </div>

        <div className="purchase-hist-body">
        {!selectedSupplier ? (
          <>
            {renderSupplierBalanceDue(allTimeSummary, { scope: 'all' })}
            {renderPeriodReport(periodSummary, purchasePeriodLabel(), {
              supplierCount: allSupplierGroups.length,
            })}
          </>
        ) : selectedSupplier ? (
          <>
            {supplierAllFileSummary ? renderSupplierBalanceDue(supplierAllFileSummary) : null}

            {supplierAllFileSummary
              ? renderPeriodReport(supplierAllFileSummary, 'All time')
              : renderPeriodReport(
                  {
                    billCount: 0,
                    pendingBillCount: 0,
                    paidBillCount: 0,
                    creditOpenBillCount: 0,
                    creditOpenTotal: 0,
                    billTotal: 0,
                    no1BillTotal: 0,
                    no2BillTotal: 0,
                    paidTotal: 0,
                    pendingTotal: 0,
                    paidNo1Total: 0,
                    paidNo2Total: 0,
                    cashTotal: 0,
                    bankTotal: 0,
                    no1CashTotal: 0,
                    no1BankTotal: 0,
                    no2CashTotal: 0,
                    no2BankTotal: 0,
                    no2ChequeTotal: 0,
                    chequeTotal: 0,
                  },
                  purchasePeriodLabel(),
                )}

            <div className="purchase-hist-supplier-tools">
              <div className="purchase-hist-supplier-sort">
                <span>Sort</span>
                <button
                  type="button"
                  className={`purchase-hist-date-chip ${supplierSort === 'newest' ? 'purchase-hist-date-chip--active' : ''}`}
                  onClick={() => setSupplierSort('newest')}
                >
                  Newest
                </button>
                <button
                  type="button"
                  className={`purchase-hist-date-chip ${supplierSort === 'oldest' ? 'purchase-hist-date-chip--active' : ''}`}
                  onClick={() => setSupplierSort('oldest')}
                >
                  Oldest
                </button>
              </div>
              <p className="purchase-hist-supplier-hint">Tap a bill to see details</p>
            </div>
          </>
        ) : null}

        {!selectedSupplier && purchaseCreditItems.length > 0 ? (
          <section className="purchase-hist-credit-section" aria-label="Purchase credit history">
            <button
              type="button"
              className="purchase-hist-credit-open purchase-hist-credit-open--page"
              onClick={() => setShowCreditPage(true)}
            >
              <span>💳 Open Purchase Credits ({purchaseCreditItems.length})</span>
              <span className="purchase-hist-credit-open-meta">
                <span className="purchase-hist-credit-open-total">{formatMoney(purchaseCreditTotal)}</span>
                <span className="purchase-hist-credit-open-caret">→</span>
              </span>
            </button>
          </section>
        ) : null}

        {!selectedSupplier ? (
          allSupplierGroups.length === 0 ? (
            search.trim() ? (
              <p className="purchase-hist-empty">No suppliers match your search.</p>
            ) : null
          ) : (
            <section className="purchase-hist-suppliers-section" aria-label="Suppliers">
              <div className="purchase-hist-suppliers-head">
                <h4 className="purchase-hist-suppliers-title">Suppliers</h4>
                <span className="purchase-hist-suppliers-count">{allSupplierGroups.length}</span>
              </div>
              <div className="purchase-hist-supplier-sort purchase-hist-supplier-sort--list">
                <span>Order</span>
                <button
                  type="button"
                  className={`purchase-hist-date-chip ${supplierGroupOrder === 'name' ? 'purchase-hist-date-chip--active' : ''}`}
                  onClick={() => setSupplierGroupOrder('name')}
                >
                  A–Z
                </button>
                <button
                  type="button"
                  className={`purchase-hist-date-chip ${supplierGroupOrder === 'spend' ? 'purchase-hist-date-chip--active' : ''}`}
                  onClick={() => setSupplierGroupOrder('spend')}
                >
                  By spend
                </button>
              </div>
              <p className="purchase-hist-suppliers-hint">Tap a supplier to open bills · oldest first inside each dealer</p>
              {renderSupplierGroupsList()}
            </section>
          )
        ) : sortedSupplierItems.length === 0 ? (
          <p className="purchase-hist-empty">
            {search.trim() ? 'No purchases match your search.' : 'No purchases for this supplier.'}
          </p>
        ) : (
          <ul className="purchase-hist-list">{sortedSupplierItems.map(renderPurchaseItem)}</ul>
        )}

        {!selectedSupplier && paymentHistoryItems.length > 0 ? (
          <section className="purchase-hist-payments" aria-label="Payment history">
            <h4 className="purchase-hist-payments-title">Payment history</h4>
            <ul className="purchase-hist-list purchase-hist-list--payments">
              {paymentHistoryItems.map((item) => (
                <li key={`pay-${item.id}`} className="purchase-hist-payment-row">
                  <div className="purchase-hist-payment-main">
                    <span className="purchase-hist-payment-shop">{item.shopName}</span>
                    <span className="purchase-hist-payment-amount">-{formatMoney(item.paidAmount)}</span>
                  </div>
                  <span className="purchase-hist-payment-meta">
                    {formatDate(item.date)} · {NO1_BILL_LABEL} {formatMoney(item.paidNo1Amount)} ·{' '}
                    {NO2_BILL_LABEL} {formatMoney(item.paidNo2Amount)} · {item.payLabel}
                  </span>
                  <span className="purchase-hist-payment-detail">{item.payDetail}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        </div>

        <div className="purchase-hist-footer">
          <button type="button" className="purchase-hist-back" onClick={handleBack}>
            {selectedSupplierKey
              ? '← Suppliers'
              : embedded
                ? `← ${embeddedBackLabel}`
                : '← Back'}
          </button>
          {!fullscreen && !embedded ? (
            <button type="button" className="purchase-hist-home" onClick={handleGoHome}>
              🏠 Home
            </button>
          ) : embedded ? (
            <button
              type="button"
              className="purchase-hist-home"
              onClick={() => navigate('/purchase')}
            >
              🛒 {embeddedActionLabel}
            </button>
          ) : (
            <button type="button" className="purchase-hist-home" onClick={() => navigate('/purchase')}>
              🛒 Purchase
            </button>
          )}
          <span className="purchase-hist-esc-hint">Esc · back</span>
        </div>
          </>
        )}
      </div>
    </div>
  )

  if (embedded) return panel
  return <Portal>{panel}</Portal>
}
