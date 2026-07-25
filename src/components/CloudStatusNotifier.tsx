import { useEffect, useRef, useState } from 'react'
import { subscribeBackupStatus } from '../firebase/sync'
import './CloudStatusNotifier.css'

const AUTO_HIDE_MS = 8000

export default function CloudStatusNotifier() {
  const [alert, setAlert] = useState<{ message: string; isError: boolean } | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return subscribeBackupStatus((message, isError) => {
      if (!message.trim()) return

      const error = Boolean(isError)
      const important =
        error ||
        message.includes('error') ||
        message.includes('failed') ||
        message.includes('Kept local') ||
        message.includes('Full data loaded') ||
        message.includes('Synced from cloud')

      if (!important && !error) return

      setAlert({ message, isError: error })

      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      if (!error) {
        hideTimerRef.current = window.setTimeout(() => {
          setAlert(null)
          hideTimerRef.current = null
        }, AUTO_HIDE_MS)
      }
    })
  }, [])

  if (!alert) return null

  return (
    <div
      className={`cloud-status-notifier ${alert.isError ? 'cloud-status-notifier--error' : 'cloud-status-notifier--info'}`}
      role="status"
      aria-live="polite"
    >
      <span className="cloud-status-notifier-icon">{alert.isError ? '⚠️' : '☁️'}</span>
      <span className="cloud-status-notifier-text">{alert.message}</span>
      <button
        type="button"
        className="cloud-status-notifier-close"
        aria-label="Dismiss cloud alert"
        onClick={() => setAlert(null)}
      >
        ✕
      </button>
    </div>
  )
}
