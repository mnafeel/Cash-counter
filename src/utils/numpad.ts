export type NumpadAction = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'backspace' | 'clear'

export function applyNumpadAction(current: string, action: NumpadAction): string {
  if (action === 'backspace') return current.slice(0, -1)
  if (action === 'clear') return ''

  if (action === '.') {
    if (current.includes('.')) return current
    return current === '' ? '0.' : `${current}.`
  }

  if (current === '0') return action
  return current + action
}
