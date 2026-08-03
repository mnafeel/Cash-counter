import type { AppData } from '../types'
import {
  applyFullRemoteCloudData,
  clearAllLocalData,
  getBankBalance,
  getCurrentBalance,
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
  cloudBackupTotals,
  fetchRemoteAppData,
  getCloudUser,
  getLocalLastBackupTime,
  isAutoBackupEnabled,
  isAutoPullFromCloudEnabled,
  isCloudLoggedIn,
  isMainBillingDevice,
  parseBackupTimestamp,
  remoteIsAheadOfLocal,
  setAutoPullFromCloudEnabled,
  subscribeToAuth,
  subscribeToCloudData,
  type CloudBackupTotals,
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

const MAIN_DEVICE_BACKUP_MS = 300
const PERIODIC_MAIN_BACKUP_MS = 2 * 60 * 1000

let periodicBackupTimer: ReturnType<typeof setInterval> | null = null

export interface CloudRemoteSummary {
  bills: number
  records: number
  cash: number
  bank: number
  backupAt: string
}

let cloudRemoteSummaryListener: ((summary: CloudRemoteSummary | null) => void) | null = null

export function setCloudRemoteSummaryListener(
  listener: ((summary: CloudRemoteSummary | null) => void) | null,
): void {
  cloudRemoteSummaryListener = listener
}

function buildCloudRemoteSummary(data: AppData, backupAt: string): CloudRemoteSummary {
  return {
    bills: data.sales.length,
    records: data.expenses.length,
    cash: getCurrentBalance(data),
    bank: getBankBalance(data),
    backupAt,
  }
}

function buildCloudRemoteSummaryFromTotals(totals: CloudBackupTotals, backupAt: string): CloudRemoteSummary {
  return { ...totals, backupAt }
}

let deferredSummaryTimer: ReturnType<typeof setTimeout> | null = null

function emitCloudRemoteSummary(data: AppData, backupAt: string): void {
  cloudRemoteSummaryListener?.(buildCloudRemoteSummary(data, backupAt))
}

function emitCloudRemoteSummaryFromPayload(
  data: AppData,
  backupAt: string,
  totals?: CloudBackupTotals,
): void {
  if (totals) {
    cloudRemoteSummaryListener?.(buildCloudRemoteSummaryFromTotals(totals, backupAt))
    return
  }
  if (loginRestoreActive || applyingRemote || backingUp) return
  if (deferredSummaryTimer) clearTimeout(deferredSummaryTimer)
  deferredSummaryTimer = setTimeout(() => {
    deferredSummaryTimer = null
    cloudRemoteSummaryListener?.(buildCloudRemoteSummary(data, backupAt))
  }, 800)
}

/** Read latest cloud backup metadata — same on every device, does not change local data. */
export async function refreshCloudRemoteSummary(): Promise<CloudRemoteSummary | null> {
  if (!isFirebaseConfigured() || !isCloudLoggedIn()) {
    cloudRemoteSummaryListener?.(null)
    return null
  }
  const remote = await fetchRemoteAppData()
  if (!remote) {
    cloudRemoteSummaryListener?.(null)
    return null
  }
  const summary =
    remote.totals != null
      ? buildCloudRemoteSummaryFromTotals(remote.totals, remote.backupAt)
      : {
          bills: remote.data.sales?.length ?? 0,
          records: remote.data.expenses?.length ?? 0,
          cash: 0,
          bank: 0,
          backupAt: remote.backupAt,
        }
  cloudRemoteSummaryListener?.(summary)
  return summary
}

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

/** Wait until auth restore / remote apply finishes — avoids duplicate restore loops on login. */
export async function waitForCloudRestoreIdle(timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (loginRestoreActive || applyingRemote || backingUp) {
    if (Date.now() - start > timeoutMs) break
    await new Promise((resolve) => setTimeout(resolve, 50))
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
    notifyRemoteListener(next)
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
      notifyRemoteListener(next)
      emitBackupStatus(
        `Account data loaded · ${next.sales.length} bills · ${next.expenses.length} records`,
      )
      return next
    }

    setLocalUserUid(uid)
    const empty = loadData()
    notifyRemoteListener(empty)
    return empty
  } finally {
    applyingRemote = false
    loginRestoreActive = false
  }
}

