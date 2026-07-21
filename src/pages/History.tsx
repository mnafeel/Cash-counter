import { useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import { formatDate, formatMoney } from '../utils/format'
import {
  buildHistoryItems,
  getHistoryPaymentLabel,
  getHistoryPaymentSortKey,
  getHistoryTypeLabel,
  historyItemSaleAmount,
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
  { id: 'date-desc', label: 'Newest first' },
  { id: 'date-asc', label: 'Oldest first' },
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

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function matchesDateFilter(iso: string, dateFilter: DateFilter, selectedDate: string): boolean {
  if (dateFilter === 'all') return true
  const d = new Date(iso)
  const now = new Date()

  if (dateFilter === 'today') return isSameDay(d, now)

  if (dateFilter === 'yesterday') {
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    return isSameDay(d, y)
  }

  if (dateFilter === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return d.getTime() >= start.getTime()
  }

  if (dateFilter === 'date') {
    if (!selectedDate) return true
    const [y, m, day] = selectedDate.split('-').map(Number)
    return isSameDay(d, new Date(y, m - 1, day))
  }

  return true
}

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
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<HistoryPaymentFilter>('all')
  const [sort, setSort] = useState<HistorySort>('date-desc')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [receiptItem, setReceiptItem] = useState<HistoryItem | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const allItems = useMemo(() => buildHistoryItems(data), [data])

  const items = useMemo(() => {
    let next = allItems.filter((item) => filter === 'all' || item.type === filter)
    next = next.filter((item) => matchesDateFilter(item.date, dateFilter, selectedDate))
    next = next.filter((item) => matchesHistoryPaymentFilter(item, paymentFilter))
    next = next.filter((item) => matchesHistorySearch(item, search))

    next.sort((a, b) => {
      const aTime = new Date(a.date).getTime()
      const bTime = new Date(b.date).getTime()
      if (sort === 'date-desc') return bTime - aTime
      if (sort === 'date-asc') return aTime - bTime
      if (sort === 'amount-desc') return b.amount - a.amount || bTime - aTime
      if (sort === 'amount-asc') return a.amount - b.amount || aTime - bTime
      if (sort === 'payment-asc' || sort === 'payment-desc') {
        const aKey = getHistoryPaymentSortKey(a)
        const bKey = getHistoryPaymentSortKey(b)
        const aLabel = a.paymentMode ? getHistoryPaymentLabel(a.paymentMode) : ''
        const bLabel = b.paymentMode ? getHistoryPaymentLabel(b.paymentMode) : ''
        if (aKey !== bKey) {
          return sort === 'payment-asc' ? aKey - bKey : bKey - aKey
        }
        return sort === 'payment-asc'
          ? aLabel.localeCompare(bLabel) || bTime - aTime
          : bLabel.localeCompare(aLabel) || bTime - aTime
      }
      const aName = (a.name ?? '').toLowerCase()
      const bName = (b.name ?? '').toLowerCase()
      if (sort === 'name-asc') return aName.localeCompare(bName) || bTime - aTime
      return bName.localeCompare(aName) || bTime - aTime
    })

    return next
  }, [allItems, filter, paymentFilter, sort, dateFilter, selectedDate, search])

  const typeTotals = useMemo(() => {
    const totals: Record<HistoryItemType, { sum: number; count: number }> = {
      sale: { sum: 0, count: 0 },
      expense: { sum: 0, count: 0 },
      purchase: { sum: 0, count: 0 },
      deposit: { sum: 0, count: 0 },
      transfer: { sum: 0, count: 0 },
    }
    for (const item of items) {
      totals[item.type].sum +=
        item.type === 'sale' ? historyItemSaleAmount(item) : item.amount
      totals[item.type].count += 1
    }
    return totals
  }, [items])

  const summaryTypes =
    filter === 'all'
      ? TYPE_SUMMARY.filter((t) => typeTotals[t.id].count > 0)
      : TYPE_SUMMARY.filter((t) => t.id === filter)

  const showPaymentFilters = filter !== 'transfer'
  const paymentOptions =
    filter === 'all' || filter === 'sale'
      ? PAYMENT_FILTER_OPTIONS
      : PAYMENT_FILTER_OPTIONS.filter(
          (opt) => opt.id === 'all' || opt.id === 'cash' || opt.id === 'bank',
        )

  const searchHint =
    filter === 'sale'
      ? 'Search customer, payment mode, amount, date…'
      : filter === 'purchase'
        ? 'Search supplier, item, bill, amount, date…'
      : filter === 'expense' || filter === 'deposit' || filter === 'transfer'
        ? 'Search note, amount, date…'
        : 'Search customer, expense, purchase, amount…'

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
    const updateType =
      item.type === 'purchase' || item.type === 'deposit' || item.type === 'transfer'
        ? 'expense'
        : item.type
    updateHistoryName(updateType, item.id, editValue, item.groupSaleIds)
    cancelEdit()
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>History</h2>
        <p>
          {items.length} of {allItems.length} records · tap a bill for receipt · ✎ to edit name
        </p>
      </div>

      <div className="history-toolbar">
        <input
          type="search"
          className="history-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchHint}
          autoComplete="off"
        />

        <div className="history-toolbar-filters">
          <label className="history-filter-field">
            <span className="history-filter-label">Type</span>
            <select
              className="history-select"
              value={filter}
              onChange={(e) => {
                const next = e.target.value as HistoryFilter
                setFilter(next)
                if (next === 'transfer') {
                  setPaymentFilter('all')
                } else if (next !== 'all' && next !== 'sale') {
                  const allowed: HistoryPaymentFilter[] = ['all', 'cash', 'bank']
                  if (!allowed.includes(paymentFilter)) setPaymentFilter('all')
                }
              }}
              aria-label="Filter by record type"
            >
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {showPaymentFilters ? (
            <label className="history-filter-field">
              <span className="history-filter-label">Payment</span>
              <select
                className="history-select"
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value as HistoryPaymentFilter)}
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

          <label className="history-filter-field">
            <span className="history-filter-label">Sort</span>
            <select
              className="history-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as HistorySort)}
              aria-label="Sort records"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="history-filter-field">
            <span className="history-filter-label">Date</span>
            <select
              className="history-select"
              value={dateFilter}
              onChange={(e) => {
                const next = e.target.value as DateFilter
                setDateFilter(next)
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
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Pick a date"
          />
        ) : null}
      </div>

      {summaryTypes.length > 0 && items.length > 0 ? (
        <div className="history-summary">
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

      {items.length === 0 ? (
        <div className="history-empty">
          <span>📋</span>
          <p>
            {allItems.length === 0
              ? 'No records yet. Use Cash Counter to save bills.'
              : 'No records match your filter or search.'}
          </p>
        </div>
      ) : (
        <ul className="history-list">
          {items.map((item) => {
            const key = editKey(item)
            const isEditing = editingKey === key

            return (
            <li
              key={item.id}
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
                        <button type="submit" className="history-name-save" aria-label="Save name">
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
                          <span className="history-item-name">{item.name}</span>
                        ) : (
                          <button
                            type="button"
                            className="history-item-name history-item-name--empty history-item-name--add"
                            onClick={(e) => {
                              e.stopPropagation()
                              startEdit(item)
                            }}
                          >
                            Add name
                          </button>
                        )}
                        <button
                          type="button"
                          className="history-name-edit-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(item)
                          }}
                          aria-label={item.name ? `Edit ${nameLabel(item.type)}` : `Add ${nameLabel(item.type)}`}
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="history-item-sub">{item.sub}</span>
                  <span className="history-item-meta">
                    {item.paySummary ? (
                      <span className="history-item-payment">{item.paySummary}</span>
                    ) : item.paymentMode ? (
                      <span className="history-item-payment">
                        {getHistoryPaymentLabel(item.paymentMode)}
                      </span>
                    ) : null}
                    <span className="history-item-date">{formatDate(item.date)}</span>
                  </span>
                </div>
                <span
                  className={`history-item-amount ${
                    item.type === 'expense'
                      ? 'negative'
                      : item.type === 'transfer'
                        ? 'neutral'
                        : 'positive'
                  }`}
                >
                  {item.type === 'expense' ? '-' : item.type === 'transfer' ? '' : '+'}
                  {formatMoney(item.amount)}
                </span>
              </div>
            </li>
            )
          })}
        </ul>
      )}

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
              <h3>{receiptItem.isSplitGroup ? 'Split Bill Receipt' : 'Bill Receipt'}</h3>
              <button
                type="button"
                className="history-receipt-close"
                onClick={() => setReceiptItem(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="history-receipt-meta">
              <div className="history-receipt-row">
                <span>Customer</span>
                <strong>{receiptItem.name || '—'}</strong>
              </div>
              {receiptItem.billCreatedAt ? (
                <div className="history-receipt-row">
                  <span>Bill created</span>
                  <strong>{formatDate(receiptItem.billCreatedAt)}</strong>
                </div>
              ) : null}
              {receiptItem.isSplitGroup &&
              receiptItem.originalBillAmount &&
              receiptItem.receiptLines ? (
                (() => {
                  const collectTarget = receiptItem.receiptLines.reduce(
                    (sum, line) => sum + line.amount,
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
                  <span>Fully collected</span>
                  <strong>{formatDate(receiptItem.completedAt)}</strong>
                </div>
              ) : null}
              <div className="history-receipt-row">
                <span>Last activity</span>
                <strong>{formatDate(receiptItem.date)}</strong>
              </div>
              <div className="history-receipt-row history-receipt-row--total">
                <span>Bill Total</span>
                <strong>{formatMoney(receiptItem.originalBillAmount ?? receiptItem.amount)}</strong>
              </div>
              {receiptItem.isSplitGroup && receiptItem.receiptLines ? (
                <div className="history-receipt-row">
                  <span>Collected</span>
                  <strong>
                    {formatMoney(
                      receiptItem.receiptLines
                        .filter((line) => line.status === 'paid')
                        .reduce((sum, line) => sum + line.amount, 0),
                    )}
                  </strong>
                </div>
              ) : null}
            </div>

            {receiptItem.receiptTimeline && receiptItem.receiptTimeline.length > 0 ? (
              <div className="history-receipt-timeline">
                <h4 className="history-receipt-section-title">Timeline</h4>
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
                        <span className="history-receipt-timeline-date">{formatDate(event.date)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <h4 className="history-receipt-section-title">Payment details</h4>
            {(() => {
              const lines =
                receiptItem.receiptLines && receiptItem.receiptLines.length > 0
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
                {lines.map((line, idx) => (
                  <li
                    key={`${line.label}-${idx}`}
                    className={`history-receipt-line history-receipt-line--${line.status}`}
                  >
                    <div className="history-receipt-line-top">
                      <span className="history-receipt-line-label">
                        {line.status === 'paid' ? '✓' : '⏳'} {line.label}
                      </span>
                      <span className="history-receipt-line-amount">{formatMoney(line.amount)}</span>
                    </div>
                    {line.detail ? (
                      <span className="history-receipt-line-detail">{line.detail}</span>
                    ) : null}
                    {line.createdAt ? (
                      <span className="history-receipt-line-date">
                        Created {formatDate(line.createdAt)}
                      </span>
                    ) : null}
                    {line.paidAt && line.status === 'paid' ? (
                      <span className="history-receipt-line-date history-receipt-line-date--paid">
                        Paid {formatDate(line.paidAt)}
                      </span>
                    ) : line.status === 'pending' ? (
                      <span className="history-receipt-line-date history-receipt-line-date--pending">
                        Awaiting payment
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              )
            })()}

            <div className="history-receipt-foot">
              <span>{getHistoryTypeLabel(receiptItem.type)}</span>
              <strong>
                {receiptItem.type === 'expense' ? '-' : '+'}
                {formatMoney(receiptItem.amount)}
              </strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
