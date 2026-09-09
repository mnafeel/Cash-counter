import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore'
import {
  authEmailToUsername,
  normalizeUsernameKey,
  usernameToAuthEmail,
  validateCloudUsername,
} from './cloudUser'
import { getFirebaseDb } from './config'

type UsernameRecord = {
  uid: string
  authEmail?: string
  retired?: boolean
  replacedBy?: string
  retiredAt?: Timestamp
}

export type CloudAccountHistoryKind = 'username' | 'password' | 'pin'

export type CloudAccountHistoryEntry = {
  id: string
  kind: CloudAccountHistoryKind
  changedAt: string
  fromUsername?: string
  toUsername?: string
}

/** @deprecated Use CloudAccountHistoryEntry */
export type CloudUsernameHistoryEntry = CloudAccountHistoryEntry

function usernameDocRef(key: string) {
  return doc(getFirebaseDb(), 'cloudUsernames', key)
}

function profileDocRef(uid: string) {
  return doc(getFirebaseDb(), 'users', uid, 'profile', 'account')
}

function accountHistoryCollection(uid: string) {
  return collection(getFirebaseDb(), 'users', uid, 'accountHistory')
}

function legacyUsernameHistoryCollection(uid: string) {
  return collection(getFirebaseDb(), 'users', uid, 'usernameHistory')
}

function isActiveUsernameRecord(data: UsernameRecord, uid: string): boolean {
  return !data.retired && Boolean(data.authEmail) && data.uid === uid
}

export async function resolveAuthEmailForUsername(username: string): Promise<string> {
  const key = validateCloudUsername(username)
  const snap = await getDoc(usernameDocRef(key))
  if (snap.exists()) {
    const data = snap.data() as UsernameRecord
    if (data.retired) {
      throw new Error('This username is no longer active. Sign in with your current username.')
    }
    if (data.authEmail) return data.authEmail
  }
  return usernameToAuthEmail(key)
}

export async function registerCloudUsername(
  uid: string,
  username: string,
  authEmail: string,
): Promise<void> {
  const key = validateCloudUsername(username)
  const existing = await getDoc(usernameDocRef(key))
  if (existing.exists()) {
    const data = existing.data() as UsernameRecord
    if (data.retired) {
      throw new Error('Username is not available.')
    }
    if (data.uid !== uid) {
      throw new Error('Username is already in use.')
    }
  }
  await setDoc(usernameDocRef(key), { uid, authEmail, updatedAt: serverTimestamp() })
  await setDoc(profileDocRef(uid), { username: key }, { merge: true })
}

export async function ensureCloudUsernameRegistered(uid: string, authEmail: string): Promise<string> {
  const fallbackKey = normalizeUsernameKey(authEmailToUsername(authEmail))
  const profileSnap = await getDoc(profileDocRef(uid))
  const profileUsername = profileSnap.exists()
    ? (profileSnap.data() as { username?: string }).username
    : undefined
  const key = profileUsername ? normalizeUsernameKey(profileUsername) : fallbackKey

  const mappingSnap = await getDoc(usernameDocRef(key))
  if (!mappingSnap.exists()) {
    await registerCloudUsername(uid, key, authEmail)
    return key
  }

  const record = mappingSnap.data() as UsernameRecord
  if (record.retired) {
    await registerCloudUsername(uid, key, authEmail)
    return key
  }

  if (record.uid === uid && record.authEmail !== authEmail) {
    await setDoc(usernameDocRef(key), { uid, authEmail, updatedAt: serverTimestamp() }, { merge: true })
  }

  await setDoc(profileDocRef(uid), { username: key }, { merge: true })
  return key
}

