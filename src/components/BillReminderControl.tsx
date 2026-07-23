import { useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { formatDate } from '../utils/format'
import { evaluateBillReminderAlert, getReminderAlertSettings, type BillReminderKind } from '../utils/billReminders'
import BillReminderModal from './BillReminderModal'
import './BillReminderControl.css'

interface BillReminderControlProps {
  saleId: string
  reminderAt?: string
  reminderNote?: string
  billKind?: BillReminderKind
  billLabel?: string
  data: AppData
  onSet: (saleId: string, reminderAt: string | null, reminderNote?: string | null) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
  compact?: boolean
}

export default function BillReminderControl({
  saleId,
  reminderAt,
  reminderNote,
  billKind = 'other',
  billLabel,
  data,
  onSet,
  onSaveAlertSettings,
  compact = false,
}: BillReminderControlProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const alertSettings = getReminderAlertSettings(data)

  const kindLabel =
    billKind === 'credit' ? 'Credit reminder' : billKind === 'cheque' ? 'Cheque reminder' : 'Reminder'

  const alertInfo = reminderAt
    ? evaluateBillReminderAlert(reminderAt, billKind, alertSettings)
    : null

  function handleSave(iso: string, settings: ReminderAlertSettings, note?: string | null) {
    onSet(saleId, iso, note)
    onSaveAlertSettings?.(settings)
  }

  function handleClear() {
    onSet(saleId, null)
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
        title={billLabel ? `${kindLabel} · ${billLabel}` : kindLabel}
        subtitle="Pick date, time, note, and how early to alert."
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
