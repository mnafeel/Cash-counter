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
import { playReminderNotificationSound } from '../utils/reminderNotificationSound'
import './ReminderAlertsNotifier.css'

const MAX_VISIBLE = 3
const DISMISSED_STORAGE_KEY = 'cash-counter-dismissed-reminder-alerts'

function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs])
  return now
}

function alertDismissKey(item: BillReminderItem): string {
  return `${item.saleId}|${item.reminderAt}`
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

function kindIcon(kind: BillReminderItem['kind']): string {
  if (kind === 'credit') return '💳'
  if (kind === 'cheque') return '🧾'
  return '🔔'
}

export default function ReminderAlertsNotifier() {
  const { data } = useCash()
  const navigate = useNavigate()
  const now = useNow()
  const alertSettings = useMemo(() => getReminderAlertSettings(data), [data])
  const showSeconds = alertSettings.notificationShowSeconds
  const [collapsed, setCollapsed] = useState(false)
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(readDismissedKeys)
  const [shownAtByKey, setShownAtByKey] = useState<Record<string, number>>({})
  const prevVisibleAlertKeysRef = useRef('')

  const activeAlerts = useMemo(
    () => buildActiveBillReminders(data, now),
    [data, now],
  )

  const visibleActiveAlerts = useMemo(
    () => activeAlerts.filter((item) => !dismissedKeys.has(alertDismissKey(item))),
    [activeAlerts, dismissedKeys],
  )

  const visibleAlertKeys = useMemo(
    () => visibleActiveAlerts.map((item) => alertDismissKey(item)).sort().join('|'),
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
        const key = alertDismissKey(item)
        if (!next[key]) next[key] = seenAt
      }
      return next
    })
  }, [visibleAlertKeys, visibleActiveAlerts])

  useEffect(() => {
    if (!alertSettings.notificationSoundEnabled || !visibleAlertKeys) return

    const currentKeys = visibleAlertKeys.split('|').filter(Boolean)
    const prevKeys = prevVisibleAlertKeysRef.current
      ? prevVisibleAlertKeysRef.current.split('|').filter(Boolean)
      : []
    const prevSet = new Set(prevKeys)
    const hasNewAlert = currentKeys.some((key) => !prevSet.has(key))

    prevVisibleAlertKeysRef.current = visibleAlertKeys

    if (hasNewAlert) void playReminderNotificationSound()
  }, [visibleAlertKeys, alertSettings.notificationSoundEnabled])

  useEffect(() => {
    if (showSeconds <= 0 || visibleActiveAlerts.length === 0) return

    const tick = window.setInterval(() => {
      const nowMs = Date.now()
      setDismissedKeys((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const item of visibleActiveAlerts) {
          const key = alertDismissKey(item)
          const shownAt = shownAtByKey[key]
          if (shownAt && nowMs - shownAt >= showSeconds * 1000) {
            next.add(key)
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
      const shownAt = shownAtByKey[alertDismissKey(item)]
      if (shownAt != null && (earliestShown == null || shownAt < earliestShown)) {
        earliestShown = shownAt
      }
    }
    if (earliestShown == null) return showSeconds
    const elapsed = Math.floor((Date.now() - earliestShown) / 1000)
    return Math.max(0, showSeconds - elapsed)
  }, [showSeconds, visibleActiveAlerts, shownAtByKey, now])

  function dismissAlert(item: BillReminderItem, event?: MouseEvent) {
    event?.stopPropagation()
    event?.preventDefault()
    setDismissedKeys((prev) => {
      const next = new Set(prev)
      next.add(alertDismissKey(item))
      return next
    })
  }

  function dismissAll(event?: MouseEvent) {
    event?.stopPropagation()
    event?.preventDefault()
    setDismissedKeys((prev) => {
      const next = new Set(prev)
      for (const item of visibleActiveAlerts) next.add(alertDismissKey(item))
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
      aria-label="Active bill reminder alerts"
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
                <li key={item.saleId} className="reminder-alerts-notifier-row">
                  <button
                    type="button"
                    className={`reminder-alerts-notifier-item reminder-alerts-notifier-item--${item.kind} ${
                      item.isOverdue ? 'reminder-alerts-notifier-item--overdue' : ''
                    }`}
                    onClick={() => navigate(`/counter?bill=${item.saleId}`)}
                  >
                    <span className="reminder-alerts-notifier-item-icon" aria-hidden="true">
                      {kindIcon(item.kind)}
                    </span>
                    <span className="reminder-alerts-notifier-item-copy">
                      <span className="reminder-alerts-notifier-item-top">
                        <strong>{item.customerName}</strong>
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
                    aria-label={`Close reminder for ${item.customerName}`}
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