export async function changeCloudUsername(
  uid: string,
  currentUsernameKey: string,
  newUsername: string,
  authEmail: string,
): Promise<string> {
  const newKey = validateCloudUsername(newUsername)
  const oldKey = normalizeUsernameKey(currentUsernameKey)

  if (newKey === oldKey) return newKey

  const newRef = usernameDocRef(newKey)
  const oldRef = usernameDocRef(oldKey)
  const profileRef = profileDocRef(uid)
  const historyRef = doc(accountHistoryCollection(uid))

  await runTransaction(getFirebaseDb(), async (tx) => {
    const newSnap = await tx.get(newRef)
    const oldSnap = oldKey !== newKey ? await tx.get(oldRef) : null

    if (newSnap.exists()) {
      const newData = newSnap.data() as UsernameRecord
      if (newData.retired) {
        if (newData.uid !== uid) {
          throw new Error('Username is not available.')
        }
      } else if (newData.uid !== uid) {
        throw new Error('Username is already in use.')
      }
    }

    tx.set(newRef, { uid, authEmail, updatedAt: serverTimestamp() })
    tx.set(
      profileRef,
      { username: newKey, usernameUpdatedAt: serverTimestamp() },
      { merge: true },
    )
    tx.set(historyRef, {
      kind: 'username',
      fromUsername: oldKey,
      toUsername: newKey,
      changedAt: serverTimestamp(),
    })

    if (oldSnap?.exists() && (oldSnap.data() as UsernameRecord).uid === uid) {
      tx.set(oldRef, {
        uid,
        retired: true,
        replacedBy: newKey,
        retiredAt: serverTimestamp(),
      })
    }
  })

  return newKey
}

export async function fetchCloudUsername(uid: string): Promise<string | null> {
  const snap = await getDoc(profileDocRef(uid))
  if (!snap.exists()) return null
  const username = (snap.data() as { username?: string }).username
  return username ? normalizeUsernameKey(username) : null
}

export async function recordCloudPasswordChange(uid: string): Promise<void> {
  const historyRef = doc(accountHistoryCollection(uid))
  await setDoc(historyRef, {
    kind: 'password',
    changedAt: serverTimestamp(),
  })
  await setDoc(profileDocRef(uid), { passwordUpdatedAt: serverTimestamp() }, { merge: true })
}

export async function recordCloudPinChange(uid: string): Promise<void> {
  const historyRef = doc(accountHistoryCollection(uid))
  await setDoc(historyRef, {
    kind: 'pin',
    changedAt: serverTimestamp(),
  })
  await setDoc(profileDocRef(uid), { pinUpdatedAt: serverTimestamp() }, { merge: true })
}

function mapHistoryDoc(
  id: string,
  data: {
    kind?: CloudAccountHistoryKind
    fromUsername?: string
    toUsername?: string
    changedAt?: Timestamp
  },
  defaultKind: CloudAccountHistoryKind = 'username',
): CloudAccountHistoryEntry {
  const changedAt = data.changedAt?.toDate?.()
  return {
    id,
    kind: data.kind ?? defaultKind,
    fromUsername: data.fromUsername,
    toUsername: data.toUsername,
    changedAt: changedAt ? changedAt.toISOString() : '',
  }
}

export async function fetchCloudAccountHistory(
  uid: string,
  maxEntries = 30,
): Promise<CloudAccountHistoryEntry[]> {
  const [accountSnap, legacySnap] = await Promise.all([
    getDocs(
      query(accountHistoryCollection(uid), orderBy('changedAt', 'desc'), limit(maxEntries)),
    ),
    getDocs(
      query(legacyUsernameHistoryCollection(uid), orderBy('changedAt', 'desc'), limit(maxEntries)),
    ),
  ])

  const merged = new Map<string, CloudAccountHistoryEntry>()
  for (const entry of accountSnap.docs) {
    merged.set(entry.id, mapHistoryDoc(entry.id, entry.data() as Record<string, unknown> as {
      kind?: CloudAccountHistoryKind
      fromUsername?: string
      toUsername?: string
      changedAt?: Timestamp
    }))
  }
  for (const entry of legacySnap.docs) {
    const mapped = mapHistoryDoc(`legacy-${entry.id}`, entry.data() as {
      fromUsername?: string
      toUsername?: string
      changedAt?: Timestamp
    })
    if (!merged.has(mapped.id)) merged.set(mapped.id, mapped)
  }

  return [...merged.values()]
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .slice(0, maxEntries)
}

/** @deprecated Use fetchCloudAccountHistory */
export async function fetchCloudUsernameHistory(
  uid: string,
  maxEntries = 20,
): Promise<CloudAccountHistoryEntry[]> {
  return fetchCloudAccountHistory(uid, maxEntries)
}

export async function removeCloudUsernameMapping(uid: string): Promise<void> {
  const username = await fetchCloudUsername(uid)
  if (!username) return
  const snap = await getDoc(usernameDocRef(username))
  if (snap.exists() && isActiveUsernameRecord(snap.data() as UsernameRecord, uid)) {
    await deleteDoc(usernameDocRef(username))
  }
}
