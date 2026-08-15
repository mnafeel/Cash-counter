import type { AppData } from '../types'

/** Reuse last result when AppData reference is unchanged (CashContext updates replace the object). */
export function memoByDataRef<T>(compute: (data: AppData) => T): (data: AppData) => T {
  let cachedData: AppData | undefined
  let cachedValue: T | undefined
  return (data: AppData) => {
    if (cachedData === data && cachedValue !== undefined) return cachedValue
    cachedData = data
    cachedValue = compute(data)
    return cachedValue
  }
}
