import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import type { AppData } from '../types'
import { loadData, normalizeData } from '../storage/database'
import { getCloudUser, requireCloudUser } from '../firebase/backup'
import { getFirebaseDb, isFirebaseConfigured } from '../firebase/config'
import { formatFirebaseError, stripUndefined } from '../firebase/utils'
import {
  buildWebsiteExportPayload,
  buildWebsiteExportQuickStats,
  websiteExportFingerprint,
  type WebsiteExportPayload,
  type WebsiteExportQuickStats,
} from './websiteExport'
import { DEFAULT_FIREBASE_CONFIG } from '../firebase/embeddedConfig'

const ENABLED_KEY = 'cash-counter-website-api-enabled'
const KEY_VALUE_KEY = 'cash-counter-website-api-key'
const KEY_HASH_KEY = 'cash-counter-website-api-key-hash'
const LAST_PUSH_KEY = 'cash-counter-website-api-last-push'
const LAST_FP_KEY = 'cash-counter-website-api-last-fp'
const LAST_TOTALS_KEY = 'cash-counter-website-api-last-totals'

const AUTO_PUSH_DEBOUNCE_MS = 1200

export interface WebsiteApiStatus {
  enabled: boolean
  hasKey: boolean
  apiKey: string | null
  keyHash: string | null
  lastPushedAt: string | null
  storeId: string | null
  connected: boolean
  autoSync: boolean
  lastTotals: WebsiteExportQuickStats | null
}

export interface WebsiteApiPushTotals {
  salesCount: number
  customerCount: number
  cashVisitCount: number
  bankVisitCount: number
  cash: number
  bank: number
}

type StatusListener = (status: WebsiteApiStatus) => void

const statusListeners = new Set<StatusListener>()

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let idleHandle: number | null = null
let pendingData: AppData | null = null
let pushing = false
let pushAgain: AppData | null = null

function notifyStatusListeners(): void {
  if (statusListeners.size === 0) return
  const status = getWebsiteApiStatus()
  for (const listener of statusListeners) {
    try {
      listener(status)
    } catch {
      /* ignore UI listener errors */
    }
  }
}

export function subscribeWebsiteApiStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  listener(getWebsiteApiStatus())
  return () => {
    statusListeners.delete(listener)
  }
}

function configDocRef(uid: string) {
  return doc(getFirebaseDb(), 'users', uid, 'websiteApi', 'config')
}

function exportDocRef(uid: string) {
  return doc(getFirebaseDb(), 'users', uid, 'websiteApi', 'export')
}

function apiKeyDocRef(keyHash: string) {
  return doc(getFirebaseDb(), 'apiKeys', keyHash)
}

/** Public read-by-hash export (works on Spark; no Cloud Functions required). */
function publicExportDocRef(keyHash: string) {
  return doc(getFirebaseDb(), 'websiteApiExports', keyHash)
}

export function isWebsiteApiEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true'
  } catch {
    return false
  }
}

export function setWebsiteApiEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
  notifyStatusListeners()
}

export function getStoredWebsiteApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_VALUE_KEY)
  } catch {
    return null
  }
}

function setStoredWebsiteApiKey(key: string | null): void {
  if (!key) {
    localStorage.removeItem(KEY_VALUE_KEY)
    localStorage.removeItem(KEY_HASH_KEY)
    return
  }
  localStorage.setItem(KEY_VALUE_KEY, key)
}

function getCachedKeyHash(): string | null {
  try {
    return localStorage.getItem(KEY_HASH_KEY)
  } catch {
    return null
  }
}

function setCachedKeyHash(hash: string | null): void {
  if (!hash) {
    localStorage.removeItem(KEY_HASH_KEY)
    return
  }
  localStorage.setItem(KEY_HASH_KEY, hash)
}

export function getWebsiteApiLastPushedAt(): string | null {
  try {
    return localStorage.getItem(LAST_PUSH_KEY)
  } catch {
    return null
  }
}

function setWebsiteApiLastPushedAt(iso: string): void {
  localStorage.setItem(LAST_PUSH_KEY, iso)
}

function getLastFingerprint(): string | null {
  try {
    return localStorage.getItem(LAST_FP_KEY)
  } catch {
    return null
  }
}

function setLastFingerprint(fp: string): void {
  localStorage.setItem(LAST_FP_KEY, fp)
}

