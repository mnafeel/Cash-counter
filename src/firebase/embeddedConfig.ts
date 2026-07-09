import type { FirebaseOptions } from 'firebase/app'
import { loadStoredFirebaseKeys } from './storeConfig'

/** Shalimar Fashions · cash-counter-84178 (public web config — safe in client app). */
export const DEFAULT_FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: 'AIzaSyBr8hk5x8XxY2rnUWPK5JLuoXa_vqKChdE',
  authDomain: 'cash-counter-84178.firebaseapp.com',
  projectId: 'cash-counter-84178',
  storageBucket: 'cash-counter-84178.firebasestorage.app',
  messagingSenderId: '342329557749',
  appId: '1:342329557749:web:8c268276625d977ec4fbbc',
}

function configFromEnv(): FirebaseOptions | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined
  if (!apiKey || !appId) return null

  return {
    apiKey,
    appId,
    authDomain:
      (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ||
      DEFAULT_FIREBASE_CONFIG.authDomain,
    projectId:
      (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ||
      DEFAULT_FIREBASE_CONFIG.projectId,
    storageBucket:
      (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ||
      DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId:
      (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ||
      DEFAULT_FIREBASE_CONFIG.messagingSenderId,
  }
}

function configFromStorage(): FirebaseOptions | null {
  const stored = loadStoredFirebaseKeys()
  if (!stored) return null
  return { ...DEFAULT_FIREBASE_CONFIG, apiKey: stored.apiKey, appId: stored.appId }
}

/** Env → saved keys → built-in project config. */
export function getFirebaseConfig(): FirebaseOptions {
  return configFromEnv() ?? configFromStorage() ?? DEFAULT_FIREBASE_CONFIG
}

export function isFirebaseConfigAvailable(): boolean {
  const config = getFirebaseConfig()
  return Boolean(config.apiKey && config.appId)
}
