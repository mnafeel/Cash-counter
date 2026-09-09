import type { RefObject } from 'react'
import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import {
  evaluateBillReminderAlert,
  getReminderAlertSettings,
  getSaleReminderKind,
  isReminderDue,
} from '../utils/billReminders'
import {
  getEffectiveSaleReminderAt,
  getEffectiveSaleReminderNote,
} from '../utils/customerReminders'
import { getSaleCustomerName } from '../utils/saleCustomerName'
import './PendingBillsPanel.css'

interface PendingBillsPanelProps {
  bills: Sale[]
  allSales?: Sale[]
  data?: AppData
  onSelect: (bill: Sale) => void
  focused?: boolean
  highlightedBillId?: string | null
  panelRef?: RefObject<HTMLElement | null>
  shortcutHint?: string
}

export default function PendingBillsPanel({
  bills,
  allSales,
  data,
  onSelect,
  focused,
  highlightedBillId,
  panelRef,
  shortcutHint,
}: PendingBillsPanelProps) {
  const total = bills.reduce((sum, b) => sum + b.billAmount, 0)
  const alertSettings = data ? getReminderAlertSettings(data) : undefined

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
          {bills.map((bill) => {
            const name = getSaleCustomerName(bill, allSales ?? bills)
            const kind = getSaleReminderKind(bill)
            const billReminderAt = data ? getEffectiveSaleReminderAt(data, bill) : bill.reminderAt
            const billReminderNote = data ? getEffectiveSaleReminderNote(data, bill) : bill.reminderNote
            const alertInfo =
              billReminderAt && alertSettings
                ? evaluateBillReminderAlert(billReminderAt, kind, alertSettings)
                : null

            return (
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
                    {bill.source === 'tally' ? (
                      <span className="pending-bills-tag">📒 Tally</span>
                    ) : null}
                    {bill.payType === 'cheque' ? (
                      <span className="pending-bills-tag">🧾 Cheque</span>
                    ) : null}
                    {bill.payType === 'credit' ? (
                      <span className="pending-bills-tag">💳 Credit</span>
                    ) : null}
                  </span>
                  {name ? <span className="pending-bills-name">{name}</span> : null}
                  <span className="pending-bills-time">Created {formatDate(bill.createdAt)}</span>
                  {bill.updatedAt ? (
                    <span className="pending-bills-time pending-bills-time--updated">
                      Updated {formatDate(bill.updatedAt)}
                    </span>
                  ) : null}
                  {billReminderAt ? (
                    <span
                      className={`pending-bills-reminder ${
                        isReminderDue(billReminderAt) ? '' : 'pending-bills-reminder--upcoming'
                      } ${alertInfo?.isAlertActive ? 'pending-bills-reminder--active' : ''}`}
                    >
                      🔔 Reminder {formatDate(billReminderAt)}
                    </span>
                  ) : null}
                  {billReminderNote ? (
                    <span className="pending-bills-reminder-note">📝 {billReminderNote}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
