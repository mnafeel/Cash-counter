import { useMemo, useRef, useState } from 'react'
import NumberKeyboard from './NumberKeyboard'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { getLastCloudUsername } from '../firebase/cloudUser'
import { applyPinAction, resolvePinLength, type NumpadAction, type PinLength } from '../utils/numpad'
import './PinGate.css'

export type ForgotPinPayload = {
  username: string
  password: string
  newPin: string
}

type PinEntryProps = {
  title: string
  subtitle?: string
  onUnlock: () => void
  verifyPin: (pin: string) => boolean
  pinLength?: PinLength
  onForgotPin?: (payload: ForgotPinPayload) => Promise<void>
  defaultCloudUsername?: string
}

export default function PinEntry({
  title,
  subtitle,
  onUnlock,
  verifyPin,
  pinLength = 4,
  onForgotPin,
  defaultCloudUsername,
}: PinEntryProps) {
  const length = resolvePinLength(pinLength)
  const [pinStr, setPinStr] = useState('')
  const [pinError, setPinError] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotUsername, setForgotUsername] = useState(
    () => defaultCloudUsername ?? getLastCloudUsername() ?? '',
  )
  const [forgotPassword, setForgotPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [forgotStatus, setForgotStatus] = useState('')
  const [forgotError, setForgotError] = useState(false)
  const [forgotBusy, setForgotBusy] = useState(false)

  const digitSlots = useMemo(() => Array.from({ length }, (_, i) => i), [length])

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
      if (pinStr.length === length) tryUnlock(pinStr)
      return
    }
    if (action === 'clear') {
      setPinStr('')
      setPinError(false)
      return
    }
    const next = applyPinAction(pinStr, action, length)
    setPinStr(next)
    setPinError(false)
    if (next.length === length) tryUnlock(next)
  }

  const handlerRef = useRef(handlePinNumpad)
  handlerRef.current = handlePinNumpad

  useNumpadKeyboard((action) => handlerRef.current(action), !showForgot)

  function pinField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    options?: { password?: boolean },
  ) {
    return (
      <label className="pin-gate-field">
        <span>{label}</span>
        <input
          type="password"
          inputMode={options?.password ? undefined : 'numeric'}
          pattern={options?.password ? undefined : '[0-9]*'}
          maxLength={options?.password ? undefined : length}
          value={value}
          onChange={(e) =>
            onChange(
              options?.password
                ? e.target.value
                : e.target.value.replace(/\D/g, '').slice(0, length),
            )
          }
          autoComplete={options?.password ? 'current-password' : 'off'}
          disabled={forgotBusy}
        />
      </label>
    )
  }

  async function handleForgotSubmit() {
    if (!onForgotPin) return
    setForgotStatus('')
    setForgotError(false)

    const username = forgotUsername.trim()
    if (!username || !forgotPassword) {
      setForgotStatus('Enter your cloud username and password.')
      setForgotError(true)
      return
    }
    if (newPin.length !== length) {
      setForgotStatus(`New PIN must be exactly ${length} digits.`)
      setForgotError(true)
      return
    }
    if (newPin !== confirmPin) {
      setForgotStatus('PIN confirmation does not match.')
      setForgotError(true)
      return
    }

    setForgotBusy(true)
    try {
      await onForgotPin({ username, password: forgotPassword, newPin })
      setForgotStatus('PIN reset. Unlocking…')
      setForgotError(false)
    } catch (err) {
      setForgotStatus(err instanceof Error ? err.message : 'Could not reset PIN.')
      setForgotError(true)
    } finally {
      setForgotBusy(false)
    }
  }

  const hint = subtitle ?? `Enter your ${length}-digit PIN to continue.`

  if (showForgot && onForgotPin) {
    return (
      <div className="pin-gate-page">
        <section className={`pin-gate pin-gate--forgot pin-gate--len-${length}`}>
          <p className="pin-gate-label">Forgot PIN</p>
          <p className="pin-gate-hint">
            Enter your cloud username and password, then set a new {length}-digit PIN.
          </p>
          <div className="pin-gate-forgot-form">
            <label className="pin-gate-field">
              <span>Cloud username</span>
              <input
                type="text"
                value={forgotUsername}
                onChange={(e) => setForgotUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                disabled={forgotBusy}
              />
            </label>
            {pinField('Cloud password', forgotPassword, setForgotPassword, { password: true })}
            {pinField('New PIN', newPin, setNewPin)}
            {pinField('Confirm new PIN', confirmPin, setConfirmPin)}
          </div>
          <div className="pin-gate-forgot-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={forgotBusy}
              onClick={() => void handleForgotSubmit()}
            >
              {forgotBusy ? 'Resetting…' : 'Reset PIN'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={forgotBusy}
              onClick={() => {
                setShowForgot(false)
                setForgotStatus('')
                setForgotError(false)
              }}
            >
              Back to PIN
            </button>
          </div>
          {forgotStatus ? (
            <p className={`pin-gate-forgot-status ${forgotError ? 'pin-gate-forgot-status--error' : ''}`}>
              {forgotStatus}
            </p>
          ) : null}
        </section>
      </div>
    )
  }

  return (
    <div className={`pin-gate-page ${unlocking ? 'pin-gate-page--unlocking' : ''}`}>
      <section className={`pin-gate pin-gate--len-${length}`}>
        <p className="pin-gate-label">{title}</p>
        <p className="pin-gate-hint">{hint}</p>
        <div className={`pin-gate-digits ${pinError ? 'pin-gate-digits--error' : ''}`}>
          {digitSlots.map((i) => (
            <span
              key={i}
              className={`pin-gate-digit ${pinStr.length > i ? 'pin-gate-digit--filled' : ''}`}
            >
              {pinStr.length > i ? '•' : ''}
            </span>
          ))}
        </div>
        {pinError ? <p className="pin-gate-error">Wrong PIN. Try again.</p> : null}
        {onForgotPin ? (
          <button
            type="button"
            className="pin-gate-forgot-link"
            onClick={() => {
              setForgotUsername(defaultCloudUsername ?? getLastCloudUsername() ?? '')
              setShowForgot(true)
            }}
          >
            Forgot PIN?
          </button>
        ) : null}
        <div className="pin-gate-keyboard">
          <NumberKeyboard onPress={(action) => handlerRef.current(action)} showEnter={false} variant="pin" />
        </div>
      </section>
    </div>
  )
}
