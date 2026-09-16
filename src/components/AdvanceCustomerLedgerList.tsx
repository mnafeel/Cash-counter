import { useMemo, useState } from 'react'
import AdvanceRefundPanel from './AdvanceRefundPanel'
import {
  advancePortfolioTotals,
  buildCustomerAdvanceGroups,
  buildGlobalAdvanceStatement,
  type GlobalAdvanceStatementRow,
} from '../utils/customerAdvance'
import { useCash } from '../context/CashContext'
import { formatDate, formatMoney } from '../utils/format'
import type { HistoryDateFilter } from '../utils/historyItems'
import { isoMatchesHistoryDateFilter } from '../utils/historyItems'
import './AdvanceCustomerLedgerList.css'

export type AdvanceLedgerListMode = 'open' | 'history'

export type AdvanceHistoryDateFilter = HistoryDateFilter

export interface AdvanceCustomerLedgerListProps {
  search?: string
  mode?: AdvanceLedgerListMode
  historyDateFilter?: AdvanceHistoryDateFilter
  historySelectedDate?: string
  onPickCustomer?: (name: string) => void
  compact?: boolean
}

function OpenAdvanceTotal({ amount }: { amount: number }) {
  return (
    <div className="advance-ledger-open-total" role="status">
      <span className="advance-ledger-open-total__label">Open advance</span>
      <strong className="advance-ledger-open-total__value">{formatMoney(amount)}</strong>
    </div>
  )
}

function HistoryAdvanceTotalsBar({
  dateFilter,
  totalReceivedAllTime,
  totalOpen,
  periodCredit,
  periodDebit,
}: {
  dateFilter: AdvanceHistoryDateFilter
  totalReceivedAllTime: number
  totalOpen: number
  periodCredit: number
  periodDebit: number
}) {
  const receivedLabel =
    dateFilter === 'all'
      ? 'Total received'
      : dateFilter === 'today'
        ? 'Received today'
        : dateFilter === 'yesterday'
          ? 'Received yesterday'
          : dateFilter === 'week'
            ? 'Received this week'
            : 'Received on date'

  return (
    <div className="advance-ledger-totals advance-ledger-totals--history" role="status">
      <div className="advance-ledger-totals__item">
        <span className="advance-ledger-totals__label">{receivedLabel}</span>
        <strong className="advance-ledger-totals__value">
          {formatMoney(dateFilter === 'all' ? totalReceivedAllTime : periodCredit)}
        </strong>
      </div>
      {dateFilter !== 'all' && periodDebit > 0.01 ? (
        <div className="advance-ledger-totals__item">
          <span className="advance-ledger-totals__label">Out in period</span>
          <strong className="advance-ledger-totals__value advance-ledger-totals__value--debit">
            {formatMoney(periodDebit)}
          </strong>
        </div>
      ) : null}
      <div className="advance-ledger-totals__item advance-ledger-totals__item--open">
        <span className="advance-ledger-totals__label">Currently lying</span>
        <strong className="advance-ledger-totals__value">{formatMoney(totalOpen)}</strong>
      </div>
    </div>
  )
}

