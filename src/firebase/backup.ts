import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { collection, doc, getDoc, getDocFromServer, onSnapshot, serverTimestamp, writeBatch, runTransaction } from 'firebase/firestore'
import { assertBackupData, backupChecksum, decodeBackup, encodeBackup, parseBackupStorage, verifyBackupChecksum } from './backupChunks'
import type { AppData } from '../types'
import {
  getBankBalance,
  getCurrentBalance,
  loadData,
  normalizeData,
} from '../storage/database'
import {
  authEmailToUsername,
  clearLastCloudUsername,
  normalizeUsernameKey,
  saveLastCloudUsername,
  usernameToAuthEmail,
} from './cloudUser'
import {
  ensureCloudUsernameRegistered,
  fetchCloudUsername,
  registerCloudUsername,
  resolveAuthEmailForUsername,
} from './cloudUsernameRegistry'
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from './config'
import { formatFirebaseError, stripUndefined } from './utils'

const AUTO_BACKUP_KEY = 'cash-counter-auto-backup'
const AUTO_PULL_KEY = 'cash-counter-auto-pull'
const MAIN_BILLING_DEVICE_KEY = 'cash-counter-main-billing-device'
const LAST_BACKUP_KEY = 'cash-counter-last-backup'

function latestDocRef(uid: string) {
  return doc(getFirebaseDb(), 'users', uid, 'data', 'latest')
}

function snapshotDocRef(uid: string, backupId: string) {
  return doc(getFirebaseDb(), 'users', uid, 'snapshots', backupId)
}

export function isAutoBackupEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_BACKUP_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setAutoBackupEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_BACKUP_KEY, enabled ? 'true' : 'false')
}

export function isAutoPullFromCloudEnabled(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_PULL_KEY)
    if (stored !== null) return stored === 'true'
    // Secondary devices default to auto-load; main billing device keeps local cash stable.
    return !isMainBillingDevice()
  } catch {
    return !isMainBillingDevice()
  }
}

export function setAutoPullFromCloudEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_PULL_KEY, enabled ? 'true' : 'false')
}

