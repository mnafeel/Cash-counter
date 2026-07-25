import type { AppData } from '../types'
import {
  applyFullRemoteCloudData,
  applyRemoteCloudData,
  getLocalDataUpdatedAt,
  isLocalDataEmpty,
  loadData,
  markLocalDataSynced,
} from '../storage/database'
import { isFirebaseConfigured } from './config'
import {
  backupAppData,
  fetchRemoteAppData,
  getLocalLastBackupTime,
  isAutoBackupEnabled,
  isCloudLoggedIn,
  parseBackupTimestamp,
  subscribeToAuth,
  subscribeToCloudData,
} from './backup'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingData: AppData | null = null
let onStatusChange: ((message: string, isError?: boolean) => void) | null = null
const statusListeners = new Set<(message: string, isError?: boolean) => void>()
let remoteListener: ((data: AppData) => void) | null = null
let cloudSnapshotUnsub: (() => void) | null = null
let applyingRemote = false
let backingUp = false
let loginRestoreActive = false
let lastAppliedRemoteBackupAt = 0

const DEBOUNCE_MS = 400

function emitBackupStatus(message: string, isError = false): void {
  onStatusChange?.(message, isError)
  for (const listener of statusListeners) {
    listener(message, isError)
  }
}

export function subscribeBackupStatus(
  listener: (message: string, isError?: boolean) => void,
): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function setCloudLoginRestoreActive(active: boolean): void {
  loginRestoreActive = active
  if (!active) return
  pendingData = null
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

/** Pull full cloud data on login — replaces local, never merges with empty/stale device data. */
export async function restoreFullCloudData(): Promise<AppData | null> {
  if (!isFirebaseConfigured() || !isCloudLoggedIn()) return null
  const remote = await fetchRemoteAppData()
  if (!remote) return null

  loginRestoreActive = true
  applyingRemote = true
  try {
    const next = applyFullRemoteCloudData(remote.data, remote.backupAt)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(remote.backupAt)
    markLocalDataSynced(remote.backupAt)
    remoteListener?.(next)
    emitBackupStatus(
      `Full data loaded · ${next.sales.length} bills · ${next.expenses.length} records · ${new Date(remote.backupAt).toLocaleString()}`,
    )
    return next
  } finally {
    applyingRemote = false
    loginRestoreActive = false
  }
}

function getEffectiveLocalTimestamp(): number {
  return Math.max(
    parseBackupTimestamp(getLocalDataUpdatedAt()),
    parseBackupTimestamp(getLocalLastBackupTime()),
  )
}

function hasUnsyncedLocalChanges(): boolean {
  if (debounceTimer !== null || backingUp) return true
  const localMs = parseBackupTimestamp(getLocalDataUpdatedAt())
  const backupMs = parseBackupTimestamp(getLocalLastBackupTime())
  return localMs > backupMs
}

export function setCloudRemoteListener(listener: ((data: AppData) => void) | null): void {
  remoteListener = listener
}

export function flushPendingBackup(): void {
  if (!pendingData || !isCloudLoggedIn()) return
  const data = pendingData
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  void runBackup(data)
}

export function setBackupStatusListener(
  listener: ((message: string, isError?: boolean) => void) | null,
): void {
  onStatusChange = listener
}

function shouldApplyRemote(backupAt: string): boolean {
  if (applyingRemote || backingUp) return false
  if (hasUnsyncedLocalChanges()) return false
  const remoteMs = parseBackupTimestamp(backupAt)
  if (remoteMs <= lastAppliedRemoteBackupAt) return false
  return remoteMs > getEffectiveLocalTimestamp()
}

function applyRemoteSnapshot(data: AppData, backupAt: string): void {
  if (!shouldApplyRemote(backupAt)) return
  applyingRemote = true
  let rebackup: AppData | null = null
  try {
    const { data: next, preservedLocal } = applyRemoteCloudData(data, backupAt)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(backupAt)
    remoteListener?.(next)
    if (preservedLocal) {
      emitBackupStatus('Kept local pending bills & records · syncing to cloud…')
      rebackup = next
    } else {
      emitBackupStatus(`Synced from cloud · ${new Date(backupAt).toLocaleString()}`)
    }
  } finally {
    applyingRemote = false
  }
  if (rebackup && isAutoBackupEnabled() && isCloudLoggedIn()) {
    pendingData = rebackup
    queueBackup(rebackup)
  }
}

function startCloudListener(): void {
  cloudSnapshotUnsub?.()
  cloudSnapshotUnsub = subscribeToCloudData(
    (data, backupAt) => {
      applyRemoteSnapshot(data, backupAt)
    },
    (message) => {
      emitBackupStatus(`Cloud error · ${message}`, true)
    },
  )
}

function stopCloudListener(): void {
  cloudSnapshotUnsub?.()
  cloudSnapshotUnsub = null
}

export async function pullCloudIfNewer(): Promise<boolean> {
  if (!isFirebaseConfigured() || !isCloudLoggedIn()) return false
  const remote = await fetchRemoteAppData()
  if (!remote) return false
  if (!shouldApplyRemote(remote.backupAt)) return false
  applyRemoteSnapshot(remote.data, remote.backupAt)
  return true
}

export function initFirebaseSync(): () => void {
  if (!isFirebaseConfigured()) return () => {}

  return subscribeToAuth((user) => {
    stopCloudListener()
    if (user) {
      startCloudListener()
      const local = loadData()
      if (isLocalDataEmpty(local)) {
        void restoreFullCloudData()
      } else {
        void pullCloudIfNewer()
      }
      return
    }
    lastAppliedRemoteBackupAt = 0
    loginRestoreActive = false
    pendingData = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  })
}

function queueBackup(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isCloudLoggedIn()) return
  if (applyingRemote || loginRestoreActive) return

  pendingData = data
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    void runBackup(data)
  }, DEBOUNCE_MS)
}

async function runBackup(data: AppData): Promise<void> {
  if (!isCloudLoggedIn() || applyingRemote || backingUp) return

  backingUp = true
  debounceTimer = null
  try {
    emitBackupStatus('Backing up to Firebase…')
    const at = await backupAppData(data)
    markLocalDataSynced(at)
    pendingData = null
    lastAppliedRemoteBackupAt = parseBackupTimestamp(at)
    emitBackupStatus(`Backed up ${new Date(at).toLocaleString()}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    emitBackupStatus(message, true)
  } finally {
    backingUp = false
  }
}

export function notifyDataChanged(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled()) return
  pendingData = data
  if (!isCloudLoggedIn() || applyingRemote || loginRestoreActive) return
  queueBackup(data)
}

export async function backupNow(data: AppData): Promise<string> {
  const at = await backupAppData(data)
  markLocalDataSynced(at)
  pendingData = null
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  lastAppliedRemoteBackupAt = parseBackupTimestamp(at)
  emitBackupStatus(`Backed up ${new Date(at).toLocaleString()}`)
  return at
}
