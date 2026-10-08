import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { test } from 'node:test'
import { formatFirebaseError } from '../src/firebase/utils.ts'

async function harness({ payment, table = '', denied = false } = {}) {
  const requests = []
  const docs = new Map(payment ? [['cloudAdmin/paymentNotice', payment]] : [])
  const context = createContext({ Date, URLSearchParams, AbortSignal, process: { env: { GCLOUD_PROJECT: 'cash-counter-84178' } }, fetch: async (url, options) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) })
    let data = {}
    if (url.includes('billingInfo')) data = { billingEnabled: true }
    if (url.includes('/timeSeries')) data = { timeSeries: [{ points: [
      { value: { int64Value: '20' }, interval: { endTime: new Date().toISOString() } },
      { value: { int64Value: '10' }, interval: { endTime: new Date(Date.now() - 300000).toISOString() } },
    ] }] }
    if (url.includes('/datasets/')) data = { location: 'asia-south1' }
    if (url.endsWith('/queries')) data = { jobComplete: true, totalRows: '1', rows: [{ f: [{ v: 'Firestore' }, { v: 'INR' }, { v: '12.50' }, { v: String(Date.now() / 1000) }] }] }
    return { ok: !denied, status: denied ? 403 : 200, json: async () => data }
  } })
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
  const imports = {
    'firebase-admin/app': { getApp: () => ({ options: { credential: { getAccessToken: async () => ({ access_token: 'server-only' }) } } }) },
    'firebase-admin/firestore': { getFirestore: () => ({ doc: (path) => ({ get: async () => ({ data: () => docs.get(path) }), set: async (data) => docs.set(path, data) }) }) },
    'firebase-functions/v2/https': { HttpsError, onCall: (_, fn) => fn },
    'firebase-functions/params': { defineString: (name) => ({ value: () => name.endsWith('UIDS') ? 'owner' : table }) },
  }
  const mod = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../functions/src/cloudUsage.ts', import.meta.url), 'utf8')), { context })
  await mod.link((name) => new SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value)
  }, { context }))
  await mod.evaluate()
  return { run: mod.namespace.getCloudUsage, requests, docs }
}
const owner = { auth: { uid: 'owner', token: {} } }

test('billing endpoint rejects unauthenticated and unauthorized callers before any reads', async () => {
  const { run, requests, docs } = await harness()
  await assert.rejects(run({}), (e) => e.code === 'unauthenticated')
  await assert.rejects(run({ auth: { uid: 'other', token: {} } }), (e) => e.code === 'permission-denied')
  assert.equal(requests.length, 0)
  assert.equal(docs.size, 0)
})
test('gauges use latest sample, counters sum, missing costs remain unknown and reports cache', async () => {
  const { run, requests } = await harness()
  const report = await run(owner)
  assert.equal(report.metrics.firestoreBytes.value, 20)
  assert.equal(report.metrics.reads.value, 30)
  assert.equal(report.outstandingAmount, null)
  assert.match(report.costs.error, /Connect/)
  const count = requests.length
  await run(owner)
  assert.equal(requests.length, count)
})
test('unavailable provider APIs do not appear as zero usage or paid status', async () => {
  const { run } = await harness({ denied: true })
  const report = await run(owner)
  assert.equal(report.billingEnabled, null)
  assert.equal(report.metrics.reads.value, null)
  assert.equal(report.paymentStatus, 'unknown')
})
test('cost query uses project scope, credits, dataset location and bounded query billing', async () => {
  const { run, requests } = await harness({ table: 'billing-project.exports.usage' })
  const report = await run(owner)
  assert.equal(report.costs.rows[0].amount, 12.5)
  const query = requests.find((r) => r.url.endsWith('/queries')).body
  assert.equal(query.location, 'asia-south1')
  assert.equal(query.queryParameters[0].parameterValue.value, 'cash-counter-84178')
  assert.match(query.query, /UNNEST\(credits\)/)
  assert.equal(query.maximumBytesBilled, '100000000')
})
test('only fresh trusted payment notices produce outstanding balance alerts', async () => {
  const payment = { checkedAt: new Date().toISOString(), status: 'past_due', currency: 'INR', outstandingAmount: 250 }
  const fresh = await harness({ payment })
  assert.match((await fresh.run(owner)).alerts[0].message, /INR 250.00/)
  const stale = await harness({ payment: { ...payment, checkedAt: '2020-01-01T00:00:00Z' } })
  const report = await stale.run(owner)
  assert.equal(report.alerts.length, 0)
  assert.equal(report.outstandingAmount, null)
})
test('storage capacity errors use requested message without mislabeling operation quotas', () => {
  assert.equal(formatFirebaseError({ code: 'storage/quota-exceeded' }), 'Cloud storage is full')
  assert.equal(formatFirebaseError({ code: 'resource-exhausted', message: 'Storage quota exceeded' }), 'Cloud storage is full')
  assert.match(formatFirebaseError({ code: 'resource-exhausted', message: 'Write quota exceeded' }), /usage limit/)
  assert.match(formatFirebaseError({ code: 'permission-denied', message: 'Billing account disabled' }), /billing needs attention/)
})
