import { useState } from 'react'
import { getCloudUser } from '../firebase/backup'
import {
  changeSiteGateCredentials,
  logoutSiteGate,
  readLocalSiteGateCredentials,
} from '../utils/siteGate'
import './SiteAccessSettings.css'

interface SiteAccessSettingsProps {
  onLoggedOut: () => void
}

export default function SiteAccessSettings({ onLoggedOut }: SiteAccessSettingsProps) {
  const local = readLocalSiteGateCredentials()
  const cloudUser = getCloudUser()
  const [currentUsername, setCurrentUsername] = useState(local?.username ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState(local?.username ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleChange(e: React.FormEvent) {
    e.preventDefault()
    setStatus('')
    setError(false)
    if (newPassword !== confirmPassword) {
      setError(true)
      setStatus('New password confirmation does not match.')
      return
    }
    setBusy(true)
    try {
      await changeSiteGateCredentials({
        currentUsername,
        currentPassword,
        newUsername,
        newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setCurrentUsername(newUsername.trim())
      setStatus(
        cloudUser
          ? 'Site access credentials updated (saved on this device and cloud).'
          : 'Site access credentials updated on this device. Sign in to Cloud to sync them for other devices.',
      )
    } catch (err) {
      setError(true)
      setStatus(err instanceof Error ? err.message : 'Could not update credentials.')
    } finally {
      setBusy(false)
    }
  }

  function handleLogout() {
    logoutSiteGate()
    onLoggedOut()
  }

  return (
    <div className="settings-scroll">
      <section className="settings-panel site-access-panel">
        <div className="settings-header">
          <h2>Site access</h2>
          <p>
            Main gatekeeper login for this website. Separate from Cloud login and App PIN. This
            device stays signed in until you log out here.
          </p>
        </div>

        <p className="settings-backup-meta">
          Current admin: <strong>{local?.username ?? 'Not set'}</strong>
          {cloudUser ? ' · Cloud sync available' : ' · Cloud not signed in (local device only until you sync)'}
        </p>

        <form className="site-access-form" onSubmit={(e) => void handleChange(e)}>
          <h3 className="site-access-form__title">Change username &amp; password</h3>
          <label>
            Current username
            <input
              value={currentUsername}
              onChange={(e) => setCurrentUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New username
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={3}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Update site credentials'}
          </button>
        </form>

        <div className="site-access-logout">
          <h3>Log out</h3>
          <p>
            Ends site access on this device only. The next visit to this link will ask for the admin
            username and password again.
          </p>
          <button type="button" className="btn btn-secondary" onClick={handleLogout}>
            Log out main admin
          </button>
        </div>

        {status ? (
          <p className={`settings-backup-status ${error ? 'settings-backup-status--error' : ''}`}>
            {status}
          </p>
        ) : null}
      </section>
    </div>
  )
}
