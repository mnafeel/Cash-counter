import type { AppData } from '../types'
import { loadData } from '../storage/database'
import { isFirebaseConfigured } from './config'
import {
  backupAppData,
  isAutoBackupEnabled,
  isCloudLoggedIn,
  subscribeToAuth,
} from './backup'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingData: AppData | null = null
let onStatusChange: ((message: string, isError?: boolean) => void) | null = null

const DEBOUNCE_MS = 2500

export function setBackupStatusListener(
  listener: ((message: string, isError?: boolean) => void) | null,
): void {
  onStatusChange = listener
}

export function initFirebaseSync(): () => void {
  if (!isFirebaseConfigured()) return () => {}

  return subscribeToAuth((user) => {
    if (user && isAutoBackupEnabled()) {
      const data = pendingData ?? loadData()
      queueBackup(data)
    }
  })
}

function queueBackup(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isCloudLoggedIn()) return

  pendingData = data
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    void runBackup(data)
  }, DEBOUNCE_MS)
}

async function runBackup(data: AppData): Promise<void> {
  if (!isCloudLoggedIn()) return

  try {
    onStatusChange?.('Backing up to Firebase…')
    const at = await backupAppData(data)
    onStatusChange?.(`Backed up ${new Date(at).toLocaleString()}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    onStatusChange?.(message, true)
  }
}

export function notifyDataChanged(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled()) return
  pendingData = data
  if (!isCloudLoggedIn()) return
  queueBackup(data)
}

export async function backupNow(data: AppData): Promise<string> {
  const at = await backupAppData(data)
  pendingData = data
  onStatusChange?.(`Backed up ${new Date(at).toLocaleString()}`)
  return at
}
