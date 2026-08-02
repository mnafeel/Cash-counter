import { useEffect } from 'react'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

/** Escape → back one step (skips when focus is in a text field unless force). */
export function usePageEscape(onBack: () => void, enabled = true, options?: { force?: boolean }) {
  useEffect(() => {
    if (!enabled) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!options?.force && isTypingTarget(e.target)) return
      e.preventDefault()
      onBack()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, enabled, options?.force])
}
