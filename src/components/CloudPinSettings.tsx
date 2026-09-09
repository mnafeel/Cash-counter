import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import type { AppData } from '../types'
import { getCloudUsername, loginCloud } from '../firebase/backup'
import { verifyCloudPassword } from '../firebase/account'
import {
  fetchCloudAccountHistory,
  type CloudAccountHistoryEntry,
} from '../firebase/cloudUsernameRegistry'
import CloudChangeHistoryDetails from './CloudChangeHistoryDetails'
import { getPinEntryLength, getPinLength, verifyUserPin } from '../utils/accessPin'
import { normalizePin, type PinLength } from '../utils/numpad'

type CloudPinSettingsProps = {
  data: AppData
  cloudUser: User | null
  onUpdatePin: (pin: string) => void
  onUpdatePinLength: (pinLength: PinLength) => void
}

type PinMode = 'change' | 'forgot' | null

function pinMatches(value: string, expected: string, length: PinLength): boolean {
  return normalizePin(value, '', length) === normalizePin(expected, '', length)
}

export default function CloudPinSettings({
  data,
  cloudUser,
  onUpdatePin,
  onUpdatePinLength,
}: CloudPinSettingsProps) {
  const savedPinLength = getPinLength(data)
  const pinEntryLength = getPinEntryLength(data)
  const defaultPin = normalizePin('0000', '0000', savedPinLength)

  const [mode, setMode] = useState<PinMode>(null)
  const [draftPinLength, setDraftPinLength] = useState<PinLength>(savedPinLength)
  const [pinHistory, setPinHistory] = useState<CloudAccountHistoryEntry[]>([])

  useEffect(() => {
    setDraftPinLength(savedPinLength)
  }, [savedPinLength])

  useEffect(() => {
    if (!cloudUser) {
      setPinHistory([])
      return
    }
    void fetchCloudAccountHistory(cloudUser.uid).then((entries) => {
      setPinHistory(entries.filter((entry) => entry.kind === 'pin'))
    })
  }, [cloudUser])

  async function loadPinHistory() {
    if (!cloudUser) return
    const entries = await fetchCloudAccountHistory(cloudUser.uid)
    setPinHistory(entries.filter((entry) => entry.kind === 'pin'))
  }
  const [oldPin, setOldPin] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [forgotUsername, setForgotUsername] = useState(() =>
    cloudUser ? getCloudUsername(cloudUser) : '',
  )
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const digitHint = useMemo(() => `${draftPinLength}-digit`, [draftPinLength])

  function resetForm() {
    setOldPin('')
    setCloudPassword('')
    setNewPin('')
    setConfirmPin('')
    setStatus('')
    setError(false)
  }

  function openMode(next: PinMode) {
    resetForm()
    setMode(next)
    if (next === 'forgot' && cloudUser) {
      setForgotUsername(getCloudUsername(cloudUser))
    }
  }

  function closeMode() {
    resetForm()
    setDraftPinLength(savedPinLength)
    setMode(null)
  }

  function validateNewPin(): string | null {
    if (newPin.length !== draftPinLength) {
      return `New PIN must be exactly ${draftPinLength} digits.`
    }
    if (newPin !== confirmPin) {
      return 'PIN confirmation does not match.'
    }
    if (pinMatches(newPin, '0000', draftPinLength)) {
      return 'Choose a PIN other than 0000.'
    }
    return null
  }

  async function verifyOldPinOrPassword(): Promise<boolean> {
    if (oldPin && verifyUserPin(data, oldPin)) return true
    if (!cloudPassword || !cloudUser) return false
    await verifyCloudPassword(cloudPassword)
    return true
  }

  async function handleChangePin() {
    setStatus('')
    setError(false)
    const validation = validateNewPin()
    if (validation) {
      setStatus(validation)
      setError(true)
      return
    }
    if (!oldPin && !cloudPassword) {
      setStatus(`Enter your current PIN or cloud password.`)
      setError(true)
      return
    }
    if (!cloudUser) {
      setStatus('Sign in to cloud to change your PIN.')
      setError(true)
      return
    }
    setBusy(true)
    try {
      const verified = await verifyOldPinOrPassword()
      if (!verified) {
        setStatus('Current PIN or cloud password is incorrect.')
        setError(true)
        return
      }
      onUpdatePinLength(draftPinLength)
      onUpdatePin(newPin)
      await loadPinHistory()
      setStatus('PIN updated successfully.')
      closeMode()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not change PIN.')
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleForgotPin() {
    setStatus('')
    setError(false)
    const validation = validateNewPin()
    if (validation) {
      setStatus(validation)
      setError(true)
      return
    }
    const username = forgotUsername.trim()
    if (!username || !cloudPassword) {
      setStatus('Enter your cloud username and password.')
      setError(true)
      return
    }
    setBusy(true)
    try {
      await loginCloud(username, cloudPassword)
      onUpdatePinLength(draftPinLength)
      onUpdatePin(newPin)
      await loadPinHistory()
      setStatus('PIN reset. Use your new PIN to unlock the app.')
      closeMode()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not reset PIN.')
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  function handlePinLengthChange(next: PinLength) {
    if (next === draftPinLength) return
    setDraftPinLength(next)
    setStatus(`New PIN will use ${next} digits after you save.`)
    setError(false)
    setOldPin('')
    setNewPin('')
    setConfirmPin('')
  }

  function pinInput(
    label: string,
    value: string,
    onChange: (value: string) => void,
    options?: { password?: boolean; digits?: PinLength },
  ) {
    const maxDigits = options?.password ? undefined : (options?.digits ?? draftPinLength)
    return (
      <label className="cloud-field">
        <span>{label}</span>
        <input
          type="password"
          inputMode={options?.password ? undefined : 'numeric'}
          pattern={options?.password ? undefined : '[0-9]*'}
          maxLength={maxDigits}
          value={value}
          onChange={(e) =>
            onChange(
              options?.password
                ? e.target.value
                : e.target.value.replace(/\D/g, '').slice(0, maxDigits),
            )
          }
          autoComplete={options?.password ? 'current-password' : 'off'}
          disabled={busy}
        />
      </label>
    )
  }

  return (
    <section className="cloud-card app-surface" aria-label="App PIN">
      <div className="cloud-card-head">
        <h3>App PIN</h3>
        <p>
          Secures the whole app · default <strong>{defaultPin}</strong> for new accounts · synced
          with cloud
        </p>
      </div>

      <div className="cloud-pin-meta">
        <div className="cloud-pin-length-row">
          <span className="cloud-pin-length-label">PIN length</span>
          <div className="cloud-pin-length-toggle">
            <button
              type="button"
              className={draftPinLength === 4 ? 'cloud-pin-length-btn--active' : ''}
              onClick={() => handlePinLengthChange(4)}
            >
              4 digits
            </button>
            <button
              type="button"
              className={draftPinLength === 6 ? 'cloud-pin-length-btn--active' : ''}
              onClick={() => handlePinLengthChange(6)}
            >
              6 digits
            </button>
          </div>
        </div>
      </div>

      {!cloudUser && !mode ? (
        <p className="cloud-card-footnote">
          Sign in to cloud to change your PIN. If you are locked out, tap <strong>Forgot PIN?</strong> on
          the PIN screen.
        </p>
      ) : null}

      {!mode ? (
        <div className="cloud-card-actions cloud-card-actions--pin">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!cloudUser}
            onClick={() => openMode('change')}
          >
            Change PIN
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => openMode('forgot')}>
            Forgot PIN
          </button>
        </div>
      ) : null}

      {mode === 'change' ? (
        <div className="cloud-card-expand">
          <p className="cloud-card-expand-hint">
            Enter your current {digitHint} PIN or cloud password, then choose a new PIN.
          </p>
          <div className="cloud-form-grid">
            {pinInput('Current PIN', oldPin, setOldPin, { digits: pinEntryLength })}
            {pinInput('Or cloud password', cloudPassword, setCloudPassword, { password: true })}
            {pinInput('New PIN', newPin, setNewPin)}
            {pinInput('Confirm new PIN', confirmPin, setConfirmPin)}
          </div>
          <div className="cloud-card-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleChangePin()}>
              {busy ? 'Updating…' : 'Update PIN'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeMode}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'forgot' ? (
        <div className="cloud-card-expand">
          <p className="cloud-card-expand-hint">
            Verify your cloud account with username and password, then set a new PIN.
          </p>
          <div className="cloud-form-grid">
            <label className="cloud-field">
              <span>Cloud username</span>
              <input
                type="text"
                value={forgotUsername}
                onChange={(e) => setForgotUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                disabled={busy}
              />
            </label>
            {pinInput('Cloud password', cloudPassword, setCloudPassword, { password: true })}
            {pinInput('New PIN', newPin, setNewPin)}
            {pinInput('Confirm new PIN', confirmPin, setConfirmPin)}
          </div>
          <div className="cloud-card-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleForgotPin()}>
              {busy ? 'Resetting…' : 'Reset PIN'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeMode}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {cloudUser ? (
        <CloudChangeHistoryDetails
          entries={pinHistory}
          label="PIN change history"
          hint="Saved to your cloud account when you change or reset your PIN."
          emptyMessage="No PIN changes yet."
          kinds={['pin']}
        />
      ) : null}

      {status ? (
        <p className={`cloud-card-status ${error ? 'cloud-card-status--error' : ''}`}>{status}</p>
      ) : null}
    </section>
  )
}
