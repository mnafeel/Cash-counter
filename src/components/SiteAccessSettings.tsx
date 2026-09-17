import { useMemo, useState } from 'react'
import { getCloudUser } from '../firebase/backup'
import {
  SITE_GATE_SESSION_DURATION_OPTIONS,
  changeSiteGateCredentials,
  formatSiteGateSessionExpiry,
  getActiveSiteGateSessionDuration,
  labelForSiteGateSessionDuration,
  logoutSiteGate,
  readLocalSiteGateCredentials,
  updateSiteGateSessionDuration,
  type SiteGateSessionDuration,
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
  const [duration, setDuration] = useState<SiteGateSessionDuration>(() =>
    getActiveSiteGateSessionDuration(),
  )
  const [expiryLabel, setExpiryLabel] = useState(() => formatSiteGateSessionExpiry())
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const adminName = useMemo(() => local?.username ?? 'Not set', [local?.username])

  function refreshExpiry() {
    setExpiryLabel(formatSiteGateSessionExpiry())
  }

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
      refreshExpiry()
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

  function handleDurationChange(next: SiteGateSessionDuration) {
    setDuration(next)
    updateSiteGateSessionDuration(next)
    refreshExpiry()
    setError(false)
    setStatus(
      next === 'never'
        ? 'Session set to Never — this device stays signed in until you log out or clear browser data.'
        : `Session duration set to ${labelForSiteGateSessionDuration(next)}. Timer restarted from now.`,
    )
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
            Main gatekeeper for this website. Separate from Cloud login and App PIN.
          </p>
        </div>

        <div className="site-access-status">
          <div className="site-access-status__row">
            <span className="site-access-status__label">Signed in as</span>
            <strong className="site-access-status__value">{adminName}</strong>
          </div>
          <div className="site-access-status__row">
            <span className="site-access-status__label">Session</span>
            <span className="site-access-status__value site-access-status__value--muted">
              {expiryLabel}
            </span>
          </div>
          <div className="site-access-status__row">
            <span className="site-access-status__label">Cloud</span>
            <span className="site-access-status__value site-access-status__value--muted">
              {cloudUser ? 'Sync available' : 'Local device only until you sync'}
            </span>
          </div>
        </div>

        <div className="site-access-card">
          <div className="site-access-card__head">
            <h3>Session duration</h3>
            <p>How long this device stays signed in. New logins start at 1 day; change it here anytime.</p>
          </div>
          <div className="site-access-duration" role="radiogroup" aria-label="Session duration">
            {SITE_GATE_SESSION_DURATION_OPTIONS.map((opt) => {
              const active = duration === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`site-access-duration__chip${active ? ' is-active' : ''}`}
                  onClick={() => handleDurationChange(opt.id)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <form className="site-access-card site-access-form" onSubmit={(e) => void handleChange(e)}>
          <div className="site-access-card__head">
            <h3>Username &amp; password</h3>
            <p>Change the site gatekeeper credentials used on the login screen.</p>
          </div>

          <div className="site-access-form__grid">
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
            <label className="site-access-form__span">
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
          </div>

          <button type="submit" className="btn btn-primary site-access-form__submit" disabled={busy}>
            {busy ? 'Saving…' : 'Update credentials'}
          </button>
        </form>

        <div className="site-access-card site-access-logout">
          <div className="site-access-card__head">
            <h3>Log out</h3>
            <p>
              Ends site access on this device only. The next visit will ask for the admin username
              and password again.
            </p>
          </div>
          <button type="button" className="btn site-access-logout__btn" onClick={handleLogout}>
            Log out this device
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
