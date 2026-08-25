import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppData } from '../types'
import { useCash } from '../context/CashContext'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { NO1_BILL_LABEL, NO2_BILL_LABEL } from '../utils/expenseBillLabels'
import { formatDate, formatMoney } from '../utils/format'
import {
  buildPurchaseCreditItems,
  filterPurchaseCreditItemsByMonth,
  formatPurchaseCreditMonthLabel,
  groupPurchaseCreditsBySupplier,
  listPurchaseCreditMonthOptions,
  matchesPurchaseCreditItem,
  matchesPurchaseCreditSupplier,
  sortPurchaseCreditItems,
  summarizePurchaseCreditItems,
  type PurchaseCreditBillSort,
  type PurchaseCreditItem,
  type PurchaseCreditSupplierGroup,
} from '../utils/purchaseHistory'
import PurchaseCreditPayModal from './PurchaseCreditPayModal'
import './PurchaseHistoryPanel.css'

interface PurchaseCreditPanelProps {
  data: AppData
  embedded?: boolean
  onClose: () => void
  onUpdateBill?: (expenseId: string) => void
}

export interface PurchaseCreditPanelHandle {
  back: () => boolean
}

const CREDIT_SORT_OPTIONS: { id: PurchaseCreditBillSort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'no1', label: NO1_BILL_LABEL },
  { id: 'no2', label: NO2_BILL_LABEL },
  { id: 'billNo', label: 'Bill No' },
]

