import type { AppData } from '../types'
import {
  applyRemoteCloudData,
  getLocalDataUpdatedAt,
  loadData,
} from '../storage/database'
import { isFirebaseConfigured } from './config'
import {
  backupAppData,
  fetchRemoteAppData,
  isAutoBackupEnabled,
  isCloudLoggedIn,
  parseBackupTimestamp,
  subscribeToAuth,
  subscribeToCloudData,
} from './backup'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingData: AppData | null = null
let onStatusChange: ((message: string, isError?: boolean) => void) | null = null
let remoteListener: ((data: AppData) => void) | null = null
let cloudSnapshotUnsub: (() => void) | null = null
let applyingRemote = false
let lastAppliedRemoteBackupAt = 0

const DEBOUNCE_MS = 600

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
  if (applyingRemote) return false
  const remoteMs = parseBackupTimestamp(backupAt)
  if (remoteMs <= lastAppliedRemoteBackupAt) return false
  const localMs = parseBackupTimestamp(getLocalDataUpdatedAt())
  return remoteMs > localMs
}

function applyRemoteSnapshot(data: AppData, backupAt: string): void {
  if (!shouldApplyRemote(backupAt)) return
  applyingRemote = true
  try {
    const next = applyRemoteCloudData(data, backupAt)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(backupAt)
    remoteListener?.(next)
    onStatusChange?.(`Synced from cloud · ${new Date(backupAt).toLocaleString()}`)
  } finally {
    applyingRemote = false
  }
}

function startCloudListener(): void {
  cloudSnapshotUnsub?.()
  cloudSnapshotUnsub = subscribeToCloudData((data, backupAt) => {
    applyRemoteSnapshot(data, backupAt)
  })
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
      void pullCloudIfNewer()
      if (isAutoBackupEnabled()) {
        queueBackup(pendingData ?? loadData())
      }
      return
    }
    lastAppliedRemoteBackupAt = 0
  })
}

function queueBackup(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isCloudLoggedIn()) return
  if (applyingRemote) return

  pendingData = data
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    void runBackup(data)
  }, DEBOUNCE_MS)
}

async function runBackup(data: AppData): Promise<void> {
  if (!isCloudLoggedIn() || applyingRemote) return

  try {
    onStatusChange?.('Backing up to Firebase…')
    const at = await backupAppData(data)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(at)
    onStatusChange?.(`Backed up ${new Date(at).toLocaleString()}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    onStatusChange?.(message, true)
  }
}

export function notifyDataChanged(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled()) return
  pendingData = data
  if (!isCloudLoggedIn() || applyingRemote) return
  queueBackup(data)
}

export async function backupNow(data: AppData): Promise<string> {
  const at = await backupAppData(data)
  pendingData = data
  lastAppliedRemoteBackupAt = parseBackupTimestamp(at)
  onStatusChange?.(`Backed up ${new Date(at).toLocaleString()}`)
  return at
}
