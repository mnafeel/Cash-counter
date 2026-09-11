import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react'
import { isReminderSnoozed } from '../utils/reminderAlertState'
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
  if (item.isDue) return 'Due'
  return 'Reminder'
}

function ReminderToastCard({
  alert,
  waitingCount,
  onDismiss,
  onOpenDetails,
  onMuteSound,
  onStopSound,
  soundMuted,
  soundPlaying,
}: {
  alert: UnifiedReminderAlert
  waitingCount: number
  onDismiss: (event?: MouseEvent) => void
  onOpenDetails: (event?: MouseEvent) => void
  onMuteSound: () => void
  onStopSound: () => void
  soundMuted: boolean
  soundPlaying: boolean
}) {
  const touchStartYRef = useRef(0)
  const [dragY, setDragY] = useState(0)
  const [dismissing, setDismissing] = useState(false)

  function handleTouchStart(event: TouchEvent) {
    touchStartYRef.current = event.touches[0]?.clientY ?? 0
  }

  function handleTouchMove(event: TouchEvent) {
    const currentY = event.touches[0]?.clientY ?? touchStartYRef.current
    const delta = currentY - touchStartYRef.current
    if (delta > 0) setDragY(delta)
  }

  function handleTouchEnd() {
    if (dragY > 48) {
      setDismissing(true)
      window.setTimeout(() => onDismiss(), 160)
      return
    }
    setDragY(0)
  }

  return (
    <div
      className={`reminder-toast reminder-toast--chip reminder-toast--${alert.kind} ${
        alert.isOverdue ? 'reminder-toast--overdue' : ''
      } ${dismissing ? 'reminder-toast--dismissing' : ''}`}
      role="status"
      aria-live="polite"
      style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined, opacity: dragY > 0 ? 1 - dragY / 120 : undefined }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="reminder-toast__chip">
        <span className="reminder-toast__chip-icon" aria-hidden="true">
          {reminderKindIcon(alert.kind)}
        </span>
        <button type="button" className="reminder-toast__chip-body" onClick={onDismiss}>
          <span className="reminder-toast__chip-line">
            <strong>{alert.title}</strong>
            <span className="reminder-toast__chip-amount">{formatMoney(alert.amount)}</span>
          </span>
          <span className="reminder-toast__chip-meta">
            {reminderSectionLabel(alert)} · {alert.reminderDateLabel}
            {waitingCount > 0 ? ` · +${waitingCount}` : ''}
          </span>
        </button>
        <div className="reminder-toast__chip-actions">
          {soundPlaying ? (
            <button
              type="button"
              className="reminder-toast__chip-btn"
              onClick={(event) => {
                event.stopPropagation()
                onStopSound()
              }}
              title="Stop sound"
              aria-label="Stop sound"
            >
              ■
            </button>
          ) : !soundMuted ? (
            <button
              type="button"
              className="reminder-toast__chip-btn"
              onClick={(event) => {
                event.stopPropagation()
                onMuteSound()
              }}
              title="Mute"
              aria-label="Mute"
            >
              🔇
            </button>
          ) : null}
          <button
            type="button"
            className="reminder-toast__chip-btn reminder-toast__chip-btn--open"
            onClick={(event) => {
              event.stopPropagation()
              onOpenDetails(event)
            }}
            title="Open"
            aria-label={`Open reminder for ${alert.title}`}
          >
            →
          </button>
          <button
            type="button"
            className="reminder-toast__chip-btn reminder-toast__chip-btn--close"
            onClick={(event) => {
              event.stopPropagation()
              onDismiss(event)
            }}
            title="Dismiss"
            aria-label={`Dismiss reminder for ${alert.title}`}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

function renderReminderItem(
  item: UnifiedReminderAlert,
  options: {
    incomingKeys: Set<string>
    deliveredKeys: Set<string>
    pinnedKeys: Set<string>
    isActivePopup: boolean
    onOpen: (item: UnifiedReminderAlert, event?: MouseEvent) => void
    onClear: (item: UnifiedReminderAlert, event?: MouseEvent) => void
    onSnooze: (item: UnifiedReminderAlert, event?: MouseEvent) => void
  },
) {
  const snoozed = isReminderSnoozed(item.dismissKey)
  const pinned = options.pinnedKeys.has(item.dismissKey)
  const showTools = item.isDue || item.isOverdue || item.isAlertActive || pinned
  return (
    <li
      key={item.dismissKey}
      className={`notifications-bell-item ${
        options.incomingKeys.has(item.dismissKey) ? 'notifications-bell-item--enter' : ''
      } ${options.deliveredKeys.has(item.dismissKey) ? 'notifications-bell-item--delivered' : ''} ${
        pinned ? 'notifications-bell-item--pinned' : ''
      } ${snoozed ? 'notifications-bell-item--snoozed' : ''} ${
        item.isOverdue ? 'notifications-bell-item--overdue' : ''
      } ${!item.isAlertActive ? 'notifications-bell-item--upcoming' : ''}`}
    >
      <button
        type="button"
        className={`notifications-bell-item-main notifications-bell-item-main--${item.kind}`}
        onClick={(event) => options.onOpen(item, event)}
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
            {pinned ? 'Docked · silent' : snoozed ? 'Snoozed' : reminderSectionLabel(item)} ·{' '}
            {item.alertLabel} · {item.reminderDateLabel}
          </span>
          {item.reminderNote ? (
            <span className="notifications-bell-item-note">{item.reminderNote}</span>
          ) : null}
        </span>
      </button>
      {showTools ? (
        <div className="notifications-bell-item-tools">
          {item.isAlertActive && !pinned && !snoozed ? (
            <button
              type="button"
              className="notifications-bell-item-tool"
              onClick={(event) => options.onSnooze(item, event)}
              aria-label={`Snooze ${item.title}`}
              title="Snooze 30 min"
            >
              ⏰
            </button>
          ) : null}
          <button
            type="button"
            className="notifications-bell-item-dismiss"
            onClick={(event) => options.onClear(item, event)}
            aria-label={`Cancel reminder for ${item.title}`}
            title="Cancel reminder"
          >
            ✕
          </button>
        </div>
      ) : null}
    </li>
  )
}

export default function NotificationsBell({ placement = 'sidebar' }: NotificationsBellProps) {
  const {
    queuedReminders,
    visibleActiveAlerts,
    incomingKeys,
    deliveredKeys,
    pinnedAlerts,
    activeToast,
    toastQueueLength,
    soundPlaying,
    soundMuted,
    openAlert,
    dismissAlert,
    dismissAll,
    clearReminder,
    snoozeAlert,
    stopSound,
    toggleSoundMuted,
    stopAll,
  } = useReminderAlerts()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const totalCount = queuedReminders.length
  const dueCount = queuedReminders.filter((item) => item.isDue || item.isOverdue).length
  const activePopupCount = visibleActiveAlerts.length

  const pinnedKeys = useMemo(
    () => new Set(pinnedAlerts.map((item) => item.dismissKey)),
    [pinnedAlerts],
  )

  const sections = useMemo(() => {
    const unpinned = queuedReminders.filter((item) => !pinnedKeys.has(item.dismissKey))
    const dueNow = unpinned.filter((item) => item.isDue || item.isOverdue)
    const alertWindow = unpinned.filter(
      (item) => item.isAlertActive && !item.isDue && !item.isOverdue,
    )
    const upcoming = unpinned.filter((item) => !item.isAlertActive)
    return [
      { key: 'due', title: 'Due now', items: dueNow },
      { key: 'alert', title: 'Alert window', items: alertWindow },
      { key: 'upcoming', title: 'Upcoming', items: upcoming },
    ].filter((section) => section.items.length > 0)
  }, [queuedReminders, pinnedKeys])

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

  function handleOpenAlert(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    openAlert(item)
    setOpen(false)
  }

  function handleClearAlert(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    clearReminder(item)
  }

  function handleSnoozeAlert(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    snoozeAlert(item)
  }

  function handleDismissToast(item: UnifiedReminderAlert, event?: MouseEvent) {
    event?.stopPropagation()
    dismissAlert(item, event)
    stopSound()
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
            soundPlaying={soundPlaying}
            onDismiss={(event) => handleDismissToast(activeToast, event)}
            onOpenDetails={(event) => handleOpenAlert(activeToast, event)}
            onMuteSound={toggleSoundMuted}
            onStopSound={stopSound}
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
                  {pinnedAlerts.length > 0 ? (
                    <section className="notifications-bell-section notifications-bell-section--pinned">
                      <h3 className="notifications-bell-section-title">Docked · silent</h3>
                      <ul className="notifications-bell-list">
                        {pinnedAlerts.map((item) =>
                          renderReminderItem(item, {
                            incomingKeys,
                            deliveredKeys,
                            pinnedKeys,
                            isActivePopup: visibleActiveAlerts.some(
                              (alert) => alert.dismissKey === item.dismissKey,
                            ),
                            onOpen: handleOpenAlert,
                            onClear: handleClearAlert,
                            onSnooze: handleSnoozeAlert,
                          }),
                        )}
                      </ul>
                    </section>
                  ) : null}
                  {sections.map((section) => (
                    <section key={section.key} className="notifications-bell-section">
                      <h3 className="notifications-bell-section-title">{section.title}</h3>
                      <ul className="notifications-bell-list">
                        {section.items.map((item) =>
                          renderReminderItem(item, {
                            incomingKeys,
                            deliveredKeys,
                            pinnedKeys,
                            isActivePopup: visibleActiveAlerts.some(
                              (alert) => alert.dismissKey === item.dismissKey,
                            ),
                            onOpen: handleOpenAlert,
                            onClear: handleClearAlert,
                            onSnooze: handleSnoozeAlert,
                          }),
                        )}
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
