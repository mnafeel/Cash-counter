const CLOUD_DOMAIN = '@cash-counter.sof'

export function usernameToAuthEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '')
  if (!clean) throw new Error('Username is required.')
  if (!/^[a-z0-9._-]{3,32}$/.test(clean)) {
    throw new Error('Username: 3–32 letters, numbers, . _ - only.')
  }
  return `${clean}${CLOUD_DOMAIN}`
}

export function authEmailToUsername(email: string | null | undefined): string {
  if (!email) return ''
  if (email.endsWith(CLOUD_DOMAIN)) return email.slice(0, -CLOUD_DOMAIN.length)
  return email.split('@')[0] ?? email
}

export function formatCloudDataSummary(data: {
  sales: unknown[]
  expenses: unknown[]
  openingBalance: number
  openingBankBalance?: number
}): string {
  const bills = data.sales.length
  const records = data.expenses.length
  return `${bills} bills · ${records} records · cash ${data.openingBalance} · bank ${data.openingBankBalance ?? 0}`
}

const LAST_USERNAME_KEY = 'cash-counter-last-username'

export function getLastCloudUsername(): string | null {
  try {
    return localStorage.getItem(LAST_USERNAME_KEY)
  } catch {
    return null
  }
}

export function saveLastCloudUsername(username: string): void {
  localStorage.setItem(LAST_USERNAME_KEY, username.trim().toLowerCase())
}

export function clearLastCloudUsername(): void {
  localStorage.removeItem(LAST_USERNAME_KEY)
}
