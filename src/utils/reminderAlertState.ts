const SNOOZE_STORAGE_KEY = 'cash-counter-reminder-snooze'
const PINNED_STORAGE_KEY = 'cash-counter-reminder-pinned'

function readRecord(key: string): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next: Record<string, number> = {}
    for (const [entryKey, value] of Object.entries(parsed)) {
      if (typeof entryKey === 'string' && typeof value === 'number') next[entryKey] = value
    }
    return next
  } catch {
    return {}
  }
}

function writeRecord(key: string, map: Record<string, number>) {
  try {
    sessionStorage.setItem(key, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

function readPinnedRecord(): Record<string, number> {
  return readRecord(PINNED_STORAGE_KEY)
}

function writePinnedRecord(map: Record<string, number>) {
  writeRecord(PINNED_STORAGE_KEY, map)
}

export function readSnoozedUntilMap(): Record<string, number> {
  return readRecord(SNOOZE_STORAGE_KEY)
}

export function writeSnoozedUntilMap(map: Record<string, number>) {
  writeRecord(SNOOZE_STORAGE_KEY, map)
}

export function isReminderSnoozed(dismissKey: string, nowMs = Date.now()): boolean {
  const until = readSnoozedUntilMap()[dismissKey]
  return typeof until === 'number' && until > nowMs
}

export function snoozeReminder(dismissKey: string, durationMs: number, nowMs = Date.now()) {
  const next = readSnoozedUntilMap()
  next[dismissKey] = nowMs + durationMs
  writeSnoozedUntilMap(next)
}

export function snoozeReminderUntil(dismissKey: string, untilMs: number) {
  const next = readSnoozedUntilMap()
  next[dismissKey] = untilMs
  writeSnoozedUntilMap(next)
}

/** Snooze until a calendar day at the given local time (default 9:00 AM). */
export function snoozeReminderUntilDate(
  dismissKey: string,
  dateValue: string,
  hour = 9,
  minute = 0,
) {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (!year || !month || !day) return
  const until = new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
  snoozeReminderUntil(dismissKey, until)
}

export function clearReminderSnooze(dismissKey: string) {
  const next = readSnoozedUntilMap()
  delete next[dismissKey]
  writeSnoozedUntilMap(next)
}

export function readPinnedReminderKeys(): Set<string> {
  const raw = readPinnedRecord()
  const next = new Set<string>()
  const cleaned: Record<string, number> = {}
  for (const [key, pinnedAt] of Object.entries(raw)) {
    if (typeof pinnedAt !== 'number') continue
    next.add(key)
    cleaned[key] = pinnedAt
  }
  writePinnedRecord(cleaned)
  return next
}

export function pinReminder(dismissKey: string, nowMs = Date.now()) {
  const next = readPinnedRecord()
  next[dismissKey] = nowMs
  writePinnedRecord(next)
  clearReminderSnooze(dismissKey)
}

export function unpinReminder(dismissKey: string) {
  const next = readPinnedRecord()
  delete next[dismissKey]
  writePinnedRecord(next)
}

export function clearPinnedReminders() {
  writePinnedRecord({})
}

export const REMINDER_SNOOZE_15_MIN_MS = 15 * 60 * 1000
export const REMINDER_SNOOZE_30_MIN_MS = 30 * 60 * 1000
export const REMINDER_SNOOZE_1_HOUR_MS = 60 * 60 * 1000
export const REMINDER_SNOOZE_4_HOUR_MS = 4 * 60 * 60 * 1000
