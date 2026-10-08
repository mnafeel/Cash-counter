import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { test } from 'node:test'
import { assertBackupData } from '../src/firebase/backupChunks.ts'

async function harness() {
  const state = { values: new Map(), failWrites: false, recover: async () => {} }
  const context = createContext({
    console, crypto, Date,
    localStorage: {
      getItem: (key) => state.values.get(key) ?? null,
      setItem: (key, value) => { if (state.failWrites) throw new Error('Quota exceeded'); state.values.set(key, value) },
      removeItem: (key) => state.values.delete(key),
    },
    setTimeout: () => 1, clearTimeout: () => {},
  })
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/storage/database.ts', import.meta.url), 'utf8'))
  const imports = new Map()
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    imports.set(match[2], match[1].split(',').map((name) => name.trim()).filter(Boolean))
  }
  const values = {
    STORAGE_KEY: 'data', LOCAL_UPDATED_AT_KEY: 'updated', LOCAL_USER_UID_KEY: 'uid',
    DEFAULT_REMINDER_ALERTS: {}, assertBackupData,
    getCloudUser: () => ({ uid: 'owner' }),
    persistRecoverySnapshot: (...args) => state.recover(...args),
  }
  const mod = new SourceTextModule(source, { context })
  await mod.link((id) => {
    const names = imports.get(id)
    assert.ok(names, id)
    return new SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, values[name] ?? (() => {}))
    }, { context })
  })
  await mod.evaluate()
  return { state, api: mod.namespace }
}

test('malformed stored JSON is preserved instead of overwritten with an empty account', async () => {
  const { state, api } = await harness()
  state.values.set('data', '{broken')
  assert.throws(() => api.loadData(), /preserved/)
  assert.equal(state.values.get('data'), '{broken')
})

test('local write failure keeps the unsaved data in memory for retry', async () => {
  const { state, api } = await harness()
  const data = { sales: [{ id: 'bill' }], expenses: [] }
  state.failWrites = true
  assert.throws(() => api.saveData(data, { immediate: true }), /Quota/)
  assert.equal(api.loadData(), data)
  state.failWrites = false
  api.flushSaveData()
  assert.deepEqual(JSON.parse(state.values.get('data')), data)
})

test('failure to persist recovery cancels cloud replacement', async () => {
  const { state, api } = await harness()
  const local = JSON.stringify({ sales: [{ id: 'local' }], expenses: [] })
  state.values.set('data', local)
  state.values.set('uid', 'owner')
  state.recover = async () => { throw new Error('Recovery quota full') }
  await assert.rejects(api.applyFullRemoteCloudData({ sales: [], expenses: [] }, '2026-10-08T00:00:00Z', 'owner'), /Recovery quota/)
  assert.equal(state.values.get('data'), local)
})

test('an edit while the recovery copy is being saved cancels cloud replacement', async () => {
  const { state, api } = await harness()
  state.values.set('data', JSON.stringify({ sales: [{ id: 'old' }], expenses: [] }))
  state.values.set('uid', 'owner')
  let finish
  state.recover = () => new Promise((resolve) => { finish = resolve })
  const restoring = api.applyFullRemoteCloudData({ sales: [], expenses: [] }, '2026-10-08T00:00:00Z', 'owner')
  const edited = { sales: [{ id: 'new' }], expenses: [] }
  api.saveData(edited)
  finish()
  await assert.rejects(restoring, /changed during restore/)
  assert.equal(api.loadData(), edited)
})
