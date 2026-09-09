import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { formatMoney } from '../utils/format'
import { reminderKindIcon, useReminderAlerts, type UnifiedReminderAlert } from '../hooks/useReminderAlerts'
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

export default function NotificationsBell({ placement = 'sidebar' }: NotificationsBellProps) {
  const {
    queuedReminders,
    visibleActiveAlerts,
    incomingKeys,
    soundPlaying,
    openAlert,
    dismissAlert,
    dismissAll,
    stopSound,
  } = useReminderAlerts()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
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
    if (incomingKeys.size > 0 && activePopupCount > 0) {
      setOpen(true)
    }
  }, [incomingKeys, activePopupCount])

  function handleOpenAlert(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    openAlert(item)
    setOpen(false)
  }

  const placementClass =
    placement === 'sidebar' ? 'notifications-bell--sidebar' : 'notifications-bell--topbar'

  return (
    <div
      className={`notifications-bell ${placementClass} ${open ? 'notifications-bell--open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`notifications-bell-trigger ${dueCount > 0 ? 'notifications-bell-trigger--due' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={totalCount > 0 ? `${totalCount} reminders` : 'Notifications'}
        title="Reminders & alerts"
      >
        <span className="notifications-bell-icon" aria-hidden="true">
          <PremiumBellIcon />
        </span>
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
            </div>
            <div className="notifications-bell-panel-actions">
              {soundPlaying ? (
                <button type="button" className="notifications-bell-action" onClick={() => stopSound()}>
                  Mute
                </button>
              ) : null}
              {activePopupCount > 0 ? (
                <button type="button" className="notifications-bell-action" onClick={dismissAll}>
                  Clear alerts
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
                            } ${item.isOverdue ? 'notifications-bell-item--overdue' : ''} ${
                              !item.isAlertActive ? 'notifications-bell-item--upcoming' : ''
                            }`}
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
                                  {reminderSectionLabel(item)} · {item.alertLabel} · {item.reminderDateLabel}
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
  )
}
