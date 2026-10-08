import { getApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineString } from 'firebase-functions/params'

const viewerUids = defineString('CLOUD_BILLING_VIEWER_UIDS', { default: '' })
const exportTable = defineString('CLOUD_BILLING_EXPORT_TABLE', { default: '' })
const CACHE_MS = 15 * 60 * 1000

type Metric = { value: number | null; measuredAt: string | null; error: string | null }
type CostRow = { service: string; currency: string; amount: number }
type Notice = { id: string; severity: 'warning' | 'error'; message: string }
interface Report {
  projectId: string
  checkedAt: string
  billingEnabled: boolean | null
  billingStatusError: string | null
  periodStart: string
  metrics: Record<string, Metric>
  costs: { rows: CostRow[]; error: string | null; exportedAt: string | null }
  paymentStatus: string
  outstandingAmount: number | null
  outstandingCurrency: string | null
  paymentCheckedAt: string | null
  alerts: Notice[]
}

// Credentials stay inside the function; no billing tokens or account IDs reach clients.
async function googleJson<T>(url: string, body?: object): Promise<T> {
  const credential = getApp().options.credential
  if (!credential) throw new Error('Monitoring credentials are unavailable.')
  const { access_token } = await credential.getAccessToken()
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    // Never relay provider payloads that might disclose account or SQL details.
    throw new Error(response.status === 403
      ? 'Permission or API setup is required.'
      : `Google Cloud data is unavailable (${response.status}).`)
  }
  return await response.json() as T
}

type Series = { points?: { interval?: { endTime?: string }; value?: { int64Value?: string; doubleValue?: number } }[] }
async function metric(projectId: string, type: string, gauge: boolean): Promise<Metric> {
  try {
    const now = new Date()
    const query = new URLSearchParams({
      filter: `metric.type="${type}" AND resource.labels.project_id="${projectId}"`,
      'interval.startTime': new Date(now.getTime() - 86400000).toISOString(),
      'interval.endTime': now.toISOString(),
      'aggregation.alignmentPeriod': '300s',
      'aggregation.perSeriesAligner': gauge ? 'ALIGN_NEXT_OLDER' : 'ALIGN_SUM',
      pageSize: '1000',
    })
    let pageToken: string | undefined
    let total = 0
    let points = 0
    let measuredAt: string | null = null
    do {
      if (pageToken) query.set('pageToken', pageToken)
      const response = await googleJson<{ timeSeries?: Series[]; nextPageToken?: string }>(
        `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${query}`,
      )
      for (const series of response.timeSeries ?? []) {
        // A gauge is a current value, never the sum of historical samples.
        for (const point of gauge ? (series.points ?? []).slice(0, 1) : series.points ?? []) {
          const value = Number(point.value?.int64Value ?? point.value?.doubleValue)
          if (!Number.isFinite(value)) continue
          total += value
          points++
          const at = point.interval?.endTime
          if (at && (!measuredAt || at > measuredAt)) measuredAt = at
        }
      }
      pageToken = response.nextPageToken
    } while (pageToken)
    return { value: points ? total : null, measuredAt, error: points ? null : 'No measurements reported in the last 24 hours.' }
  } catch (error) {
    return { value: null, measuredAt: null, error: error instanceof Error ? error.message : 'Metric unavailable.' }
  }
}

async function costs(projectId: string, periodStart: string): Promise<Report['costs']> {
  const table = exportTable.value().trim()
  if (!table) return { rows: [], exportedAt: null, error: 'Connect the Cloud Billing export to show actual costs.' }
  if (!/^[a-z][a-z0-9-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(table)) {
    return { rows: [], exportedAt: null, error: 'The billing export configuration is invalid.' }
  }
  try {
    const [tableProject, dataset] = table.split('.')
    const { location } = await googleJson<{ location: string }>(`https://bigquery.googleapis.com/bigquery/v2/projects/${tableProject}/datasets/${dataset}`)
    const result = await googleJson<{
      jobComplete?: boolean; totalRows?: string
      rows?: { f: { v: string | null }[] }[]
    }>(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
      query: `SELECT service.description, currency,
        SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost,
        MAX(export_time) AS exported_at
        FROM \`${table}\`
        WHERE project.id = @project AND usage_start_time >= TIMESTAMP(@start)
          AND usage_start_time < CURRENT_TIMESTAMP()
        GROUP BY service.description, currency ORDER BY net_cost DESC`,
      useLegacySql: false, parameterMode: 'NAMED', location,
      queryParameters: [
        { name: 'project', parameterType: { type: 'STRING' }, parameterValue: { value: projectId } },
        { name: 'start', parameterType: { type: 'STRING' }, parameterValue: { value: periodStart } },
      ],
      maximumBytesBilled: '100000000', maxResults: 1000, timeoutMs: 10000,
    })
    if (!result.jobComplete || Number(result.totalRows ?? 0) > (result.rows?.length ?? 0)) {
      throw new Error('Billing export is still processing. Check Billing Reports for the latest amount.')
    }
    if (!result.rows?.length) return { rows: [], exportedAt: null, error: 'No billing export entries for this month yet.' }
    let exportedAt: string | null = null
    const rows = result.rows.map(({ f }) => {
      if (f[2]?.v == null || !f[1]?.v) throw new Error('Missing amount or currency in billing export.')
      const amount = Number(f[2]?.v)
      if (!Number.isFinite(amount)) throw new Error('Invalid amount in billing export.')
      const stamp = Number(f[3]?.v)
      if (Number.isFinite(stamp) && stamp > 0) {
        const at = new Date(stamp * 1000).toISOString()
        if (!exportedAt || at > exportedAt) exportedAt = at
      }
      return { service: f[0]?.v ?? 'Other services', currency: f[1]?.v ?? '', amount }
    })
    return { rows, exportedAt, error: null }
  } catch (error) {
    return { rows: [], exportedAt: null, error: error instanceof Error ? error.message : 'Costs unavailable.' }
  }
}

