import { useEffect, useMemo, useRef, useState, useCallback, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import PurchaseHistoryPanel from '../components/PurchaseHistoryPanel'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import { useAppPageBack } from '../hooks/useAppPageBack'
import { usePageEscape } from '../hooks/usePageEscape'
import { formatDate, formatMoney } from '../utils/format'
import { buildPurchaseCreditItems } from '../utils/purchaseHistory'
import { counterBillPath, resolveHistoryItemBillId } from '../utils/counterBillRoute'
import { readBillEditMode } from '../utils/billEditMode'
import {
  buildHistoryItems,
  getHistoryPaymentLabel,
  getHistoryPaymentSortKey,
  getHistoryItemListPaymentParts,
  getHistoryListPaymentPartIcon,
  getHistoryListPaymentPartLabel,
  getHistoryTypeLabel,
  historyItemAmountForDateFilter,
  historyItemCreatedTime,
  historyItemSortTime,
  historyItemActivityLabel,
  historyItemListDateLabel,
  historyItemListPaymentTypeText,
  historyItemListRowSub,
  matchesHistoryDateFilter,
  matchesHistoryPaymentFilter,
  matchesHistorySearch,
  type HistoryFilter,
  type HistoryItem,
  type HistoryItemType,
  type HistoryPaymentFilter,
} from '../utils/historyItems'
import './History.css'

type HistorySort =
  | 'date-desc'
  | 'created-desc'
  | 'date-asc'
  | 'amount-desc'
  | 'amount-asc'
  | 'payment-asc'
  | 'payment-desc'
  | 'name-asc'
  | 'name-desc'
type DateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'date'

const FILTER_OPTIONS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sale', label: 'Bills' },
  { id: 'expense', label: 'Expenses' },
  { id: 'purchase', label: 'Purchases' },
  { id: 'deposit', label: 'Added' },
  { id: 'transfer', label: 'Transfer' },
]

const SORT_OPTIONS: { id: HistorySort; label: string }[] = [
  { id: 'date-desc', label: 'Latest → Oldest' },
  { id: 'date-asc', label: 'Oldest → Latest' },
  { id: 'created-desc', label: 'Newest bill first' },
  { id: 'amount-desc', label: 'Highest amount' },
  { id: 'amount-asc', label: 'Lowest amount' },
  { id: 'payment-asc', label: 'Payment A → Z' },
  { id: 'payment-desc', label: 'Payment Z → A' },
  { id: 'name-asc', label: 'Name A → Z' },
  { id: 'name-desc', label: 'Name Z → A' },
]

const DATE_FILTER_OPTIONS: { id: DateFilter; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'date', label: 'Pick a date…' },
]

const TYPE_SUMMARY: { id: HistoryItemType; label: string; icon: string; sign: string }[] = [
  { id: 'sale', label: 'Bills', icon: '💵', sign: '+' },
  { id: 'expense', label: 'Expenses', icon: '📤', sign: '-' },
  { id: 'purchase', label: 'Purchases', icon: '🛒', sign: '-' },
  { id: 'deposit', label: 'Added', icon: '📥', sign: '+' },
  { id: 'transfer', label: 'Transfer', icon: '🔄', sign: '' },
]

const PAYMENT_FILTER_OPTIONS: { id: HistoryPaymentFilter; label: string }[] = [
  { id: 'all', label: 'All payments' },
  { id: 'cash', label: '💵 Cash' },
  { id: 'bank', label: '🏦 Bank' },
  { id: 'credit', label: '💳 Credit' },
  { id: 'cheque', label: '🧾 Cheque' },
  { id: 'split', label: '➗ Split' },
  { id: 'pending', label: '⏳ Pending' },
]

function historyIcon(type: HistoryItemType): string {
  if (type === 'sale') return '💵'
  if (type === 'deposit') return '📥'
  if (type === 'transfer') return '🔄'
  if (type === 'purchase') return '🛒'
  if (type === 'loan') return '🤝'
  return '📤'
}

function nameLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Customer name'
  if (type === 'purchase') return 'Supplier name'
  return 'Note / name'
}

function namePlaceholder(type: HistoryItemType): string {
  if (type === 'sale') return 'Customer name'
  if (type === 'purchase') return 'Supplier name'
  return 'Note or name'
}

function editKey(item: HistoryItem): string {
  return `${item.type}:${item.id}`
}

