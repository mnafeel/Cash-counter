import { useDeferredValue, useState } from 'react'

/** Instant input value + deferred value for heavy filter passes. */
export function useDeferredSearch(initial = '') {
  const [value, setValue] = useState(initial)
  const deferredValue = useDeferredValue(value)
  const isPending = value !== deferredValue
  return { value, setValue, deferredValue, isPending }
}
