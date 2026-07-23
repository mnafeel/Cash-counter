export function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function parseAmount(value: string): number {
  const cleaned = value.replace(/[^\d.]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** YYYY-MM-DD for HTML date inputs from an ISO timestamp. */
export function isoToDateInputValue(iso: string): string {
  const date = new Date(iso)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** HH:MM for HTML time inputs from an ISO timestamp (local time). */
export function isoToTimeInputValue(iso: string): string {
  const date = new Date(iso)
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** Local calendar date + time from inputs → ISO. */
export function dateTimeInputValuesToIso(
  dateValue: string,
  timeValue: string,
  fallbackIso?: string,
): string | null {
  if (!dateValue) return null
  const [y, mo, d] = dateValue.split('-').map((part) => Number(part))
  if (!y || !mo || !d) return null

  let hours = 0
  let minutes = 0
  let seconds = 0
  let milliseconds = 0

  if (timeValue.trim()) {
    const parts = timeValue.trim().split(':')
    const h = Number(parts[0])
    const m = Number(parts[1] ?? 0)
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return null
    }
    hours = h
    minutes = m
  } else if (fallbackIso) {
    const fallback = new Date(fallbackIso)
    hours = fallback.getHours()
    minutes = fallback.getMinutes()
    seconds = fallback.getSeconds()
    milliseconds = fallback.getMilliseconds()
  }

  return new Date(y, mo - 1, d, hours, minutes, seconds, milliseconds).toISOString()
}

/** Local calendar date from date input → ISO, keeping time from fallback when provided. */
export function dateInputValueToIso(dateValue: string, fallbackIso?: string): string | null {
  return dateTimeInputValuesToIso(dateValue, '', fallbackIso)
}
