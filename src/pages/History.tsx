import { useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import type { AppData } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import './History.css'

type HistoryItemType = 'sale' | 'expense' | 'deposit' | 'transfer'

type HistoryFilter = 'all' | 'sale' | 'expense' | 'deposit' | 'transfer'

type HistorySort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

interface HistoryItem {
  type: HistoryItemType
  id: string
  amount: number
  sub: string
  name?: string
  date: string
}

function buildHistoryItems(data: AppData): HistoryItem[] {
  return [
    ...data.sales.map((s) => {
      const payLabel =
        s.status === 'pending'
          ? '💳 Credit · Pending'
          : s.payType === 'bank'
            ? '🏦 Bank'
            : s.payType === 'credit'
              ? '💳 Credit'
              : s.payType === 'split'
                ? `💵 ${formatMoney(s.cashAmount ?? 0)} · 🏦 ${formatMoney(s.bankAmount ?? 0)}`
                : '💵 Cash'
      const orig =
        s.originalBillAmount && s.originalBillAmount !== s.billAmount
          ? `Bill ${formatMoney(s.originalBillAmount)} → `
          : ''
      return {
        type: 'sale' as const,
        id: s.id,
        amount: s.billAmount,
        sub: `${orig}${s.status === 'pending' ? 'Pending · ' : s.payType === 'bank' || s.payType === 'credit' ? 'Paid ' : `Give ${formatMoney(s.paidAmount)} · `}${payLabel}${s.changeAmount > 0 ? ` · Change ${formatMoney(s.changeAmount)}` : ''}`,
        name: s.customerName,
        date: s.createdAt,
      }
    }),
    ...data.expenses.map((e) => {
      if (e.kind === 'transfer') {
        const toBank = e.transferDirection === 'cash-to-bank'
        return {
          type: 'transfer' as const,
          id: e.id,
          amount: e.amount,
          sub: toBank ? '💵 → 🏦 Cash to bank' : '🏦 → 💵 Bank to cash',
          name: e.name,
          date: e.createdAt,
        }
      }
      const isAdd = e.kind === 'add'
      return {
        type: isAdd ? ('deposit' as const) : ('expense' as const),
        id: e.id,
        amount: e.amount,
        sub: isAdd
          ? e.payType === 'bank'
            ? '🏦 Added to bank'
            : '💵 Added to counter'
          : e.payType === 'bank'
            ? '🏦 Bank expense'
            : '💵 Cash expense',
        name: e.name,
        date: e.createdAt,
      }
    }),
  ]
}

function matchesSearch(item: HistoryItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase().trim()
  const haystack = [
    item.name,
    item.sub,
    formatMoney(item.amount),
    formatDate(item.date),
    item.type === 'sale'
      ? 'bill collected customer'
      : item.type === 'deposit'
        ? 'money added'
        : item.type === 'transfer'
          ? 'transfer cash bank'
          : 'expense',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

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

export default function History() {
  const { data, removeSale, removeExpense } = useCash()
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [sort, setSort] = useState<HistorySort>('date-desc')
  const [search, setSearch] = useState('')

  const allItems = useMemo(() => buildHistoryItems(data), [data])

  const items = useMemo(() => {
    let next = allItems.filter((item) => filter === 'all' || item.type === filter)
    next = next.filter((item) => matchesSearch(item, search))

    next.sort((a, b) => {
      if (sort === 'date-desc') return new Date(b.date).getTime() - new Date(a.date).getTime()
      if (sort === 'date-asc') return new Date(a.date).getTime() - new Date(b.date).getTime()
      if (sort === 'amount-desc') return b.amount - a.amount
      return a.amount - b.amount
    })

    return next
  }, [allItems, filter, sort, search])

  function handleDelete(type: HistoryItemType, id: string) {
    if (!confirm('Delete this record?')) return
    if (type === 'sale') removeSale(id)
    else removeExpense(id)
  }

  const searchHint =
    filter === 'sale'
      ? 'Search customer name, amount, date…'
      : filter === 'expense' || filter === 'deposit' || filter === 'transfer'
        ? 'Search note, amount, date…'
        : 'Search customer, expense note, amount…'

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>History</h2>
        <p>
          {items.length} of {allItems.length} records
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
          {items.map((item) => (
            <li key={item.id} className={`history-item history-item--${item.type}`}>
              <div className="history-item-main">
                <span className="history-item-icon">
                  {item.type === 'sale'
                    ? '💵'
                    : item.type === 'deposit'
                      ? '📥'
                      : item.type === 'transfer'
                        ? '🔄'
                        : '📤'}
                </span>
                <div className="history-item-info">
                  <div className="history-item-top">
                    <span className="history-item-type">
                      {item.type === 'sale'
                        ? 'Bill Collected'
                        : item.type === 'deposit'
                          ? 'Money Added'
                          : item.type === 'transfer'
                            ? 'Transfer'
                            : 'Expense'}
                    </span>
                    {item.name && <span className="history-item-name">{item.name}</span>}
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
              <button
                type="button"
                className="history-delete"
                onClick={() => handleDelete(item.type, item.id)}
                aria-label="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
