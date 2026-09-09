type CloudLoginFormProps = {
  username: string
  password: string
  busy: boolean
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSignIn: () => void
  onCreateAccount: () => void
}

export default function CloudLoginForm({
  username,
  password,
  busy,
  onUsernameChange,
  onPasswordChange,
  onSignIn,
  onCreateAccount,
}: CloudLoginFormProps) {
  const canSubmit = Boolean(username.trim()) && password.length >= 6

  return (
    <section className="cloud-card cloud-card--login app-surface" aria-label="Cloud sign in">
      <div className="cloud-card-head">
        <h3>Sign in to cloud</h3>
        <p>Use your cloud username and password to load or back up your data.</p>
      </div>

      <div className="cloud-form-grid">
        <label className="cloud-field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            autoComplete="username"
            placeholder="e.g. shalimar"
            autoCapitalize="none"
            disabled={busy}
          />
        </label>
        <label className="cloud-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="current-password"
            placeholder="Min 6 characters"
            disabled={busy}
          />
        </label>
      </div>

      <div className="cloud-card-actions">
        <button
          type="button"
          className="btn btn-primary cloud-card-actions-primary"
          disabled={busy || !canSubmit}
          onClick={onSignIn}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !canSubmit}
          onClick={onCreateAccount}
        >
          Create account
        </button>
      </div>

      <p className="cloud-card-footnote">
        New accounts start with app PIN <strong>0000</strong>. Change it after signing in.
      </p>
    </section>
  )
}