function getLastTotals(): WebsiteExportQuickStats | null {
  try {
    const raw = localStorage.getItem(LAST_TOTALS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as WebsiteExportQuickStats
  } catch {
    return null
  }
}

function setLastTotals(totals: WebsiteApiPushTotals): void {
  localStorage.setItem(
    LAST_TOTALS_KEY,
    JSON.stringify({
      salesCount: totals.salesCount,
      customerCount: totals.customerCount,
      expenseCount: 0,
    } satisfies WebsiteExportQuickStats),
  )
}

export function getWebsiteApiStatus(): WebsiteApiStatus {
  const key = getStoredWebsiteApiKey()
  const enabled = isWebsiteApiEnabled()
  const storeId = getCloudUser()?.uid ?? null
  return {
    enabled,
    hasKey: Boolean(key),
    apiKey: key,
    keyHash: getCachedKeyHash(),
    lastPushedAt: getWebsiteApiLastPushedAt(),
    storeId,
    connected: Boolean(enabled && key && storeId),
    autoSync: Boolean(enabled && key),
    lastTotals: getLastTotals(),
  }
}

/** Random API key for the external website (`cc_` + 32 hex). */
export function generateWebsiteApiKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `cc_${hex}`
}

export async function hashWebsiteApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey.trim())
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function resolveKeyHash(apiKey: string): Promise<string> {
  const cached = getCachedKeyHash()
  if (cached) return cached
  const hash = await hashWebsiteApiKey(apiKey)
  setCachedKeyHash(hash)
  return hash
}

/**
 * Create/replace API key in cloud + local storage.
 * Requires cloud login. Returns the plaintext key (show/copy once from Settings).
 */
export async function registerWebsiteApiKey(apiKey = generateWebsiteApiKey()): Promise<string> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.')
  const user = requireCloudUser()
  const key = apiKey.trim()
  if (!key.startsWith('cc_') || key.length < 20) {
    throw new Error('Invalid API key format.')
  }

  const keyHash = await hashWebsiteApiKey(key)
  const previous = getStoredWebsiteApiKey()

  try {
    await Promise.all([
      setDoc(configDocRef(user.uid), {
        enabled: true,
        keyHash,
        updatedAt: new Date().toISOString(),
        uid: user.uid,
      }),
      setDoc(apiKeyDocRef(keyHash), {
        uid: user.uid,
        createdAt: new Date().toISOString(),
      }),
    ])

    if (previous && previous !== key) {
      const oldHash = await hashWebsiteApiKey(previous)
      if (oldHash !== keyHash) {
        await Promise.all([
          deleteDoc(apiKeyDocRef(oldHash)).catch(() => undefined),
          deleteDoc(publicExportDocRef(oldHash)).catch(() => undefined),
        ])
      }
    }
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }

  setWebsiteApiEnabled(true)
  setStoredWebsiteApiKey(key)
  setCachedKeyHash(keyHash)
  notifyStatusListeners()
  return key
}

export async function disableWebsiteApi(): Promise<void> {
  setWebsiteApiEnabled(false)
  const user = getCloudUser()
  const key = getStoredWebsiteApiKey()
  if (!user || !isFirebaseConfigured()) {
    notifyStatusListeners()
    return
  }

  try {
    const writes: Promise<unknown>[] = [
      setDoc(
        configDocRef(user.uid),
        {
          enabled: false,
          updatedAt: new Date().toISOString(),
          uid: user.uid,
        },
        { merge: true },
      ),
    ]
    if (key) {
      const keyHash = await resolveKeyHash(key)
      writes.push(
        deleteDoc(apiKeyDocRef(keyHash)).catch(() => undefined),
        deleteDoc(publicExportDocRef(keyHash)).catch(() => undefined),
      )
    }
    await Promise.all(writes)
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
  notifyStatusListeners()
}

/** Instant Settings summary — no ledger / activity rebuild. */
export function getWebsiteExportQuickStats(data?: AppData): WebsiteExportQuickStats {
  return buildWebsiteExportQuickStats(data ?? loadData())
}

/** Build current payload without uploading. Heavy — call only on demand (download). */
export function previewWebsiteExport(data?: AppData): WebsiteExportPayload {
  const user = getCloudUser()
  const storeId = user?.uid ?? 'local'
  return buildWebsiteExportPayload(normalizeData(data ?? loadData()), storeId)
}

function canAutoPush(): boolean {
  return (
    isWebsiteApiEnabled() &&
    Boolean(getStoredWebsiteApiKey()) &&
    Boolean(getCloudUser()) &&
    isFirebaseConfigured()
  )
}

/** Publish sales / customers / cash & bank visits for the website API. */
export async function pushWebsiteExport(
  source?: AppData,
  options?: { force?: boolean },
): Promise<string> {
  if (!isWebsiteApiEnabled()) {
    throw new Error('Website API is turned off. Enable it in Settings.')
  }
  if (!getStoredWebsiteApiKey()) {
    throw new Error('Generate an API key first.')
  }
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.')

  const user = requireCloudUser()
  const apiKey = getStoredWebsiteApiKey()
  if (!apiKey) throw new Error('Generate an API key first.')

  const data = normalizeData(source ?? loadData())
  const fingerprint = websiteExportFingerprint(data)
  if (!options?.force && fingerprint === getLastFingerprint() && getWebsiteApiLastPushedAt()) {
    return getWebsiteApiLastPushedAt()!
  }

  const exportedAt = new Date().toISOString()
  const payload = buildWebsiteExportPayload(data, user.uid, exportedAt)
  const keyHash = await resolveKeyHash(apiKey)
  const body = JSON.stringify(payload)

  try {
    await Promise.all([
      setDoc(exportDocRef(user.uid), {
        ...stripUndefined(payload),
        _updatedAt: exportedAt,
      }),
      setDoc(publicExportDocRef(keyHash), {
        body,
        exportedAt,
        storeId: user.uid,
        enabled: true,
      }),
      setDoc(
        configDocRef(user.uid),
        {
          enabled: true,
          lastExportAt: exportedAt,
          uid: user.uid,
          keyHash,
        },
        { merge: true },
      ),
    ])
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }

  setWebsiteApiLastPushedAt(exportedAt)
  setLastFingerprint(fingerprint)
  setLastTotals(payload.totals)
  notifyStatusListeners()
  return exportedAt
}

async function runScheduledPush(data: AppData): Promise<void> {
  if (!canAutoPush()) return
  if (pushing) {
    pushAgain = data
    return
  }
  pushing = true
  try {
    await pushWebsiteExport(data)
  } catch {
    /* auto-push is best-effort — never block the app */
  } finally {
    pushing = false
    if (pushAgain) {
      const again = pushAgain
      pushAgain = null
      scheduleWebsiteApiExport(again)
    }
  }
}

function cancelIdleCallbackSafe(handle: number): void {
  const cancel = (window as Window & { cancelIdleCallback?: (id: number) => void })
    .cancelIdleCallback
  if (typeof cancel === 'function') cancel(handle)
  else clearTimeout(handle)
}

function requestIdleCallbackSafe(cb: () => void, timeout: number): number {
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (typeof ric === 'function') return ric(cb, { timeout })
  return window.setTimeout(cb, 0) as unknown as number
}

/**
 * Debounced + idle auto-publish after local data changes.
 * Never blocks UI; skips if API off / not signed in / unchanged fingerprint.
 */
export function scheduleWebsiteApiExport(data: AppData): void {
  if (!canAutoPush()) return
  pendingData = data
  if (debounceTimer) clearTimeout(debounceTimer)
  if (idleHandle != null) {
    cancelIdleCallbackSafe(idleHandle)
    idleHandle = null
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const toPush = pendingData
    pendingData = null
    if (!toPush) return
    idleHandle = requestIdleCallbackSafe(() => {
      idleHandle = null
      void runScheduledPush(toPush)
    }, 2500)
  }, AUTO_PUSH_DEBOUNCE_MS)
}