export default function History() {
  const { data, updateHistoryName } = useCash()
  const navigate = useNavigate()
  const goBack = useAppPageBack()
  const location = useLocation()
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<HistoryPaymentFilter>('all')
  const [sort, setSort] = useState<HistorySort>('date-desc')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [receiptItem, setReceiptItem] = useState<HistoryItem | null>(null)
  const [purchaseCreditListOpen, setPurchaseCreditListOpen] = useState(false)
  const [highlightedPurchaseCreditIndex, setHighlightedPurchaseCreditIndex] = useState(-1)
  const [billEditMode, setBillEditMode] = useState(() => readBillEditMode())
  const [showPurchaseHistory, setShowPurchaseHistory] = useState(false)
  const [purchaseOnlyMode, setPurchaseOnlyMode] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const purchaseCreditBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const fromQuery = params.get('purchases') === '1'
    const fromState = Boolean(
      (location.state as { showPurchaseHistory?: boolean } | null)?.showPurchaseHistory,
    )
    const purchaseMode = fromQuery || fromState
    setShowPurchaseHistory(purchaseMode)
    setPurchaseOnlyMode(purchaseMode)
  }, [location.key, location.search, location.state])

  const closePurchaseHistory = useCallback(() => {
    navigate('/')
  }, [navigate])

  useEffect(() => {
    if (!purchaseCreditListOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (purchaseCreditBarRef.current?.contains(event.target as Node)) return
      setPurchaseCreditListOpen(false)
      setHighlightedPurchaseCreditIndex(-1)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [purchaseCreditListOpen])

  useEffect(() => {
    function onBillEditModeChange(event: Event) {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') setBillEditMode(detail)
    }
    window.addEventListener('bill-edit-mode', onBillEditModeChange)
    return () => window.removeEventListener('bill-edit-mode', onBillEditModeChange)
  }, [])

  const handlePageBack = useCallback(() => {
    if (receiptItem) {
      setReceiptItem(null)
      return
    }
    if (purchaseCreditListOpen) {
      setPurchaseCreditListOpen(false)
      setHighlightedPurchaseCreditIndex(-1)
      return
    }
    if (editingKey) {
      setEditingKey(null)
      setEditValue('')
      return
    }
    goBack()
  }, [goBack, receiptItem, purchaseCreditListOpen, editingKey])

  usePageEscape(handlePageBack, !purchaseOnlyMode)

  const allItems = useMemo(() => buildHistoryItems(data), [data])
  const purchaseCreditItems = useMemo(() => buildPurchaseCreditItems(data), [data])
  const purchaseCreditTotal = useMemo(
    () => purchaseCreditItems.reduce((sum, item) => sum + item.amount, 0),
    [purchaseCreditItems],
  )

  function sortItems(list: HistoryItem[], purchasePaidDisplay: boolean): HistoryItem[] {
    return [...list].sort((a, b) => {
      const aUpdated = historyItemSortTime(a)
      const bUpdated = historyItemSortTime(b)
      const aCreated = historyItemCreatedTime(a)
      const bCreated = historyItemCreatedTime(b)
      const aAmount = historyItemAmountForDateFilter(a, dateFilter, selectedDate, purchasePaidDisplay)
      const bAmount = historyItemAmountForDateFilter(b, dateFilter, selectedDate, purchasePaidDisplay)
      if (sort === 'date-desc') return bUpdated - aUpdated
      if (sort === 'created-desc') return bCreated - aCreated
      if (sort === 'date-asc') return aUpdated - bUpdated
      if (sort === 'amount-desc') return bAmount - aAmount || bUpdated - aUpdated
      if (sort === 'amount-asc') return aAmount - bAmount || aUpdated - bUpdated
      if (sort === 'payment-asc' || sort === 'payment-desc') {
        const aKey = getHistoryPaymentSortKey(a)
        const bKey = getHistoryPaymentSortKey(b)
        const aLabel = a.paymentMode ? getHistoryPaymentLabel(a.paymentMode) : ''
        const bLabel = b.paymentMode ? getHistoryPaymentLabel(b.paymentMode) : ''
        if (aKey !== bKey) {
          return sort === 'payment-asc' ? aKey - bKey : bKey - aKey
        }
        return sort === 'payment-asc'
          ? aLabel.localeCompare(bLabel) || bUpdated - aUpdated
          : bLabel.localeCompare(aLabel) || bUpdated - aUpdated
      }
      const aName = (a.name ?? '').toLowerCase()
      const bName = (b.name ?? '').toLowerCase()
      if (sort === 'name-asc') return aName.localeCompare(bName) || bUpdated - aUpdated
      return bName.localeCompare(aName) || bUpdated - aUpdated
    })
  }

  const normalItems = useMemo(() => {
    let next = allItems.filter((item) => item.type !== 'purchase')
    next = next.filter((item) => filter === 'all' || item.type === filter)
    next = next.filter((item) => matchesHistoryDateFilter(item, dateFilter, selectedDate))
    next = next.filter((item) => matchesHistoryPaymentFilter(item, paymentFilter))
    next = next.filter((item) => matchesHistorySearch(item, search))
    return sortItems(next, false)
  }, [allItems, filter, paymentFilter, sort, dateFilter, selectedDate, search])

  const purchaseItems = useMemo(() => {
    if (!showPurchaseHistory) return []
    const includePurchases =
      filter === 'all' || filter === 'purchase' || (filter === 'expense' && showPurchaseHistory)
    if (!includePurchases) return []
    let next = allItems.filter(
      (item) => item.type === 'purchase' && (item.paidAmount ?? 0) > 0,
    )
    next = next.filter((item) => matchesHistoryDateFilter(item, dateFilter, selectedDate))
    next = next.filter((item) => matchesHistoryPaymentFilter(item, paymentFilter))
    next = next.filter((item) => matchesHistorySearch(item, search))
    return sortItems(next, true)
  }, [allItems, showPurchaseHistory, filter, paymentFilter, sort, dateFilter, selectedDate, search])

  const combinedItems = useMemo(() => {
    if (!showPurchaseHistory) return normalItems
    return sortItems([...normalItems, ...purchaseItems], true)
  }, [showPurchaseHistory, normalItems, purchaseItems, sort])

  const purchasePaidTotal = useMemo(
    () => purchaseItems.reduce((sum, item) => sum + (item.paidAmount ?? 0), 0),
    [purchaseItems],
  )

  const typeTotals = useMemo(() => {
    const totals: Record<HistoryItemType, { sum: number; count: number }> = {
      sale: { sum: 0, count: 0 },
      expense: { sum: 0, count: 0 },
      purchase: { sum: 0, count: 0 },
      deposit: { sum: 0, count: 0 },
      transfer: { sum: 0, count: 0 },
      loan: { sum: 0, count: 0 },
    }
    const items = showPurchaseHistory ? combinedItems : normalItems
    for (const item of items) {
      totals[item.type].sum += historyItemAmountForDateFilter(
        item,
        dateFilter,
        selectedDate,
        showPurchaseHistory && item.type === 'purchase',
      )
      totals[item.type].count += 1
    }
    return totals
  }, [combinedItems, normalItems, showPurchaseHistory, dateFilter, selectedDate])

  const summaryTypes =
    filter === 'all'
      ? TYPE_SUMMARY.filter((t) => {
          if (t.id === 'purchase') return showPurchaseHistory && typeTotals.purchase.count > 0
          return typeTotals[t.id].count > 0
        })
      : TYPE_SUMMARY.filter((t) => t.id === filter)

  const showPaymentFilters = filter !== 'transfer'
  const paymentOptions =
    filter === 'all' || filter === 'sale'
      ? PAYMENT_FILTER_OPTIONS
      : PAYMENT_FILTER_OPTIONS.filter(
          (opt) => opt.id === 'all' || opt.id === 'cash' || opt.id === 'bank',
        )

  const normalFilterOptions = useMemo(
    () => FILTER_OPTIONS.filter((opt) => opt.id !== 'purchase'),
    [],
  )

  const searchHint =
    filter === 'sale'
      ? 'Search customer, payment mode, amount, date…'
      : filter === 'expense' || filter === 'deposit' || filter === 'transfer'
        ? 'Search note, amount, date…'
        : 'Search customer, expense, amount, date…'

  function startEdit(item: HistoryItem) {
    setEditingKey(editKey(item))
    setEditValue(item.name ?? '')
    requestAnimationFrame(() => editInputRef.current?.focus())
  }

  function cancelEdit() {
    setEditingKey(null)
    setEditValue('')
  }

  function saveEdit(item: HistoryItem) {
    if (item.type === 'loan' || (data.loans ?? []).some((loan) => loan.id === item.id)) {
      cancelEdit()
      return
    }
    const updateType: 'sale' | 'expense' | 'deposit' | 'transfer' =
      item.type === 'sale'
        ? 'sale'
        : item.type === 'deposit' || item.type === 'transfer'
          ? item.type
          : 'expense'
    updateHistoryName(updateType, item.id, editValue, item.groupSaleIds)
    cancelEdit()
  }

  function openSaleBillEditor(item: HistoryItem) {
    const billId = resolveHistoryItemBillId(item)
    if (!billId) return
    setReceiptItem(null)
    navigate(counterBillPath(billId))
  }

  function handleNameEditClick(item: HistoryItem, e: MouseEvent) {
    e.stopPropagation()
    if (item.type === 'loan' || (data.loans ?? []).some((loan) => loan.id === item.id)) return
    startEdit(item)
  }

  function canEditBillFromHistory(item: HistoryItem): boolean {
    if (!billEditMode) return false
    if (item.type === 'sale') return true
    if (item.type === 'purchase' && item.hasOpenCredit && item.openCreditExpenseId) return true
    return false
  }

  function handleDateEditClick(item: HistoryItem, e: MouseEvent) {
    e.stopPropagation()
    if (!canEditBillFromHistory(item)) return
    if (item.type === 'sale') {
      openSaleBillEditor(item)
      return
    }
    if (item.type === 'purchase' && item.openCreditExpenseId) {
      openPurchaseCreditUpdate(item.openCreditExpenseId)
    }
  }

  function openPurchaseCreditUpdate(expenseId: string) {
    setPurchaseCreditListOpen(false)
    setReceiptItem(null)
    navigate(`/purchase?edit=${encodeURIComponent(expenseId)}`)
  }

  function togglePurchaseCreditList() {
    setPurchaseCreditListOpen((open) => {
      const next = !open
      if (next && purchaseCreditItems.length > 0) setHighlightedPurchaseCreditIndex(0)
      else setHighlightedPurchaseCreditIndex(-1)
      return next
    })
  }

  function renderHistoryList(
    listItems: HistoryItem[],
    purchasePaidRows: boolean,
    emptyIcon: string,
    emptyMessage: string,
  ) {
    if (listItems.length === 0) {
      return (
        <div className="history-empty history-empty--section">
          <span>{emptyIcon}</span>
          <p>{emptyMessage}</p>
        </div>
      )
    }

    return (
      <ul className="history-list">
        {listItems.map((item) => {
          const key = editKey(item)
          const isEditing = editingKey === key
          const displayAmount = historyItemAmountForDateFilter(
            item,
            dateFilter,
            selectedDate,
            purchasePaidRows && item.type === 'purchase',
          )
          const dateEditable = canEditBillFromHistory(item)
          const paymentDetail = historyItemListPaymentTypeText(item, dateFilter, selectedDate)

          return (
            <li
              key={key}
              className={`history-item history-item--${item.type} ${item.isSplitGroup ? 'history-item--split' : ''}`}
            >
              <div
                className="history-item-main history-item-tap"
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isEditing) setReceiptItem(item)
                }}
                onKeyDown={(e) => {
                  if (isEditing) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setReceiptItem(item)
                  }
                }}
              >
                <span className="history-item-icon">{historyIcon(item.type)}</span>
                <div className="history-item-info">
                  <div className="history-item-top">
                    <span className="history-item-type">{getHistoryTypeLabel(item.type)}</span>
                    {isEditing ? (
                      <form
                        className="history-name-edit"
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                          e.preventDefault()
                          saveEdit(item)
                        }}
                      >
                        <input
                          ref={editInputRef}
                          type="text"
                          className="history-name-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder={namePlaceholder(item.type)}
                          aria-label={nameLabel(item.type)}
                          autoComplete="off"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                        <button type="button" className="history-name-save" aria-label="Save name">
                          ✓
                        </button>
                        <button
                          type="button"
                          className="history-name-cancel"
                          onClick={cancelEdit}
                          aria-label="Cancel edit"
                        >
                          ✕
                        </button>
                      </form>
                    ) : (
                      <div className="history-name-row">
                        {item.name ? (
                          <button
                            type="button"
                            className="history-item-name history-item-name--editable"
                            onClick={(e) => handleNameEditClick(item, e)}
                          >
                            {item.name}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="history-item-name history-item-name--empty history-item-name--add"
                            onClick={(e) => handleNameEditClick(item, e)}
                          >
                            Add name
                          </button>
                        )}
                        <button
                          type="button"
                          className="history-name-edit-btn"
                          onClick={(e) => handleNameEditClick(item, e)}
                          aria-label={
                            item.name
                              ? `Edit ${nameLabel(item.type)}`
                              : `Add ${nameLabel(item.type)}`
                          }
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="history-item-sub">{historyItemListRowSub(item)}</span>
                  <span className="history-item-meta">
                    {paymentDetail ? (
                      <span className="history-item-payment">{paymentDetail}</span>
                    ) : null}
                    {dateEditable ? (
                      <button
                        type="button"
                        className="history-item-date history-item-date--editable"
                        onClick={(e) => handleDateEditClick(item, e)}
                        aria-label="Edit bill on Counter"
                      >
                        {historyItemListDateLabel(item)}
                      </button>
                    ) : (
                      <span className="history-item-date">{historyItemListDateLabel(item)}</span>
                    )}
                  </span>
                </div>
                <span
                  className={`history-item-amount ${
                    item.type === 'expense' || item.type === 'purchase'
                      ? 'negative'
                      : item.type === 'transfer'
                        ? 'neutral'
                        : 'positive'
                  }`}
                >
                  {item.type === 'expense' || item.type === 'purchase'
                    ? '-'
                    : item.type === 'transfer'
                      ? ''
                      : '+'}
                  {formatMoney(displayAmount)}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  if (purchaseOnlyMode) {
    return (
      <div className="history-page history-page--purchase-only">
        <PurchaseHistoryPanel
          open
          variant="embedded"
          data={data}
          onClose={closePurchaseHistory}
          embeddedBackLabel="Home"
          embeddedActionLabel="Open Purchase"
        />
      </div>
    )
  }

  return (
    <div className="history-page page-shell">
      <PageCorners left={<PageBackButton onClick={handlePageBack} ariaLabel="Back" />} />
      <div className="history-top">
      <header className="history-header">
        <div className="history-header-main">
          <h2>History</h2>
          <span className="history-header-badge">
            {showPurchaseHistory ? combinedItems.length : normalItems.length} records
          </span>
        </div>
        {showPurchaseHistory && purchaseItems.length > 0 ? (
          <p className="history-header-meta">
            {purchaseItems.length} paid purchases · {formatMoney(purchasePaidTotal)}
          </p>
        ) : null}
        <p className="history-header-hints">
          Tap row for receipt · tap name to rename
          {billEditMode ? ' · tap date to edit bill' : ''}
        </p>
      </header>

      <div className="history-toolbar">
        <div
          className={`history-toolbar-primary${showPaymentFilters ? '' : ' history-toolbar-primary--no-payment'}`}
        >
          <label className="history-filter-field history-filter-field--search">
            <span className="history-filter-label">Search</span>
            <input
              type="search"
              className="history-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPurchaseCreditListOpen(false)
              }}
              onFocus={() => setPurchaseCreditListOpen(false)}
              placeholder={searchHint}
              autoComplete="off"
            />
          </label>

          <label className="history-filter-field history-filter-field--type">
            <span className="history-filter-label">Type</span>
            <select
              className="history-select"
              value={filter}
              onChange={(e) => {
                const next = e.target.value as HistoryFilter
                setFilter(next)
                setPurchaseCreditListOpen(false)
                if (next === 'transfer') {
                  setPaymentFilter('all')
                } else if (next !== 'all' && next !== 'sale') {
                  const allowed: HistoryPaymentFilter[] = ['all', 'cash', 'bank']
                  if (!allowed.includes(paymentFilter)) setPaymentFilter('all')
                }
              }}
              aria-label="Filter by record type"
            >
              {normalFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {showPaymentFilters ? (
            <label className="history-filter-field history-filter-field--payment">
              <span className="history-filter-label">Payment</span>
              <select
                className="history-select"
                value={paymentFilter}
                onChange={(e) => {
                  setPaymentFilter(e.target.value as HistoryPaymentFilter)
                  setPurchaseCreditListOpen(false)
                }}
                aria-label="Filter by payment mode"
              >
                {paymentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="history-toolbar-secondary">
          <label className="history-filter-field history-filter-field--sort">
            <span className="history-filter-label">Sort</span>
            <select
              className="history-select"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as HistorySort)
                setPurchaseCreditListOpen(false)
              }}
              aria-label="Sort records"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="history-filter-field history-filter-field--date">
            <span className="history-filter-label">Date</span>
            <select
              className="history-select"
              value={dateFilter}
              onChange={(e) => {
                const next = e.target.value as DateFilter
                setDateFilter(next)
                setPurchaseCreditListOpen(false)
                if (next !== 'date') setSelectedDate('')
              }}
              aria-label="Filter by date"
            >
              {DATE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {dateFilter === 'date' ? (
          <input
            type="date"
            className="history-date-input history-date-input--active"
            value={selectedDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setSelectedDate(e.target.value)
              setPurchaseCreditListOpen(false)
            }}
            aria-label="Pick a date"
          />
        ) : null}
      </div>

      <label className="history-paid-toggle">
        <span className="history-paid-toggle-copy">
          <span className="history-paid-toggle-label">Paid purchases</span>
          <span className="history-paid-toggle-hint">Mix in time order</span>
        </span>
        <input
          type="checkbox"
          checked={showPurchaseHistory}
          onChange={(e) => {
            setShowPurchaseHistory(e.target.checked)
            setPurchaseCreditListOpen(false)
          }}
          aria-label="Include paid purchases in time order"
        />
      </label>
      </div>

      <div className="history-scroll">
        <section className="history-section">
          {purchaseCreditItems.length > 0 ? (
            <div className="history-purchase-credit-bar" ref={purchaseCreditBarRef}>
              <button
                type="button"
                className="history-purchase-credit-open"
                onClick={togglePurchaseCreditList}
              >
                <span>💳 Purchase Credits ({purchaseCreditItems.length})</span>
                <span className="history-purchase-credit-open-meta">
                  <span className="history-purchase-credit-open-total">
                    {formatMoney(purchaseCreditTotal)}
                  </span>
                  <span className="history-purchase-credit-open-caret">
                    {purchaseCreditListOpen ? '▲' : '▼'}
                  </span>
                </span>
              </button>
              {purchaseCreditListOpen ? (
                <ul className="history-purchase-credit-list" role="listbox">
                  {purchaseCreditItems.map((credit, index) => (
                    <li key={credit.id} className="history-purchase-credit-row">
                      <button
                        type="button"
                        className={`history-purchase-credit-item ${index === highlightedPurchaseCreditIndex ? 'history-purchase-credit-item--active' : ''}`}
                        onMouseEnter={() => setHighlightedPurchaseCreditIndex(index)}
                        onClick={() => openPurchaseCreditUpdate(credit.id)}
                      >
                        <span className="history-purchase-credit-item-top">
                          {credit.shopName ? (
                            <span className="history-purchase-credit-item-name">{credit.shopName}</span>
                          ) : (
                            <span className="history-purchase-credit-item-name">Supplier</span>
                          )}
                          <span className="history-purchase-credit-item-amount">
                            Paid {formatMoney(credit.paidAmount)} · Credit{' '}
                            {formatMoney(credit.amount)}
                          </span>
                        </span>
                        <span className="history-purchase-credit-item-types">
                          <span className="history-purchase-credit-type-chip">{credit.billLabel}</span>
                          <span className="history-purchase-credit-type-chip history-purchase-credit-type-chip--pay">
                            {credit.payLabel}
                          </span>
                        </span>
                        {credit.description ? (
                          <span className="history-purchase-credit-item-desc">{credit.description}</span>
                        ) : null}
                        <span className="history-purchase-credit-item-date">
                          Updated · {formatDate(credit.date)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="history-purchase-credit-update"
                        onClick={() => openPurchaseCreditUpdate(credit.id)}
                      >
                        Credit Update
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {summaryTypes.length > 0 ? (
            <div className="history-summary history-summary--grid">
              {summaryTypes.map((t) => (
                <div key={t.id} className={`history-summary-item history-summary-item--${t.id}`}>
                  <span className="history-summary-label">
                    {t.icon} {t.label} ({typeTotals[t.id].count})
                  </span>
                  <span className="history-summary-value">
                    {t.sign}
                    {formatMoney(typeTotals[t.id].sum)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {renderHistoryList(
            combinedItems,
            showPurchaseHistory,
            '📋',
            allItems.length === 0
              ? 'No records yet. Use Cash Counter to save bills.'
              : 'No records match your filter or search.',
          )}
        </section>
      </div>

      {receiptItem ? (
        <div
          className="history-receipt-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setReceiptItem(null)}
        >
          <div
            className="history-receipt-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="history-receipt-head">
              <div className="history-receipt-head-main">
                <span className={`history-receipt-type history-receipt-type--${receiptItem.type}`}>
                  {getHistoryTypeLabel(receiptItem.type)}
                </span>
                <h3>
                  {receiptItem.isSplitGroup ? 'Split bill' : 'Receipt'}
                </h3>
              </div>
              <button
                type="button"
                className="history-receipt-close"
                onClick={() => setReceiptItem(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {(() => {
              const receiptPaymentParts = getHistoryItemListPaymentParts(receiptItem, 'all', '')
              return (
                <div className="history-receipt-top">
                  <h4 className="history-receipt-top-name">{receiptItem.name || 'No name'}</h4>
                  <div className="history-receipt-top-total">
                    <span>Total</span>
                    <strong>
                      {formatMoney(receiptItem.originalBillAmount ?? receiptItem.amount)}
                    </strong>
                  </div>
                  {receiptPaymentParts.length > 0 ? (
                    <div className="history-receipt-split">
                      <div className="history-receipt-split-grid">
                        {receiptPaymentParts.map((part, partIndex) => (
                          <div
                            key={`${part.mode}-${part.status}-${partIndex}`}
                            className={`history-receipt-split-item history-receipt-split-item--${part.mode} history-receipt-split-item--${part.status}`}
                          >
                            <span className="history-receipt-split-item-label">
                              {getHistoryListPaymentPartIcon(part.mode)}{' '}
                              {getHistoryListPaymentPartLabel(part.mode)}
                              {part.status === 'pending' ? ' · pending' : ''}
                            </span>
                            <strong className="history-receipt-split-item-amount">
                              {formatMoney(part.amount)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })()}

            <div className="history-receipt-body">
            <div className="history-receipt-meta">
              {receiptItem.billCreatedAt ? (
                <div className="history-receipt-row">
                  <span>Bill created</span>
                  <strong>{formatDate(receiptItem.billCreatedAt)}</strong>
                </div>
              ) : null}
              {receiptItem.isSplitGroup &&
              receiptItem.originalBillAmount &&
              receiptItem.collectionBreakdown ? (
                (() => {
                  const collectTarget =
                    receiptItem.collectionBreakdown.cash +
                    receiptItem.collectionBreakdown.bank +
                    receiptItem.collectionBreakdown.cheque +
                    (receiptItem.receiptLines ?? [])
                      .filter((line) => line.status === 'pending')
                      .reduce((sum, line) => sum + line.amount, 0)
                  return collectTarget > 0 &&
                    collectTarget !== receiptItem.originalBillAmount ? (
                    <div className="history-receipt-row">
                      <span>Round / Collect</span>
                      <strong>{formatMoney(collectTarget)}</strong>
                    </div>
                  ) : null
                })()
              ) : receiptItem.isSplitGroup &&
                receiptItem.originalBillAmount &&
                receiptItem.receiptLines ? (
                (() => {
                  // Sum unique payment channels only — paid cheque counts as bank, not twice.
                  const collectTarget = getHistoryItemListPaymentParts(receiptItem, 'all', '').reduce(
                    (sum, part) => sum + part.amount,
                    0,
                  )
                  return collectTarget > 0 &&
                    collectTarget !== receiptItem.originalBillAmount ? (
                    <div className="history-receipt-row">
                      <span>Round / Collect</span>
                      <strong>{formatMoney(collectTarget)}</strong>
                    </div>
                  ) : null
                })()
              ) : null}
              {receiptItem.completedAt ? (
                <div className="history-receipt-row">
                  <span>
                    {receiptItem.type === 'purchase'
                      ? receiptItem.hasOpenCredit
                        ? 'Last payment'
                        : 'Fully paid'
                      : 'Fully collected'}
                  </span>
                  <strong>{formatDate(receiptItem.completedAt)}</strong>
                </div>
              ) : null}
              {receiptItem.type === 'purchase' && (receiptItem.paidAmount ?? 0) > 0 ? (
                <div className="history-receipt-row">
                  <span>Paid</span>
                  <strong>{formatMoney(receiptItem.paidAmount ?? 0)}</strong>
                </div>
              ) : null}
              {receiptItem.type === 'purchase' && receiptItem.hasOpenCredit ? (
                <div className="history-receipt-row">
                  <span>Credit balance</span>
                  <strong>{formatMoney(receiptItem.openCreditAmount ?? 0)}</strong>
                </div>
              ) : null}
              <div className="history-receipt-row">
                <span>Last activity</span>
                <strong>{historyItemActivityLabel(receiptItem)}</strong>
              </div>
            </div>

            {receiptItem.receiptTimeline && receiptItem.receiptTimeline.length > 0 ? (
              <div className="history-receipt-timeline">
                <h4 className="history-receipt-section-title">Payment timeline</h4>
                <ul className="history-receipt-timeline-list">
                  {receiptItem.receiptTimeline.map((event, idx) => (
                    <li
                      key={`${event.label}-${event.date}-${idx}`}
                      className={`history-receipt-timeline-item history-receipt-timeline-item--${event.type}`}
                    >
                      <span className="history-receipt-timeline-dot" aria-hidden="true" />
                      <div className="history-receipt-timeline-body">
                        <div className="history-receipt-timeline-top">
                          <span className="history-receipt-timeline-label">{event.label}</span>
                          {event.amount != null ? (
                            <span className="history-receipt-timeline-amount">
                              {formatMoney(event.amount)}
                            </span>
                          ) : null}
                        </div>
                        {event.detail ? (
                          <span className="history-receipt-timeline-detail">{event.detail}</span>
                        ) : null}
                        <span className="history-receipt-timeline-date">{formatDate(event.date)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!(receiptItem.receiptTimeline && receiptItem.receiptTimeline.length > 0) ? (
              <>
                <h4 className="history-receipt-section-title">Details</h4>
                {(() => {
                  const lines =
                    receiptItem.receiptLines && receiptItem.receiptLines.length > 0
                      ? receiptItem.receiptLines.filter(
                          (line) =>
                            line.label !== 'Bill total' &&
                            line.label !== 'Purchase' &&
                            line.label !== 'Paid',
                        )
                      : [
                          {
                            label: getHistoryTypeLabel(receiptItem.type),
                            amount: receiptItem.amount,
                            status: 'paid' as const,
                            detail: receiptItem.sub,
                            date: receiptItem.date,
                          },
                        ]
                  const displayLines =
                    lines.length > 0
                      ? lines
                      : receiptItem.receiptLines && receiptItem.receiptLines.length > 0
                        ? receiptItem.receiptLines
                        : [
                            {
                              label: getHistoryTypeLabel(receiptItem.type),
                              amount: receiptItem.amount,
                              status: 'paid' as const,
                              detail: receiptItem.sub,
                              date: receiptItem.date,
                            },
                          ]
                  return (
                    <ul className="history-receipt-lines">
                      {displayLines.map((line, idx) => (
                        <li
                          key={`${line.label}-${idx}`}
                          className={`history-receipt-line history-receipt-line--${line.status}`}
                        >
                          <div className="history-receipt-line-top">
                            <span className="history-receipt-line-label">
                              {line.status === 'paid' ? '✓' : '⏳'} {line.label}
                            </span>
                            <span className="history-receipt-line-amount">
                              {formatMoney(line.amount)}
                            </span>
                          </div>
                          {line.detail ? (
                            <span className="history-receipt-line-detail">{line.detail}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )
                })()}
              </>
            ) : null}

            {receiptItem.type === 'sale' && billEditMode ? (
              <button
                type="button"
                className="btn btn-secondary history-receipt-edit-btn"
                onClick={() => openSaleBillEditor(receiptItem)}
              >
                Edit bill on Counter
              </button>
            ) : null}
            </div>

            <div className="history-receipt-foot">
              <span>{getHistoryTypeLabel(receiptItem.type)}</span>
              <strong>
                {receiptItem.type === 'expense' || receiptItem.type === 'purchase' ? '-' : '+'}
                {formatMoney(
                  receiptItem.type === 'purchase' && (receiptItem.paidAmount ?? 0) > 0
                    ? receiptItem.paidAmount ?? 0
                    : receiptItem.amount,
                )}
              </strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
