import { useEffect, useRef, useState } from 'react'
import { getOpenTimingMs, subscribeOpenTiming, type OpenTimingEntry } from '../utils/openTiming'
import './OpenTimingNotifier.css'

const AUTO_HIDE_MS = 3500

type OpenTimingNotifierProps = {
  navLabels?: string[]
  activeNavLabel?: string | null
}

export default function OpenTimingNotifier({
  navLabels = [],
  activeNavLabel = null,
}: OpenTimingNotifierProps) {
  const [toast, setToast] = useState<OpenTimingEntry | null>(null)
  const [navMs, setNavMs] = useState<Record<string, number>>({})
  const hideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return subscribeOpenTiming((entry) => {
      setToast(entry)
      setNavMs((prev) => ({ ...prev, [entry.label]: entry.ms }))
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => {
        setToast((current) => (current?.at === entry.at ? null : current))
        hideTimerRef.current = null
      }, AUTO_HIDE_MS)
    })
  }, [])

  useEffect(() => {
    const next: Record<string, number> = {}
    for (const label of navLabels) {
      const ms = getOpenTimingMs(label)
      if (ms != null) next[label] = ms
    }
    setNavMs((prev) => ({ ...prev, ...next }))
  }, [navLabels, activeNavLabel])

  return (
    <>
      {navLabels.length > 0 ? (
        <div className="open-timing-nav" aria-hidden="true">
          {navLabels.map((label) => {
            const ms = navMs[label]
            if (ms == null) return null
            const active = label === activeNavLabel
            return (
              <span
                key={label}
                className={`open-timing-nav-chip ${active ? 'open-timing-nav-chip--active' : ''}`}
              >
                {label} {ms} ms
              </span>
            )
          })}
        </div>
      ) : null}
      {toast ? (
        <div className="open-timing-toast" role="status" aria-live="polite">
          <span className="open-timing-toast-label">{toast.label}</span>
          <span className="open-timing-toast-ms">{toast.ms} ms</span>
        </div>
      ) : null}
    </>
  )
}
