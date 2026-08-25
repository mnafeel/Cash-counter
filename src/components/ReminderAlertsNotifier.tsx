import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import { formatMoney } from '../utils/format'
import {
  buildActiveBillReminders,
  formatNotificationShowLabel,
  getReminderAlertSettings,
  type BillReminderItem,
} from '../utils/billReminders'
import { buildActiveLoanReminders, type LoanReminderItem } from '../utils/loanReminders'
import {
  isReminderSoundPlaying,
  playReminderNotificationSound,
  startAlertReminderSound,
  stopReminderNotificationSound,
  subscribeReminderSoundPlaying,
  type ReminderSoundStyle,
} from '../utils/reminderNotificationSound'
import './ReminderAlertsNotifier.css'

const MAX_VISIBLE = 3
const DISMISSED_STORAGE_KEY = 'cash-counter-dismissed-reminder-alerts'

type UnifiedReminderAlert = {
  dismissKey: string
  kind: 'credit' | 'cheque' | 'other' | 'loan'
  title: string
  amount: number
  alertLabel: string
  reminderDateLabel: string
  reminderSortAt: string
  reminderNote?: string
  isDue: boolean
  isOverdue: boolean
  soundStyle: ReminderSoundStyle
  onOpen: () => void
}

function useNow(tickMs = 5000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs])
  return now
}

function billAlert(item: BillReminderItem, onOpen: () => void): UnifiedReminderAlert {
  return {
    dismissKey: `bill|${item.saleId}|${item.reminderAt}`,
    kind: item.kind,
    title: item.customerName,
    amount: item.amount,
    alertLabel: item.alertLabel,
    reminderDateLabel: item.reminderDateLabel,
    reminderSortAt: item.reminderAt,
    reminderNote: item.reminderNote,
    isDue: item.isDue,
    isOverdue: item.isOverdue,
    soundStyle: 'normal',
    onOpen,
  }
}

function loanAlert(item: LoanReminderItem, onOpen: () => void): UnifiedReminderAlert {
  return {
    dismissKey: `loan|${item.loanId}|${item.reminderAt}`,
    kind: 'loan',
    title: item.personName,
    amount: item.amount,
    alertLabel: item.alertLabel,
    reminderDateLabel: item.reminderDateLabel,
    reminderSortAt: item.reminderAt,
    reminderNote: item.reminderNote,
    isDue: item.isDue,
    isOverdue: item.isOverdue,
    soundStyle: item.soundStyle,
    onOpen,
  }
}

function readDismissedKeys(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((key) => typeof key === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function writeDismissedKeys(keys: Set<string>) {
  sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...keys]))
}

function kindIcon(kind: UnifiedReminderAlert['kind']): string {
  if (kind === 'credit') return '💳'
  if (kind === 'cheque') return '🧾'
  if (kind === 'loan') return '🤝'
  return '🔔'
}

