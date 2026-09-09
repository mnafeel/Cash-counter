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

export function formatFirebaseError(
  err: unknown,
  context?: 'username' | 'password',
): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code)
    const message =
      'message' in err && typeof (err as { message: string }).message === 'string'
        ? (err as { message: string }).message
        : ''

    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      return 'Wrong current password.'
    }
    if (code === 'auth/email-already-in-use') return 'Username is already in use.'
    if (code === 'auth/weak-password') return 'Password must be at least 6 characters.'
    if (code === 'auth/invalid-email') return 'Invalid username format.'
    if (code === 'auth/requires-recent-login') {
      return 'Session expired. Sign out, sign in again, then retry.'
    }
    if (code === 'auth/operation-not-allowed') {
      if (context === 'password') {
        return 'Password change is not allowed for this account. Sign out and sign in again, then retry.'
      }
      if (context === 'username') {
        return 'Could not change username. Check your connection and try again.'
      }
      return 'This account action is not allowed. Check Firebase Authentication settings.'
    }
    if (code === 'permission-denied' && context === 'username') {
      return 'Could not save username. Publish the latest Firestore rules and try again.'
    }
    if (code.startsWith('functions/')) {
      if (code === 'functions/unauthenticated') return 'Sign in to cloud first.'
      if (code === 'functions/already-exists') return 'Username is already in use.'
      if ('message' in err && typeof (err as { message: string }).message === 'string') {
        if (message && message !== code) return message
      }
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
