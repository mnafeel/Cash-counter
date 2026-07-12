// Direct Tally Prime HTTP API — Settings URL → party name + amount → Pending Bills.

import { collectTallyBills, testTallyApi, type TallyBill, type TallyDateScope } from './tallyApi'

export type { TallyBill, TallyDateScope }

export const TALLY_API_URL_KEY = 'tally-api-url'
const LEGACY_BRIDGE_URL_KEY = 'tally-lan-url'
export const TALLY_DATE_SCOPE_KEY = 'tally-date-scope'

export function getTallyApiUrl(): string {
  try {
    const saved = localStorage.getItem(TALLY_API_URL_KEY)
    if (saved) return saved
    const legacy = localStorage.getItem(LEGACY_BRIDGE_URL_KEY)
    if (legacy) return legacy.replace(':8080', ':9999')
  } catch {
    /* ignore */
  }
  return ''
}

export function setTallyApiUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '')
  if (clean) localStorage.setItem(TALLY_API_URL_KEY, clean)
  else localStorage.removeItem(TALLY_API_URL_KEY)
}

export function getTallyDateScope(): TallyDateScope {
  try {
    const raw = localStorage.getItem(TALLY_DATE_SCOPE_KEY)
    if (raw === 'week' || raw === 'month') return raw
  } catch {
    /* ignore */
  }
  return 'today'
}

export function setTallyDateScope(scope: TallyDateScope): void {
  localStorage.setItem(TALLY_DATE_SCOPE_KEY, scope)
}

export async function fetchTallyBills(
  overrideUrl?: string,
  scope?: TallyDateScope,
): Promise<TallyBill[]> {
  const apiUrl = overrideUrl?.trim() || getTallyApiUrl()
  if (!apiUrl) return []
  try {
    return await collectTallyBills(apiUrl, scope ?? getTallyDateScope())
  } catch {
    return []
  }
}

export async function testTallyConnection(
  url: string,
  scope?: TallyDateScope,
): Promise<{ connected: boolean; billCount: number; error?: string }> {
  return testTallyApi(url, scope ?? getTallyDateScope())
}

/** @deprecated use getTallyApiUrl */
export const getTallyBridgeUrl = getTallyApiUrl
/** @deprecated use setTallyApiUrl */
export const setTallyBridgeUrl = setTallyApiUrl
/** @deprecated */
export async function probeLocalTally(): Promise<boolean> {
  const url = getTallyApiUrl()
  if (!url) return false
  const result = await testTallyConnection(url)
  return result.connected
}
/** @deprecated use fetchTallyBills */
export const fetchLocalTallyBills = fetchTallyBills
/** @deprecated use testTallyConnection */
export const testTallyBridge = testTallyConnection