const PurchaseCreditPanel = forwardRef<PurchaseCreditPanelHandle, PurchaseCreditPanelProps>(
  function PurchaseCreditPanel({ data, embedded = false, onClose, onUpdateBill }, ref) {
    const navigate = useNavigate()
    const { applyBulkPurchaseCreditPayments } = useCash()
    const { value: search, setValue: setSearch, deferredValue: deferredSearch } = useDeferredSearch()
    const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null)
    const [expandedCreditId, setExpandedCreditId] = useState<string | null>(null)
    const [selectedMonth, setSelectedMonth] = useState<string>('all')
    const [showDetails, setShowDetails] = useState(false)
    const [selectMode, setSelectMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
    const [creditSort, setCreditSort] = useState<PurchaseCreditBillSort>('newest')
    const [payModalOpen, setPayModalOpen] = useState(false)
    const [payStatus, setPayStatus] = useState('')

    const purchaseCreditItems = useMemo(() => buildPurchaseCreditItems(data), [data])
    const rootSummary = useMemo(() => summarizePurchaseCreditItems(purchaseCreditItems), [purchaseCreditItems])
    const supplierGroups = useMemo(
      () => groupPurchaseCreditsBySupplier(purchaseCreditItems),
      [purchaseCreditItems],
    )
    const filteredSuppliers = useMemo(() => {
      if (!deferredSearch.trim()) return supplierGroups
      return supplierGroups.filter((group) => matchesPurchaseCreditSupplier(group, deferredSearch))
    }, [supplierGroups, deferredSearch])
    const selectedSupplier = useMemo((): PurchaseCreditSupplierGroup | null => {
      if (!selectedSupplierKey) return null
      return supplierGroups.find((group) => group.shopKey === selectedSupplierKey) ?? null
    }, [selectedSupplierKey, supplierGroups])
    const supplierMonthOptions = useMemo(
      () => (selectedSupplier ? listPurchaseCreditMonthOptions(selectedSupplier.items) : []),
      [selectedSupplier],
    )
    const supplierCreditItems = useMemo(() => {
      if (!selectedSupplier) return []
      let items = filterPurchaseCreditItemsByMonth(selectedSupplier.items, selectedMonth)
      if (deferredSearch.trim()) {
        items = items.filter((item) => matchesPurchaseCreditItem(item, deferredSearch))
      }
      return sortPurchaseCreditItems(items, creditSort)
    }, [selectedSupplier, selectedMonth, deferredSearch, creditSort])
    const flatSelectableItems = useMemo(() => {
      let items = purchaseCreditItems
      if (selectedSupplier) {
        items = filterPurchaseCreditItemsByMonth(selectedSupplier.items, selectedMonth)
      }
      if (deferredSearch.trim()) {
        items = items.filter((item) => matchesPurchaseCreditItem(item, deferredSearch))
      }
      return sortPurchaseCreditItems(items, creditSort)
    }, [purchaseCreditItems, selectedSupplier, selectedMonth, deferredSearch, creditSort])
    const supplierSummary = useMemo(
      () => summarizePurchaseCreditItems(supplierCreditItems),
      [supplierCreditItems],
    )
    const supplierAllSummary = useMemo(
      () => (selectedSupplier ? summarizePurchaseCreditItems(selectedSupplier.items) : null),
      [selectedSupplier],
    )
    const selectedCredits = useMemo(
      () => flatSelectableItems.filter((item) => selectedIds.has(item.id)),
      [flatSelectableItems, selectedIds],
    )
    const selectedTotal = useMemo(
      () => selectedCredits.reduce((sum, item) => sum + item.amount, 0),
      [selectedCredits],
    )

    function clearSelection() {
      setSelectedIds(new Set())
    }

    function toggleCreditSelection(id: string) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    function selectAllVisible() {
      setSelectedIds(new Set(flatSelectableItems.map((item) => item.id)))
    }

    function handleBack() {
      if (payModalOpen) {
        setPayModalOpen(false)
        return
      }
      if (expandedCreditId) {
        setExpandedCreditId(null)
        return
      }
      if (selectedSupplierKey) {
        setSelectedSupplierKey(null)
        setSelectedMonth('all')
        setShowDetails(false)
        setSelectMode(false)
        clearSelection()
        return
      }
      onClose()
    }

    function handleUpdateBill(expenseId: string) {
      if (onUpdateBill) {
        onUpdateBill(expenseId)
        return
      }
      navigate(`/purchase?edit=${encodeURIComponent(expenseId)}`)
    }

    function openSupplier(shopKey: string) {
      setSelectedSupplierKey(shopKey)
      setExpandedCreditId(null)
      setSelectedMonth('all')
      setShowDetails(false)
      clearSelection()
    }

    function toggleSelectMode() {
      setSelectMode((prev) => {
        if (prev) clearSelection()
        return !prev
      })
    }

    function handleBulkPay(
      payments: Array<{
        id: string
        payment: {
          payType: import('../types').ExpensePayType
          payAmount: number
          cashAmount?: number
          bankAmount?: number
          chequeAmount?: number
          chequeApproved?: boolean
        }
      }>,
    ) {
      applyBulkPurchaseCreditPayments(payments)
      setPayModalOpen(false)
      clearSelection()
      setSelectMode(false)
      setPayStatus(`Paid ${payments.length} credit bill${payments.length === 1 ? '' : 's'}`)
    }

    useImperativeHandle(ref, () => ({
      back: () => {
        if (payModalOpen) {
          setPayModalOpen(false)
          return true
        }
        if (expandedCreditId) {
          setExpandedCreditId(null)
          return true
        }
        if (selectedSupplierKey) {
          setSelectedSupplierKey(null)
          setSelectedMonth('all')
          setShowDetails(false)
          setSelectMode(false)
          clearSelection()
          return true
        }
        return false
      },
    }))

    useEffect(() => {
      function onKeyDown(e: KeyboardEvent) {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        handleBack()
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [expandedCreditId, selectedSupplierKey, payModalOpen, onClose])

    function renderCreditReport(
      summary: ReturnType<typeof summarizePurchaseCreditItems>,
      labelPrefix: string,
    ) {
      return (
        <div className="purchase-hist-credits-report" aria-label={`${labelPrefix} credit report`}>
          <div className="purchase-hist-credits-report-row purchase-hist-credits-report-row--total">
            <span>Total credit</span>
            <strong>{formatMoney(summary.creditTotal)}</strong>
          </div>
          <div className="purchase-hist-credits-report-row purchase-hist-credits-report-row--no1">
            <span>{NO1_BILL_LABEL}</span>
            <strong>{formatMoney(summary.no1CreditTotal)}</strong>
          </div>
          <div className="purchase-hist-credits-report-row purchase-hist-credits-report-row--no2">
            <span>{NO2_BILL_LABEL}</span>
            <strong>{formatMoney(summary.no2CreditTotal)}</strong>
          </div>
          <div className="purchase-hist-credits-report-meta">
            <span>{summary.creditCount} bills</span>
            <span>
              {NO1_BILL_LABEL} {summary.no1Count} · {NO2_BILL_LABEL} {summary.no2Count}
            </span>
            <span>Paid {formatMoney(summary.paidTotal)} · Bill {formatMoney(summary.billTotal)}</span>
          </div>
        </div>
      )
    }

    function renderCreditSideButton(creditId: string) {
      if (selectMode) return null
      return (
        <button
          type="button"
          className="purchase-hist-side-credit-btn"
          onClick={(e) => {
            e.stopPropagation()
            handleUpdateBill(creditId)
          }}
        >
          Credit Update
        </button>
      )
    }

    function renderPurchaseCreditItem(credit: PurchaseCreditItem, showSupplier = false) {
      const expanded = showDetails && expandedCreditId === credit.id
      const checked = selectedIds.has(credit.id)
      return (
        <li
          key={credit.id}
          className={`purchase-hist-credit-item ${expanded ? 'purchase-hist-credit-item--expanded' : ''}${checked ? ' purchase-hist-credit-item--selected' : ''}`}
        >
          <div className="purchase-hist-credit-item-row">
            {selectMode ? (
              <label className="purchase-hist-select-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCreditSelection(credit.id)}
                  aria-label={`Select ${credit.shopName}`}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="purchase-hist-credit-item-btn"
              onClick={() => {
                if (selectMode) {
                  toggleCreditSelection(credit.id)
                  return
                }
                if (!showDetails) return
                setExpandedCreditId(expanded ? null : credit.id)
              }}
            >
              <span className="purchase-hist-credit-item-top">
                <span>
                  {showSupplier ? (
                    <>
                      <strong className="purchase-hist-credit-supplier-inline">{credit.shopName}</strong>
                      {' · '}
                    </>
                  ) : null}
                  {credit.description || credit.billLabel}
                </span>
                <span className="purchase-hist-credit-item-balance">{formatMoney(credit.amount)}</span>
              </span>
              <span className="purchase-hist-credit-item-types">
                <span className="purchase-hist-credit-type-chip">{credit.billLabel}</span>
                <span className="purchase-hist-credit-type-chip purchase-hist-credit-type-chip--pay">
                  {credit.payLabel}
                </span>
              </span>
              <span className="purchase-hist-credit-item-meta">
                {credit.billNo ? `Bill No ${credit.billNo} · ` : ''}
                Paid {formatMoney(credit.paidAmount)} · Bill {formatMoney(credit.billTotal)} ·{' '}
                {formatDate(credit.date)}
              </span>
            </button>
            {renderCreditSideButton(credit.id)}
          </div>
          {expanded ? (
            <div className="purchase-hist-item-credit">
              {credit.description ? (
                <span className="purchase-hist-credit-item-pay">{credit.description}</span>
              ) : null}
              {credit.billNo ? (
                <span className="purchase-hist-credit-item-pay">Bill No · {credit.billNo}</span>
              ) : null}
              <span className="purchase-hist-credit-item-pay">{credit.payDetail}</span>
              <div className="purchase-hist-item-credit-row">
                <span>Open credit</span>
                <strong>{formatMoney(credit.amount)}</strong>
              </div>
            </div>
          ) : showDetails && !selectMode ? (
            <div className="purchase-hist-credits-item-inline">
              <span>{credit.payDetail}</span>
            </div>
          ) : null}
        </li>
      )
    }

    return (
      <div className="purchase-hist-credits-page">
        <div className="purchase-hist-credits-top">
          <div className="purchase-hist-credits-head">
            <h3>{selectedSupplier ? selectedSupplier.shopName : 'Purchase Credits'}</h3>
            <p className="purchase-hist-credits-sub">
              {selectedSupplier
                ? `${supplierAllSummary?.creditCount ?? 0} credit bills · search · select · bulk pay`
                : `${purchaseCreditItems.length} open bills · ${supplierGroups.length} suppliers · select to pay many at once`}
            </p>
          </div>

          <input
            type="search"
            className="purchase-hist-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              selectedSupplier ? 'Search bill, item, bill no…' : 'Search supplier, bill, amount…'
            }
            aria-label="Search purchase credits"
          />

          <div className="purchase-hist-credits-toolbar">
            <button
              type="button"
              className={`purchase-hist-date-chip ${selectMode ? 'purchase-hist-date-chip--active' : ''}`}
              onClick={toggleSelectMode}
            >
              {selectMode ? 'Done selecting' : 'Select'}
            </button>
            {selectMode ? (
              <>
                <button type="button" className="purchase-hist-date-chip" onClick={selectAllVisible}>
                  Select all
                </button>
                <button
                  type="button"
                  className="purchase-hist-date-chip"
                  onClick={clearSelection}
                  disabled={selectedIds.size === 0}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="purchase-credit-pay-submit purchase-credit-pay-submit--inline"
                  disabled={selectedIds.size === 0}
                  onClick={() => setPayModalOpen(true)}
                >
                  Pay selected · {formatMoney(selectedTotal)}
                </button>
              </>
            ) : null}
          </div>

          {selectedSupplier ? (
            <>
              {renderCreditReport(
                selectedMonth === 'all' ? (supplierAllSummary ?? supplierSummary) : supplierSummary,
                selectedMonth === 'all'
                  ? selectedSupplier.shopName
                  : formatPurchaseCreditMonthLabel(selectedMonth),
              )}

              <div className="purchase-hist-credits-tools">
                <label className="purchase-hist-credits-month">
                  <span>Month</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => {
                      setSelectedMonth(e.target.value)
                      setExpandedCreditId(null)
                      clearSelection()
                    }}
                    aria-label="Filter credits by month"
                  >
                    <option value="all">All months</option>
                    {supplierMonthOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="purchase-hist-supplier-sort">
                  <span>Sort</span>
                  {CREDIT_SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`purchase-hist-date-chip ${creditSort === opt.id ? 'purchase-hist-date-chip--active' : ''}`}
                      onClick={() => setCreditSort(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!selectMode ? (
                  <label className="purchase-hist-credits-details-toggle">
                    <input
                      type="checkbox"
                      checked={showDetails}
                      onChange={(e) => {
                        setShowDetails(e.target.checked)
                        if (!e.target.checked) setExpandedCreditId(null)
                      }}
                    />
                    <span>Show details</span>
                  </label>
                ) : null}
              </div>
            </>
          ) : (
            <>
              {renderCreditReport(rootSummary, 'All suppliers')}
              {selectMode ? (
                <div className="purchase-hist-supplier-sort">
                  <span>Sort</span>
                  {CREDIT_SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`purchase-hist-date-chip ${creditSort === opt.id ? 'purchase-hist-date-chip--active' : ''}`}
                      onClick={() => setCreditSort(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {payStatus ? <p className="purchase-hist-export-status">{payStatus}</p> : null}
        </div>

        <div className="purchase-hist-credits-body">
          {selectMode ? (
            flatSelectableItems.length === 0 ? (
              <p className="purchase-hist-empty">No credit bills match your search.</p>
            ) : (
              <ul className="purchase-hist-credit-list purchase-hist-credit-list--panel">
                {flatSelectableItems.map((credit) =>
                  renderPurchaseCreditItem(credit, !selectedSupplier),
                )}
              </ul>
            )
          ) : !selectedSupplier ? (
            filteredSuppliers.length === 0 ? (
              <p className="purchase-hist-empty">
                {search.trim() ? 'No suppliers match your search.' : 'No open purchase credits.'}
              </p>
            ) : (
              <ul className="purchase-hist-list purchase-hist-list--suppliers">
                {filteredSuppliers.map((group) => (
                  <li key={group.shopKey} className="purchase-hist-supplier">
                    <button
                      type="button"
                      className="purchase-hist-supplier-btn purchase-hist-supplier-btn--credit"
                      onClick={() => openSupplier(group.shopKey)}
                    >
                      <div className="purchase-hist-supplier-top">
                        <span className="purchase-hist-supplier-name">{group.shopName}</span>
                        <span className="purchase-hist-credit-item-balance">
                          {formatMoney(group.creditTotal)}
                        </span>
                      </div>
                      <span className="purchase-hist-supplier-meta">
                        {group.creditCount} bills · {NO1_BILL_LABEL} {formatMoney(group.no1CreditTotal)} ·{' '}
                        {NO2_BILL_LABEL} {formatMoney(group.no2CreditTotal)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : supplierCreditItems.length === 0 ? (
            <p className="purchase-hist-empty">
              {search.trim() || selectedMonth !== 'all'
                ? 'No credit bills match your search or month.'
                : 'No credit bills for this supplier.'}
            </p>
          ) : (
            <ul className="purchase-hist-credit-list purchase-hist-credit-list--panel">
              {supplierCreditItems.map((credit) => renderPurchaseCreditItem(credit))}
            </ul>
          )}
        </div>

        <div className="purchase-hist-footer purchase-hist-footer--credits">
          <button type="button" className="purchase-hist-back" onClick={handleBack}>
            {selectedSupplierKey ? '← Suppliers' : embedded ? '← History' : '← Back'}
          </button>
          <span className="purchase-hist-esc-hint">Esc · back</span>
        </div>

        <PurchaseCreditPayModal
          open={payModalOpen}
          selections={selectedCredits.map((item) => ({ id: item.id, amount: item.amount }))}
          onClose={() => setPayModalOpen(false)}
          onConfirm={handleBulkPay}
        />
      </div>
    )
  },
)

export default PurchaseCreditPanel
