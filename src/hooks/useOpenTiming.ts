import { useEffect, useRef } from 'react'
import { finishOpenTiming, startOpenTiming } from '../utils/openTiming'

/**
 * Measure time from becoming active until paint completes.
 * Pass `autoStart` false when timing already started (e.g. nav click).
 */
export function useOpenTiming(label: string, active: boolean, autoStart = true) {
  const wasActiveRef = useRef(active)

  useEffect(() => {
    const entering = active && !wasActiveRef.current
    wasActiveRef.current = active
    if (!entering) return

    const startedAt = autoStart ? performance.now() : undefined
    if (autoStart) startOpenTiming(label)

    let cancelled = false
    const report = () => {
      if (cancelled) return
      finishOpenTiming(label, startedAt)
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(report)
    })

    return () => {
      cancelled = true
    }
  }, [label, active, autoStart])
}
