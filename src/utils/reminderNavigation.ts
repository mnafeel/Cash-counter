import type { UnifiedReminderAlert } from '../hooks/useReminderAlerts'
import { normalizeRoutePath } from './hashRoute'
import { isPinProtectedRoute } from './pinProtectedRoutes'

const PENDING_REMINDER_NAV_KEY = 'cash-counter-pending-reminder-nav'

export type ReminderOverlayKind = 'credits' | 'cheques' | 'customers'

export type ReminderOverlayIntent = {
  overlay: ReminderOverlayKind
  customer?: string
}

export function buildReminderNavigationPath(alert: UnifiedReminderAlert): string {
  const customer = encodeURIComponent(alert.title)
  if (alert.kind === 'credit') {
    return `/?overlay=credits&customer=${customer}`
  }
  if (alert.kind === 'cheque') {
    return `/?overlay=cheques&customer=${customer}`
  }
  if (alert.kind === 'loan') {
    return '/loan'
  }
  if (alert.saleId) {
    return `/counter?bill=${encodeURIComponent(alert.saleId)}`
  }
  return '/'
}

export function reminderPathToIntent(path: string): ReminderOverlayIntent | null {
  const queryIndex = path.indexOf('?')
  const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)
  const overlay = params.get('overlay')
  if (overlay === 'credits' || overlay === 'cheques' || overlay === 'customers') {
    const rawCustomer = params.get('customer')
    return {
      overlay,
      customer: rawCustomer ? decodeURIComponent(rawCustomer) : undefined,
    }
  }
  return null
}

export function storePendingReminderNavigation(path: string) {
  try {
    sessionStorage.setItem(PENDING_REMINDER_NAV_KEY, path)
  } catch {
    // ignore quota errors
  }
}

export function peekPendingReminderNavigation(): string | null {
  try {
    return sessionStorage.getItem(PENDING_REMINDER_NAV_KEY)
  } catch {
    return null
  }
}

export function consumePendingReminderNavigation(): string | null {
  const pending = peekPendingReminderNavigation()
  if (!pending) return null
  try {
    sessionStorage.removeItem(PENDING_REMINDER_NAV_KEY)
  } catch {
    // ignore
  }
  return pending
}

export function hasReminderNavigationIntent(searchParams: URLSearchParams): boolean {
  const overlay = searchParams.get('overlay')
  if (overlay === 'credits' || overlay === 'cheques' || overlay === 'customers') {
    return true
  }
  return peekPendingReminderNavigation() != null
}

export function shouldStorePendingReminderNavigation(path: string, homeUnlocked: boolean): boolean {
  if (homeUnlocked) return false
  const pathname = path.split('?')[0] || '/'
  return isPinProtectedRoute(normalizeRoutePath(pathname))
}
