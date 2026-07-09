import type { FirebaseOptions } from 'firebase/app'
import { DEFAULT_FIREBASE_CONFIG } from './embeddedConfig'

const STORAGE_KEY = 'cash-counter-firebase-keys'

export interface StoredFirebaseKeys {
  apiKey: string
  appId: string
}

export function loadStoredFirebaseKeys(): StoredFirebaseKeys | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFirebaseKeys>
    if (!parsed.apiKey || !parsed.appId) return null
    return { apiKey: parsed.apiKey, appId: parsed.appId }
  } catch {
    return null
  }
}

export function saveStoredFirebaseKeys(keys: StoredFirebaseKeys): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
}

export function buildFirebaseConfig(keys: StoredFirebaseKeys): FirebaseOptions {
  return { ...DEFAULT_FIREBASE_CONFIG, apiKey: keys.apiKey, appId: keys.appId }
}
