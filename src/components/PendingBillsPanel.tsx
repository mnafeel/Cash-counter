import type { RefObject } from 'react'
import type { Sale } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import './PendingBillsPanel.css'

interface PendingBillsPanelProps {
  bills: Sale[]
  onSelect: (bill: Sale) => void
  focused?: boolean
  highlightedBillId?: string | null
  panelRef?: RefObject<HTMLElement | null>
  shortcutHint?: string
}
export default function PendingBillsPanel({
  bills,
  onSelect,
  focused,
  highlightedBillId,
  panelRef,
  shortcutHint,
}: PendingBillsPanelProps) {
  const total = bills.reduce((sum, b) => sum + b.billAmount, 0)

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={`pending-bills ${focused ? 'pending-bills--focused' : ''}`}
    >
      <div className="pending-bills-header">
        <span className="pending-bills-title">
          Pending
          {shortcutHint ? <span className="pending-bills-shortcut">{shortcutHint}</span> : null}
        </span>
        <span className="pending-bills-total">{formatMoney(total)}</span>
      </div>

      {bills.length === 0 ? (
        <p className="pending-bills-empty">No pending bills</p>
      ) : (
        <ul className="pending-bills-list">
          {bills.map((bill) => (
            <li key={bill.id} className="pending-bills-item">
              <button
                type="button"
                data-bill-id={bill.id}
                tabIndex={-1}
                className={`pending-bills-load pending-bills-load--full ${highlightedBillId === bill.id ? 'pending-bills-load--highlighted' : ''}`}
                onClick={() => onSelect(bill)}
              >
                <span className="pending-bills-amount">
                  {formatMoney(bill.billAmount)}
                  {bill.payType === 'cheque' ? (
                    <span className="pending-bills-tag">🧾 Cheque</span>
                  ) : null}
                </span>
                {bill.customerName ? (
                  <span className="pending-bills-name">{bill.customerName}</span>
                ) : null}
                <span className="pending-bills-time">Created {formatDate(bill.createdAt)}</span>
                {bill.updatedAt ? (
                  <span className="pending-bills-time pending-bills-time--updated">
                    Updated {formatDate(bill.updatedAt)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
