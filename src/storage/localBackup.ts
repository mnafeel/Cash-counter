import type { AppData } from '../types'
import { normalizeData } from './database'

const DB_NAME = 'cash-counter-local-backups'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const MAX_SNAPSHOTS = 20

export interface LocalBackupSnapshotMeta {
  id: string
  savedAt: string
  salesCount: number
  expensesCount: number
  pendingCount: number
}

interface LocalBackupRecord extends LocalBackupSnapshotMeta {
  data: AppData
}

let dbPromise: Promise<IDBDatabase> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingSnapshot: AppData | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
  return dbPromise
}

function snapshotMeta(data: AppData, savedAt: string): LocalBackupSnapshotMeta {
  return {
    id: savedAt.replace(/[:.]/g, '-'),
    savedAt,
    salesCount: data.sales.length,
    expensesCount: data.expenses.length,
    pendingCount: data.sales.filter((sale) => sale.status === 'pending').length,
  }
}

async function persistSnapshot(data: AppData): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  const normalized = normalizeData(data)
  const savedAt = new Date().toISOString()
  const record: LocalBackupRecord = {
    ...snapshotMeta(normalized, savedAt),
    data: normalized,
  }

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })

  await pruneOldSnapshots()
}

async function pruneOldSnapshots(): Promise<void> {
  const items = await listLocalBackupSnapshots()
  if (items.length <= MAX_SNAPSHOTS) return

  const db = await openDb()
  const toDelete = items.slice(MAX_SNAPSHOTS)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const item of toDelete) store.delete(item.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB prune failed'))
  })
}

/** Debounced auto-backup to browser database on every save. */
export function queueLocalBackupSnapshot(data: AppData): void {
  pendingSnapshot = data
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const snapshot = pendingSnapshot
    pendingSnapshot = null
    debounceTimer = null
    if (snapshot) void persistSnapshot(snapshot).catch(() => {})
  }, 1500)
}

export function flushLocalBackupSnapshot(): void {
  const snapshot = pendingSnapshot
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingSnapshot = null
  if (snapshot) void persistSnapshot(snapshot).catch(() => {})
}

export async function listLocalBackupSnapshots(): Promise<LocalBackupSnapshotMeta[]> {
  if (typeof indexedDB === 'undefined') return []

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => {
      const rows = (request.result as LocalBackupRecord[]).map(({ data: _data, ...meta }) => meta)
      rows.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      resolve(rows)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
  })
}

export async function loadLocalBackupSnapshot(id: string): Promise<AppData | null> {
  if (typeof indexedDB === 'undefined') return null

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => {
      const record = request.result as LocalBackupRecord | undefined
      resolve(record ? normalizeData(record.data) : null)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
  })
}
