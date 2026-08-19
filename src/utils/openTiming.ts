import { normalizeRoutePath } from './hashRoute'

export type OpenTimingEntry = {
  label: string
  ms: number
  at: number
}

type Listener = (entry: OpenTimingEntry) => void

let pending: { label: string; startedAt: number } | null = null
let lastEntry: OpenTimingEntry | null = null
const timingsByLabel = new Map<string, number>()
const listeners = new Set<Listener>()

function emit(entry: OpenTimingEntry) {
  lastEntry = entry
  timingsByLabel.set(entry.label, entry.ms)
  listeners.forEach((listener) => listener(entry))
}

/** Call when navigation or panel open begins. */
export function startOpenTiming(label: string): void {
  pending = { label, startedAt: performance.now() }
}

/** Call when view has painted. Returns measured ms. */
export function finishOpenTiming(label: string, startedAt?: number): number {
  const t0 =
    startedAt ??
    (pending?.label === label ? pending.startedAt : performance.now())
  const ms = Math.max(0, Math.round(performance.now() - t0))
  if (pending?.label === label) pending = null
  emit({ label, ms, at: Date.now() })
  return ms
}

export function subscribeOpenTiming(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLastOpenTiming(): OpenTimingEntry | null {
  return lastEntry
}

export function getOpenTimingMs(label: string): number | undefined {
  return timingsByLabel.get(label)
}

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Home',
  '/counter': 'Counter',
  '/expenses': 'Expenses',
  '/history': 'History',
  '/purchase': 'Purchases',
  '/loan': 'Loan',
  '/staff': 'Staff',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

export function openTimingLabelForPath(pathname: string): string | null {
  const path = normalizeRoutePath(pathname)
  return ROUTE_LABELS[path] ?? null
}
