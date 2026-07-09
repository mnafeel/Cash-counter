import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import { isFirebaseConfigured } from '../firebase/config'
import { getLastCloudUsername } from '../firebase/cloudUser'
import {
  createCloudAccount,
  getCloudUsername,
  getLocalLastBackupTime,
  getRemoteLastBackupTime,
  isAutoBackupEnabled,
  loginCloud,
  logoutCloud,
  restoreAppData,
  setAutoBackupEnabled,
  subscribeToAuth,
} from '../firebase/backup'
import { backupNow, setBackupStatusListener } from '../firebase/sync'
import type { AppData } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, applyPinAction, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import './Settings.css'

type SettingsField = 'openingCash' | 'openingBank' | 'pin' | 'pinConfirm'

export default function Settings() {
  const {
    data,
    balance,
    bankBalance,
    updateOpeningBalance,
    updateOpeningBankBalance,
    updateHomePin,
    replaceAllData,
    resetAllData,
  } = useCash()
  const [openingStr, setOpeningStr] = useState(String(data.openingBalance))
  const [openingBankStr, setOpeningBankStr] = useState(String(data.openingBankBalance ?? 0))
  const [pinStr, setPinStr] = useState('')
  const [pinConfirmStr, setPinConfirmStr] = useState('')
  const [activeField, setActiveField] = useState<SettingsField>('openingCash')
  const [saved, setSaved] = useState(false)
  const [pinError, setPinError] = useState('')

  const [cloudUsername, setCloudUsername] = useState(() => getLastCloudUsername() ?? '')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudUser, setCloudUser] = useState<User | null>(null)
  const [autoBackup, setAutoBackup] = useState(isAutoBackupEnabled())
  const [backupStatus, setBackupStatus] = useState('')
  const [backupError, setBackupError] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(getLocalLastBackupTime())

  const firebaseBuilt = isFirebaseConfigured()

  const opening = parseAmount(openingStr)
  const openingBank = parseAmount(openingBankStr)

  useEffect(() => {
    setOpeningStr(String(data.openingBalance))
    setOpeningBankStr(String(data.openingBankBalance ?? 0))
  }, [data.openingBalance, data.openingBankBalance])

  useEffect(() => {
    if (!firebaseBuilt) return
    return subscribeToAuth(async (user) => {
      setCloudUser(user)
      if (user) {
        setCloudUsername(getCloudUsername(user))
        const remote = await getRemoteLastBackupTime().catch(() => null)
        if (remote) setLastBackup(remote)
      }
    })
  }, [firebaseBuilt])

  useEffect(() => {
    setBackupStatusListener((message, isError) => {
      setBackupStatus(message)
      setBackupError(Boolean(isError))
    })
    return () => setBackupStatusListener(null)
  }, [])

  function activeValue(): string {
    if (activeField === 'openingCash') return openingStr
    if (activeField === 'openingBank') return openingBankStr
    if (activeField === 'pin') return pinStr
    return pinConfirmStr
  }

  function setActiveValue(next: string) {
    if (activeField === 'openingCash') setOpeningStr(next)
    else if (activeField === 'openingBank') setOpeningBankStr(next)
    else if (activeField === 'pin') setPinStr(next)
    else setPinConfirmStr(next)
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') return

    const isPinField = activeField === 'pin' || activeField === 'pinConfirm'
    const prev = activeValue()
    const next = isPinField ? applyPinAction(prev, action) : applyNumpadAction(prev, action)

    if (isPinField && next.length > 4) return
    setActiveValue(next)
    setPinError('')
  }

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  useNumpadKeyboard((action) => numpadHandlerRef.current(action))

  function handleSave() {
    setPinError('')

    if (pinStr || pinConfirmStr) {
      if (pinStr.length !== 4 || pinConfirmStr.length !== 4) {
        setPinError('PIN must be exactly 4 digits.')
        return
      }
      if (pinStr !== pinConfirmStr) {
        setPinError('PINs do not match.')
        return
      }
      updateHomePin(pinStr)
    }

    updateOpeningBalance(opening)
    updateOpeningBankBalance(openingBank)
    setSaved(true)
    setPinStr('')
    setPinConfirmStr('')
    setTimeout(() => setSaved(false), 1200)
  }

  function cloudDataSummary(snapshot: AppData): string {
    return `${snapshot.sales.length} bills · ${snapshot.expenses.length} records · cash ${formatMoney(snapshot.openingBalance)} · bank ${formatMoney(snapshot.openingBankBalance ?? 0)}`
  }

  function applyCloudDataToForm(snapshot: AppData) {
    replaceAllData(snapshot)
    setOpeningStr(String(snapshot.openingBalance))
    setOpeningBankStr(String(snapshot.openingBankBalance ?? 0))
  }

  async function loadCloudDataAfterAuth(isNewAccount: boolean) {
    const restored = await restoreAppData()
    if (restored) {
      applyCloudDataToForm(restored)
      const remote = await getRemoteLastBackupTime().catch(() => null)
      if (remote) setLastBackup(remote)
      setBackupStatus(`Opened · full data loaded · ${cloudDataSummary(restored)}`)
      return
    }

    if (isNewAccount) {
      const at = await backupNow(data)
      setLastBackup(at)
      setBackupStatus(`Username created · ${cloudDataSummary(data)} saved to cloud`)
      return
    }

    setBackupStatus('No cloud data yet for this username.')
    setBackupError(true)
  }

  async function handleCloudCreate() {
    setBackupBusy(true)
    setBackupError(false)
    try {
      if (cloudUser) {
        await logoutCloud()
        resetAllData()
        setOpeningStr('0')
        setOpeningBankStr('0')
        setCloudUser(null)
      }
      await createCloudAccount(cloudUsername, cloudPassword)
      setCloudPassword('')
      await loadCloudDataAfterAuth(true)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Create failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleCloudOpen() {
    setBackupBusy(true)
    setBackupError(false)
    try {
      if (cloudUser) {
        await logoutCloud()
        resetAllData()
        setOpeningStr('0')
        setOpeningBankStr('0')
        setCloudUser(null)
      }
      await loginCloud(cloudUsername, cloudPassword)
      setCloudPassword('')
      await loadCloudDataAfterAuth(false)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Open failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleBackupNow() {
    if (!cloudUser) return
    setBackupBusy(true)
    setBackupError(false)
    try {
      const at = await backupNow(data)
      setLastBackup(at)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Backup failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleCloudLogout() {
    const ok = window.confirm(
      'Logout? All local data on this device will be removed. Your cloud backup stays safe. Open username again to load full data.',
    )
    if (!ok) return

    setBackupBusy(true)
    try {
      await logoutCloud()
      resetAllData()
      setOpeningStr('0')
      setOpeningBankStr('0')
      setCloudUser(null)
      setCloudPassword('')
      setLastBackup(null)
      setBackupStatus('Logged out — local data removed')
      setBackupError(false)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Logout failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  function toggleAutoBackup() {
    const next = !autoBackup
    setAutoBackup(next)
    setAutoBackupEnabled(next)
  }

  return (
    <div className="settings-page">
      <div className="settings-scroll">
        <div className="settings-header">
          <h2>Settings</h2>
          <p>Opening balances, PIN & cloud username</p>
        </div>

        <div className="settings-fields">
          <AmountDisplay
            label="Opening Cash"
            value={openingStr}
            active={activeField === 'openingCash'}
            onSelect={() => setActiveField('openingCash')}
            compact
          />
          <AmountDisplay
            label="Opening Bank"
            value={openingBankStr}
            active={activeField === 'openingBank'}
            onSelect={() => setActiveField('openingBank')}
            compact
          />
          <AmountDisplay
            label="New Home PIN"
            value={pinStr ? '•'.repeat(pinStr.length) : ''}
            active={activeField === 'pin'}
            onSelect={() => setActiveField('pin')}
            compact
          />
          <AmountDisplay
            label="Confirm PIN"
            value={pinConfirmStr ? '•'.repeat(pinConfirmStr.length) : ''}
            active={activeField === 'pinConfirm'}
            onSelect={() => setActiveField('pinConfirm')}
            compact
          />
        </div>

        <NumberKeyboard onPress={handleNumpad} showEnter={false} />

        {pinError && <p className="settings-pin-error">{pinError}</p>}

        <div className="settings-info">
          <div className="settings-row">
            <span>Current cash</span>
            <span className="settings-highlight">{formatMoney(balance)}</span>
          </div>
          <div className="settings-row">
            <span>Current bank</span>
            <span className="settings-highlight">{formatMoney(bankBalance)}</span>
          </div>
        </div>

        <section className="settings-backup">
          <div className="settings-backup-head">
            <h3>Cloud Username</h3>
            <p>Create username or Open — same username always loads that data from cloud.</p>
          </div>

          <p className="settings-backup-meta">Firebase connected · cash-counter-84178</p>

          {cloudUser && (
            <div className="settings-backup-open">
              <p className="settings-backup-signed-in">Open · {getCloudUsername(cloudUser)}</p>
              <div className="settings-backup-summary">
                <span>{data.sales.length} bills</span>
                <span>{data.expenses.length} records</span>
                <span>Cash {formatMoney(balance)}</span>
                <span>Bank {formatMoney(bankBalance)}</span>
              </div>
              <label className="settings-backup-toggle">
                <input type="checkbox" checked={autoBackup} onChange={toggleAutoBackup} />
                Auto backup on every change
              </label>
              {lastBackup && (
                <p className="settings-backup-meta">
                  Last cloud save: {new Date(lastBackup).toLocaleString()}
                </p>
              )}
              <div className="settings-backup-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={backupBusy || !firebaseBuilt}
                  onClick={() => void handleBackupNow()}
                >
                  Save to cloud
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={backupBusy}
                  onClick={() => void handleCloudLogout()}
                >
                  Logout
                </button>
              </div>
            </div>
          )}

          <div className="settings-backup-form">
            <span className="settings-backup-form-label">
              {cloudUser ? 'Create new username or open another' : 'Create username or open'}
            </span>
            <label className="settings-backup-field">
              <span>Cloud Username</span>
              <input
                type="text"
                value={cloudUsername}
                onChange={(e) => setCloudUsername(e.target.value)}
                autoComplete="username"
                placeholder="e.g. shalimar"
                autoCapitalize="none"
              />
            </label>
            <label className="settings-backup-field">
              <span>Cloud Password</span>
              <input
                type="password"
                value={cloudPassword}
                onChange={(e) => setCloudPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Min 6 characters"
              />
            </label>
            <div className="settings-backup-actions settings-backup-actions--create">
              <button
                type="button"
                className="btn btn-primary"
                disabled={backupBusy || !cloudUsername.trim() || cloudPassword.length < 6}
                onClick={() => void handleCloudCreate()}
              >
                Create username
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={backupBusy || !cloudUsername.trim() || cloudPassword.length < 6}
                onClick={() => void handleCloudOpen()}
              >
                Open
              </button>
            </div>
          </div>

          {backupStatus && (
            <p className={`settings-backup-status ${backupError ? 'settings-backup-status--error' : ''}`}>
              {backupStatus}
            </p>
          )}
        </section>
      </div>

      <button
        type="button"
        className={`btn btn-primary ${saved ? 'btn-saved' : ''}`}
        onClick={handleSave}
      >
        {saved ? '✓ Saved!' : 'Save Settings'}
      </button>

      <p className="settings-note">
        Home PIN default is 0000. Leave PIN fields empty to keep current PIN.
      </p>
    </div>
  )
}
