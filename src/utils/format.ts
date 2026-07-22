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

/** Local calendar date from date input → ISO, keeping time from fallback when provided. */
export function dateInputValueToIso(dateValue: string, fallbackIso?: string): string | null {
  if (!dateValue) return null
  const [y, m, d] = dateValue.split('-').map((part) => Number(part))
  if (!y || !m || !d) return null
  const fallback = fallbackIso ? new Date(fallbackIso) : new Date()
  return new Date(
    y,
    m - 1,
    d,
    fallback.getHours(),
    fallback.getMinutes(),
    fallback.getSeconds(),
    fallback.getMilliseconds(),
  ).toISOString()
}
