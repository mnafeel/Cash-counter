import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import type { AppData } from '../types'
import { authEmailToUsername, clearLastCloudUsername, saveLastCloudUsername, usernameToAuthEmail } from './cloudUser'
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from './config'
import { formatFirebaseError, stripUndefined } from './utils'

const AUTO_BACKUP_KEY = 'cash-counter-auto-backup'
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

export async function createCloudAccount(username: string, password: string): Promise<User> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured in this build.')
  }
  try {
    const email = usernameToAuthEmail(username)
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
    saveLastCloudUsername(username)
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
    const email = usernameToAuthEmail(username)
    const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
    saveLastCloudUsername(username)
    return cred.user
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
}

export function getCloudUsername(user: User | null): string {
  return authEmailToUsername(user?.email)
}

export async function restoreCloudDataForUser(): Promise<AppData | null> {
  return restoreAppData()
}

export async function logoutCloud(): Promise<void> {
  clearLastCloudUsername()
  await signOut(getFirebaseAuth())
}

function requireCloudUser(): User {
  const user = getCloudUser()
  if (!user) throw new Error('Login to cloud account first.')
  return user
}

export async function backupAppData(data: AppData): Promise<string> {
  const user = requireCloudUser()

  const backedUpAt = new Date().toISOString()
  const cleanData = stripUndefined(data)
  const payload = {
    ...cleanData,
    _backupAt: backedUpAt,
    _updatedAt: serverTimestamp(),
  }

  try {
    await setDoc(latestDocRef(user.uid), payload)
    await setDoc(snapshotDocRef(user.uid, backedUpAt.replace(/[:.]/g, '-')), {
      ...cleanData,
      _backupAt: backedUpAt,
      _updatedAt: backedUpAt,
    })
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }

  setLocalLastBackupTime(backedUpAt)
  return backedUpAt
}

export async function restoreAppData(): Promise<AppData | null> {
  const user = requireCloudUser()

  try {
    const snap = await getDoc(latestDocRef(user.uid))
    if (!snap.exists()) return null

    const raw = snap.data() as AppData & { _backupAt?: string; _updatedAt?: unknown }
    const { _backupAt: _ignoredAt, _updatedAt: _ignoredUpdated, ...rest } = raw
    void _ignoredAt
    void _ignoredUpdated

    if (raw._backupAt) setLocalLastBackupTime(raw._backupAt)
    return rest as AppData
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
