import { useEffect, useMemo, useRef, useState } from 'react'
import AppDateChipInput from './AppDateChipInput'
import type { ReminderAlertSettings } from '../types'
import { DEFAULT_REMINDER_ALERTS, NOTIFICATION_SHOW_SECOND_OPTIONS, NOTIFICATION_SOUND_REPEAT_OPTIONS } from '../types'
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
  getReminderDateTimeQuickOptions,
  getSuggestedReminderDateTime,
  type BillReminderKind,
} from '../utils/billReminders'
import { testReminderNotificationSound, stopReminderNotificationSound, type ReminderSoundStyle } from '../utils/reminderNotificationSound'
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
  /** Loan only — mark reminder as urgent for stronger sound. */
  reminderUrgent?: boolean
  alertSettings: ReminderAlertSettings
  onSave: (
    reminderAt: string,
    alertSettings: ReminderAlertSettings,
    reminderNote?: string | null,
    loanExtras?: { reminderUrgent?: boolean },
  ) => void
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
  reminderUrgent,
  alertSettings,
  onSave,
  onClear,
}: BillReminderModalProps) {
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('09:00')
  const [noteValue, setNoteValue] = useState('')
  const [creditDaysBefore, setCreditDaysBefore] = useState(alertSettings.creditDaysBefore)
  const [chequeDaysBefore, setChequeDaysBefore] = useState(alertSettings.chequeDaysBefore)
  const [loanDaysBefore, setLoanDaysBefore] = useState(alertSettings.loanDaysBefore)
  const [alertIntervalDays, setAlertIntervalDays] = useState(alertSettings.alertIntervalDays)
  const [notificationShowSeconds, setNotificationShowSeconds] = useState(alertSettings.notificationShowSeconds)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(alertSettings.notificationSoundEnabled)
  const [notificationSoundMode, setNotificationSoundMode] = useState(alertSettings.notificationSoundMode)
  const [notificationSoundRepeatSeconds, setNotificationSoundRepeatSeconds] = useState(
    alertSettings.notificationSoundRepeatSeconds,
  )
  const [soundTesting, setSoundTesting] = useState(false)
  const [loanUrgent, setLoanUrgent] = useState(reminderUrgent ?? false)
  const wasOpenRef = useRef(false)

  const quickOptions = useMemo(() => getReminderDateTimeQuickOptions(), [open])

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true

    if (reminderAt) {
      setDateValue(isoToDateInputValue(reminderAt))
      setTimeValue(isoToTimeInputValue(reminderAt))
    } else {
      const suggested = getSuggestedReminderDateTime(billKind)
      setDateValue(suggested.dateValue)
      setTimeValue(suggested.timeValue)
    }
    setNoteValue(reminderNote?.trim() ?? '')
    setCreditDaysBefore(alertSettings.creditDaysBefore)
    setChequeDaysBefore(alertSettings.chequeDaysBefore)
    setLoanDaysBefore(alertSettings.loanDaysBefore)
    setAlertIntervalDays(alertSettings.alertIntervalDays)
    setNotificationShowSeconds(alertSettings.notificationShowSeconds)
    setNotificationSoundEnabled(alertSettings.notificationSoundEnabled)
    setNotificationSoundMode(alertSettings.notificationSoundMode)
    setNotificationSoundRepeatSeconds(alertSettings.notificationSoundRepeatSeconds)
    setSoundTesting(false)
    setLoanUrgent(reminderUrgent ?? false)
  }, [open, reminderAt, reminderNote, reminderUrgent, alertSettings, billKind])

  useEffect(() => {
    if (!open) stopReminderNotificationSound()
    return () => stopReminderNotificationSound()
  }, [open])

  const draftSettings = useMemo(
    (): ReminderAlertSettings => ({
      creditDaysBefore,
      chequeDaysBefore,
      loanDaysBefore,
      alertIntervalDays,
      notificationShowSeconds,
      notificationSoundEnabled,
      notificationSoundMode,
      notificationSoundRepeatSeconds,
    }),
    [
      creditDaysBefore,
      chequeDaysBefore,
      loanDaysBefore,
      alertIntervalDays,
      notificationShowSeconds,
      notificationSoundEnabled,
      notificationSoundMode,
      notificationSoundRepeatSeconds,
    ],
  )

  const preview = useMemo(() => {
    if (!dateValue) return null
    const iso = dateTimeInputValuesToIso(dateValue, timeValue || '09:00')
    if (!iso) return null
    return evaluateBillReminderAlert(iso, billKind, draftSettings)
  }, [dateValue, timeValue, billKind, draftSettings])

  const daysBefore = daysBeforeForKind(billKind, draftSettings)
  const kindLabel =
    billKind === 'credit'
      ? 'Credit'
      : billKind === 'cheque'
        ? 'Cheque'
        : billKind === 'loan'
          ? 'Loan'
          : 'Bill'
  const previewSoundStyle: ReminderSoundStyle =
    billKind === 'loan' && loanUrgent ? 'urgent' : 'normal'

  function handleSave() {
    if (!dateValue) return
    const iso = dateTimeInputValuesToIso(dateValue, timeValue || '09:00')
    if (!iso) return
    onSave(
      iso,
      draftSettings,
      noteValue.trim() || null,
      billKind === 'loan' ? { reminderUrgent: loanUrgent } : undefined,
    )
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
              <div className="bill-reminder-modal-pick bill-reminder-modal-pick--date">
                <span>Date</span>
                <AppDateChipInput
                  value={dateValue}
                  active
                  className="bill-reminder-modal-date-chip"
                  onChange={setDateValue}
                  aria-label={`${kindLabel} reminder date`}
                />
              </div>
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
            <div className="bill-reminder-modal-quick">
                {quickOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`bill-reminder-modal-quick-chip ${
                      dateValue === option.dateValue && timeValue === option.timeValue
                        ? 'bill-reminder-modal-quick-chip--active'
                        : ''
                    }`}
                    onClick={() => {
                      setDateValue(option.dateValue)
                      setTimeValue(option.timeValue)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            {reminderAt ? (
              <p className="bill-reminder-modal-current">Editing reminder · was {formatDate(reminderAt)}</p>
            ) : null}
            <p className="bill-reminder-modal-help">
              Pick any date and time. Alerts can start days before the due date, or only on the due day.
            </p>
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
            {billKind === 'loan' ? (
              <>
                <div className="bill-alert-settings-row">
                  <span className="bill-alert-settings-label">🤝 Loan alert before</span>
                  <div className="bill-alert-settings-chips">
                    {DAY_OPTIONS.map((days) => (
                      <button
                        key={`loan-${days}`}
                        type="button"
                        className={`bill-alert-settings-chip ${loanDaysBefore === days ? 'bill-alert-settings-chip--active' : ''}`}
                        onClick={() => setLoanDaysBefore(days)}
                      >
                        {days === 0 ? 'Due day' : `${days}d`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bill-alert-settings-row">
                  <span className="bill-alert-settings-label">⚡ Importance</span>
                  <div className="bill-alert-settings-chips">
                    <button
                      type="button"
                      className={`bill-alert-settings-chip ${!loanUrgent ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setLoanUrgent(false)}
                    >
                      Normal
                    </button>
                    <button
                      type="button"
                      className={`bill-alert-settings-chip ${loanUrgent ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setLoanUrgent(true)}
                    >
                      Urgent
                    </button>
                  </div>
                </div>
              </>
            ) : null}
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
            {notificationSoundEnabled ? (
              <>
                <div className="bill-alert-settings-row">
                  <span className="bill-alert-settings-label">Sound mode</span>
                  <div className="bill-alert-settings-chips">
                    <button
                      type="button"
                      className={`bill-alert-settings-chip ${notificationSoundMode === 'once' ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setNotificationSoundMode('once')}
                    >
                      Once
                    </button>
                    <button
                      type="button"
                      className={`bill-alert-settings-chip ${notificationSoundMode === 'interval' ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setNotificationSoundMode('interval')}
                    >
                      Interval
                    </button>
                    <button
                      type="button"
                      className={`bill-alert-settings-chip ${notificationSoundMode === 'continuous' ? 'bill-alert-settings-chip--active' : ''}`}
                      onClick={() => setNotificationSoundMode('continuous')}
                    >
                      Continuous
                    </button>
                  </div>
                </div>
                {notificationSoundMode === 'interval' ? (
                  <div className="bill-alert-settings-row">
                    <span className="bill-alert-settings-label">Repeat every</span>
                    <div className="bill-alert-settings-chips">
                      {NOTIFICATION_SOUND_REPEAT_OPTIONS.map((seconds) => (
                        <button
                          key={`sound-repeat-${seconds}`}
                          type="button"
                          className={`bill-alert-settings-chip ${notificationSoundRepeatSeconds === seconds ? 'bill-alert-settings-chip--active' : ''}`}
                          onClick={() => setNotificationSoundRepeatSeconds(seconds)}
                        >
                          {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="bill-alert-settings-row">
                  <span className="bill-alert-settings-label">Preview</span>
                  <div className="bill-alert-settings-chips">
                    <button
                      type="button"
                      className="bill-alert-settings-chip bill-alert-settings-chip--test"
                      onClick={() => {
                        setSoundTesting(true)
                        void testReminderNotificationSound(
                          previewSoundStyle,
                          notificationSoundMode,
                          notificationSoundRepeatSeconds,
                        )
                      }}
                    >
                      Test sound
                    </button>
                    {soundTesting ? (
                      <button
                        type="button"
                        className="bill-alert-settings-chip bill-alert-settings-chip--stop"
                        onClick={() => {
                          stopReminderNotificationSound()
                          setSoundTesting(false)
                        }}
                      >
                        Stop
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            ) : null}
            {billKind === 'loan' && loanUrgent ? (
              <p className="bill-reminder-modal-suggested">
                Urgent uses a longer, stronger alert tone when this loan reminder is active.
              </p>
            ) : null}
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
