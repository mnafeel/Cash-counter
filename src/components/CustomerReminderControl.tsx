import { useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { formatDate } from '../utils/format'
import { evaluateBillReminderAlert, getReminderAlertSettings, type BillReminderKind } from '../utils/billReminders'
import { getCustomerReminderNote } from '../utils/customerReminders'
import BillReminderModal from './BillReminderModal'
import './BillReminderControl.css'

interface CustomerReminderControlProps {
  customerName: string
  reminderAt?: string
  billKind: Extract<BillReminderKind, 'credit' | 'cheque'>
  data: AppData
  onSet: (
    customerName: string,
    kind: Extract<BillReminderKind, 'credit' | 'cheque'>,
    reminderAt: string | null,
    reminderNote?: string | null,
  ) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
  compact?: boolean
}

export default function CustomerReminderControl({
  customerName,
  reminderAt,
  billKind,
  data,
  onSet,
  onSaveAlertSettings,
  compact = false,
}: CustomerReminderControlProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const alertSettings = getReminderAlertSettings(data)
  const reminderNote = getCustomerReminderNote(data, customerName, billKind)

  const kindLabel =
    billKind === 'credit' ? 'Credit reminder' : 'Cheque reminder'

  const alertInfo = reminderAt
    ? evaluateBillReminderAlert(reminderAt, billKind, alertSettings)
    : null

  function handleSave(iso: string, settings: ReminderAlertSettings, note?: string | null) {
    onSet(customerName, billKind, iso, note)
    onSaveAlertSettings?.(settings)
  }

  function handleClear() {
    onSet(customerName, billKind, null)
  }

  return (
    <>
      <div className={`bill-reminder-control ${compact ? 'bill-reminder-control--compact' : ''}`}>
        <span className="bill-reminder-control-kind">{kindLabel}</span>
        <div className="bill-reminder-control-actions">
          <button
            type="button"
            className="bill-reminder-control-btn bill-reminder-control-btn--open"
            onClick={() => setModalOpen(true)}
          >
            {reminderAt ? 'Edit reminder' : 'Set reminder'}
          </button>
        </div>
        {reminderAt && alertInfo ? (
          <span
            className={`bill-reminder-control-status ${
              alertInfo.isAlertActive ? 'bill-reminder-control-status--due' : ''
            }`}
          >
            🔔 {formatDate(reminderAt)}
            {alertInfo.isAlertActive ? ` · ${alertInfo.alertLabel}` : ` · Alert ${alertInfo.alertLabel.toLowerCase()}`}
          </span>
        ) : null}
        {reminderNote ? (
          <span className="bill-reminder-control-note">📝 {reminderNote}</span>
        ) : null}
      </div>

      <BillReminderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${kindLabel} · ${customerName}`}
        subtitle="Applies to all open bills for this customer."
        billKind={billKind}
        reminderAt={reminderAt}
        reminderNote={reminderNote}
        alertSettings={alertSettings}
        onSave={handleSave}
        onClear={handleClear}
      />
    </>
  )
}
