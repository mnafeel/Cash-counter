import { useEffect, useMemo, useState } from 'react'
import type { ReminderAlertSettings } from '../types'
import { DEFAULT_REMINDER_ALERTS, NOTIFICATION_SHOW_SECOND_OPTIONS } from '../types'
import {
  dateTimeInputValuesToIso,
  formatDate,
  isoToDateInputValue,
  isoToTimeInputValue,
} from '../utils/format'
import {
  daysBeforeForKind,
  evaluateBillReminderAlert,
  formatNotificationShowLabel,
  type BillReminderKind,
} from '../utils/billReminders'
import './BillReminderAlertsSettings.css'
import './BillReminderModal.css'

const DAY_OPTIONS = [0, 1, 2, 3, 5, 7, 14, 30]
const INTERVAL_OPTIONS = [1, 2, 3, 7]

export interface BillReminderModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  billKind: BillReminderKind
  reminderAt?: string
  reminderNote?: string
  alertSettings: ReminderAlertSettings
  onSave: (reminderAt: string, alertSettings: ReminderAlertSettings, reminderNote?: string | null) => void
  onClear: () => void
}

export default function BillReminderModal({
  open,
  onClose,
  title,
  subtitle,
  billKind,
  reminderAt,
  reminderNote,
  alertSettings,
  onSave,
  onClear,
}: BillReminderModalProps) {
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('09:00')
  const [noteValue, setNoteValue] = useState('')
  const [creditDaysBefore, setCreditDaysBefore] = useState(alertSettings.creditDaysBefore)
  const [chequeDaysBefore, setChequeDaysBefore] = useState(alertSettings.chequeDaysBefore)
  const [alertIntervalDays, setAlertIntervalDays] = useState(alertSettings.alertIntervalDays)
  const [notificationShowSeconds, setNotificationShowSeconds] = useState(alertSettings.notificationShowSeconds)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(alertSettings.notificationSoundEnabled)

  useEffect(() => {
    if (!open) return
    setDateValue(reminderAt ? isoToDateInputValue(reminderAt) : '')
    setTimeValue(reminderAt ? isoToTimeInputValue(reminderAt) : '09:00')
    setNoteValue(reminderNote?.trim() ?? '')
    setCreditDaysBefore(alertSettings.creditDaysBefore)
    setChequeDaysBefore(alertSettings.chequeDaysBefore)
    setAlertIntervalDays(alertSettings.alertIntervalDays)
    setNotificationShowSeconds(alertSettings.notificationShowSeconds)
    setNotificationSoundEnabled(alertSettings.notificationSoundEnabled)
  }, [open, reminderAt, reminderNote, alertSettings])

  const draftSettings = useMemo(
    (): ReminderAlertSettings => ({
      creditDaysBefore,
      chequeDaysBefore,
      alertIntervalDays,
      notificationShowSeconds,
      notificationSoundEnabled,
    }),
    [creditDaysBefore, chequeDaysBefore, alertIntervalDays, notificationShowSeconds, notificationSoundEnabled],
  )

  const preview = useMemo(() => {
    if (!dateValue) return null
    const iso = dateTimeInputValuesToIso(dateValue, timeValue || '09:00')
    if (!iso) return null
    return evaluateBillReminderAlert(iso, billKind, draftSettings)
  }, [dateValue, timeValue, billKind, draftSettings])

  const daysBefore = daysBeforeForKind(billKind, draftSettings)
  const kindLabel =
    billKind === 'credit' ? 'Credit' : billKind === 'cheque' ? 'Cheque' : 'Bill'

  function handleSave() {
    if (!dateValue) return
    const iso = dateTimeInputValuesToIso(dateValue, timeValue || '09:00')
    if (!iso) return
    onSave(iso, draftSettings, noteValue.trim() || null)
    onClose()
  }

  function handleClear() {
    onClear()
    onClose()
  }

  if (!open) return null

  return (
    <div className="bill-reminder-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="bill-reminder-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="bill-reminder-modal-panel">
        <div className="bill-reminder-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="bill-reminder-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="bill-reminder-modal-body">
          <section className="bill-reminder-modal-section">
            <span className="bill-reminder-modal-section-title">📅 Reminder date &amp; time</span>
            <div className="bill-reminder-modal-datetime">
              <label className="bill-reminder-modal-pick">
                <span>Date</span>
                <input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  aria-label={`${kindLabel} reminder date`}
                />
              </label>
              <label className="bill-reminder-modal-pick">
                <span>Time</span>
                <input
                  type="time"
                  value={timeValue}
                  onChange={(e) => setTimeValue(e.target.value)}
                  aria-label={`${kindLabel} reminder time`}
                />
              </label>
            </div>
            {reminderAt ? (
              <p className="bill-reminder-modal-current">Current: {formatDate(reminderAt)}</p>
            ) : null}
          </section>

          <section className="bill-reminder-modal-section">
            <span className="bill-reminder-modal-section-title">📝 Reminder note</span>
            <label className="bill-reminder-modal-note">
              <span>Optional note shown with alerts</span>
              <textarea
                value={noteValue}
                onChange={(e) => setNoteValue(e.target.value)}
                placeholder="e.g. Call before noon, collect from office…"
                rows={3}
                maxLength={200}
                aria-label={`${kindLabel} reminder note`}
              />
            </label>
          </section>

          <section className="bill-reminder-modal-section">
            <span className="bill-reminder-modal-section-title">🔔 Alert before due</span>
            {(billKind === 'credit' || billKind === 'other') && (
              <div className="bill-alert-settings-row">
                <span className="bill-alert-settings-label">💳 Credit alert before</span>
                <div className="bill-alert-settings-chips">
                  {DAY_OPTIONS.map((days) => (
                    <button
                      key={`credit-${days}`}
                      type="button"
                      className={`bill-alert-settings-chip ${creditDaysBefore === days ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setCreditDaysBefore(days)}
                    >
                      {days === 0 ? 'Due day' : `${days}d`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(billKind === 'cheque' || billKind === 'other') && (
              <div className="bill-alert-settings-row">
                <span className="bill-alert-settings-label">🧾 Cheque alert before</span>
                <div className="bill-alert-settings-chips">
                  {DAY_OPTIONS.map((days) => (
                    <button
                      key={`cheque-${days}`}
                      type="button"
                      className={`bill-alert-settings-chip ${chequeDaysBefore === days ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setChequeDaysBefore(days)}
                    >
                      {days === 0 ? 'Due day' : `${days}d`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="bill-alert-settings-row">
              <span className="bill-alert-settings-label">Repeat alert</span>
              <div className="bill-alert-settings-chips">
                {INTERVAL_OPTIONS.map((days) => (
                  <button
                    key={`interval-${days}`}
                    type="button"
                    className={`bill-alert-settings-chip ${alertIntervalDays === days ? 'bill-alert-settings-chip--active' : ''}`}
                    onClick={() => setAlertIntervalDays(days)}
                  >
                    {days === 1 ? 'Daily' : `${days} days`}
                  </button>
                ))}
              </div>
            </div>
            <div className="bill-alert-settings-row">
              <span className="bill-alert-settings-label">⏱ Notification show</span>
              <div className="bill-alert-settings-chips">
                {NOTIFICATION_SHOW_SECOND_OPTIONS.map((seconds) => (
                  <button
                    key={`notify-${seconds}`}
                    type="button"
                    className={`bill-alert-settings-chip ${notificationShowSeconds === seconds ? 'bill-alert-settings-chip--active' : ''}`}
                    onClick={() => setNotificationShowSeconds(seconds)}
                  >
                    {formatNotificationShowLabel(seconds)}
                  </button>
                ))}
              </div>
            </div>
            <div className="bill-alert-settings-row">
              <span className="bill-alert-settings-label">🔊 Alert sound</span>
              <div className="bill-alert-settings-chips">
                <button
                  type="button"
                  className={`bill-alert-settings-chip ${notificationSoundEnabled ? 'bill-alert-settings-chip--active' : ''}`}
                  onClick={() => setNotificationSoundEnabled(true)}
                >
                  On
                </button>
                <button
                  type="button"
                  className={`bill-alert-settings-chip ${!notificationSoundEnabled ? 'bill-alert-settings-chip--active' : ''}`}
                  onClick={() => setNotificationSoundEnabled(false)}
                >
                  Off
                </button>
              </div>
            </div>
          </section>

          {preview && dateValue ? (
            <p
              className={`bill-reminder-modal-preview ${
                preview.isAlertActive ? 'bill-reminder-modal-preview--active' : ''
              }`}
            >
              Alert starts {daysBefore === 0 ? 'on due day' : `${daysBefore} day${daysBefore === 1 ? '' : 's'} before`}
              {preview.isAlertActive ? ` · ${preview.alertLabel}` : ` · ${preview.alertLabel}`}
            </p>
          ) : null}
        </div>

        <div className="bill-reminder-modal-actions">
          <button
            type="button"
            className="bill-reminder-modal-btn bill-reminder-modal-btn--primary"
            onClick={handleSave}
            disabled={!dateValue}
          >
            Save reminder
          </button>
          {reminderAt ? (
            <button type="button" className="bill-reminder-modal-btn" onClick={handleClear}>
              Clear
            </button>
          ) : null}
          <button type="button" className="bill-reminder-modal-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_REMINDER_ALERTS }