export default function ReminderAlertsNotifier() {
  const { data } = useCash()
  const navigate = useNavigate()
  const mightHaveReminders = useMemo(() => {
    if (data.sales.some((sale) => sale.reminderAt)) return true
    if ((data.loans ?? []).some((loan) => !loan.settledAt && loan.reminderAt)) return true
    const customerReminders = data.customerReminders
    if (customerReminders && Object.keys(customerReminders).length > 0) return true
    return false
  }, [data])
  const now = useNow(mightHaveReminders ? 5000 : 60000)
  const alertSettings = useMemo(() => getReminderAlertSettings(data), [data])
  const showSeconds = alertSettings.notificationShowSeconds
  const [collapsed, setCollapsed] = useState(false)
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(readDismissedKeys)
  const [shownAtByKey, setShownAtByKey] = useState<Record<string, number>>({})
  const [soundPlaying, setSoundPlaying] = useState(false)
  const prevAlertStateRef = useRef<Record<string, { visible: boolean; due: boolean }>>({})
  const soundSessionKeyRef = useRef('')

  useEffect(() => {
    setSoundPlaying(isReminderSoundPlaying())
    return subscribeReminderSoundPlaying(() => setSoundPlaying(isReminderSoundPlaying()))
  }, [])

  const activeAlerts = useMemo(() => {
    const bills = buildActiveBillReminders(data, now).map((item) =>
      billAlert(item, () => navigate(`/counter?bill=${item.saleId}`)),
    )
    const loans = buildActiveLoanReminders(data, now).map((item) =>
      loanAlert(item, () => navigate('/loan')),
    )
    return [...bills, ...loans].sort(
      (a, b) => new Date(a.reminderSortAt).getTime() - new Date(b.reminderSortAt).getTime(),
    )
  }, [data, now, navigate])

  const visibleActiveAlerts = useMemo(
    () => activeAlerts.filter((item) => !dismissedKeys.has(item.dismissKey)),
    [activeAlerts, dismissedKeys],
  )

  const visibleAlertKeys = useMemo(
    () => visibleActiveAlerts.map((item) => item.dismissKey).sort().join('|'),
    [visibleActiveAlerts],
  )

  useEffect(() => {
    writeDismissedKeys(dismissedKeys)
  }, [dismissedKeys])

  useEffect(() => {
    if (visibleActiveAlerts.length === 0) return
    const seenAt = Date.now()
    setShownAtByKey((prev) => {
      const next = { ...prev }
      for (const item of visibleActiveAlerts) {
        if (!next[item.dismissKey]) next[item.dismissKey] = seenAt
      }
      return next
    })
  }, [visibleAlertKeys, visibleActiveAlerts])

  useEffect(() => {
    if (!alertSettings.notificationSoundEnabled || visibleActiveAlerts.length === 0) {
      stopReminderNotificationSound()
      return
    }

    let shouldPlay = false
    const nextState: Record<string, { visible: boolean; due: boolean }> = {}

    for (const item of visibleActiveAlerts) {
      const due = item.isDue || item.isOverdue
      const prev = prevAlertStateRef.current[item.dismissKey]
      nextState[item.dismissKey] = { visible: true, due }

      if (!prev?.visible) shouldPlay = true
      else if (due && !prev.due) shouldPlay = true
    }

    prevAlertStateRef.current = nextState

    const sessionKey = visibleActiveAlerts.map((item) => item.dismissKey).sort().join('|')
    const mode = alertSettings.notificationSoundMode

    if (shouldPlay || (mode !== 'once' && soundSessionKeyRef.current !== sessionKey)) {
      soundSessionKeyRef.current = sessionKey
      const useUrgent = visibleActiveAlerts.some((item) => item.soundStyle === 'urgent' || item.isOverdue)
      const style = useUrgent ? 'urgent' : 'normal'
      if (mode === 'once') {
        void playReminderNotificationSound(style)
      } else {
        void startAlertReminderSound(style, mode, alertSettings.notificationSoundRepeatSeconds)
      }
    }

    if (mode === 'once') {
      return () => stopReminderNotificationSound()
    }
    return undefined
  }, [
    visibleActiveAlerts,
    alertSettings.notificationSoundEnabled,
    alertSettings.notificationSoundMode,
    alertSettings.notificationSoundRepeatSeconds,
  ])

  useEffect(() => {
    if (showSeconds <= 0 || visibleActiveAlerts.length === 0) return

    const tick = window.setInterval(() => {
      const nowMs = Date.now()
      setDismissedKeys((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const item of visibleActiveAlerts) {
          const shownAt = shownAtByKey[item.dismissKey]
          if (shownAt && nowMs - shownAt >= showSeconds * 1000) {
            next.add(item.dismissKey)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 250)

    return () => window.clearInterval(tick)
  }, [showSeconds, visibleAlertKeys, visibleActiveAlerts, shownAtByKey])

  const secondsRemaining = useMemo(() => {
    if (showSeconds <= 0 || visibleActiveAlerts.length === 0) return null
    let earliestShown: number | null = null
    for (const item of visibleActiveAlerts) {
      const shownAt = shownAtByKey[item.dismissKey]
      if (shownAt != null && (earliestShown == null || shownAt < earliestShown)) {
        earliestShown = shownAt
      }
    }
    if (earliestShown == null) return showSeconds
    const elapsed = Math.floor((Date.now() - earliestShown) / 1000)
    return Math.max(0, showSeconds - elapsed)
  }, [showSeconds, visibleActiveAlerts, shownAtByKey, now])

  function dismissAlert(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    event?.preventDefault()
    setDismissedKeys((prev) => {
      const next = new Set(prev)
      next.add(item.dismissKey)
      return next
    })
  }

  function dismissAll(event?: MouseEvent) {
    event?.stopPropagation()
    event?.preventDefault()
    setDismissedKeys((prev) => {
      const next = new Set(prev)
      for (const item of visibleActiveAlerts) next.add(item.dismissKey)
      return next
    })
  }

  if (visibleActiveAlerts.length === 0) return null

  const visibleAlerts = collapsed ? [] : visibleActiveAlerts.slice(0, MAX_VISIBLE)
  const hiddenCount = Math.max(0, visibleActiveAlerts.length - MAX_VISIBLE)

  return (
    <aside
      className={`reminder-alerts-notifier ${collapsed ? 'reminder-alerts-notifier--collapsed' : ''}`}
      aria-live="polite"
      aria-label="Active reminder alerts"
    >
      <div className="reminder-alerts-notifier-shell">
        <div className="reminder-alerts-notifier-head">
          <button
            type="button"
            className="reminder-alerts-notifier-head-main"
            onClick={() => setCollapsed((open) => !open)}
            aria-expanded={!collapsed}
          >
            <span className="reminder-alerts-notifier-live" aria-hidden="true" />
            <span className="reminder-alerts-notifier-head-copy">
              <span className="reminder-alerts-notifier-kicker">Reminder</span>
              <span className="reminder-alerts-notifier-title">
                {visibleActiveAlerts.length} due
                {secondsRemaining != null ? (
                  <span className="reminder-alerts-notifier-countdown">{secondsRemaining}s</span>
                ) : null}
              </span>
            </span>
            <span className="reminder-alerts-notifier-chevron" aria-hidden="true">
              {collapsed ? '▾' : '▴'}
            </span>
          </button>
          <button
            type="button"
            className="reminder-alerts-notifier-close-all"
            onClick={dismissAll}
            aria-label="Close all reminder alerts"
            title="Close all"
          >
            ✕
          </button>
          {soundPlaying ? (
            <button
              type="button"
              className="reminder-alerts-notifier-stop-sound"
              onClick={() => stopReminderNotificationSound()}
              aria-label="Stop reminder sound"
              title="Stop sound"
            >
              🔇 Stop
            </button>
          ) : null}
        </div>

        {!collapsed ? (
          <div className="reminder-alerts-notifier-body">
            {showSeconds > 0 ? (
              <p className="reminder-alerts-notifier-auto">
                Auto hide · {formatNotificationShowLabel(showSeconds)}
              </p>
            ) : null}

            <ul className="reminder-alerts-notifier-list">
              {visibleAlerts.map((item) => (
                <li key={item.dismissKey} className="reminder-alerts-notifier-row">
                  <button
                    type="button"
                    className={`reminder-alerts-notifier-item reminder-alerts-notifier-item--${item.kind} ${
                      item.isOverdue ? 'reminder-alerts-notifier-item--overdue' : ''
                    }`}
                    onClick={item.onOpen}
                  >
                    <span className="reminder-alerts-notifier-item-icon" aria-hidden="true">
                      {kindIcon(item.kind)}
                    </span>
                    <span className="reminder-alerts-notifier-item-copy">
                      <span className="reminder-alerts-notifier-item-top">
                        <strong>{item.title}</strong>
                        <span>{formatMoney(item.amount)}</span>
                      </span>
                      <span className="reminder-alerts-notifier-item-meta">
                        {item.alertLabel} · {item.reminderDateLabel}
                      </span>
                      {item.reminderNote ? (
                        <span className="reminder-alerts-notifier-item-note">📝 {item.reminderNote}</span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="reminder-alerts-notifier-item-close"
                    onClick={(event) => dismissAlert(item, event)}
                    aria-label={`Close reminder for ${item.title}`}
                    title="Close"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            {hiddenCount > 0 ? (
              <p className="reminder-alerts-notifier-more">+{hiddenCount} more</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
