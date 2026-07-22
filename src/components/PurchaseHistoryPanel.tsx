import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppData } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import { NO1_BILL_LABEL, NO1_EXPENSE_LABEL, NO2_BILL_LABEL, NO2_EXPENSE_LABEL } from '../utils/expenseBillLabels'
import {
  buildPurchaseHistoryItems,
  filterPurchaseHistoryItems,
  getTopPurchaseShop,
  groupPurchasesBySupplier,
  matchesPurchaseHistorySearch,
  summarizePurchases,
  type PurchaseDateFilter,
  type PurchaseHistoryItem,
  type PurchaseSupplierGroup,
} from '../utils/purchaseHistory'
import './PurchaseHistoryPanel.css'

const DATE_OPTIONS: { id: PurchaseDateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
]

interface PurchaseHistoryPanelProps {
  open: boolean
  onClose: () => void
  data: AppData
  variant?: 'modal' | 'fullscreen'
  onOpenBill?: (expenseId: string) => void
  onUpdateBill?: (expenseId: string) => void
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
  onOpenBill,
  onUpdateBill,
}: PurchaseHistoryPanelProps) {
  const navigate = useNavigate()
  const fullscreen = variant === 'fullscreen'
  const [dateFilter, setDateFilter] = useState<PurchaseDateFilter>('today')
  const [selectedDate, setSelectedDate] = useState('')
  const [search, setSearch] = useState('')
  const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  const allItems = useMemo(() => buildPurchaseHistoryItems(data), [data])
  const dateFilteredItems = useMemo(
    () => filterPurchaseHistoryItems(allItems, dateFilter, selectedDate),
    [allItems, dateFilter, selectedDate],
  )
  const items = useMemo(() => {
    if (!search.trim()) return dateFilteredItems
    return dateFilteredItems.filter((item) => matchesPurchaseHistorySearch(item, search))
  }, [dateFilteredItems, search])
  const supplierGroups = useMemo(() => groupPurchasesBySupplier(items), [items])
  const summary = useMemo(() => summarizePurchases(items), [items])
  const topShop = useMemo(() => getTopPurchaseShop(items), [items])
  const selectedSupplier = useMemo((): PurchaseSupplierGroup | null => {
    if (!selectedSupplierKey) return null
    const fromGroups = supplierGroups.find((group) => group.shopKey === selectedSupplierKey)
    if (fromGroups) return fromGroups
    const shopItems = items.filter((item) => item.shopName.trim().toLowerCase() === selectedSupplierKey)
    if (shopItems.length === 0) {
      const name =
        dateFilteredItems.find((item) => item.shopName.trim().toLowerCase() === selectedSupplierKey)
          ?.shopName ?? selectedSupplierKey
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
  }, [selectedSupplierKey, supplierGroups, items, dateFilteredItems])

  if (!open) return null

  function handleClose() {
    setSelectedSupplierKey(null)
    setExpandedItemId(null)
    setSearch('')
    onClose()
  }

  function handleGoHome() {
    handleClose()
    navigate('/')
  }

  function handleBack() {
    if (selectedSupplierKey) {
      setSelectedSupplierKey(null)
      setExpandedItemId(null)
      return
    }
    handleClose()
  }

  function handleOpenBill(expenseId: string) {
    handleClose()
    if (onOpenBill) {
      onOpenBill(expenseId)
      return
    }
    navigate(`/purchase?open=${encodeURIComponent(expenseId)}`)
  }

  function handleUpdateBill(expenseId: string) {
    handleClose()
    if (onUpdateBill) {
      onUpdateBill(expenseId)
      return
    }
    navigate(`/purchase?edit=${encodeURIComponent(expenseId)}`)
  }

  function renderBillActions(billId: string) {
    return (
      <div className="purchase-hist-item-actions purchase-hist-item-actions--bill">
        <button type="button" className="purchase-hist-action-btn" onClick={() => handleOpenBill(billId)}>
          Open Bill
        </button>
        <button
          type="button"
          className="purchase-hist-action-btn purchase-hist-action-btn--update"
          onClick={() => handleUpdateBill(billId)}
        >
          Update
        </button>
      </div>
    )
  }

  function renderPurchaseItem(item: PurchaseHistoryItem) {
    const expanded = expandedItemId === item.id
    return (
      <li key={item.id} className={`purchase-hist-item ${expanded ? 'purchase-hist-item--expanded' : ''}`}>
        <button
          type="button"
          className="purchase-hist-item-btn"
          onClick={() => setExpandedItemId(expanded ? null : item.id)}
        >
          <div className="purchase-hist-item-info">
            <div className="purchase-hist-item-top">
              <span className="purchase-hist-item-label">
                {item.description || item.billLabel}
                <span className={`purchase-hist-bill-tag ${billTagClass(item.billType)}`}>
                  {item.billLabel}
                </span>
              </span>
              <span className="purchase-hist-item-amount">-{formatMoney(item.amount)}</span>
            </div>
            <span className="purchase-hist-item-meta">
              {formatDate(item.date)} · {item.payLabel}
            </span>
          </div>
        </button>
        {expanded ? (
          <div className="purchase-hist-item-detail">
            {item.description ? (
              <div className="purchase-hist-item-detail-row">
                <span>Item</span>
                <strong>{item.description}</strong>
              </div>
            ) : null}
            <div className="purchase-hist-item-detail-row">
              <span>Date</span>
              <strong>{formatDate(item.date)}</strong>
            </div>
            <div className="purchase-hist-item-detail-row">
              <span>No 1</span>
              <strong>{formatMoney(item.no1Amount)}</strong>
            </div>
            <div className="purchase-hist-item-detail-row">
              <span>No 2</span>
              <strong>{formatMoney(item.no2Amount)}</strong>
            </div>
            <div className="purchase-hist-item-detail-row purchase-hist-item-detail-row--total">
              <span>Total</span>
              <strong>{formatMoney(item.amount)}</strong>
            </div>
            {item.amount !== item.paidAmount ? (
              <div className="purchase-hist-item-detail-row">
                <span>Paid</span>
                <strong>{formatMoney(item.paidAmount)}</strong>
              </div>
            ) : null}
            <p className="purchase-hist-item-detail-pay">{item.payDetail}</p>
            {renderBillActions(item.id)}
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div
      className={`purchase-hist-overlay ${fullscreen ? 'purchase-hist-overlay--fullscreen' : ''}`}
      role="dialog"
      aria-modal="true"
      onClick={fullscreen ? undefined : handleClose}
    >
      <div className="purchase-hist-panel" onClick={(e) => e.stopPropagation()}>
        <div className="purchase-hist-head">
          <h3>{selectedSupplier ? selectedSupplier.shopName : 'Purchase History'}</h3>
          <button type="button" className="purchase-hist-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <input
          type="search"
          className="purchase-hist-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search supplier, item, amount…"
          aria-label="Search purchase history"
        />

        {!selectedSupplier ? (
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
                  if (e.target.value) setDateFilter('date')
                }}
                aria-label="Pick date for purchase history"
              />
            </label>
          </div>
        ) : null}

        {!selectedSupplier ? (
          <>
            <div className="purchase-hist-summary-top">
              <div className="purchase-hist-summary-row purchase-hist-summary-row--no1">
                <span>{NO1_EXPENSE_LABEL}</span>
                <strong>{formatMoney(summary.gstTotal)}</strong>
              </div>
              <div className="purchase-hist-summary-row purchase-hist-summary-row--no2">
                <span>{NO2_EXPENSE_LABEL}</span>
                <strong>{formatMoney(summary.noGstTotal)}</strong>
              </div>
              <div className="purchase-hist-summary-row purchase-hist-summary-row--total">
                <span>Total</span>
                <strong>{formatMoney(summary.total)}</strong>
              </div>
              <span className="purchase-hist-summary-count">
                {summary.count} purchases · {supplierGroups.length} suppliers
              </span>
            </div>

            {topShop ? (
              <div className="purchase-hist-top-shop">
                <span className="purchase-hist-top-shop-label">Top Supplier</span>
                <strong>{topShop.shopName}</strong>
                <span>
                  {NO1_EXPENSE_LABEL} {formatMoney(topShop.gstTotal)} · {NO2_EXPENSE_LABEL}{' '}
                  {formatMoney(topShop.noGstTotal)}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="purchase-hist-supplier-summary">
            <div className="purchase-hist-supplier-summary-row">
              <span>Total</span>
              <strong>{formatMoney(selectedSupplier.total)}</strong>
            </div>
            <div className="purchase-hist-supplier-summary-row">
              <span>{NO1_EXPENSE_LABEL}</span>
              <strong>{formatMoney(selectedSupplier.gstTotal)}</strong>
            </div>
            <div className="purchase-hist-supplier-summary-row">
              <span>{NO2_EXPENSE_LABEL}</span>
              <strong>{formatMoney(selectedSupplier.noGstTotal)}</strong>
            </div>
            <span className="purchase-hist-supplier-summary-count">
              {selectedSupplier.count} purchases · tap row for details
            </span>
          </div>
        )}

        {!selectedSupplier ? (
          supplierGroups.length === 0 ? (
            <p className="purchase-hist-empty">
              {search.trim() ? 'No purchases match your search.' : 'No purchases for this period.'}
            </p>
          ) : (
            <ul className="purchase-hist-list purchase-hist-list--suppliers">
              {supplierGroups.map((group) => (
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
                      <span className="purchase-hist-item-amount">-{formatMoney(group.total)}</span>
                    </div>
                    <span className="purchase-hist-supplier-meta">
                      {group.count} purchases · {NO1_BILL_LABEL} {formatMoney(group.gstTotal)} ·{' '}
                      {NO2_BILL_LABEL} {formatMoney(group.noGstTotal)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : selectedSupplier.items.length === 0 ? (
          <p className="purchase-hist-empty">
            {search.trim() ? 'No purchases match your search.' : 'No purchases for this supplier.'}
          </p>
        ) : (
          <ul className="purchase-hist-list">{selectedSupplier.items.map(renderPurchaseItem)}</ul>
        )}

        <div className="purchase-hist-footer">
          <button type="button" className="purchase-hist-back" onClick={handleBack}>
            {selectedSupplierKey ? '← Suppliers' : fullscreen ? '✕ Close' : '← Back'}
          </button>
          {!fullscreen ? (
            <button type="button" className="purchase-hist-home" onClick={handleGoHome}>
              🏠 Home
            </button>
          ) : (
            <button type="button" className="purchase-hist-home" onClick={() => navigate('/purchase')}>
              🛒 Purchase
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
