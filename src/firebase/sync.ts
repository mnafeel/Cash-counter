import type { AppData } from '../types'
import {
  applyFullRemoteCloudData,
  clearAllLocalData,
  getLocalDataUpdatedAt,
  getLocalUserUid,
  isLocalDataEmpty,
  isLocalDataOwnedByUser,
  loadData,
  markLocalDataSynced,
  setLocalUserUid,
} from '../storage/database'
import { clearAllLocalBackupSnapshots } from '../storage/localBackup'
import { isFirebaseConfigured } from './config'
import {
  backupAppData,
  clearLocalLastBackupTime,
  fetchRemoteAppData,
  getCloudUser,
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

function wipeLocalDeviceData(): void {
  clearAllLocalData()
  clearLocalLastBackupTime()
  lastAppliedRemoteBackupAt = 0
  void clearAllLocalBackupSnapshots()
}

/** Pull full cloud data on login — replaces local, never merges with empty/stale device data. */
export async function restoreFullCloudData(): Promise<AppData | null> {
  if (!isFirebaseConfigured() || !isCloudLoggedIn()) return null
  const user = getCloudUser()
  if (!user) return null

  const remote = await fetchRemoteAppData()
  if (!remote) return null

  loginRestoreActive = true
  applyingRemote = true
  try {
    const next = applyFullRemoteCloudData(remote.data, remote.backupAt, user.uid)
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

async function replaceLocalFromCloud(uid: string): Promise<AppData | null> {
  loginRestoreActive = true
  applyingRemote = true
  try {
    const remote = await fetchRemoteAppData()
    if (remote) {
      const next = applyFullRemoteCloudData(remote.data, remote.backupAt, uid)
      lastAppliedRemoteBackupAt = parseBackupTimestamp(remote.backupAt)
      markLocalDataSynced(remote.backupAt)
      remoteListener?.(next)
      emitBackupStatus(
        `Account data loaded · ${next.sales.length} bills · ${next.expenses.length} records`,
      )
      return next
    }

    setLocalUserUid(uid)
    const empty = loadData()
    remoteListener?.(empty)
    return empty
  } finally {
    applyingRemote = false
    loginRestoreActive = false
  }
}

/** Ensure local storage belongs to the signed-in cloud user — never merge across accounts. */
async function onCloudUserSignedIn(uid: string): Promise<void> {
  const storedUid = getLocalUserUid()
  const local = loadData()

  if (storedUid && storedUid !== uid) {
    emitBackupStatus('Switching account — loading your cloud data…')
    wipeLocalDeviceData()
    await replaceLocalFromCloud(uid)
    return
  }

  if (!storedUid && !isLocalDataEmpty(local)) {
    const remote = await fetchRemoteAppData()
    if (remote) {
      emitBackupStatus('Loading your cloud data…')
      wipeLocalDeviceData()
      loginRestoreActive = true
      applyingRemote = true
      try {
        const next = applyFullRemoteCloudData(remote.data, remote.backupAt, uid)
        lastAppliedRemoteBackupAt = parseBackupTimestamp(remote.backupAt)
        markLocalDataSynced(remote.backupAt)
        remoteListener?.(next)
      } finally {
        applyingRemote = false
        loginRestoreActive = false
      }
      return
    }

    setLocalUserUid(uid)
    remoteListener?.(local)
    return
  }

  setLocalUserUid(uid)

  if (isLocalDataEmpty(local)) {
    await restoreFullCloudData()
    return
  }

  await pullCloudIfNewer()
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
  if (applyingRemote || backingUp || loginRestoreActive) return false
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return false
  if (hasUnsyncedLocalChanges()) return false
  const remoteMs = parseBackupTimestamp(backupAt)
  if (remoteMs <= lastAppliedRemoteBackupAt) return false
  return remoteMs > getEffectiveLocalTimestamp()
}

function applyRemoteSnapshot(data: AppData, backupAt: string): void {
  if (!shouldApplyRemote(backupAt)) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return

  applyingRemote = true
  try {
    const next = applyFullRemoteCloudData(data, backupAt, user?.uid)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(backupAt)
    remoteListener?.(next)
    emitBackupStatus(
      `Synced from cloud · ${next.sales.length} bills · ${next.expenses.length} records · ${new Date(backupAt).toLocaleString()}`,
    )
  } finally {
    applyingRemote = false
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
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return false
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
      void onCloudUserSignedIn(user.uid)
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
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return

  pendingData = data
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    const latest = pendingData
    if (latest) void runBackup(latest)
  }, DEBOUNCE_MS)
}

async function runBackup(data: AppData): Promise<void> {
  if (!isCloudLoggedIn() || applyingRemote || backingUp || loginRestoreActive) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return

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
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return
  queueBackup(data)
}

/** Push full local snapshot to cloud right away — used after deletes so other devices match. */
export function notifyDataChangedImmediate(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled()) return
  pendingData = data
  if (!isCloudLoggedIn() || applyingRemote || loginRestoreActive) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  void runBackup(data)
}

export async function backupNow(data: AppData): Promise<string> {
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) {
    setLocalUserUid(user.uid)
  }
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