async function collectReport(projectId: string): Promise<Report> {
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const metricTypes: Record<string, [string, boolean]> = {
    firestoreBytes: ['firestore.googleapis.com/storage/data_and_index_storage_bytes', true],
    backupBytes: ['firestore.googleapis.com/storage/backups_storage_bytes', true],
    reads: ['firestore.googleapis.com/document/read_ops_count', false],
    writes: ['firestore.googleapis.com/document/write_ops_count', false],
    deletes: ['firestore.googleapis.com/document/delete_ops_count', false],
    bucketBytes: ['storage.googleapis.com/storage/total_bytes', true],
    functionRequests: ['run.googleapis.com/request_count', false],
  }
  const [billing, metrics, cost, notice] = await Promise.all([
    googleJson<{ billingEnabled: boolean }>(`https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`)
      .then((result) => ({ enabled: result.billingEnabled, error: null as string | null }))
      .catch((err: Error) => ({ enabled: null, error: err.message })),
    Promise.all(Object.entries(metricTypes).map(async ([key, [type, gauge]]) => [key, await metric(projectId, type, gauge)] as const)),
    costs(projectId, periodStart),
    getFirestore().doc('cloudAdmin/paymentNotice').get(),
  ])
  const alerts: Notice[] = []
  if (billing.enabled === false) alerts.push({ id: 'billing-disabled', severity: 'error', message: 'Firebase billing is disabled. Check your billing account and payment method to keep cloud backups running.' })
  // Payment balances are NOT provided by the project Billing API. Only display
  // a dated notice written by a trusted administrator/integration (never a client).
  const payment = notice.data()
  const checkedAt = typeof payment?.checkedAt === 'string' ? payment.checkedAt : ''
  const age = now.getTime() - Date.parse(checkedAt)
  const fresh = Number.isFinite(age) && age >= 0 && age < 72 * 3600000
  const status = fresh && ['paid', 'past_due', 'payment_failed'].includes(payment?.status) ? payment?.status : 'unknown'
  const amount = fresh && typeof payment?.outstandingAmount === 'number' && Number.isFinite(payment.outstandingAmount) && payment.outstandingAmount >= 0 ? payment.outstandingAmount : null
  const currency = fresh && typeof payment?.currency === 'string' && /^[A-Z]{3}$/.test(payment.currency) ? payment.currency : null
  if (status === 'past_due' || status === 'payment_failed' || (amount !== null && amount > 0)) {
    alerts.push({ id: `payment-${checkedAt}`, severity: 'error', message: `${status === 'payment_failed' ? 'Firebase payment failed.' : 'Firebase payment requires attention.'}${amount !== null && currency ? ` Outstanding: ${currency} ${amount.toFixed(2)}.` : ''} Open Cloud Billing to resolve it.` })
  }
  if (fresh && typeof payment?.message === 'string' && payment.message.trim()) {
    alerts.push({ id: `notice-${checkedAt}`, severity: 'warning', message: payment.message.slice(0, 500) })
  }
  return { projectId, checkedAt: now.toISOString(), billingEnabled: billing.enabled, billingStatusError: billing.error,
    periodStart, metrics: Object.fromEntries(metrics), costs: cost,
    paymentStatus: status, outstandingAmount: amount, outstandingCurrency: currency,
    paymentCheckedAt: fresh ? checkedAt : null, alerts }
}

let inFlight: Promise<Report> | null = null
export const getCloudUsage = onCall({ region: 'us-central1', timeoutSeconds: 60, maxInstances: 1 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to cloud first.')
  const permitted = viewerUids.value().split(',').map((uid) => uid.trim()).filter(Boolean)
  if (!permitted.includes(request.auth.uid) && request.auth.token.cloudBillingAdmin !== true) {
    throw new HttpsError('permission-denied', 'Project billing information is available only to the configured billing owner.')
  }
  const projectId = process.env.GCLOUD_PROJECT || getApp().options.projectId
  if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId)) throw new HttpsError('failed-precondition', 'Project billing is not configured.')
  const cacheRef = getFirestore().doc('cloudAdmin/usageCache')
  const cached = (await cacheRef.get()).data() as Report | undefined
  const cacheAge = cached ? Date.now() - Date.parse(cached.checkedAt) : NaN
  if (cached?.projectId === projectId && cacheAge >= 0 && cacheAge < CACHE_MS) return cached
  if (!inFlight) {
    inFlight = collectReport(projectId).then(async (report) => {
      await cacheRef.set(report)
      return report
    }).finally(() => { inFlight = null })
  }
  return inFlight
})
