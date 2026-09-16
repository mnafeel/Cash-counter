import { useDeferredValue, useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import {
  getAdvanceSalesCountMode,
  listAppliedAdvancesForSettings,
  listReceivedAdvancesForSettings,
} from '../utils/customerAdvance'
import { formatMoney, formatTimestamp } from '../utils/format'
import './AdvanceSettingsPanel.css'

export default function AdvanceSettingsPanel() {
  const {
    data,
    updateAdvanceSalesCountMode,
    setCustomerAdvanceCountInSales,
    unapplyCustomerAdvanceFromSale,
  } = useCash()
  const addToSalesDefault = getAdvanceSalesCountMode(data) === 'on_receive'
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const receivedRows = useMemo(() => listReceivedAdvancesForSettings(data), [data])
  const appliedRows = useMemo(() => listAppliedAdvancesForSettings(data), [data])

  const filteredReceived = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return receivedRows
    return receivedRows.filter((row) => {
      const hay = `${row.customerName} ${row.payLabel} ${row.note ?? ''} ${row.amount} ${row.remaining}`
      return hay.toLowerCase().includes(q)
    })
  }, [receivedRows, deferredSearch])

  const filteredApplied = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return appliedRows
    return appliedRows.filter((row) => {
      const hay = `${row.customerName} ${row.saleLabel} ${row.note ?? ''} ${row.amount}`
      return hay.toLowerCase().includes(q)
    })
  }, [appliedRows, deferredSearch])

  return (
    <div className="advance-settings">
      <header className="advance-settings-head">
        <h3>Advance settings</h3>
        <p>
          All advance payments are listed here. Toggle Add to sales per advance, and unapply from a
          bill when needed.
        </p>
      </header>

      <button
        type="button"
        className={`advance-sales-toggle ${addToSalesDefault ? 'advance-sales-toggle--on' : ''}`}
        aria-pressed={addToSalesDefault}
        onClick={() =>
          updateAdvanceSalesCountMode(addToSalesDefault ? 'on_bill' : 'on_receive')
        }
      >
        <span className="advance-sales-toggle__track" aria-hidden="true">
          <span className="advance-sales-toggle__thumb" />
        </span>
        <span className="advance-sales-toggle__copy">
          <span className="advance-sales-toggle__title">Default · Add to sales</span>
          <span className="advance-sales-toggle__detail">
            {addToSalesDefault
              ? 'ON — new advances count in Sales when received; bills later only take remaining'
              : 'OFF — new advances join the bill total when you generate a sale'}
          </span>
        </span>
      </button>

      <input
        className="advance-settings-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search customer, amount…"
        aria-label="Search advances"
      />

      <section className="advance-settings-manage" aria-label="Advance payments">
        <h4 className="advance-settings-manage__title">Advance payments</h4>
        <p className="advance-settings-manage__intro">
          Each advance bill — applied amount goes to the sale; remaining stays as open advance.
        </p>

        {filteredReceived.length === 0 ? (
          <p className="advance-settings-empty">
            {receivedRows.length === 0
              ? 'No advance payments recorded yet.'
              : 'No matches for this search.'}
          </p>
        ) : (
          <ul className="advance-settings-list">
            {filteredReceived.map((row) => (
              <li key={row.id} className="advance-settings-row">
                <div className="advance-settings-row__main">
                  <strong>{row.customerName}</strong>
                  <span className="advance-settings-row__amount">{formatMoney(row.amount)}</span>
                </div>
                <div className="advance-settings-row__meta">
                  <span>{row.payLabel}</span>
                  <span>{formatTimestamp(row.at)}</span>
                </div>
                <div className="advance-settings-row__meta">
                  <span>Applied {formatMoney(row.applied)}</span>
                  <span>Remaining {formatMoney(row.remaining)}</span>
                  <span
                    className={`advance-settings-status advance-settings-status--${
                      row.remaining <= 0.01
                        ? 'applied'
                        : row.applied > 0.01
                          ? 'partial'
                          : 'open'
                    }`}
                  >
                    {row.remaining <= 0.01
                      ? 'Applied'
                      : row.applied > 0.01
                        ? 'Partial'
                        : 'Open'}
                  </span>
                </div>
                {row.note ? <p className="advance-settings-row__note">{row.note}</p> : null}
                <button
                  type="button"
                  className={`advance-sales-toggle advance-sales-toggle--compact ${row.countInSalesOnReceive ? 'advance-sales-toggle--on' : ''}`}
                  aria-pressed={row.countInSalesOnReceive}
                  onClick={() =>
                    setCustomerAdvanceCountInSales(row.id, !row.countInSalesOnReceive)
                  }
                >
                  <span className="advance-sales-toggle__track" aria-hidden="true">
                    <span className="advance-sales-toggle__thumb" />
                  </span>
                  <span className="advance-sales-toggle__copy">
                    <span className="advance-sales-toggle__title">Add to sales</span>
                    <span className="advance-sales-toggle__detail">
                      {row.countInSalesOnReceive
                        ? 'ON — in Sales when received; bill uses remaining only'
                        : 'OFF — included in the bill total when applied'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="advance-settings-manage" aria-label="Manage apply">
        <h4 className="advance-settings-manage__title">Manage apply</h4>
        <p className="advance-settings-manage__intro">
          Unapply an advance from a bill if it was applied by mistake.
        </p>

        {filteredApplied.length === 0 ? (
          <p className="advance-settings-empty">
            {appliedRows.length === 0
              ? 'No advances applied to sales yet.'
              : 'No matches for this search.'}
          </p>
        ) : (
          <ul className="advance-settings-list">
            {filteredApplied.map((row) => (
              <li key={row.id} className="advance-settings-row">
                <div className="advance-settings-row__main">
                  <strong>{row.customerName}</strong>
                  <span className="advance-settings-row__amount">{formatMoney(row.amount)}</span>
                </div>
                <div className="advance-settings-row__meta">
                  <span className="advance-settings-status advance-settings-status--applied">
                    Applied
                  </span>
                  <span>{row.saleLabel}</span>
                  <span>{formatTimestamp(row.at)}</span>
                </div>
                {row.note ? <p className="advance-settings-row__note">{row.note}</p> : null}
                <button
                  type="button"
                  className="advance-settings-unapply"
                  onClick={() => unapplyCustomerAdvanceFromSale(row.id)}
                >
                  Unapply
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
