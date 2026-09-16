import { useDeferredValue, useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import { buildCustomerReturnHistory } from '../utils/customerAdvance'
import { formatDate, formatMoney } from '../utils/format'
import './ReturnLookupPanel.css'

export default function ReturnLookupPanel({ compact = false }: { compact?: boolean }) {
  const { data } = useCash()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const history = useMemo(() => buildCustomerReturnHistory(data), [data])

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return history
    return history.filter(
      (row) =>
        row.customerName.toLowerCase().includes(q) ||
        row.itemLabel.toLowerCase().includes(q) ||
        String(row.amount).includes(q),
    )
  }, [history, deferredSearch])

  const limit = compact ? 40 : 200

  return (
    <div className={`return-lookup ${compact ? 'return-lookup--compact' : ''}`}>
      {!compact ? (
        <p className="return-lookup-hint">
          Search returns from Counter bills or credits to advance. New returns are recorded on Counter.
        </p>
      ) : null}

      <div className="return-lookup-search-wrap">
        <label className="return-lookup-search-label" htmlFor="return-lookup-search">
          Search returns
        </label>
        <input
          id="return-lookup-search"
          className="return-lookup-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Customer, item, or amount"
          autoComplete="off"
        />
      </div>

      <p className="return-lookup-count" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'return' : 'returns'}
      </p>

      {filtered.length === 0 ? (
        <p className="return-lookup-empty">
          {history.length === 0 ? 'No returns recorded yet.' : 'No returns match this search.'}
        </p>
      ) : (
        <ul className="return-lookup-list">
          {filtered.slice(0, limit).map((row) => {
            const open = expandedId === row.id
            return (
              <li key={`${row.source}-${row.id}`} className="return-lookup-card">
                <button
                  type="button"
                  className="return-lookup-card__head"
                  aria-expanded={open}
                  onClick={() => setExpandedId(open ? null : row.id)}
                >
                  <div className="return-lookup-card__main">
                    <strong>{row.customerName}</strong>
                    <span className="return-lookup-meta">{row.itemLabel}</span>
                    <span className="return-lookup-date">{formatDate(row.at)}</span>
                  </div>
                  <div className="return-lookup-card__side">
                    <strong>{formatMoney(row.amount)}</strong>
                    <span className="return-lookup-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  </div>
                </button>
                {open ? (
                  <div className="return-lookup-card__detail">
                    <dl>
                      <div>
                        <dt>Item / details</dt>
                        <dd>{row.itemLabel}</dd>
                      </div>
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatMoney(row.amount)}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>{row.source === 'advance' ? 'Credited to advance' : 'Deducted on bill'}</dd>
                      </div>
                      <div>
                        <dt>Date</dt>
                        <dd>{formatDate(row.at)}</dd>
                      </div>
                      {row.saleId ? (
                        <div>
                          <dt>Bill</dt>
                          <dd className="return-lookup-mono">{row.saleId.slice(0, 8)}…</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
