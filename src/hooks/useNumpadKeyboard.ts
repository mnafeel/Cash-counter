import { useEffect } from 'react'
import type { NumpadAction } from '../utils/numpad'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable
}

export function keyEventToNumpadAction(key: string): NumpadAction | null {
  if (key.length === 1 && key >= '0' && key <= '9') return key as NumpadAction
  if (key === '.') return '.'
  if (key === 'Backspace') return 'backspace'
  if (key === 'Enter') return 'enter'
  if (key === 'Delete' || key === 'Escape') return 'clear'
  return null
}

export function useNumpadKeyboard(
  onPress: (action: NumpadAction) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      const action = keyEventToNumpadAction(e.key)
      if (!action) return

      e.preventDefault()
      onPress(action)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onPress, enabled])
}
