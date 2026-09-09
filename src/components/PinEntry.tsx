import { useRef, useState } from 'react'
import NumberKeyboard from './NumberKeyboard'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { applyPinAction, type NumpadAction } from '../utils/numpad'
import './PinGate.css'

type PinEntryProps = {
  title: string
  subtitle?: string
  onUnlock: () => void
  verifyPin: (pin: string) => boolean
  keyboardRoute?: string
}

export default function PinEntry({
  title,
  subtitle = 'Enter your 4-digit PIN to continue.',
  onUnlock,
  verifyPin,
  keyboardRoute,
}: PinEntryProps) {
  const [pinStr, setPinStr] = useState('')
  const [pinError, setPinError] = useState(false)
  const [unlocking, setUnlocking] = useState(false)

  function tryUnlock(nextPin: string) {
    if (verifyPin(nextPin)) {
      setUnlocking(true)
      onUnlock()
      setPinStr('')
      setPinError(false)
      return
    }
    setPinError(true)
    setPinStr('')
  }

  function handlePinNumpad(action: NumpadAction) {
    if (action === 'enter') {
      if (pinStr.length === 4) tryUnlock(pinStr)
      return
    }
    if (action === 'clear') {
      setPinStr('')
      setPinError(false)
      return
    }
    const next = applyPinAction(pinStr, action)
    setPinStr(next)
    setPinError(false)
    if (next.length === 4) tryUnlock(next)
  }

  const handlerRef = useRef(handlePinNumpad)
  handlerRef.current = handlePinNumpad

  useRouteNumpadKeyboard(
    keyboardRoute ?? '',
    (action) => handlerRef.current(action),
    Boolean(keyboardRoute),
  )

  return (
    <div className={`pin-gate-page ${unlocking ? 'pin-gate-page--unlocking' : ''}`}>
      <section className="pin-gate">
        <p className="pin-gate-label">{title}</p>
        {subtitle ? <p className="pin-gate-hint">{subtitle}</p> : null}
        <div className={`pin-gate-digits ${pinError ? 'pin-gate-digits--error' : ''}`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`pin-gate-digit ${pinStr.length > i ? 'pin-gate-digit--filled' : ''}`}
            >
              {pinStr.length > i ? '•' : ''}
            </span>
          ))}
        </div>
        {pinError ? <p className="pin-gate-error">Wrong PIN. Try again.</p> : null}
        <div className="pin-gate-keyboard">
          <NumberKeyboard onPress={(action) => handlerRef.current(action)} showEnter={false} variant="pin" />
        </div>
      </section>
    </div>
  )
}