/** View-only / secondary devices — always mirror cloud (main device stays local-first). */
function ensureSecondaryDeviceAutoPull(): void {
  if (!isMainBillingDevice() && !isAutoPullFromCloudEnabled()) {
    setAutoPullFromCloudEnabled(true)
  }
}

async function syncSecondaryDeviceFromCloud(uid: string): Promise<void> {
  const remote = await fetchRemoteAppData()
  await refreshCloudRemoteSummary()
  if (!remote) return

  loginRestoreActive = true
  applyingRemote = true
  try {
    const next = applyFullRemoteCloudData(remote.data, remote.backupAt, uid)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(remote.backupAt)
    markLocalDataSynced(remote.backupAt)
    notifyRemoteListener(next)
    emitBackupStatus(
      `Cloud loaded · ${next.sales.length} bills · ${next.expenses.length} records · ${new Date(remote.backupAt).toLocaleString()}`,
    )
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
        notifyRemoteListener(next)
      } finally {
        applyingRemote = false
        loginRestoreActive = false
      }
      return
    }

    setLocalUserUid(uid)
    notifyRemoteListener(local)
    return
  }

  setLocalUserUid(uid)

  if (!isMainBillingDevice()) {
    ensureSecondaryDeviceAutoPull()
    await syncSecondaryDeviceFromCloud(uid)
    return
  }

  if (isLocalDataEmpty(local)) {
    await restoreFullCloudData()
    await refreshCloudRemoteSummary()
    return
  }

  await refreshCloudRemoteSummary()

  if (isAutoPullFromCloudEnabled()) {
    await pullCloudIfNewer()
  }
}

function stopPeriodicMainDeviceBackup(): void {
  if (periodicBackupTimer) {
    clearInterval(periodicBackupTimer)
    periodicBackupTimer = null
  }
}

function startPeriodicMainDeviceBackup(): void {
  stopPeriodicMainDeviceBackup()
  if (!isMainBillingDevice() || !isAutoBackupEnabled()) return
  periodicBackupTimer = setInterval(() => {
    backupMainDeviceIfNeeded()
  }, PERIODIC_MAIN_BACKUP_MS)
}

/** Push unsynced local data from the main billing device — source of truth for cloud. */
export function backupMainDeviceIfNeeded(): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isCloudLoggedIn()) return
  if (!isMainBillingDevice()) return
  if (applyingRemote || loginRestoreActive || backingUp) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return
  if (!hasUnsyncedLocalChanges()) return
  queueBackup(loadData())
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

function notifyRemoteListener(data: AppData): void {
  if (!remoteListener) return
  const heavy = data.sales.length > 250 || data.expenses.length > 400
  if (!heavy) {
    remoteListener(data)
    return
  }
  const deliver = () => remoteListener?.(data)
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(deliver, { timeout: 2000 })
  } else {
    setTimeout(deliver, 32)
  }
}

