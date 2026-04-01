import { useState, useEffect, useCallback } from 'react'
import { fetchStatus, disableBootstrap, SaApiError } from './saApi'

interface Props {
  /** Called by parent when bootstrap is successfully disabled — lets the parent update global banner state. */
  onDisabled?: () => void
}

export default function BootstrapSettings({ onDisabled }: Props) {
  const [enabled, setEnabled]   = useState<boolean | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [disabling, setDisabling]   = useState(false)
  const [disabled, setDisabled]     = useState(false)   // successfully disabled in this session

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { bootstrapEnabled } = await fetchStatus()
      setEnabled(bootstrapEnabled)
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to load status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDisable() {
    setDisabling(true)
    setConfirming(false)
    setError(null)
    try {
      await disableBootstrap()
      setEnabled(false)
      setDisabled(true)
      onDisabled?.()
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to disable bootstrap.')
    } finally {
      setDisabling(false)
    }
  }

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <h2 className="sa-page-title">Bootstrap Settings</h2>
      </div>

      {loading && <div className="sa-loading"><div className="app-loading__spinner" /></div>}
      {error   && <p className="sa-error-banner" role="alert">{error}</p>}

      {!loading && (
        <>
          {/* Status card */}
          <div className={`sa-status-card ${enabled ? 'sa-status-card--enabled' : 'sa-status-card--disabled'}`}>
            <div className="sa-status-card__indicator" aria-hidden="true" />
            <div className="sa-status-card__body">
              <p className="sa-status-card__label">Bootstrap Authentication</p>
              <p className="sa-status-card__value">{enabled ? 'ENABLED' : 'DISABLED'}</p>
            </div>
          </div>

          {disabled && (
            <div className="sa-callout sa-callout--success">
              <strong>Bootstrap disabled.</strong> The <code>BOOTSTRAP_ADMIN_ENABLED</code> environment
              variable still needs to be set to <code>false</code> on the Function App to fully prevent
              re-activation. See the steps below.
            </div>
          )}

          {/* Info panels — shown based on state */}
          {enabled && !disabled && (
            <div className="sa-callout sa-callout--warning">
              <p className="sa-callout__title">Bootstrap is currently active</p>
              <p>
                Anyone who knows the <code>BOOTSTRAP_ADMIN_SECRET</code> can access this Super Admin console.
                Once you have confirmed that real Entra SSO accounts are working correctly, you should
                disable bootstrap access to reduce the attack surface.
              </p>
            </div>
          )}

          {!enabled && !disabled && (
            <div className="sa-callout sa-callout--info">
              Bootstrap has already been disabled (either via database flag or the{' '}
              <code>BOOTSTRAP_ADMIN_ENABLED</code> environment variable).
            </div>
          )}

          {/* Disable button — only shown when currently enabled */}
          {enabled && !disabled && (
            <div className="sa-action-section">
              <h3 className="sa-section-title">Disable Bootstrap</h3>
              <p className="sa-body-text">
                Clicking <strong>Disable Bootstrap</strong> will write a flag to Cosmos DB that prevents
                any further bootstrap logins, even if the environment variable is still set.
                Your current session will not be affected.
              </p>
              <button
                className="btn btn--danger"
                onClick={() => setConfirming(true)}
                disabled={disabling}
              >
                {disabling ? 'Disabling…' : 'Disable Bootstrap'}
              </button>
            </div>
          )}

          {/* Re-enable instructions */}
          <div className="sa-action-section">
            <h3 className="sa-section-title">
              {enabled ? 'How to disable (hardened)' : 'How to re-enable (if needed)'}
            </h3>
            {enabled ? (
              <ol className="sa-instruction-list">
                <li>
                  Click <strong>Disable Bootstrap</strong> above to set the database kill-switch.
                </li>
                <li>
                  Go to the Azure Portal → Function App → <em>Configuration</em> and set{' '}
                  <code>BOOTSTRAP_ADMIN_ENABLED</code> to <code>false</code>, then save.
                </li>
                <li>
                  Restart the Function App. The super admin login page will now show a
                  "Bootstrap access is disabled" message.
                </li>
              </ol>
            ) : (
              <ol className="sa-instruction-list">
                <li>
                  Go to the <a className="sa-ext-link" href="https://portal.azure.com" target="_blank" rel="noopener noreferrer">
                    Azure Portal
                  </a> → your Function App → <em>Environment variables</em> and set{' '}
                  <code>BOOTSTRAP_ADMIN_ENABLED</code> to <code>true</code>, then save.
                </li>
                <li>
                  If the database kill-switch was set, open <strong>Azure Cosmos DB Data Explorer</strong>,
                  navigate to the <code>allowance-db</code> database, <code>families</code> container,
                  and delete the document with <code>id = "system-config"</code> and{' '}
                  <code>familyId = "system"</code>.
                </li>
                <li>
                  Restart the Function App, then reload this page and log in again.
                </li>
              </ol>
            )}
          </div>

          {/* Ongoing management guidance */}
          <div className="sa-action-section">
            <h3 className="sa-section-title">Ongoing Family Management</h3>
            <p className="sa-body-text">
              Once Entra SSO is working you should manage families through the Families tab in this
              console rather than directly editing Cosmos DB. For reading raw data, use the{' '}
              <a className="sa-ext-link" href="https://portal.azure.com" target="_blank" rel="noopener noreferrer">
                Azure Cosmos DB Data Explorer
              </a>.
            </p>
            <p className="sa-body-text">
              To add a new family member who already has an Entra account, go to{' '}
              <strong>Families → [family name] → Add Member</strong> and enter their Entra OID and a
              display name.
            </p>
          </div>
        </>
      )}

      {/* Confirm disable dialog */}
      {confirming && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Disable Bootstrap Access?</p>
            <div className="sa-dialog__body">
              <p>This will write a permanent flag to Cosmos DB preventing all future bootstrap logins.</p>
              <p>
                <strong>You will be signed out of this session immediately.</strong> To re-enable, you
                must be able to access the Azure portal.
              </p>
              <p>Are you sure SSO users are working correctly before proceeding?</p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDisable} disabled={disabling}>
                {disabling ? 'Disabling…' : 'Yes, Disable Bootstrap'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
