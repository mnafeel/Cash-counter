import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { test } from 'node:test'
import * as chunks from '../src/firebase/backupChunks.ts'

async function harness() {
  const latest = 'users/owner/data/latest'
  const old = { sales: [{ id: 'old' }], expenses: [], _backupAt: '2026-10-01T00:00:00Z' }
  const state = { docs: new Map([[latest, old]]), writes: 0, fail: false, conflict: false }
  const local = new Map([['cash-counter-last-backup', old._backupAt]])
  const context = createContext({ console, crypto, TextEncoder, Date, localStorage: {
    getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key),
  } })
  const read = async (ref) => {
    const value = structuredClone(state.docs.get(ref.path))
    return { exists: () => value !== undefined, data: () => value }
  }
  let id = 0
  const ref = (parent, ...parts) => {
    const path = [parent.path, ...(parts.length ? parts : [`version${++id}`])].filter(Boolean).join('/')
    return { path, id: path.split('/').at(-1) }
  }
  const firestore = {
    collection: ref, doc: ref, getDoc: read, getDocFromServer: read,
    serverTimestamp: () => 'server-time', onSnapshot: () => () => {},
    writeBatch: () => {
      const entries = []
      return {
        set: (ref, data) => entries.push([ref.path, data]),
        commit: async () => {
          if (state.fail) throw new Error('offline')
          state.writes += entries.length
          for (const [path, data] of entries) state.docs.set(path, structuredClone(data))
          if (state.conflict) state.docs.set(latest, { ...old, _backupAt: '2026-10-02T00:00:00Z' })
        },
      }
    },
    runTransaction: async (_, fn) => {
      const entries = []
      await fn({ get: read, set: (ref, data) => entries.push([ref.path, data]) })
      for (const [path, data] of entries) state.docs.set(path, structuredClone(data))
    },
  }
  const modules = {
    'firebase/firestore': firestore,
    './backupChunks': chunks,
    '../storage/database': { getBankBalance: () => 0, getCurrentBalance: () => 0, loadData: () => old, normalizeData: (data) => data },
    './config': { getFirebaseAuth: () => ({ currentUser: { uid: 'owner' } }), getFirebaseDb: () => ({}), isFirebaseConfigured: () => true },
    './utils': { stripUndefined: (data) => JSON.parse(JSON.stringify(data)), formatFirebaseError: (err) => err.message },
  }
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/firebase/backup.ts', import.meta.url), 'utf8'))
  const imports = new Map()
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    imports.set(match[2], match[1].split(',').map((name) => name.trim()).filter(Boolean))
  }
  const mod = new SourceTextModule(source, { context })
  await mod.link((name) => {
    const names = imports.get(name)
    return new SyntheticModule(names, function () {
      for (const key of names) this.setExport(key, modules[name]?.[key] ?? (() => {}))
    }, { context })
  })
  await mod.evaluate()
  return { state, api: mod.namespace, latest, old, local }
}

test('large backup publishes small documents, restores completely, and archives legacy data', async () => {
  const { state, api, latest, old } = await harness()
  const data = { sales: [{ id: 'large', note: 'a'.repeat(1100000) }], expenses: [] }
  await api.backupAppData(data)
  assert.ok(state.docs.get(latest)._storage.sha256)
  assert.deepEqual((await api.fetchRemoteAppData()).data, data)
  const legacy = [...state.docs.entries()].find(([path]) => /snapshots\/version1-previous$/.test(path))[1]
  const stored = [...Array(legacy._storage.chunkCount)].map((_, i) => state.docs.get(`users/owner/snapshots/version1-previous/chunks/${i}`).body)
  assert.deepEqual(chunks.decodeBackup(legacy._storage, stored), { sales: old.sales, expenses: [] })
  for (const value of state.docs.values()) assert.ok(Buffer.byteLength(JSON.stringify(value)) < 1048576)
})

test('failed chunk upload leaves the prior latest backup unchanged', async () => {
  const { state, api, latest, old } = await harness()
  state.fail = true
  await assert.rejects(api.backupAppData({ sales: [], expenses: [] }), /offline/)
  assert.deepEqual(state.docs.get(latest), old)
})

test('concurrent cloud write is archived and main-device backup completes', async () => {
  const { state, api, latest } = await harness()
  state.conflict = true
  await api.backupAppData({ sales: [], expenses: [] })
  assert.ok(state.docs.get(latest)._storage.sha256)
  assert.equal(state.docs.get('users/owner/snapshots/version1-previous')._backupAt, '2026-10-02T00:00:00Z')
})

test('main-device backup works when its local backup timestamp is missing', async () => {
  const { state, api, local } = await harness()
  local.clear()
  await api.backupAppData({ sales: [], expenses: [] })
  assert.ok(state.writes > 0)
  assert.ok(state.docs.has('users/owner/snapshots/version1-previous'))
})

test('replacing a chunked backup retains its original chunks and recoverable manifest', async () => {
  const { state, api, latest } = await harness()
  const first = { sales: [{ id: 'first' }], expenses: [] }
  await api.backupAppData(first)
  const manifest = structuredClone(state.docs.get(latest))
  const oldChunks = [...Array(manifest._storage.chunkCount)].map((_, i) => state.docs.get(`users/owner/snapshots/${manifest._storage.backupId}/chunks/${i}`).body)
  await api.backupAppData({ sales: [{ id: 'second' }], expenses: [] })
  assert.deepEqual(state.docs.get('users/owner/snapshots/version2-previous'), manifest)
  assert.deepEqual(chunks.decodeBackup(manifest._storage, oldChunks), first)
  assert.deepEqual(state.docs.get(`users/owner/snapshots/${manifest._storage.backupId}/chunks/0`).body, oldChunks[0])
})
