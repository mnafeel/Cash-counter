import type { Sale } from '../types'
import { formatMoney, formatTime } from '../utils/format'
import './PendingBillsPanel.css'

interface PendingBillsPanelProps {
  bills: Sale[]
  onSelect: (bill: Sale) => void
}

export default function PendingBillsPanel({ bills, onSelect }: PendingBillsPanelProps) {
  const total = bills.reduce((sum, b) => sum + b.billAmount, 0)

  return (
    <aside className="pending-bills">
      <div className="pending-bills-header">
        <span className="pending-bills-title">Pending</span>
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
                className="pending-bills-load pending-bills-load--full"
                onClick={() => onSelect(bill)}
              >
                <span className="pending-bills-amount">{formatMoney(bill.billAmount)}</span>
                {bill.customerName ? (
                  <span className="pending-bills-name">{bill.customerName}</span>
                ) : null}
                <span className="pending-bills-time">{formatTime(bill.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
