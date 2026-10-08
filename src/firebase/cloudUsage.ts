import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseApp, getFirebaseDb } from './config'

export interface CloudMetric { value: number | null; measuredAt: string | null; error: string | null }
export interface CloudUsageReport {
  projectId: string
  checkedAt: string
  billingEnabled: boolean | null
  billingStatusError: string | null
  periodStart: string
  metrics: Record<string, CloudMetric>
  costs: { rows: { service: string; currency: string; amount: number }[]; error: string | null; exportedAt: string | null }
  paymentStatus: string
  outstandingAmount: number | null
  outstandingCurrency: string | null
  paymentCheckedAt: string | null
  alerts: { id: string; severity: 'warning' | 'error'; message: string }[]
}

const cache = new Map<string, { at: number; report: CloudUsageReport }>()
const pending = new Map<string, Promise<CloudUsageReport>>()
export async function fetchCloudUsage(uid: string): Promise<CloudUsageReport> {
  const project = getFirebaseApp().options.projectId ?? ''
  const key = `${project}:${uid}`
  const saved = cache.get(key)
  if (saved && Date.now() - saved.at < 5 * 60000) return saved.report
  const existing = pending.get(key)
  if (existing) return existing
  const call = httpsCallable<void, CloudUsageReport>(getFunctions(getFirebaseApp(), 'us-central1'), 'getCloudUsage')
  const request = call().then(({ data }) => {
    if (data.projectId !== project || !Array.isArray(data.alerts) || !data.metrics || !data.costs) {
      throw new Error('Cloud usage returned an invalid report.')
    }
    cache.set(key, { at: Date.now(), report: data })
    return data
  }).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

export async function fetchBackupFootprint(uid: string): Promise<{ bytes: number | null; backupAt: string | null }> {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'users', uid, 'data', 'latest'))
  if (!snapshot.exists()) return { bytes: null, backupAt: null }
  const raw = snapshot.data()
  return {
    bytes: typeof raw._storage?.byteLength === 'number' ? raw._storage.byteLength : null,
    backupAt: typeof raw._backupAt === 'string' ? raw._backupAt : null,
  }
}

export function cloudUsageError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return 'Project billing details are restricted to the billing owner.'
  if (code.includes('unauthenticated')) return 'Sign in to view cloud usage.'
  return 'Cloud usage is not connected or is temporarily unavailable. Open Cloud Billing for current charges and payment notices.'
}

export function cloudConsoleLinks(project: string) {
  const id = encodeURIComponent(project)
  return {
    billing: `https://console.cloud.google.com/billing/linkedaccount?project=${id}`,
    usage: `https://console.cloud.google.com/firestore/databases/-default-/usage?project=${id}`,
  }
}
