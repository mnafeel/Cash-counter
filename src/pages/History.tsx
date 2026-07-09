import { useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import { formatDate, formatMoney } from '../utils/format'
import {
  buildHistoryItems,
  getHistoryTypeLabel,
  matchesHistorySearch,
  type HistoryFilter,
  type HistoryItem,
  type HistoryItemType,
} from '../utils/historyItems'
import './History.css'

type HistorySort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

const FILTER_OPTIONS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sale', label: 'Bills' },
  { id: 'expense', label: 'Expenses' },
  { id: 'deposit', label: 'Added' },
  { id: 'transfer', label: 'Transfer' },
]

const SORT_OPTIONS: { id: HistorySort; label: string }[] = [
  { id: 'date-desc', label: 'Date ↓' },
  { id: 'date-asc', label: 'Date ↑' },
  { id: 'amount-desc', label: 'Amount ↓' },
  { id: 'amount-asc', label: 'Amount ↑' },
]

function historyIcon(type: HistoryItemType): string {
  if (type === 'sale') return '💵'
  if (type === 'deposit') return '📥'
  if (type === 'transfer') return '🔄'
  return '📤'
}

function nameLabel(type: HistoryItemType): string {
  return type === 'sale' ? 'Customer name' : 'Note / name'
}

function namePlaceholder(type: HistoryItemType): string {
  return type === 'sale' ? 'Customer name' : 'Note or name'
}

function editKey(item: HistoryItem): string {
  return `${item.type}:${item.id}`
}

export default function History() {
  const { data, updateHistoryName } = useCash()
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [sort, setSort] = useState<HistorySort>('date-desc')
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const allItems = useMemo(() => buildHistoryItems(data), [data])

  const items = useMemo(() => {
    let next = allItems.filter((item) => filter === 'all' || item.type === filter)
    next = next.filter((item) => matchesHistorySearch(item, search))

    next.sort((a, b) => {
      if (sort === 'date-desc') return new Date(b.date).getTime() - new Date(a.date).getTime()
      if (sort === 'date-asc') return new Date(a.date).getTime() - new Date(b.date).getTime()
      if (sort === 'amount-desc') return b.amount - a.amount
      return a.amount - b.amount
    })

    return next
  }, [allItems, filter, sort, search])

  const searchHint =
    filter === 'sale'
      ? 'Search customer name, amount, date…'
      : filter === 'expense' || filter === 'deposit' || filter === 'transfer'
        ? 'Search note, amount, date…'
        : 'Search customer, expense note, amount…'

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
    updateHistoryName(item.type, item.id, editValue)
    cancelEdit()
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>History</h2>
        <p>
          {items.length} of {allItems.length} records · tap ✎ to edit name · delete from Home
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

        <div className="history-filters" role="group" aria-label="Filter records">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`history-chip ${filter === opt.id ? 'history-chip--active' : ''}`}
              onClick={() => setFilter(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="history-sorts" role="group" aria-label="Sort records">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`history-chip history-chip--sort ${sort === opt.id ? 'history-chip--active' : ''}`}
              onClick={() => setSort(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
            <li key={item.id} className={`history-item history-item--${item.type}`}>
              <div className="history-item-main">
                <span className="history-item-icon">{historyIcon(item.type)}</span>
                <div className="history-item-info">
                  <div className="history-item-top">
                    <span className="history-item-type">{getHistoryTypeLabel(item.type)}</span>
                    {isEditing ? (
                      <form
                        className="history-name-edit"
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
                          <span className="history-item-name history-item-name--empty">No name</span>
                        )}
                        <button
                          type="button"
                          className="history-name-edit-btn"
                          onClick={() => startEdit(item)}
                          aria-label={item.name ? `Edit ${nameLabel(item.type)}` : `Add ${nameLabel(item.type)}`}
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="history-item-sub">{item.sub}</span>
                  <span className="history-item-date">{formatDate(item.date)}</span>
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
    </div>
  )
}