export function flushPendingBackup(): void {
  if (!pendingData || !isCloudLoggedIn()) return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  void runBackup()
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
  if (!isAutoPullFromCloudEnabled()) {
    if (shouldApplyRemote(backupAt)) {
      emitBackupStatus(
        `Cloud has newer data · Settings → Cloud → Load from cloud (${new Date(backupAt).toLocaleString()})`,
      )
    }
    return
  }
  if (!shouldApplyRemote(backupAt)) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return

  applyingRemote = true
  try {
    const next = applyFullRemoteCloudData(data, backupAt, user?.uid)
    lastAppliedRemoteBackupAt = parseBackupTimestamp(backupAt)
    notifyRemoteListener(next)
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
    (payload) => {
      emitCloudRemoteSummaryFromPayload(payload.data, payload.backupAt, payload.totals)
      applyRemoteSnapshot(payload.data, payload.backupAt)
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
  if (!isAutoPullFromCloudEnabled()) return false
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
    stopPeriodicMainDeviceBackup()
    if (user) {
      startCloudListener()
      void onCloudUserSignedIn(user.uid).finally(() => {
        backupMainDeviceIfNeeded()
        startPeriodicMainDeviceBackup()
      })
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

function scheduleMainDeviceBackup(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runBackup({ force: true })
  }, MAIN_DEVICE_BACKUP_MS)
}

function queueBackup(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isCloudLoggedIn()) return
  if (!isMainBillingDevice()) return
  if (applyingRemote || loginRestoreActive) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return

  pendingData = data
  scheduleMainDeviceBackup()
}

async function runBackup(options?: { force?: boolean }): Promise<void> {
  if (!isCloudLoggedIn() || applyingRemote || loginRestoreActive) return
  if (backingUp) {
    scheduleMainDeviceBackup()
    return
  }
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return

  const data = loadData()
  const force = options?.force ?? isMainBillingDevice()

  if (!force) {
    const remote = await fetchRemoteAppData()
    if (remote && remoteIsAheadOfLocal(data, remote.data)) {
      const r = cloudBackupTotals(remote.data)
      emitBackupStatus(
        `Backup skipped — cloud has newer data (${r.bills} bills · cash ${r.cash}). Load from cloud on this device first.`,
        true,
      )
      return
    }
  }

  backingUp = true
  try {
    emitBackupStatus('Backing up to Firebase…')
    const at = await backupAppData(data)
    markLocalDataSynced(at)
    pendingData = null
    lastAppliedRemoteBackupAt = parseBackupTimestamp(at)
    const totals = cloudBackupTotals(data)
    emitCloudRemoteSummary(data, at)
    emitBackupStatus(
      `Backed up · ${totals.bills} bills · cash ${totals.cash} · bank ${totals.bank} · ${new Date(at).toLocaleString()}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    emitBackupStatus(message, true)
  } finally {
    backingUp = false
    if (
      isMainBillingDevice() &&
      isAutoBackupEnabled() &&
      isCloudLoggedIn() &&
      hasUnsyncedLocalChanges()
    ) {
      scheduleMainDeviceBackup()
    }
  }
}

export function notifyDataChanged(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isMainBillingDevice()) return
  pendingData = data
  if (!isCloudLoggedIn() || applyingRemote || loginRestoreActive) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return
  queueBackup(data)
}

/** Push full local snapshot to cloud right away — used after deletes so other devices match. */
export function notifyDataChangedImmediate(data: AppData): void {
  if (!isFirebaseConfigured() || !isAutoBackupEnabled() || !isMainBillingDevice()) return
  pendingData = data
  if (!isCloudLoggedIn() || applyingRemote || loginRestoreActive) return
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  void runBackup({ force: true })
}

export async function backupNow(options?: { force?: boolean }): Promise<string> {
  if (!isMainBillingDevice()) {
    throw new Error('This is not the main billing device. Turn on Main billing device to save, or use Load from cloud.')
  }
  const user = getCloudUser()
  if (user && !isLocalDataOwnedByUser(user.uid)) {
    setLocalUserUid(user.uid)
  }
  flushPendingBackup()
  const data = loadData()
  if (!options?.force) {
    const remote = await fetchRemoteAppData()
    if (remote && remoteIsAheadOfLocal(data, remote.data)) {
      throw new Error(
        `Cloud already has more data (${remote.data.sales.length} bills). Load from cloud first, or save again to overwrite.`,
      )
    }
  }
  const at = await backupAppData(data)
  markLocalDataSynced(at)
  pendingData = null
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  lastAppliedRemoteBackupAt = parseBackupTimestamp(at)
  const totals = cloudBackupTotals(data)
  emitCloudRemoteSummary(data, at)
  emitBackupStatus(
    `Backed up · ${totals.bills} bills · cash ${totals.cash} · bank ${totals.bank} · ${new Date(at).toLocaleString()}`,
  )
  return at
}
