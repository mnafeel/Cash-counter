import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { test } from 'node:test'

async function harness() {
  const state = {
    data: { sales: [], expenses: [] }, revision: '2026-10-08T01:00:00Z',
    uid: 'owner', localUid: 'owner', dirty: true, uploaded: 0, synced: 0,
    cleared: 0, timers: new Map(), backupAt: '2026-10-08T00:00:00Z',
    upload: async () => '2026-10-08T02:00:00Z', fetch: async () => null,
  }
  const totals = (data) => ({ bills: data.sales.length, records: data.expenses.length, cash: 0, bank: 0 })
  const modules = {
    '../storage/database': {
      applyFullRemoteCloudData: async (data) => data,
      clearAllLocalData: () => { state.cleared++ }, flushSaveData: () => {},
      getBankBalance: () => 0, getCurrentBalance: () => 0,
      getLocalDataUpdatedAt: () => state.revision, getLocalUserUid: () => state.localUid,
      hasUnsyncedLocalData: () => state.dirty,
      isLocalDataEmpty: () => false, isLocalDataOwnedByUser: (uid) => uid === state.localUid,
      loadData: () => state.data,
      markLocalDataSynced: () => { state.synced++; state.dirty = false },
      setLocalUserUid: (uid) => { state.localUid = uid },
    },
    '../storage/localBackup': { persistRecoverySnapshot: async () => {} },
    './config': { isFirebaseConfigured: () => true },
    './backup': {
      backupAppData: async (...args) => { state.uploaded++; return state.upload(...args) },
      clearLocalLastBackupTime: () => {}, cloudBackupTotals: totals,
      fetchRemoteAppData: () => state.fetch(), getCloudUser: () => ({ uid: state.uid }),
      getLocalLastBackupTime: () => state.backupAt, isAutoBackupEnabled: () => true,
      isAutoPullFromCloudEnabled: () => false, isCloudLoggedIn: () => true,
      isMainBillingDevice: () => true, markLocalBackupTime: (at) => { state.backupAt = at },
      parseBackupTimestamp: (at) => Date.parse(at) || 0,
      remoteIsAheadOfLocal: () => false, setAutoPullFromCloudEnabled: () => {},
      subscribeToAuth: (callback) => { state.auth = callback; return () => {} },
      subscribeToCloudData: () => () => {},
    },
  }
  let timerId = 0
  const context = createContext({
    console, Date,
    setTimeout: (fn, delay) => { const id = ++timerId; state.timers.set(id, { fn, delay }); return id },
    clearTimeout: (id) => state.timers.delete(id),
    setInterval: () => ++timerId, clearInterval: () => {},
  })
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/firebase/sync.ts', import.meta.url), 'utf8'))
  const mod = new SourceTextModule(source, { context, importModuleDynamically: () => Promise.reject(new Error('Optional API disabled')) })
  await mod.link((id) => {
    const values = modules[id]
    assert.ok(values, `Unexpected dependency: ${id}`)
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await mod.evaluate()
  return { state, api: mod.namespace }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('edits made during upload remain dirty and are scheduled for another backup', async () => {
  const { state, api } = await harness()
  let finish
  state.upload = () => new Promise((resolve) => { finish = resolve })
  const saving = api.backupNow({ force: true })
  await tick()
  state.data = { sales: [{ id: 'new-bill' }], expenses: [] }
  state.revision = '2026-10-08T01:30:00Z'
  api.notifyDataChanged(state.data)
  finish('2026-10-08T02:00:00Z')
  await saving
  assert.equal(state.synced, 0)
  assert.equal(state.dirty, true)
  assert.equal(state.backupAt, '2026-10-08T02:00:00Z')
  assert.ok([...state.timers.values()].some((timer) => timer.delay === 5000))
})

test('manual saves do not overlap an in-flight upload', async () => {
  const { state, api } = await harness()
  let finish
  state.upload = () => new Promise((resolve) => { finish = resolve })
  const first = api.backupNow({ force: true })
  await tick()
  await assert.rejects(api.backupNow({ force: true }), /busy/)
  finish('2026-10-08T02:00:00Z')
  await first
  assert.equal(state.uploaded, 1)
  assert.equal(state.synced, 1)
})

test('a failed account-switch read preserves local data and pauses automatic writes', async () => {
  const { state, api } = await harness()
  state.uid = 'other-owner'
  state.fetch = async () => { throw new Error('offline') }
  api.initFirebaseSync()
  state.auth({ uid: state.uid })
  await tick()
  assert.equal(state.cleared, 0)
  assert.equal(state.localUid, 'owner')
  assert.equal(state.uploaded, 0)
  await assert.rejects(api.backupNow({ force: true }), /owns/)
})

test('failed automatic uploads back off rather than retry every 300ms', async () => {
  const { state, api } = await harness()
  state.upload = async () => { throw new Error('offline') }
  api.notifyDataChanged(state.data)
  const entry = [...state.timers.entries()][0]
  state.timers.delete(entry[0])
  entry[1].fn()
  await tick()
  assert.equal(state.synced, 0)
  assert.ok([...state.timers.values()].some((timer) => timer.delay >= 5000))
})
