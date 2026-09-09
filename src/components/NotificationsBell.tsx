import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { formatMoney } from '../utils/format'
import {
  reminderKindIcon,
  useReminderAlerts,
  type UnifiedReminderAlert,
} from '../hooks/useReminderAlerts'
import './NotificationsBell.css'

function PremiumBellIcon() {
  return (
    <svg className="notifications-bell-svg" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="notifications-bell-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path
        fill="url(#notifications-bell-grad)"
        d="M12 2.2c-1.4 0-2.5 1.1-2.5 2.5v.4c-2.5.7-4.3 3-4.3 5.7v3.1l-1.1 1.8c-.4.7.2 1.5 1 1.5h13.8c.8 0 1.4-.8 1-1.5l-1.1-1.8v-3.1c0-2.7-1.8-5-4.3-5.7v-.4c0-1.4-1.1-2.5-2.5-2.5Z"
      />
      <path
        fill="currentColor"
        fillOpacity="0.35"
        d="M9.2 18.8c.4 1.1 1.4 1.9 2.8 1.9s2.4-.8 2.8-1.9"
      />
      <circle cx="17.2" cy="5.4" r="2.1" fill="var(--accent, #c9a227)" opacity="0.9" />
    </svg>
  )
}

type NotificationsBellProps = {
  placement?: 'topbar' | 'sidebar'
}

function reminderSectionLabel(item: UnifiedReminderAlert): string {
  if (item.isOverdue) return 'Overdue'
  if (item.isDue) return 'Due now'
  if (item.isAlertActive) return 'Alert window'
  return 'Upcoming'
}

