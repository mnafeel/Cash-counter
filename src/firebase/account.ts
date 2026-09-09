import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from './config'
import {
  authEmailToUsername,
  normalizeUsernameKey,
  saveLastCloudUsername,
} from './cloudUser'
import {
  changeCloudUsername,
  fetchCloudUsername,
  recordCloudPasswordChange,
} from './cloudUsernameRegistry'
import { formatFirebaseError } from './utils'

async function reauthenticateCurrentUser(currentPassword: string) {
  const user = getFirebaseAuth().currentUser
  if (!user?.email) throw new Error('Sign in to cloud first.')
  const cred = EmailAuthProvider.credential(user.email, currentPassword)
  await reauthenticateWithCredential(user, cred)
  return user
}

export async function updateCloudPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.')
  if (newPassword.length < 6) throw new Error('New password must be at least 6 characters.')
  try {
    const user = await reauthenticateCurrentUser(currentPassword)
    await updatePassword(user, newPassword)
    await recordCloudPasswordChange(user.uid)
  } catch (err) {
    throw new Error(formatFirebaseError(err, 'password'))
  }
}

export async function verifyCloudPassword(password: string): Promise<void> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.')
  try {
    await reauthenticateCurrentUser(password)
  } catch (err) {
    throw new Error(formatFirebaseError(err))
  }
}

export async function updateCloudUsername(
  currentPassword: string,
  newUsername: string,
): Promise<string> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.')
  const user = getFirebaseAuth().currentUser
  if (!user?.email) throw new Error('Sign in to cloud first.')

  try {
    await reauthenticateCurrentUser(currentPassword)
    const currentKey =
      (await fetchCloudUsername(user.uid)) ??
      normalizeUsernameKey(authEmailToUsername(user.email))
    const nextKey = await changeCloudUsername(user.uid, currentKey, newUsername, user.email)
    saveLastCloudUsername(nextKey)
    return nextKey
  } catch (err) {
    throw new Error(formatFirebaseError(err, 'username'))
  }
}
