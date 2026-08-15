import { useDeferredValue, useState, useCallback } from 'react'

/** Instant input value + deferred value for heavy filter passes. */
export function useDeferredSearch(initial = '') {
  const [value, setValue] = useState(initial)
  const deferredValue = useDeferredValue(value)
  const isPending = value !== deferredValue
  const reset = useCallback(() => setValue(initial), [initial])
  return { value, setValue, deferredValue, isPending, reset }
}