function ReminderToastCard({
  alert,
  waitingCount,
  onOpen,
  onDismiss,
  onMuteSound,
  soundMuted,
}: {
  alert: UnifiedReminderAlert
  waitingCount: number
  onOpen: (event?: MouseEvent) => void
  onDismiss: () => void
  onMuteSound: () => void
  soundMuted: boolean
}) {
  return (
    <div
      className={`reminder-toast reminder-toast--${alert.kind} ${
        alert.isOverdue ? 'reminder-toast--overdue' : ''
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="reminder-toast__glow" aria-hidden="true" />
      <button type="button" className="reminder-toast__main" onClick={onOpen}>
        <span className="reminder-toast__stamp" aria-hidden="true">✉</span>
        <span className="reminder-toast__icon" aria-hidden="true">
          {reminderKindIcon(alert.kind)}
        </span>
        <span className="reminder-toast__copy">
          <span className="reminder-toast__eyebrow">
            {reminderSectionLabel(alert)}
            {waitingCount > 0 ? ` · ${waitingCount} more waiting` : ''}
          </span>
          <span className="reminder-toast__title">{alert.title}</span>
          <span className="reminder-toast__meta">
            {formatMoney(alert.amount)} · {alert.alertLabel} · {alert.reminderDateLabel}
          </span>
          {alert.reminderNote ? (
            <span className="reminder-toast__note">{alert.reminderNote}</span>
          ) : null}
        </span>
      </button>
      <div className="reminder-toast__actions">
        {!soundMuted ? (
          <button
            type="button"
            className="reminder-toast__action"
            onClick={(event) => {
              event.stopPropagation()
              onMuteSound()
            }}
            aria-label="Mute reminder sound"
            title="Mute sound"
          >
            🔇
          </button>
        ) : null}
        <button
          type="button"
          className="reminder-toast__action reminder-toast__action--close"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss()
          }}
          aria-label={`Dismiss alert for ${alert.title}`}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export default function NotificationsBell({ placement = 'sidebar' }: NotificationsBellProps) {
  const {
    queuedReminders,
    visibleActiveAlerts,
    incomingKeys,
    deliveredKeys,
    activeToast,
    toastQueueLength,
    soundPlaying,
    soundMuted,
    openAlert,
    dismissAlert,
    dismissAll,
    dismissActiveToast,
    stopSound,
    toggleSoundMuted,
    stopAll,
  } = useReminderAlerts()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const openedForBatchRef = useRef(false)
  const totalCount = queuedReminders.length
  const dueCount = queuedReminders.filter((item) => item.isDue || item.isOverdue).length
  const activePopupCount = visibleActiveAlerts.length

  const sections = useMemo(() => {
    const dueNow = queuedReminders.filter((item) => item.isDue || item.isOverdue)
    const alertWindow = queuedReminders.filter(
      (item) => item.isAlertActive && !item.isDue && !item.isOverdue,
    )
    const upcoming = queuedReminders.filter((item) => !item.isAlertActive)
    return [
      { key: 'due', title: 'Due now', items: dueNow },
      { key: 'alert', title: 'Alert window', items: alertWindow },
      { key: 'upcoming', title: 'Upcoming', items: upcoming },
    ].filter((section) => section.items.length > 0)
  }, [queuedReminders])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!activeToast) {
      openedForBatchRef.current = false
      return
    }
    if (!openedForBatchRef.current && activePopupCount > 0) {
      openedForBatchRef.current = true
      setOpen(true)
    }
  }, [activeToast, activePopupCount])

  function handleOpenAlert(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    openAlert(item)
    setOpen(false)
    if (activeToast?.dismissKey === item.dismissKey) dismissActiveToast()
  }

  const placementClass =
    placement === 'sidebar' ? 'notifications-bell--sidebar' : 'notifications-bell--topbar'

  return (
    <>
      {activeToast ? (
        <div className="reminder-toast-stack" aria-hidden={false}>
          <ReminderToastCard
            alert={activeToast}
            waitingCount={toastQueueLength}
            soundMuted={soundMuted}
            onOpen={(event) => handleOpenAlert(activeToast, event)}
            onDismiss={dismissActiveToast}
            onMuteSound={toggleSoundMuted}
          />
        </div>
      ) : null}

      <div
        className={`notifications-bell ${placementClass} ${open ? 'notifications-bell--open' : ''}`}
        ref={rootRef}
      >
        <button
          type="button"
          className={`notifications-bell-trigger ${dueCount > 0 ? 'notifications-bell-trigger--due' : ''} ${
            soundMuted ? 'notifications-bell-trigger--muted' : ''
          }`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={totalCount > 0 ? `${totalCount} reminders` : 'Notifications'}
          title="Reminders & alerts"
        >
          <span className="notifications-bell-icon" aria-hidden="true">
            <PremiumBellIcon />
          </span>
          {soundMuted ? (
            <span className="notifications-bell-muted" aria-hidden="true">🔇</span>
          ) : null}
          {totalCount > 0 ? (
            <>
              <span className="notifications-bell-count" aria-hidden="true">
                {totalCount > 99 ? '99+' : totalCount}
              </span>
              <span className="notifications-bell-badge" aria-hidden="true">
                {totalCount > 99 ? '99+' : totalCount}
              </span>
            </>
          ) : null}
        </button>

        {open ? (
          <div className="notifications-bell-panel" role="dialog" aria-label="Reminders">
            <div className="notifications-bell-panel-head">
              <div>
                <p className="notifications-bell-panel-kicker">Notifications</p>
                <h2 className="notifications-bell-panel-title">
                  {totalCount > 0 ? `${totalCount} reminder${totalCount === 1 ? '' : 's'}` : 'All clear'}
                </h2>
                {soundMuted ? (
                  <p className="notifications-bell-panel-note">Sound muted · reminders still listed below</p>
                ) : null}
              </div>
              <div className="notifications-bell-panel-actions">
                <button
                  type="button"
                  className={`notifications-bell-action ${
                    soundMuted ? 'notifications-bell-action--active' : ''
                  }`}
                  onClick={toggleSoundMuted}
                  aria-pressed={soundMuted}
                  title={soundMuted ? 'Turn reminder sound back on' : 'Mute reminder sound'}
                >
                  {soundMuted ? '🔊 Sound on' : '🔇 Mute sound'}
                </button>
                {soundPlaying ? (
                  <button type="button" className="notifications-bell-action" onClick={() => stopSound()}>
                    Stop sound
                  </button>
                ) : null}
                {activePopupCount > 0 ? (
                  <button type="button" className="notifications-bell-action" onClick={dismissAll}>
                    Clear alerts
                  </button>
                ) : null}
                {activePopupCount > 0 || activeToast || toastQueueLength > 0 ? (
                  <button
                    type="button"
                    className="notifications-bell-action notifications-bell-action--danger"
                    onClick={stopAll}
                  >
                    Stop all
                  </button>
                ) : null}
              </div>
            </div>

            <div className="notifications-bell-panel-body">
              {totalCount === 0 ? (
                <p className="notifications-bell-empty">No reminders scheduled yet.</p>
              ) : (
                <div className="notifications-bell-sections">
                  {sections.map((section) => (
                    <section key={section.key} className="notifications-bell-section">
                      <h3 className="notifications-bell-section-title">{section.title}</h3>
                      <ul className="notifications-bell-list">
                        {section.items.map((item) => {
                          const isActivePopup = visibleActiveAlerts.some(
                            (alert) => alert.dismissKey === item.dismissKey,
                          )
                          return (
                            <li
                              key={item.dismissKey}
                              className={`notifications-bell-item ${
                                incomingKeys.has(item.dismissKey) ? 'notifications-bell-item--enter' : ''
                              } ${deliveredKeys.has(item.dismissKey) ? 'notifications-bell-item--delivered' : ''} ${
                                item.isOverdue ? 'notifications-bell-item--overdue' : ''
                              } ${!item.isAlertActive ? 'notifications-bell-item--upcoming' : ''}`}
                            >
                              <button
                                type="button"
                                className={`notifications-bell-item-main notifications-bell-item-main--${item.kind}`}
                                onClick={(event) => handleOpenAlert(item, event)}
                              >
                                <span className="notifications-bell-item-icon" aria-hidden="true">
                                  {reminderKindIcon(item.kind)}
                                </span>
                                <span className="notifications-bell-item-copy">
                                  <span className="notifications-bell-item-top">
                                    <strong>{item.title}</strong>
                                    <span>{formatMoney(item.amount)}</span>
                                  </span>
                                  <span className="notifications-bell-item-meta">
                                    {reminderSectionLabel(item)} · {item.alertLabel} ·{' '}
                                    {item.reminderDateLabel}
                                  </span>
                                  {item.reminderNote ? (
                                    <span className="notifications-bell-item-note">{item.reminderNote}</span>
                                  ) : null}
                                </span>
                              </button>
                              {isActivePopup ? (
                                <button
                                  type="button"
                                  className="notifications-bell-item-dismiss"
                                  onClick={(event) => dismissAlert(item, event)}
                                  aria-label={`Dismiss alert for ${item.title}`}
                                >
                                  ✕
                                </button>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
