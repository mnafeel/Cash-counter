import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { getCloudUsername, refreshCloudUsernameCache, setCachedCloudUsername } from '../firebase/backup'
import { updateCloudPassword, updateCloudUsername } from '../firebase/account'
import CloudChangeHistoryDetails from './CloudChangeHistoryDetails'
import {
  fetchCloudAccountHistory,
  type CloudAccountHistoryEntry,
} from '../firebase/cloudUsernameRegistry'

type CloudAccountSettingsProps = {
  cloudUser: User
  historyRefreshKey?: number
}

type EditMode = 'username' | 'password' | null

export default function CloudAccountSettings({ cloudUser, historyRefreshKey = 0 }: CloudAccountSettingsProps) {
  const [displayUsername, setDisplayUsername] = useState(() => getCloudUsername(cloudUser))
  const currentUsername = displayUsername
  const [mode, setMode] = useState<EditMode>(null)

  useEffect(() => {
    void refreshCloudUsernameCache(cloudUser).then((username) => {
      if (username) setDisplayUsername(username)
    })
  }, [cloudUser])
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState(currentUsername)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<CloudAccountHistoryEntry[]>([])

  async function loadHistory() {
    const entries = await fetchCloudAccountHistory(cloudUser.uid)
    setHistory(entries)
  }

  useEffect(() => {
    void loadHistory()
  }, [cloudUser.uid, historyRefreshKey])

  function resetForm() {
    setCurrentPassword('')
    setNewUsername(currentUsername)
    setNewPassword('')
    setConfirmPassword('')
    setStatus('')
    setError(false)
  }

  function openMode(next: EditMode) {
    resetForm()
    setNewUsername(currentUsername)
    setMode(next)
  }

  function closeMode() {
    resetForm()
    setMode(null)
  }

  async function handleUsernameSave() {
    setStatus('')
    setError(false)

    if (!currentPassword) {
      setStatus('Enter your current password to confirm.')
      setError(true)
      return
    }

    const username = newUsername.trim()
    if (!username) {
      setStatus('Enter a new username.')
      setError(true)
      return
    }

    if (username === currentUsername) {
      setStatus('Choose a different username.')
      setError(true)
      return
    }

    setBusy(true)
    try {
      const nextKey = await updateCloudUsername(currentPassword, username)
      setCachedCloudUsername(cloudUser.uid, nextKey)
      setDisplayUsername(nextKey)
      setStatus(`Username updated to ${nextKey}. Your old username no longer works for sign-in.`)
      await loadHistory()
      closeMode()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not update username.')
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handlePasswordSave() {
    setStatus('')
    setError(false)

    if (!currentPassword) {
      setStatus('Enter your current password.')
      setError(true)
      return
    }
    if (newPassword.length < 6) {
      setStatus('New password must be at least 6 characters.')
      setError(true)
      return
    }
    if (newPassword !== confirmPassword) {
      setStatus('New passwords do not match.')
      setError(true)
      return
    }

    setBusy(true)
    try {
      await updateCloudPassword(currentPassword, newPassword)
      setStatus('Password updated and saved to cloud.')
      await loadHistory()
      closeMode()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not update password.')
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cloud-card app-surface" aria-label="Cloud account">
      <div className="cloud-card-head">
        <h3>Cloud account</h3>
        <p>Your cloud username and password for backup &amp; sync.</p>
      </div>

      <div className="cloud-account-profile">
        <div className="cloud-account-avatar" aria-hidden="true">☁️</div>
        <div className="cloud-account-identity">
          <span className="cloud-account-label">Signed in as</span>
          <strong className="cloud-account-username">{currentUsername}</strong>
        </div>
      </div>

      {!mode ? (
        <div className="cloud-account-actions">
          <button
            type="button"
            className="cloud-account-action-btn"
            onClick={() => openMode('username')}
          >
            <span className="cloud-account-action-title">Change username</span>
            <span className="cloud-account-action-sub">Update your cloud user ID</span>
          </button>
          <button
            type="button"
            className="cloud-account-action-btn"
            onClick={() => openMode('password')}
          >
            <span className="cloud-account-action-title">Change password</span>
            <span className="cloud-account-action-sub">Set a new cloud password</span>
          </button>
        </div>
      ) : null}

      {mode === 'username' ? (
        <div className="cloud-card-expand">
          <p className="cloud-card-expand-hint">
            Enter your current password and choose a new username. After saving, only the new username
            will work — the old one is retired immediately.
          </p>
          <div className="cloud-form-grid cloud-form-grid--single">
            <label className="cloud-field">
              <span>Current password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
            <label className="cloud-field">
              <span>New username</span>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                disabled={busy}
              />
            </label>
          </div>
          <div className="cloud-card-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleUsernameSave()}>
              {busy ? 'Saving…' : 'Save username'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeMode}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'password' ? (
        <div className="cloud-card-expand">
          <p className="cloud-card-expand-hint">Enter your current password, then choose a new one.</p>
          <div className="cloud-form-grid cloud-form-grid--single">
            <label className="cloud-field">
              <span>Current password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
            <label className="cloud-field">
              <span>New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Min 6 characters"
                disabled={busy}
              />
            </label>
            <label className="cloud-field">
              <span>Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
          </div>
          <div className="cloud-card-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handlePasswordSave()}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeMode}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <CloudChangeHistoryDetails
        entries={history}
        label="Account change history"
        hint="Username, password, and PIN changes saved to your cloud account."
        emptyMessage="No account changes yet."
      />

      {status ? (
        <p className={`cloud-card-status ${error ? 'cloud-card-status--error' : ''}`}>{status}</p>
      ) : null}
    </section>
  )
}
