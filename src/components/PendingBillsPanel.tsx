import { useState, type MouseEvent } from 'react'
import type { RefObject } from 'react'
import type { AppData, ReminderAlertSettings, Sale } from '../types'
import { formatDate, formatMoney } from '../utils/format'
import {
  evaluateBillReminderAlert,
  getReminderAlertSettings,
  getSaleReminderKind,
  isReminderDue,
} from '../utils/billReminders'
import { getSaleCustomerName } from '../utils/saleCustomerName'
import BillReminderModal from './BillReminderModal'
import './PendingBillsPanel.css'

interface PendingBillsPanelProps {
  bills: Sale[]
  allSales?: Sale[]
  data?: AppData
  onSelect: (bill: Sale) => void
  onSetReminder?: (saleId: string, reminderAt: string | null, reminderNote?: string | null) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
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
  onSetReminder,
  onSaveAlertSettings,
  focused,
  highlightedBillId,
  panelRef,
  shortcutHint,
}: PendingBillsPanelProps) {
  const [modalBill, setModalBill] = useState<Sale | null>(null)
  const total = bills.reduce((sum, b) => sum + b.billAmount, 0)
  const alertSettings = data ? getReminderAlertSettings(data) : undefined

  function openReminderModal(bill: Sale, event: MouseEvent) {
    event.stopPropagation()
    event.preventDefault()
    setModalBill(bill)
  }

  function closeReminderModal() {
    setModalBill(null)
  }

  function handleSaveReminder(iso: string, settings: ReminderAlertSettings, reminderNote?: string | null) {
    if (!modalBill || !onSetReminder) return
    onSetReminder(modalBill.id, iso, reminderNote)
    onSaveAlertSettings?.(settings)
  }

  function handleClearReminder() {
    if (!modalBill || !onSetReminder) return
    onSetReminder(modalBill.id, null)
  }

  const modalKind = modalBill ? getSaleReminderKind(modalBill) : 'other'
  const modalName = modalBill
    ? getSaleCustomerName(modalBill, allSales ?? bills) || 'Bill'
    : ''

  return (
    <>
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
              const alertInfo =
                bill.reminderAt && alertSettings
                  ? evaluateBillReminderAlert(bill.reminderAt, kind, alertSettings)
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
                    {bill.reminderAt ? (
                      <span
                        className={`pending-bills-reminder ${
                          isReminderDue(bill.reminderAt) ? '' : 'pending-bills-reminder--upcoming'
                        } ${alertInfo?.isAlertActive ? 'pending-bills-reminder--active' : ''}`}
                      >
                        🔔 Reminder {formatDate(bill.reminderAt)}
                      </span>
                    ) : null}
                    {bill.reminderNote ? (
                      <span className="pending-bills-reminder-note">📝 {bill.reminderNote}</span>
                    ) : null}
                  </button>
                  {onSetReminder && data ? (
                    <button
                      type="button"
                      className="pending-bills-reminder-btn"
                      onClick={(event) => openReminderModal(bill, event)}
                      aria-label={`Set reminder for ${name || 'bill'}`}
                    >
                      🔔 {bill.reminderAt ? 'Edit' : 'Reminder'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      {modalBill && alertSettings && onSetReminder ? (
        <BillReminderModal
          open
          onClose={closeReminderModal}
          title={`${modalKind === 'credit' ? 'Credit' : modalKind === 'cheque' ? 'Cheque' : 'Bill'} reminder · ${modalName}`}
          subtitle={`${formatMoney(modalBill.billAmount)} · Pick date, time, note, and alert options.`}
          billKind={modalKind}
          reminderAt={modalBill.reminderAt}
          reminderNote={modalBill.reminderNote}
          alertSettings={alertSettings}
          onSave={handleSaveReminder}
          onClear={handleClearReminder}
        />
      ) : null}
    </>
  )
}
