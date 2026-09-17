import { useEffect, useState } from 'react'
import {
  isSiteGateUnlocked,
  loadSiteGateCredentials,
  setupSiteGateCredentials,
  verifySiteGateLogin,
} from '../utils/siteGate'
import './SiteGateScreen.css'

interface SiteGateScreenProps {
  onUnlocked: () => void
}

export default function SiteGateScreen({ onUnlocked }: SiteGateScreenProps) {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (isSiteGateUnlocked()) {
        onUnlocked()
        return
      }
      const creds = await loadSiteGateCredentials()
      if (cancelled) return
      setNeedsSetup(!creds)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [onUnlocked])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (needsSetup) {
        if (password !== confirmPassword) {
          throw new Error('Password confirmation does not match.')
        }
        await setupSiteGateCredentials(username, password)
        onUnlocked()
        return
      }
      const ok = await verifySiteGateLogin(username, password)
      if (!ok) throw new Error('Incorrect username or password.')
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue.')
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <div className="site-gate">
        <div className="site-gate-card">
          <p className="site-gate-meta">Checking site access…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="site-gate">
      <div className="site-gate-card">
        <p className="site-gate-brand">SFCC Admin</p>
        <h1>{needsSetup ? 'Create site access' : 'Admin login'}</h1>
        <p className="site-gate-meta">
          {needsSetup
            ? 'Set the main username and password for this site. This is separate from cloud login.'
            : 'Enter the site admin username and password to continue.'}
        </p>
        <form className="site-gate-form" onSubmit={(e) => void handleSubmit(e)}>
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          {needsSetup ? (
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>
          ) : null}
          {error ? <p className="site-gate-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : needsSetup ? 'Create access & enter' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
