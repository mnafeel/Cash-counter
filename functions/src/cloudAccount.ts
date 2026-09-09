import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const CLOUD_DOMAIN = '@cash-counter.sof'

function usernameToAuthEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '')
  if (!clean) throw new HttpsError('invalid-argument', 'Username is required.')
  if (!/^[a-z0-9._-]{3,32}$/.test(clean)) {
    throw new HttpsError('invalid-argument', 'Username: 3–32 letters, numbers, . _ - only.')
  }
  return `${clean}${CLOUD_DOMAIN}`
}

type UpdateCloudAccountRequest = {
  newUsername?: string
  newPassword?: string
}

/**
 * Updates cloud username (auth email) and/or password via Admin SDK.
 * Client must reauthenticate before calling (recent sign-in).
 */
export const updateCloudAccount = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to cloud first.')
  }

  const data = (request.data ?? {}) as UpdateCloudAccountRequest
  const newUsername = typeof data.newUsername === 'string' ? data.newUsername.trim() : ''
  const newPassword = typeof data.newPassword === 'string' ? data.newPassword : ''

  const wantsUsername = newUsername.length > 0
  const wantsPassword = newPassword.length > 0

  if (!wantsUsername && !wantsPassword) {
    throw new HttpsError('invalid-argument', 'Nothing to update.')
  }

  if (wantsPassword && newPassword.length < 6) {
    throw new HttpsError('invalid-argument', 'New password must be at least 6 characters.')
  }

  const auth = getAuth()
  const user = await auth.getUser(uid)
  const updates: { email?: string; password?: string; emailVerified?: boolean } = {}

  if (wantsUsername) {
    const nextEmail = usernameToAuthEmail(newUsername)
    if (nextEmail !== user.email) {
      try {
        const existing = await auth.getUserByEmail(nextEmail)
        if (existing.uid !== uid) {
          throw new HttpsError('already-exists', 'Username is already in use.')
        }
      } catch (err: unknown) {
        const code =
          err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
        if (code !== 'auth/user-not-found') {
          if (err instanceof HttpsError) throw err
          throw new HttpsError('internal', 'Could not verify username availability.')
        }
      }
      updates.email = nextEmail
      updates.emailVerified = true
    }
  }

  if (wantsPassword) {
    updates.password = newPassword
  }

  if (!updates.email && !updates.password) {
    return { ok: true, unchanged: true }
  }

  await auth.updateUser(uid, updates)
  return { ok: true, username: wantsUsername ? newUsername.toLowerCase() : undefined }
})
