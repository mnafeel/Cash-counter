import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getCloudUser } from '../firebase/backup'
import { getFirebaseDb, isFirebaseConfigured } from '../firebase/config'
import { formatFirebaseError } from '../firebase/utils'

const CREDS_KEY = 'sfcc-site-gate-credentials'
const SESSION_KEY = 'sfcc-site-gate-session'
const DURATION_PREF_KEY = 'sfcc-site-gate-session-duration'
const PBKDF2_ITERATIONS = 120_000

export type SiteGateSessionDuration =
  | '1m'
  | '1d'
  | '1w'
  | '1mo'
  | '1y'
  | '2y'
  | 'never'

export const SITE_GATE_SESSION_DURATION_OPTIONS: ReadonlyArray<{
  id: SiteGateSessionDuration
  label: string
}> = [
  { id: '1m', label: '1 minute' },
  { id: '1d', label: '1 day' },
  { id: '1w', label: '1 week' },
  { id: '1mo', label: '1 month' },
  { id: '1y', label: '1 year' },
  { id: '2y', label: '2 years' },
  { id: 'never', label: 'Never' },
]

export const DEFAULT_SITE_GATE_SESSION_DURATION: SiteGateSessionDuration = '1d'

const DURATION_MS: Record<Exclude<SiteGateSessionDuration, 'never'>, number> = {
  '1m': 60_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
  '1mo': 30 * 86_400_000,
  '1y': 365 * 86_400_000,
  '2y': 2 * 365 * 86_400_000,
}

export interface SiteGateCredentials {
  username: string
  passwordHash: string
  salt: string
  updatedAt: string
}

export interface SiteGateSession {
  username: string
  unlockedAt: string
  /** Session length chosen for this unlock. Missing on legacy sessions → treat as never. */
  duration?: SiteGateSessionDuration
  /** ISO expiry; null means never. Missing on legacy sessions → never. */
  expiresAt?: string | null
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

export function isSiteGateSessionDuration(value: unknown): value is SiteGateSessionDuration {
  return SITE_GATE_SESSION_DURATION_OPTIONS.some((o) => o.id === value)
}

export function labelForSiteGateSessionDuration(duration: SiteGateSessionDuration): string {
  return SITE_GATE_SESSION_DURATION_OPTIONS.find((o) => o.id === duration)?.label ?? duration
}

export function computeSiteGateExpiresAt(
  unlockedAt: Date,
  duration: SiteGateSessionDuration,
): string | null {
  if (duration === 'never') return null
  return new Date(unlockedAt.getTime() + DURATION_MS[duration]).toISOString()
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

export function readSiteGateSessionDurationPreference(): SiteGateSessionDuration {
  try {
    const raw = localStorage.getItem(DURATION_PREF_KEY)
    if (isSiteGateSessionDuration(raw)) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_SITE_GATE_SESSION_DURATION
}

export function writeSiteGateSessionDurationPreference(duration: SiteGateSessionDuration): void {
  localStorage.setItem(DURATION_PREF_KEY, duration)
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

export function writeSiteGateSession(
  username: string,
  duration: SiteGateSessionDuration = readSiteGateSessionDurationPreference(),
): void {
  const unlockedAt = new Date()
  const session: SiteGateSession = {
    username: username.trim(),
    unlockedAt: unlockedAt.toISOString(),
    duration,
    expiresAt: computeSiteGateExpiresAt(unlockedAt, duration),
  }
  writeSiteGateSessionDurationPreference(duration)
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

/** Update duration for the current unlock without requiring a new login. */
export function updateSiteGateSessionDuration(duration: SiteGateSessionDuration): void {
  const session = readSiteGateSession()
  if (!session) {
    writeSiteGateSessionDurationPreference(duration)
    return
  }
  writeSiteGateSession(session.username, duration)
}

export function clearSiteGateSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function getActiveSiteGateSessionDuration(): SiteGateSessionDuration {
  const session = readSiteGateSession()
  if (session && isSiteGateSessionDuration(session.duration)) return session.duration
  return readSiteGateSessionDurationPreference()
}

export function formatSiteGateSessionExpiry(session: SiteGateSession | null = readSiteGateSession()): string {
  if (!session) return 'Not signed in'
  const duration = isSiteGateSessionDuration(session.duration)
    ? session.duration
    : 'never'

  if (duration === 'never' || session.expiresAt == null) {
    return 'Never expires (until you log out or clear browser data)'
  }
  const expires = new Date(session.expiresAt)
  if (Number.isNaN(expires.getTime())) return 'Unknown'
  if (expires.getTime() <= Date.now()) return 'Expired — log in again'
  return `Expires ${expires.toLocaleString()}`
}

export function isSiteGateUnlocked(): boolean {
  const session = readSiteGateSession()
  const creds = readLocalSiteGateCredentials()
  if (!session || !creds) return false
  if (session.username.trim().toLowerCase() !== creds.username.trim().toLowerCase()) return false

  // Pre–session-timeout unlocks had no expiry. Force a fresh login under the new policy
  // (default 1 day) instead of silently keeping forever access.
  if (session.expiresAt === undefined && session.duration == null) {
    clearSiteGateSession()
    return false
  }
  if (session.expiresAt == null) return true

  const expiresMs = Date.parse(session.expiresAt)
  if (Number.isNaN(expiresMs)) {
    clearSiteGateSession()
    return false
  }
  if (Date.now() >= expiresMs) {
    clearSiteGateSession()
    return false
  }
  return true
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
  duration: SiteGateSessionDuration = DEFAULT_SITE_GATE_SESSION_DURATION,
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
  writeSiteGateSession(name, duration)
  return creds
}

export async function verifySiteGateLogin(
  username: string,
  password: string,
  duration: SiteGateSessionDuration = DEFAULT_SITE_GATE_SESSION_DURATION,
): Promise<boolean> {
  const creds = await loadSiteGateCredentials()
  if (!creds) return false
  if (creds.username.trim().toLowerCase() !== username.trim().toLowerCase()) return false
  const hash = await hashSiteGatePassword(password, creds.salt)
  if (hash !== creds.passwordHash) return false
  writeLocalSiteGateCredentials(creds)
  writeSiteGateSession(creds.username, duration)
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
  writeSiteGateSession(newUsername, getActiveSiteGateSessionDuration())
}

export function logoutSiteGate(): void {
  clearSiteGateSession()
}
