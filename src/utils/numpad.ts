export type NumpadAction =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '.'
  | 'backspace'
  | 'clear'
  | 'enter'

export function applyNumpadAction(current: string, action: NumpadAction): string {
  if (action === 'backspace') return current.slice(0, -1)
  if (action === 'clear') return ''

  if (action === '.') {
    if (current.includes('.')) return current
    return current === '' ? '0.' : `${current}.`
  }

  if (action === 'enter') return current

  if (current === '0') return action
  return current + action
}

export type PinLength = 4 | 6

export function resolvePinLength(value: unknown): PinLength {
  return value === 6 ? 6 : 4
}

/** PIN entry — allows leading zeros. Default max 4 digits. */
export function applyPinAction(
  current: string,
  action: NumpadAction,
  maxLength: PinLength = 4,
): string {
  if (action === 'backspace') return current.slice(0, -1)
  if (action === 'clear') return ''
  if (action === 'enter' || action === '.') return current
  if (!/^\d$/.test(action)) return current
  if (current.length >= maxLength) return current
  return current + action
}

export function normalizePin(
  pin: unknown,
  fallback = '0000',
  maxLength: PinLength = 4,
): string {
  if (pin == null || pin === '') return fallback.slice(0, maxLength)
  const digits = String(pin).replace(/\D/g, '')
  const trimmed = digits.length > 0 ? digits.slice(0, maxLength) : fallback
  return trimmed.slice(0, maxLength)
}
