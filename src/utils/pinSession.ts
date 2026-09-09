/** How long PIN access lasts without user activity before auto-lock. */
export const PIN_SESSION_MS = 2 * 60 * 1000

export function formatPinSessionRemaining(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000))
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
