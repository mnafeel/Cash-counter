import { useEffect, useRef, useState } from 'react'
import {
  getOpenTimingMs,
  isOpenTimingVisible,
  OPEN_TIMING_VISIBLE_LABELS,
  subscribeOpenTiming,
  type OpenTimingEntry,
} from '../utils/openTiming'
import './OpenTimingNotifier.css'

const AUTO_HIDE_MS = 2500

type OpenTimingNotifierProps = {
  activeNavLabel?: string | null
}

export default function OpenTimingNotifier({ activeNavLabel = null }: OpenTimingNotifierProps) {
  const [toast, setToast] = useState<OpenTimingEntry | null>(null)
  const [navMs, setNavMs] = useState<Record<string, number>>({})
  const hideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return subscribeOpenTiming((entry) => {
      if (!isOpenTimingVisible(entry.label)) return
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
    for (const label of OPEN_TIMING_VISIBLE_LABELS) {
      const ms = getOpenTimingMs(label)
      if (ms != null) next[label] = ms
    }
    setNavMs((prev) => ({ ...prev, ...next }))
  }, [activeNavLabel])

  const hasNavMetrics = OPEN_TIMING_VISIBLE_LABELS.some((label) => navMs[label] != null)
  const showToast = toast != null

  if (!hasNavMetrics && !showToast) return null

  const activeTimingLabel =
    activeNavLabel === 'Staff & Salary' ? 'Staff' : activeNavLabel

  return (
    <div className="sidebar-dev-metrics" aria-hidden="true">
      {OPEN_TIMING_VISIBLE_LABELS.map((label) => {
        const ms = navMs[label]
        if (ms == null) return null
        const active = label === activeTimingLabel || label === toast?.label
        return (
          <span
            key={label}
            className={`sidebar-dev-chip ${active ? 'sidebar-dev-chip--active' : ''}`}
          >
            {label} {ms}ms
          </span>
        )
      })}
      {showToast && !navMs[toast.label] ? (
        <span className="sidebar-dev-chip sidebar-dev-chip--active">
          {toast.label} {toast.ms}ms
        </span>
      ) : null}
    </div>
  )
}
