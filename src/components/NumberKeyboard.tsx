import type { ReactNode } from 'react'
import NumPad from './NumPad'
import type { NumpadAction } from '../utils/numpad'
import './NumberKeyboard.css'

interface NumberKeyboardProps {
  onPress: (action: NumpadAction) => void
  footer?: ReactNode
  showEnter?: boolean
  hint?: string
  variant?: 'default' | 'pin'
}

export default function NumberKeyboard({
  onPress,
  footer,
  showEnter = true,
  hint,
  variant = 'default',
}: NumberKeyboardProps) {
  return (
    <div className={`number-keyboard ${variant === 'pin' ? 'number-keyboard--pin' : ''}`}>
      {hint ? <span className="number-keyboard-hint">{hint}</span> : null}
      <span className="number-keyboard-label">Number keyboard</span>
      <NumPad onPress={onPress} showEnter={showEnter} variant={variant} />
      {footer ? <div className="number-keyboard-footer">{footer}</div> : null}
    </div>
  )
}
