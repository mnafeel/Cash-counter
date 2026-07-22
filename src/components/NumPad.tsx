import type { NumpadAction } from '../utils/numpad'
import './NumPad.css'

const KEYS: { action: NumpadAction; label: string }[] = [
  { action: '7', label: '7' },
  { action: '8', label: '8' },
  { action: '9', label: '9' },
  { action: '4', label: '4' },
  { action: '5', label: '5' },
  { action: '6', label: '6' },
  { action: '1', label: '1' },
  { action: '2', label: '2' },
  { action: '3', label: '3' },
  { action: 'clear', label: 'C' },
  { action: '0', label: '0' },
  { action: '.', label: '.' },
]

interface NumPadProps {
  onPress: (action: NumpadAction) => void
  showEnter?: boolean
  variant?: 'default' | 'pin'
}

export default function NumPad({ onPress, showEnter = true, variant = 'default' }: NumPadProps) {
  if (variant === 'pin') {
    return (
      <div className="numpad numpad--pin">
        <div className="numpad-grid numpad-grid--pin">
          {KEYS.slice(0, 9).map((key) => (
            <button
              key={key.label}
              type="button"
              className="numpad-key"
              onClick={() => onPress(key.action)}
            >
              {key.label}
            </button>
          ))}
          <button
            type="button"
            className="numpad-key numpad-key--action"
            onClick={() => onPress('clear')}
          >
            C
          </button>
          <button type="button" className="numpad-key" onClick={() => onPress('0')}>
            0
          </button>
          <button
            type="button"
            className="numpad-key numpad-key--backspace"
            onClick={() => onPress('backspace')}
          >
            ⌫
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="numpad">
      <div className="numpad-grid">
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            className={`numpad-key ${key.action === 'clear' ? 'numpad-key--action' : ''}`}
            onClick={() => onPress(key.action)}
          >
            {key.label}
          </button>
        ))}
        <button
          type="button"
          className={`numpad-key numpad-key--backspace ${showEnter ? 'numpad-key--half-wide' : 'numpad-key--wide'}`}
          onClick={() => onPress('backspace')}
        >
          ⌫
        </button>
        {showEnter ? (
          <button
            type="button"
            className="numpad-key numpad-key--enter"
            onClick={() => onPress('enter')}
          >
            Enter
          </button>
        ) : null}
      </div>
    </div>
  )
}
