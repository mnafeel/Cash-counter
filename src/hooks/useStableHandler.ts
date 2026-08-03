import { useCallback, useRef } from 'react'

/** Keeps a stable callback identity while always invoking the latest handler. */
export function useStableHandler<T extends (...args: never[]) => void>(handler: T): T {
  const ref = useRef(handler)
  ref.current = handler
  return useCallback(((...args) => ref.current(...args)) as T, [])
}
