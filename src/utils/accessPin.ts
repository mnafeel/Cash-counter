import type { AppData } from '../types'
import { normalizePin, resolvePinLength, type PinLength } from './numpad'

const DEFAULT_PIN = '0000'

function storedPinDigits(data: AppData): string {
  const digits = String(data.homePin ?? '').replace(/\D/g, '')
  return digits || DEFAULT_PIN
}

/** App security PIN (synced with cloud backup per user). */
export function getUserPin(data: AppData): string {
  return normalizePin(data.homePin, DEFAULT_PIN, getPinLength(data))
}

export function getPinLength(data: AppData): PinLength {
  return resolvePinLength(data.pinLength)
}

/** How many digits the PIN pad should accept (handles mid-change 4↔6 transitions). */
export function getPinEntryLength(data: AppData): PinLength {
  const configured = getPinLength(data)
  const storedLen = storedPinDigits(data).length
  if (storedLen > 0 && storedLen !== configured) {
    return storedLen >= 6 ? 6 : 4
  }
  return configured
}

/** Verify entered PIN against stored value during length transitions. */
export function verifyUserPin(data: AppData, entered: string): boolean {
  const enteredDigits = entered.replace(/\D/g, '')
  if (!enteredDigits) return false

  const stored = storedPinDigits(data)
  const configured = getPinLength(data)
  const normalizedStored = normalizePin(stored, DEFAULT_PIN, configured)
  const normalizedEntered = normalizePin(enteredDigits, '', configured)

  if (enteredDigits === stored) return true
  if (normalizedEntered === normalizedStored) return true
  if (enteredDigits === normalizedStored) return true

  return false
}
