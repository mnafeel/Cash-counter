/** Remove undefined values — Firestore rejects them. */
export function stripUndefined<T>(value: T): T {
  if (value === undefined || value === null) return value
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) out[key] = stripUndefined(val)
    }
    return out as T
  }
  return value
}

export function formatFirebaseError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code)
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      return 'Wrong email or password.'
    }
    if (code === 'auth/email-already-in-use') return 'Email already in use — try Sign in.'
    if (code === 'auth/weak-password') return 'Password must be at least 6 characters.'
    if (code === 'auth/invalid-email') return 'Invalid email address.'
    if (code === 'auth/operation-not-allowed') {
      return 'Enable Email/Password in Firebase Console → Authentication → Sign-in method.'
    }
    if (code === 'permission-denied') {
      return 'Firestore permission denied — publish rules from firebase/firestore.rules.'
    }
    if (code === 'unavailable') return 'Firebase is offline. Check internet connection.'
    if ('message' in err && typeof (err as { message: string }).message === 'string') {
      return (err as { message: string }).message
    }
    return code
  }
  if (err instanceof Error) return err.message
  return 'Backup failed'
}
