import { useState, useEffect } from 'react'
import { fetchStatus, loginBootstrap, setSaToken, getSaToken, SaApiError } from './saApi'
import SuperAdminApp from './SuperAdminApp'

// ---------------------------------------------------------------------------
// SuperAdminGate — shown at /superadmin
//
// Flow:
//   1. Check /api/superadmin/status to see if bootstrap is enabled
//   2. If disabled → show "Bootstrap disabled, use SSO" message
//   3. If already have a valid session token in sessionStorage → go straight to app
//   4. Otherwise → show secret entry form
//
// Security notes:
//   - No raw secret is ever stored — only the session JWT from the exchange
//   - Session JWT lives in sessionStorage (cleared on tab close)
//   - We probe `status` first so the UI makes it clear when bootstrap is off
// ---------------------------------------------------------------------------

export default function SuperAdminGate() {
  const [bootstrapEnabled, setBootstrapEnabled] = useState<boolean | null>(null)
  const [hasSession, setHasSession]             = useState<boolean>(!!getSaToken())
  const [secret, setSecret]                     = useState('')
  const [error, setError]                       = useState<string | null>(null)
  const [loading, setLoading]                   = useState(false)

  // Check bootstrap status on mount
  useEffect(() => {
    fetchStatus()
      .then(s => setBootstrapEnabled(s.bootstrapEnabled))
      .catch(() => setBootstrapEnabled(false))
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!secret.trim()) return
    setError(null)
    setLoading(true)
    try {
      const token = await loginBootstrap(secret.trim())
      setSaToken(token)
      setHasSession(true)
    } catch (err) {
      if (err instanceof SaApiError) {
        if (err.status === 403) {
          setError('Bootstrap admin access is currently disabled.')
        } else if (err.status === 401) {
          setError('Incorrect secret. Check your BOOTSTRAP_ADMIN_SECRET app setting.')
        } else {
          setError(`Error ${err.status}: ${err.message}`)
        }
      } else {
        setError('Network error — check that the API is reachable.')
      }
    } finally {
      setLoading(false)
      setSecret('')
    }
  }

  function handleSignOut() {
    import('./saApi').then(({ clearSaToken }) => clearSaToken())
    setHasSession(false)
  }

  // Loading status check
  if (bootstrapEnabled === null) {
    return (
      <div className="sa-gate">
        <div className="sa-gate__card">
          <div className="app-loading__spinner" />
          <p>Checking bootstrap status…</p>
        </div>
      </div>
    )
  }

  // Already signed in
  if (hasSession) {
    return <SuperAdminApp onSignOut={handleSignOut} />
  }

  // Bootstrap disabled
  if (!bootstrapEnabled) {
    return (
      <div className="sa-gate">
        <div className="sa-gate__card">
          <div className="sa-gate__icon" aria-hidden="true">🔒</div>
          <h1 className="sa-gate__title">Super Admin</h1>
          <p className="sa-gate__hint">
            Bootstrap admin access is disabled. Set{' '}
            <code>BOOTSTRAP_ADMIN_ENABLED=true</code> in the Function App
            settings to re-enable it.
          </p>
        </div>
      </div>
    )
  }

  // Show login form
  return (
    <div className="sa-gate">
      <div className="sa-gate__card">
        <div className="sa-gate__icon" aria-hidden="true">🛡️</div>
        <h1 className="sa-gate__title">Super Admin</h1>
        <p className="sa-gate__hint">
          Enter the <code>BOOTSTRAP_ADMIN_SECRET</code> to access the admin console.
        </p>

        <form className="sa-gate__form" onSubmit={handleLogin} autoComplete="off">
          <label className="sa-form-label" htmlFor="sa-secret">
            Bootstrap Secret
          </label>
          <input
            id="sa-secret"
            className="sa-form-input"
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder="Paste secret here…"
            autoFocus
            autoComplete="new-password"
            aria-describedby={error ? 'sa-error' : undefined}
          />
          {error && (
            <p id="sa-error" className="sa-gate__error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn--primary btn--full"
            type="submit"
            disabled={loading || !secret.trim()}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="sa-gate__disclaimer">
          This console is for initial setup only. Disable it once SSO is configured.
        </p>
      </div>
    </div>
  )
}
