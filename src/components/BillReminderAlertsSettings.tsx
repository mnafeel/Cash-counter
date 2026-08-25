import { useEffect, useState } from 'react'
import type { ReminderAlertSettings } from '../types'
import { DEFAULT_REMINDER_ALERTS, NOTIFICATION_SHOW_SECOND_OPTIONS } from '../types'
import { formatNotificationShowLabel } from '../utils/billReminders'
import { testReminderNotificationSound } from '../utils/reminderNotificationSound'
import './BillReminderAlertsSettings.css'

const DAY_OPTIONS = [0, 1, 2, 3, 5, 7, 14, 30]
const INTERVAL_OPTIONS = [1, 2, 3, 7]

interface BillReminderAlertsSettingsProps {
  settings: ReminderAlertSettings
  onSave: (settings: ReminderAlertSettings) => void
}

export default function BillReminderAlertsSettings({
  settings,
  onSave,
}: BillReminderAlertsSettingsProps) {
  const [creditDaysBefore, setCreditDaysBefore] = useState(settings.creditDaysBefore)
  const [chequeDaysBefore, setChequeDaysBefore] = useState(settings.chequeDaysBefore)
  const [loanDaysBefore, setLoanDaysBefore] = useState(settings.loanDaysBefore)
  const [alertIntervalDays, setAlertIntervalDays] = useState(settings.alertIntervalDays)
  const [notificationShowSeconds, setNotificationShowSeconds] = useState(settings.notificationShowSeconds)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(settings.notificationSoundEnabled)
  const [notificationSoundMode, setNotificationSoundMode] = useState(settings.notificationSoundMode)
  const [notificationSoundRepeatSeconds, setNotificationSoundRepeatSeconds] = useState(
    settings.notificationSoundRepeatSeconds,
  )

  useEffect(() => {
    setCreditDaysBefore(settings.creditDaysBefore)
    setChequeDaysBefore(settings.chequeDaysBefore)
    setLoanDaysBefore(settings.loanDaysBefore)
    setAlertIntervalDays(settings.alertIntervalDays)
    setNotificationShowSeconds(settings.notificationShowSeconds)
    setNotificationSoundEnabled(settings.notificationSoundEnabled)
    setNotificationSoundMode(settings.notificationSoundMode)
    setNotificationSoundRepeatSeconds(settings.notificationSoundRepeatSeconds)
  }, [settings])

  function handleSave() {
    onSave({
      creditDaysBefore,
      chequeDaysBefore,
      loanDaysBefore,
      alertIntervalDays,
      notificationShowSeconds,
      notificationSoundEnabled,
      notificationSoundMode,
      notificationSoundRepeatSeconds,
    })
  }

  function handleReset() {
    setCreditDaysBefore(DEFAULT_REMINDER_ALERTS.creditDaysBefore)
    setChequeDaysBefore(DEFAULT_REMINDER_ALERTS.chequeDaysBefore)
    setLoanDaysBefore(DEFAULT_REMINDER_ALERTS.loanDaysBefore)
    setAlertIntervalDays(DEFAULT_REMINDER_ALERTS.alertIntervalDays)
    setNotificationShowSeconds(DEFAULT_REMINDER_ALERTS.notificationShowSeconds)
    setNotificationSoundEnabled(DEFAULT_REMINDER_ALERTS.notificationSoundEnabled)
    setNotificationSoundMode(DEFAULT_REMINDER_ALERTS.notificationSoundMode)
    setNotificationSoundRepeatSeconds(DEFAULT_REMINDER_ALERTS.notificationSoundRepeatSeconds)
    onSave(DEFAULT_REMINDER_ALERTS)
  }

  return (
    <div className="bill-alert-settings">
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
        <span className="bill-alert-settings-label">🔔 Alert interval</span>
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
          <button
            type="button"
            className="bill-alert-settings-chip bill-alert-settings-chip--test"
            onClick={() => void testReminderNotificationSound()}
          >
            Test
          </button>
        </div>
      </div>

      <div className="bill-alert-settings-actions">
        <button type="button" className="bill-alert-settings-save" onClick={handleSave}>
          Save alert options
        </button>
        <button type="button" className="bill-alert-settings-reset" onClick={handleReset}>
          Reset
        </button>
      </div>

      <p className="bill-alert-settings-note">
        Top-right alerts auto-hide after{' '}
        {notificationShowSeconds <= 0
          ? 'you close them (Until closed).'
          : `${formatNotificationShowLabel(notificationShowSeconds)}.`}{' '}
        Sound {notificationSoundEnabled ? 'on' : 'off'}. Credit default{' '}
        {DEFAULT_REMINDER_ALERTS.creditDaysBefore} days · Cheque default{' '}
        {DEFAULT_REMINDER_ALERTS.chequeDaysBefore} days · Loan default{' '}
        {DEFAULT_REMINDER_ALERTS.loanDaysBefore} days.
      </p>
    </div>
  )
}
