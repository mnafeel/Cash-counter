import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getCloudUser } from '../firebase/backup'
import { getFirebaseDb, isFirebaseConfigured } from '../firebase/config'
import { formatFirebaseError } from '../firebase/utils'

const CREDS_KEY = 'sfcc-site-gate-credentials'
const SESSION_KEY = 'sfcc-site-gate-session'
const PBKDF2_ITERATIONS = 120_000

export interface SiteGateCredentials {
  username: string
  passwordHash: string
  salt: string
  updatedAt: string
}

export interface SiteGateSession {
  username: string
  unlockedAt: string
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export async function hashSiteGatePassword(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )
  return bytesToHex(bits)
}

export function readLocalSiteGateCredentials(): SiteGateCredentials | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SiteGateCredentials
    if (!parsed?.username || !parsed?.passwordHash || !parsed?.salt) return null
    return parsed
  } catch {
    return null
  }
}

export function writeLocalSiteGateCredentials(creds: SiteGateCredentials): void {
  localStorage.setItem(CREDS_KEY, JSON.stringify(creds))
}

export function clearLocalSiteGateCredentials(): void {
  localStorage.removeItem(CREDS_KEY)
}

export function readSiteGateSession(): SiteGateSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SiteGateSession
    if (!parsed?.username || !parsed?.unlockedAt) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSiteGateSession(username: string): void {
  const session: SiteGateSession = {
    username: username.trim(),
    unlockedAt: new Date().toISOString(),
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSiteGateSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function isSiteGateUnlocked(): boolean {
  const session = readSiteGateSession()
  const creds = readLocalSiteGateCredentials()
  if (!session || !creds) return false
  return session.username.trim().toLowerCase() === creds.username.trim().toLowerCase()
}

function siteAccessDocRef() {
  return doc(getFirebaseDb(), 'siteAccess', 'gate')
}

function userSiteGateDocRef(uid: string) {
  return doc(getFirebaseDb(), 'users', uid, 'siteGate', 'credentials')
}

/** Load gate credentials: local first, then public cloud doc, then signed-in user doc. */
export async function loadSiteGateCredentials(): Promise<SiteGateCredentials | null> {
  const local = readLocalSiteGateCredentials()
  if (local) return local

  if (!isFirebaseConfigured()) return null

  try {
    const publicSnap = await getDoc(siteAccessDocRef())
    if (publicSnap.exists()) {
      const data = publicSnap.data() as SiteGateCredentials
      if (data.username && data.passwordHash && data.salt) {
        writeLocalSiteGateCredentials(data)
        return data
      }
    }
  } catch {
    /* public read may fail offline */
  }

  const user = getCloudUser()
  if (!user) return null
  try {
    const snap = await getDoc(userSiteGateDocRef(user.uid))
    if (!snap.exists()) return null
    const data = snap.data() as SiteGateCredentials
    if (!data.username || !data.passwordHash || !data.salt) return null
    writeLocalSiteGateCredentials(data)
    return data
  } catch {
    return null
  }
}

async function persistCredentialsEverywhere(creds: SiteGateCredentials): Promise<void> {
  writeLocalSiteGateCredentials(creds)
  if (!isFirebaseConfigured()) return

  const writes: Promise<unknown>[] = []
  const user = getCloudUser()
  if (user) {
    writes.push(setDoc(userSiteGateDocRef(user.uid), creds, { merge: true }))
  }
  // Public gate doc (readable without cloud login) — requires auth to write.
  if (user) {
    writes.push(setDoc(siteAccessDocRef(), creds, { merge: true }))
  }
  if (writes.length === 0) return
  try {
    await Promise.all(writes)
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
}

export async function setupSiteGateCredentials(
  username: string,
  password: string,
): Promise<SiteGateCredentials> {
  const name = username.trim()
  if (name.length < 3) throw new Error('Username must be at least 3 characters.')
  if (password.length < 6) throw new Error('Password must be at least 6 characters.')
  const existing = await loadSiteGateCredentials()
  if (existing) throw new Error('Site access is already set up. Log in instead.')

  const salt = randomSaltHex()
  const passwordHash = await hashSiteGatePassword(password, salt)
  const creds: SiteGateCredentials = {
    username: name,
    passwordHash,
    salt,
    updatedAt: new Date().toISOString(),
  }
  await persistCredentialsEverywhere(creds)
  writeSiteGateSession(name)
  return creds
}

export async function verifySiteGateLogin(
  username: string,
  password: string,
): Promise<boolean> {
  const creds = await loadSiteGateCredentials()
  if (!creds) return false
  if (creds.username.trim().toLowerCase() !== username.trim().toLowerCase()) return false
  const hash = await hashSiteGatePassword(password, creds.salt)
  if (hash !== creds.passwordHash) return false
  writeLocalSiteGateCredentials(creds)
  writeSiteGateSession(creds.username)
  return true
}

export async function changeSiteGateCredentials(input: {
  currentUsername: string
  currentPassword: string
  newUsername: string
  newPassword: string
}): Promise<void> {
  const creds = await loadSiteGateCredentials()
  if (!creds) throw new Error('Site access is not set up yet.')

  if (creds.username.trim().toLowerCase() !== input.currentUsername.trim().toLowerCase()) {
    throw new Error('Current username is incorrect.')
  }
  const currentHash = await hashSiteGatePassword(input.currentPassword, creds.salt)
  if (currentHash !== creds.passwordHash) {
    throw new Error('Current password is incorrect.')
  }

  const newUsername = input.newUsername.trim()
  if (newUsername.length < 3) throw new Error('New username must be at least 3 characters.')
  if (input.newPassword.length < 6) throw new Error('New password must be at least 6 characters.')

  const salt = randomSaltHex()
  const passwordHash = await hashSiteGatePassword(input.newPassword, salt)
  const next: SiteGateCredentials = {
    username: newUsername,
    passwordHash,
    salt,
    updatedAt: new Date().toISOString(),
  }
  await persistCredentialsEverywhere(next)
  writeSiteGateSession(newUsername)
}

export function logoutSiteGate(): void {
  clearSiteGateSession()
}