function StatementTable({
  rows,
  showCustomer,
}: {
  rows: GlobalAdvanceStatementRow[]
  showCustomer?: boolean
}) {
  if (rows.length === 0) {
    return <p className="advance-ledger-empty advance-ledger-empty--inline">No transactions yet.</p>
  }
  return (
    <table className="advance-statement">
      <thead>
        <tr>
          <th>Date</th>
          {showCustomer ? <th>Customer</th> : null}
          <th>Description</th>
          <th className="advance-statement__num">Credit</th>
          <th className="advance-statement__num">Debit</th>
          <th className="advance-statement__num">Balance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={row.statusTag === 'Open' ? 'advance-statement__row--open' : ''}
          >
            <td className="advance-statement__date">
              <time>{formatDate(row.at)}</time>
            </td>
            {showCustomer ? (
              <td className="advance-statement__customer">{row.customerName}</td>
            ) : null}
            <td className="advance-statement__desc">
              <span className="advance-statement__label">{row.label}</span>
              {row.detail ? (
                <span className="advance-statement__detail">{row.detail}</span>
              ) : null}
            </td>
            <td className="advance-statement__num advance-statement__credit">
              {row.credit > 0 ? `+${formatMoney(row.credit)}` : '—'}
            </td>
            <td className="advance-statement__num advance-statement__debit">
              {row.debit > 0 ? `−${formatMoney(row.debit)}` : '—'}</td>
            <td className="advance-statement__num advance-statement__balance">
              {formatMoney(row.balance)}
            </td>
            <td>
              {row.statusTag ? (
                <span
                  className={`advance-statement__tag advance-statement__tag--${row.statusTag.toLowerCase()}`}
                >
                  {row.statusTag}
                </span>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AdvanceCustomerLedgerList({
  search = '',
  mode = 'history',
  historyDateFilter = 'all',
  historySelectedDate = '',
  onPickCustomer,
  compact = false,
}: AdvanceCustomerLedgerListProps) {
  const { data } = useCash()
  const [refundKey, setRefundKey] = useState<string | null>(null)

  const totals = useMemo(() => advancePortfolioTotals(data), [data])
  const groups = useMemo(() => buildCustomerAdvanceGroups(data), [data])

  const openGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = groups.filter((g) => g.isActive)
    if (q) list = list.filter((g) => g.customerName.toLowerCase().includes(q))
    return list
  }, [groups, search])

  const openAdvanceTotal = useMemo(
    () => Math.round(openGroups.reduce((sum, g) => sum + g.balance, 0) * 100) / 100,
    [openGroups],
  )

  const { statementRows, periodCredit, periodDebit } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const chronological = buildGlobalAdvanceStatement(data)
    let filtered = chronological.filter((row) =>
      isoMatchesHistoryDateFilter(row.at, historyDateFilter, historySelectedDate),
    )
    if (q) {
      filtered = filtered.filter((row) => row.customerName.toLowerCase().includes(q))
    }
    const periodCredit = Math.round(
      filtered.reduce((sum, row) => sum + row.credit, 0) * 100,
    ) / 100
    const periodDebit = Math.round(
      filtered.reduce((sum, row) => sum + row.debit, 0) * 100,
    ) / 100
    return {
      statementRows: [...filtered].reverse(),
      periodCredit,
      periodDebit,
    }
  }, [data, search, historyDateFilter, historySelectedDate])

  if ((data.customerAdvances ?? []).length === 0) {
    return <p className="advance-ledger-empty">No advance activity yet.</p>
  }

  if (mode === 'open') {
    return (
      <div className={`advance-ledger ${compact ? 'advance-ledger--compact' : ''}`}>
        <OpenAdvanceTotal amount={openAdvanceTotal} />
        {openGroups.length === 0 ? (
          <p className="advance-ledger-empty">No open advance balances.</p>
        ) : (
          <ul className="advance-ledger-open-list">
            {openGroups.map((group) => {
              const refundOpen = refundKey === group.key
              return (
                <li key={group.key} className="advance-ledger-open-row">
                  <div className="advance-ledger-open-row-main">
                    <span className="advance-ledger-open-row-name">{group.customerName}</span>
                    <strong className="advance-ledger-open-row-balance">
                      {formatMoney(group.balance)}
                    </strong>
                    <div className="advance-ledger-open-row-actions">
                      <button
                        type="button"
                        className="advance-ledger-group-refund"
                        onClick={() =>
                          setRefundKey((prev) => (prev === group.key ? null : group.key))
                        }
                      >
                        {refundOpen ? 'Close' : 'Refund'}
                      </button>
                      {onPickCustomer ? (
                        <button
                          type="button"
                          className="advance-ledger-group-use"
                          onClick={() => onPickCustomer(group.customerName)}
                        >
                          Use
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {refundOpen ? (
                    <div className="advance-ledger-refund-block">
                      <AdvanceRefundPanel
                        compact
                        lockCustomerName
                        defaultCustomerName={group.customerName}
                        defaultAmount={group.balance}
                        onRefunded={() => setRefundKey(null)}
                      />
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

  return (
    <div className={`advance-ledger ${compact ? 'advance-ledger--compact' : ''}`}>
      <HistoryAdvanceTotalsBar
        dateFilter={historyDateFilter}
        totalReceivedAllTime={totals.totalReceived}
        totalOpen={totals.totalOpen}
        periodCredit={periodCredit}
        periodDebit={periodDebit}
      />
      {statementRows.length === 0 ? (
        <p className="advance-ledger-empty">No transactions match this filter.</p>
      ) : (
        <div className="advance-ledger-statement-wrap">
          <StatementTable rows={statementRows} showCustomer />
        </div>
      )}
    </div>
  )
}