/** Only the main billing device should write to cloud — prevents other devices overwriting correct cash. */
export function isMainBillingDevice(): boolean {
  try {
    return localStorage.getItem(MAIN_BILLING_DEVICE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setMainBillingDevice(enabled: boolean): void {
  localStorage.setItem(MAIN_BILLING_DEVICE_KEY, enabled ? 'true' : 'false')
  if (!enabled) setAutoBackupEnabled(false)
}

export function getLocalLastBackupTime(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    return null
  }
}

function setLocalLastBackupTime(iso: string): void {
  localStorage.setItem(LAST_BACKUP_KEY, iso)
}

export function clearLocalLastBackupTime(): void {
  localStorage.removeItem(LAST_BACKUP_KEY)
}

/** Keep local backup timestamp aligned after applying a remote snapshot. */
export function markLocalBackupTime(iso: string): void {
  setLocalLastBackupTime(iso)
}

export function parseBackupTimestamp(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

export function subscribeToAuth(onChange: (user: User | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    onChange(null)
    return () => {}
  }
  return onAuthStateChanged(getFirebaseAuth(), onChange)
}

export function getCloudUser(): User | null {
  if (!isFirebaseConfigured()) return null
  return getFirebaseAuth().currentUser
}

export function isCloudLoggedIn(): boolean {
  return Boolean(getCloudUser())
}

const cachedUsernameByUid = new Map<string, string>()

export function setCachedCloudUsername(uid: string, username: string): void {
  cachedUsernameByUid.set(uid, normalizeUsernameKey(username))
}

export function clearCachedCloudUsername(uid?: string): void {
  if (uid) cachedUsernameByUid.delete(uid)
  else cachedUsernameByUid.clear()
}

export async function refreshCloudUsernameCache(user: User | null): Promise<string> {
  if (!user) {
    clearCachedCloudUsername()
    return ''
  }
  const fromProfile = await fetchCloudUsername(user.uid)
  if (fromProfile) {
    setCachedCloudUsername(user.uid, fromProfile)
    return fromProfile
  }
  const registered = await ensureCloudUsernameRegistered(user.uid, user.email ?? '')
  setCachedCloudUsername(user.uid, registered)
  return registered
}

export async function createCloudAccount(username: string, password: string): Promise<User> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured in this build.')
  }
  try {
    const email = usernameToAuthEmail(username)
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
    await registerCloudUsername(cred.user.uid, username, email)
    const key = normalizeUsernameKey(username)
    setCachedCloudUsername(cred.user.uid, key)
    saveLastCloudUsername(key)
    return cred.user
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
}

export async function loginCloud(username: string, password: string): Promise<User> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured in this build.')
  }
  try {
    const email = await resolveAuthEmailForUsername(username)
    const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
    const key = await ensureCloudUsernameRegistered(cred.user.uid, cred.user.email ?? email)
    setCachedCloudUsername(cred.user.uid, key)
    saveLastCloudUsername(normalizeUsernameKey(username))
    return cred.user
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
}

export function getCloudUsername(user: User | null): string {
  if (!user) return ''
  const cached = cachedUsernameByUid.get(user.uid)
  if (cached) return cached
  return authEmailToUsername(user.email)
}

export async function restoreCloudDataForUser(): Promise<AppData | null> {
  return restoreAppData()
}

export async function logoutCloud(): Promise<void> {
  const uid = getCloudUser()?.uid
  clearLastCloudUsername()
  if (uid) clearCachedCloudUsername(uid)
  await signOut(getFirebaseAuth())
}

export function requireCloudUser(): User {
  const user = getCloudUser()
  if (!user) throw new Error('Login to cloud account first.')
  return user
}

export interface CloudBackupTotals {
  bills: number
  records: number
  cash: number
  bank: number
}

export function cloudBackupTotals(data: AppData): CloudBackupTotals {
  return {
    bills: data.sales.length,
    records: data.expenses.length,
    cash: getCurrentBalance(data),
    bank: getBankBalance(data),
  }
}

export function cloudTotalsMatch(a: CloudBackupTotals, b: CloudBackupTotals): boolean {
  return (
    a.bills === b.bills &&
    a.records === b.records &&
    Math.abs(a.cash - b.cash) < 0.01 &&
    Math.abs(a.bank - b.bank) < 0.01
  )
}

/** Cloud already has more bills/cash — auto-backup must not overwrite it. */
export function remoteIsAheadOfLocal(local: AppData, remote: AppData): boolean {
  const l = cloudBackupTotals(local)
  const r = cloudBackupTotals(remote)
  return (
    r.bills > l.bills ||
    r.records > l.records ||
    r.cash > l.cash + 0.01 ||
    r.bank > l.bank + 0.01
  )
}

export async function backupAppData(source?: AppData, options?: { allowOverwrite?: boolean }): Promise<string> {
  const user = requireCloudUser()

  const baseline = await getDocFromServer(latestDocRef(user.uid))
  const baselineVersion = JSON.stringify(baseline.data() ?? null)
  if (baseline.exists() && !options?.allowOverwrite && baseline.data()._backupAt !== getLocalLastBackupTime()) {
    throw new Error('Cloud has a backup this device has not loaded. Automatic overwrite stopped; review and load the cloud backup first.')
  }
  const backedUpAt = new Date().toISOString()
  const cleanData = stripUndefined(normalizeData(source ?? loadData()))

  // Immutable parts are uploaded first. Readers only see a new backup after all
  // parts exist and the latest pointer + history manifest are committed together.
  const backupId = doc(collection(getFirebaseDb(), 'users', user.uid, 'snapshots')).id
  const { storage, chunks } = encodeBackup(cleanData, backupId)
  storage.sha256 = await backupChecksum(chunks)
  const payload = {
    _storage: storage,
    _schemaVersion: 1,
    _backupAt: backedUpAt,
    _updatedAt: serverTimestamp(),
    _totals: cloudBackupTotals(cleanData),
  }

  let legacyManifest: Record<string, unknown> | null = null
  const versions = [{ id: backupId, chunks }]
  if (baseline.exists() && !baseline.data()._storage) {
    const { _backupAt, _updatedAt: _ignored, _totals, ...legacyData } = baseline.data()
    void _ignored
    assertBackupData(legacyData)
    const legacy = encodeBackup(legacyData, `${backupId}-legacy`)
    legacy.storage.sha256 = await backupChecksum(legacy.chunks)
    versions.push({ id: legacy.storage.backupId, chunks: legacy.chunks })
    legacyManifest = { _storage: legacy.storage, _backupAt, _updatedAt: serverTimestamp(),
      ...(_totals !== undefined ? { _totals } : {}) }
  }

  try {
    // Keep each request well below Firestore's 10 MiB request limit.
    for (const version of versions) {
      for (let offset = 0; offset < version.chunks.length; offset += 8) {
        const batch = writeBatch(getFirebaseDb())
        version.chunks.slice(offset, offset + 8).forEach((body, index) => {
          batch.set(doc(snapshotDocRef(user.uid, version.id), 'chunks', String(offset + index)), { body })
        })
        await batch.commit()
      }
    }
    await runTransaction(getFirebaseDb(), async (publish) => {
      const current = await publish.get(latestDocRef(user.uid))
      if (JSON.stringify(current.data() ?? null) !== baselineVersion) {
        throw new Error('Cloud changed during this backup. Local data is safe; reload cloud status before retrying.')
      }
      // Preserve the previous single-document backup on its first migration.
      if (legacyManifest) {
        publish.set(snapshotDocRef(user.uid, `${backupId}-legacy`), legacyManifest)
      }
      publish.set(snapshotDocRef(user.uid, backupId), payload)
      publish.set(latestDocRef(user.uid), payload)
    })
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }

  // Verify this immutable version from the server, never an optimistic local write.
  const verifiedSnap = await getDocFromServer(snapshotDocRef(user.uid, backupId))
  const verified = verifiedSnap.exists()
    ? await parseCloudPayload(user.uid, verifiedSnap.data(), true)
    : null
  const uploadedTotals = cloudBackupTotals(cleanData)
  const remoteTotals = verified ? cloudBackupTotals(normalizeData(verified.data)) : null
  if (!verified || !remoteTotals || !cloudTotalsMatch(uploadedTotals, remoteTotals)) {
    throw new Error(
      'Cloud verify failed — uploaded cash/bills did not match. Check internet and tap Save to cloud again.',
    )
  }

  return backedUpAt
}

export async function restoreAppData(): Promise<AppData | null> {
  const user = requireCloudUser()

  try {
    const snap = await getDoc(latestDocRef(user.uid))
    if (!snap.exists()) return null

    const payload = await parseCloudPayload(user.uid, snap.data())
    if (!payload) return null
    setLocalLastBackupTime(payload.backupAt)
    return payload.data
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
}

export async function getRemoteLastBackupTime(): Promise<string | null> {
  const user = getCloudUser()
  if (!user) return null

  try {
    const snap = await getDoc(latestDocRef(user.uid))
    if (!snap.exists()) return null
    const raw = snap.data() as { _backupAt?: string }
    return raw._backupAt ?? null
  } catch {
    return null
  }
}

export interface CloudRemotePayload {
  data: AppData
  backupAt: string
  totals?: CloudBackupTotals
}

function parseCloudTotals(raw: unknown): CloudBackupTotals | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const totals = raw as Partial<CloudBackupTotals>
  if (typeof totals.bills !== 'number') return undefined
  return {
    bills: totals.bills,
    records: typeof totals.records === 'number' ? totals.records : 0,
    cash: typeof totals.cash === 'number' ? totals.cash : 0,
    bank: typeof totals.bank === 'number' ? totals.bank : 0,
  }
}

/** Parse cloud doc without normalizing — normalize only when applying to local storage. */
async function parseCloudPayload(
  uid: string,
  raw: Record<string, unknown>,
  fromServer = false,
): Promise<CloudRemotePayload | null> {
  if (typeof raw._backupAt !== 'string' || !Number.isFinite(Date.parse(raw._backupAt))) {
    throw new Error('Invalid cloud backup timestamp. Local data has not been replaced.')
  }
  if (raw._schemaVersion !== undefined && raw._schemaVersion !== 1) {
    throw new Error('This backup requires a newer app version. Update the app before restoring.')
  }
  const { _backupAt: backupAt, _updatedAt: _ignoredUpdated, _schemaVersion: _ignoredSchema, _totals, _storage, ...rest } = raw
  void _ignoredSchema
  void _ignoredUpdated
  let data = rest
  if (_storage !== undefined) {
    const storage = parseBackupStorage(_storage)
    const chunks: unknown[] = []
    // Bound concurrent reads for large backups and retain manifest order.
    for (let offset = 0; offset < storage.chunkCount; offset += 8) {
      const parts = await Promise.all(
        Array.from({ length: Math.min(8, storage.chunkCount - offset) }, async (_, index) => {
          const ref = doc(snapshotDocRef(uid, storage.backupId), 'chunks', String(offset + index))
          const snap = await (fromServer ? getDocFromServer(ref) : getDoc(ref))
          return snap.exists() ? snap.data().body : undefined
        }),
      )
      chunks.push(...parts)
    }
    await verifyBackupChecksum(storage, chunks)
    data = decodeBackup(storage, chunks)
  }
  assertBackupData(data)
  return { data: data as unknown as AppData, backupAt, totals: parseCloudTotals(_totals) }
}

/** Live listener — fires when another device backs up to cloud. */
export function subscribeToCloudData(
  onUpdate: (payload: CloudRemotePayload) => void,
  onError?: (message: string) => void,
): () => void {
  const user = getCloudUser()
  if (!user || !isFirebaseConfigured()) return () => {}

  let generation = 0
  let active = true
  const unsubscribe = onSnapshot(
    latestDocRef(user.uid),
    { includeMetadataChanges: true },
    (snap) => {
      const current = ++generation
      if (!snap.exists() || snap.metadata.hasPendingWrites) return
      void parseCloudPayload(user.uid, snap.data()).then((parsed) => {
        if (active && current === generation && parsed) onUpdate(parsed)
      }).catch((error: unknown) => {
        if (active && current === generation) onError?.(formatFirebaseError(error))
      })
    },
    (error) => {
      onError?.(formatFirebaseError(error))
    },
  )
  return () => {
    active = false
    generation++
    unsubscribe()
  }
}

export async function fetchRemoteAppData(): Promise<CloudRemotePayload | null> {
  const user = getCloudUser()
  if (!user) return null

  // A read failure must not be mistaken for an empty cloud account.
  const snap = await getDocFromServer(latestDocRef(user.uid))
  if (!snap.exists()) return null
  return parseCloudPayload(user.uid, snap.data())
}
