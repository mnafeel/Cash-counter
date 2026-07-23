import { useMemo, useState } from 'react'
import type { AppData, ReminderAlertSettings } from '../types'
import { formatDate } from '../utils/format'
import { evaluateBillReminderAlert, getReminderAlertSettings, type BillReminderKind } from '../utils/billReminders'
import {
  getEffectiveSaleReminderAt,
  getEffectiveSaleReminderNote,
  resolveSaleCustomerLabel,
} from '../utils/customerReminders'
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
  onSetCustomer?: (
    customerName: string,
    kind: Extract<BillReminderKind, 'credit' | 'cheque'>,
    reminderAt: string | null,
    reminderNote?: string | null,
  ) => void
  onSaveAlertSettings?: (settings: ReminderAlertSettings) => void
  compact?: boolean
}

export default function BillReminderControl({
  saleId,
  reminderAt: reminderAtProp,
  reminderNote: reminderNoteProp,
  billKind = 'other',
  billLabel,
  data,
  onSet,
  onSetCustomer,
  onSaveAlertSettings,
  compact = false,
}: BillReminderControlProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const alertSettings = getReminderAlertSettings(data)

  const sale = useMemo(() => data.sales.find((entry) => entry.id === saleId), [data.sales, saleId])

  const reminderAt = useMemo(() => {
    if (sale) return getEffectiveSaleReminderAt(data, sale) ?? reminderAtProp
    return reminderAtProp
  }, [data, sale, reminderAtProp])

  const reminderNote = useMemo(() => {
    if (sale) return getEffectiveSaleReminderNote(data, sale) ?? reminderNoteProp
    return reminderNoteProp
  }, [data, sale, reminderNoteProp])

  const kindLabel =
    billKind === 'credit' ? 'Credit reminder' : billKind === 'cheque' ? 'Cheque reminder' : 'Reminder'

  const alertInfo = reminderAt
    ? evaluateBillReminderAlert(reminderAt, billKind, alertSettings)
    : null

  function saveReminder(reminderAtValue: string | null, note?: string | null) {
    if (
      sale &&
      (billKind === 'credit' || billKind === 'cheque') &&
      onSetCustomer
    ) {
      const customerName = resolveSaleCustomerLabel(sale, data.sales)
      if (customerName) {
        onSetCustomer(customerName, billKind, reminderAtValue, note)
        return
      }
    }
    onSet(saleId, reminderAtValue, note)
  }

  function handleSave(iso: string, settings: ReminderAlertSettings, note?: string | null) {
    saveReminder(iso, note)
    onSaveAlertSettings?.(settings)
  }

  function handleClear() {
    saveReminder(null)
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
