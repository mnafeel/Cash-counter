import { useEffect, useState } from 'react'
import { formatPinSessionRemaining, PIN_SESSION_MS } from '../utils/pinSession'
import './PinLockCountdown.css'

type PinLockCountdownProps = {
  lastActivityAt: number | null
}

export default function PinLockCountdown({ lastActivityAt }: PinLockCountdownProps) {
  const [remainingMs, setRemainingMs] = useState(0)

  useEffect(() => {
    if (!lastActivityAt) {
      setRemainingMs(0)
      return
    }

    const tick = () => {
      setRemainingMs(Math.max(0, lastActivityAt + PIN_SESSION_MS - Date.now()))
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [lastActivityAt])

  if (!lastActivityAt || remainingMs <= 0) return null

  return (
    <div className="pin-lock-countdown" aria-live="polite" title="Secure pages lock after idle">
      <span className="pin-lock-countdown-label">Lock</span>
      <span className="pin-lock-countdown-time">{formatPinSessionRemaining(remainingMs)}</span>
    </div>
  )
}