/** After a successful cloud backup, refresh website export when API is on. */
export async function pushWebsiteExportAfterBackup(source?: AppData): Promise<void> {
  if (!canAutoPush()) return
  try {
    await pushWebsiteExport(source)
  } catch {
    /* backup already succeeded — website push is best-effort */
  }
}

export async function fetchWebsiteExportMeta(): Promise<{
  enabled: boolean
  lastExportAt: string | null
} | null> {
  const user = getCloudUser()
  if (!user || !isFirebaseConfigured()) return null
  try {
    const snap = await getDoc(configDocRef(user.uid))
    if (!snap.exists()) return { enabled: false, lastExportAt: null }
    const raw = snap.data() as { enabled?: boolean; lastExportAt?: string }
    return {
      enabled: raw.enabled === true,
      lastExportAt: raw.lastExportAt ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Cloud Function URL (requires Blaze plan).
 * Prefer getWebsiteApiFirestoreUrl until Functions are deployed.
 */
export function getWebsiteApiEndpointUrl(): string {
  const projectId = DEFAULT_FIREBASE_CONFIG.projectId || 'cash-counter-84178'
  return `https://us-central1-${projectId}.cloudfunctions.net/getWebsiteData`
}

/** Firestore REST URL for a published export (works on Spark). */
export function getWebsiteApiFirestoreUrl(keyHash: string): string {
  const projectId = DEFAULT_FIREBASE_CONFIG.projectId || 'cash-counter-84178'
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/websiteApiExports/${keyHash}`
}

export function getWebsiteApiBlazeUpgradeUrl(): string {
  const projectId = DEFAULT_FIREBASE_CONFIG.projectId || 'cash-counter-84178'
  return `https://console.firebase.google.com/project/${projectId}/usage/details`
}

export function buildWebsiteApiCurlExample(apiKey: string): string {
  const url = getWebsiteApiEndpointUrl()
  return `curl -sS -H "Authorization: Bearer ${apiKey}" "${url}"`
}

/** Fetch helper for Spark Firestore export (parses `body` JSON string). */
export function buildWebsiteApiFirestoreFetchExample(keyHash: string): string {
  const url = getWebsiteApiFirestoreUrl(keyHash)
  return [
    `const res = await fetch(${JSON.stringify(url)})`,
    `const doc = await res.json()`,
    `const data = JSON.parse(doc.fields.body.stringValue)`,
  ].join('\n')
}
