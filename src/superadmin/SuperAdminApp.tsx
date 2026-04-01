import { useState, useEffect } from 'react'
import FamiliesList from './FamiliesList'
import FamilyDetail from './FamilyDetail'
import BootstrapSettings from './BootstrapSettings'
import RoleSwitcher from '../components/RoleSwitcher'
import { setSaMsalTokenProvider, fetchStatus } from './saApi'

type SAView = 'families' | 'family-detail' | 'settings'

interface Props {
  onSignOut: () => void
  /** Acquires an MSAL access token for the super admin API. */
  onGetToken?: () => Promise<string>
  /** If provided, a role-switcher control is shown to switch to family view. */
  onSwitchView?: () => void
}

export default function SuperAdminApp({ onSignOut, onGetToken, onSwitchView }: Props) {
  const [view, setView]               = useState<SAView>('families')
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null)
  const [bootstrapEnabled, setBootstrapEnabled] = useState<boolean | null>(null)

  // Register the MSAL token provider synchronously during render so it is available
  // before child components mount and fire their own data-loading effects.
  // (useEffect runs after children, which would cause a race on first render.)
  if (onGetToken) {
    setSaMsalTokenProvider(onGetToken)
  }

  // Clean up the provider on unmount to avoid stale closures when the SA view unmounts.
  useEffect(() => {
    return () => setSaMsalTokenProvider(null)
  }, [])

  // Fetch bootstrap status once on mount — drives the persistent warning banner.
  useEffect(() => {
    fetchStatus()
      .then(s => setBootstrapEnabled(s.bootstrapEnabled))
      .catch(() => setBootstrapEnabled(null)) // If status fetch fails, hide banner (fail safe)
  }, [])

  function openFamily(familyId: string) {
    setSelectedFamilyId(familyId)
    setView('family-detail')
  }

  function backToFamilies() {
    setSelectedFamilyId(null)
    setView('families')
  }

  function handleBootstrapDisabled() {
    setBootstrapEnabled(false)
  }

  return (
    <div className="sa-app">
      {/* Top bar */}
      <header className="sa-topbar">
        <div className="sa-topbar__brand">
          <span className="sa-topbar__icon" aria-hidden="true">🛡️</span>
          <span className="sa-topbar__title">Super Admin Console</span>
        </div>
        <nav className="sa-topbar__nav">
          <button
            className={`sa-nav-btn${view === 'families' || view === 'family-detail' ? ' sa-nav-btn--active' : ''}`}
            onClick={backToFamilies}
          >
            Families
          </button>
          <button
            className={`sa-nav-btn${view === 'settings' ? ' sa-nav-btn--active' : ''}`}
            onClick={() => setView('settings')}
          >
            Bootstrap Settings
          </button>
        </nav>
        <div className="sa-topbar__actions">
          {/* Role switcher shown only for multi-role users */}
          {onSwitchView && (
            <RoleSwitcher currentView="superadmin" onSwitch={() => onSwitchView()} />
          )}
          <button className="sa-topbar__signout btn btn--sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* Bootstrap warning banner — visible on all pages while bootstrap is enabled */}
      {bootstrapEnabled === true && (
        <div className="sa-bootstrap-warning" role="alert">
          <span className="sa-bootstrap-warning__icon" aria-hidden="true">⚠️</span>
          <div className="sa-bootstrap-warning__text">
            <strong>Bootstrap Admin access is enabled.</strong>
            Disable it once you have assigned the SuperAdmin app role to your account in
            Entra ID — the bootstrap secret is a break-glass credential and should not
            remain active in production.
          </div>
          <button
            className="sa-bootstrap-warning__btn"
            onClick={() => setView('settings')}
          >
            Go to Settings
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="sa-main">
        {(view === 'families') && (
          <FamiliesList onSelectFamily={openFamily} />
        )}
        {view === 'family-detail' && selectedFamilyId && (
          <FamilyDetail familyId={selectedFamilyId} onBack={backToFamilies} />
        )}
        {view === 'settings' && (
          <BootstrapSettings onDisabled={handleBootstrapDisabled} />
        )}
      </main>
    </div>
  )
}
