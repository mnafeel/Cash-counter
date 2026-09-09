import type { AppData } from '../types'
import { normalizePin } from './numpad'

const DEFAULT_PIN = '0000'

/** PIN for reports, purchase, loan, staff, and settings. Falls back to dashboard PIN. */
export function getAccessPin(data: AppData): string {
  return normalizePin(data.accessPin ?? data.homePin, DEFAULT_PIN)
}
