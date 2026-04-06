import { useState, useEffect, useRef } from 'react'
import { useMsal } from '@azure/msal-react'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { useApi } from './hooks/useApi'
import { getDisplayName, getSignInEmail, parseAccessTokenClaims, apiTokenRequest } from './auth/msalConfig'
import { useIsSuperAdmin } from './hooks/useAppRole'
import type { FamilyData, KidView, Transaction, Chore, FamilyInviteCode } from './data/mockData'
import { computeKidView } from './data/mockData'
import UserApp from './components/user/UserApp'
import AdminApp from './components/admin/AdminApp'
import ActivationScreen from './components/ActivationScreen'
import RolePicker from './components/RolePicker'
import RoleSwitcher from './components/RoleSwitcher'
import SuperAdminApp from './superadmin/SuperAdminApp'
import type { ActiveView } from './components/RolePicker'

export default function App() {
  const { accounts, instance } = useMsal()
  const { apiFetch } = useApi()
  const isSuperAdmin = useIsSuperAdmin()

  const [familyData, setFamilyData]   = useState<FamilyData | null>(null)
  const [allTxns, setAllTxns]         = useState<Transaction[]>([])
  const [chores, setChores]           = useState<Chore[]>([])
  const [pendingInvites, setPendingInvites] = useState<FamilyInviteCode[]>([])
  const [loading, setLoading]         = useState(true)
  const [errorCode, setErrorCode]     = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<{ status?: number; apiCode?: string; message?: string; source?: string; ts: string } | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const retryTimerRef                 = useRef<ReturnType<typeof setTimeout> | null>(null)
  // null = "not chosen yet"; will show RolePicker for multi-role users
  const [activeView, setActiveView]   = useState<ActiveView | null>(null)
  // Name claims extracted from access token (optional claims may not be in ID token)
  const [atClaims, setAtClaims]       = useState<Record<string, unknown>>({})

  const account = accounts[0]

  useEffect(() => {
    // Extract name claims from the access token (they may not be in the ID token
    // if optional claims are only configured for the access token in Entra).
    if (account) {
      instance.acquireTokenSilent({ ...apiTokenRequest, account })
        .then(r => setAtClaims(parseAccessTokenClaims(r.accessToken)))
        .catch(() => { /* non-fatal — display name falls back to email */ })
    }

    // Load all family data. On first load after a full sign-in Entra may still
    // be propagating a session policy change, causing a transient auth failure.
    // We retry once after a short delay before surfacing an error to the user.
    //
    // Each fetch is wrapped with a label so that when it fails we can report
    // exactly which API call is responsible (family / transactions / chores).
    function labelledFetch<T>(label: string, path: string): Promise<T> {
      return apiFetch<T>(path).catch((err: unknown) => {
        // Attach the source label to the error object so the catch handler can read it
        if (err != null && typeof err === 'object') {
          (err as Record<string, unknown>)['_source'] = label
        }
        throw err
      })
    }

    const loadData = () =>
      labelledFetch<FamilyData>('family', 'family')
        .then(data => {
          setFamilyData(data)
          const txnPromise = labelledFetch<{ transactions: Transaction[] }>('transactions', 'transactions')
            .then(r => setAllTxns(r.transactions))
          const promises: Promise<unknown>[] = [txnPromise]
          if (data.currentUserRole === 'FamilyAdmin') {
            promises.push(
              labelledFetch<{ chores: Chore[] }>('chores', 'chores')
                .then(r => setChores(r.chores))
            )
            promises.push(
              labelledFetch<{ codes: FamilyInviteCode[] }>('invites', 'invites')
                .then(r => setPendingInvites(r.codes.filter(c => !c.used && !c.expired)))
            )
          }
          return Promise.all(promises)
        })

    loadData()
      .then(() => setLoading(false))
      .catch(() => {
        // First attempt failed — wait 2 s for session propagation then retry once
        retryTimerRef.current = setTimeout(() => {
          loadData()
            .then(() => setLoading(false))
            .catch((err: unknown) => {
              // Capture structured error detail for display to the user.
              const e = err as Record<string, unknown>
              const status = typeof e?.['status'] === 'number' ? (e['status'] as number) : undefined
              const body = e?.['body'] as Record<string, unknown> | undefined
              const apiCode = typeof body?.['code'] === 'string' ? (body['code'] as string) : undefined
              const message = typeof body?.['message'] === 'string' ? (body['message'] as string) : undefined
              const source = typeof e?.['_source'] === 'string' ? (e['_source'] as string) : undefined
              setErrorDetail({ status, apiCode, message, source, ts: new Date().toISOString() })

              if (status === 404) {
                setErrorCode('not-enrolled')
              } else {
                console.error('[App] Failed to load family data:', err)
                setErrorCode('error')
              }
              setLoading(false)
            })
        }, 2000)
      })

    return () => {
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Multi-role user: has SuperAdmin AND is enrolled in a family.
  // Default to family view on first render by setting activeView in an effect
  // rather than directly in the render body (calling setState during render
  // is a React anti-pattern that causes issues in strict mode).
  useEffect(() => {
    if (isSuperAdmin && familyData && activeView === null) {
      setActiveView('family')
    }
  }, [isSuperAdmin, familyData, activeView])

  const handleSignOut = () => {
    instance.logoutRedirect({ account }).catch(console.error)
  }

  /** Acquire an access token for the super admin API (used by SuperAdminApp). */
  async function getSuperAdminToken(): Promise<string> {
    const activeAccount = accounts[0]
    if (!activeAccount) {
      // No account in cache — session expired with no recovery possible silently.
      // Redirect to sign-in; the throw prevents callers from receiving undefined.
      await instance.loginRedirect({ ...apiTokenRequest })
      throw new Error('Redirecting to sign-in')
    }
    try {
      const result = await instance.acquireTokenSilent({ ...apiTokenRequest, account: activeAccount })
      return result.accessToken
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        // Consent required or session expired — redirect rather than surfacing a raw error.
        await instance.acquireTokenRedirect({ ...apiTokenRequest, account: activeAccount })
        throw new Error('Redirecting to sign-in')
      }
      throw err
    }
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
        <p>Loading your account...</p>
      </div>
    )
  }

  // Super-admin-only user (not enrolled in a family) → go straight to admin console
  if (isSuperAdmin && errorCode === 'not-enrolled') {
    return (
      <SuperAdminApp
        onGetToken={getSuperAdminToken}
        onSignOut={handleSignOut}
      />
    )
  }

  // Multi-role user: has SuperAdmin AND is enrolled in a family — activeView
  // is set to 'family' by the effect above; render nothing during the brief
  // transition frame to avoid a flash.
  if (isSuperAdmin && familyData && activeView === null) {
    return null
  }

  // Multi-role user chose super admin view
  if (isSuperAdmin && activeView === 'superadmin') {
    return (
      <SuperAdminApp
        onGetToken={getSuperAdminToken}
        onSignOut={handleSignOut}
        // Allow switching back to family view if the user is enrolled
        onSwitchView={familyData ? () => setActiveView('family') : undefined}
      />
    )
  }

  // Non-super-admin user not enrolled → activation screen
  if (errorCode === 'not-enrolled') {
    return (
      <ActivationScreen onEnrolled={() => window.location.reload()} />
    )
  }

  if (errorCode || !familyData) {
    // Build a short reference string the user can share for troubleshooting.
    const errorRef = errorDetail
      ? [
          errorDetail.source ? `api/${errorDetail.source}` : null,
          errorDetail.status ? `HTTP ${errorDetail.status}` : null,
          errorDetail.apiCode ?? null,
          errorDetail.ts,
        ].filter(Boolean).join(' · ')
      : null

    return (
      <div className="app-error">
        <div className="app-error__card">
          <h2>Something went wrong</h2>
          <p>Couldn&apos;t load account data. Please try refreshing.</p>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 8 }}>
            If the problem persists, sign out and sign back in.
          </p>
          {errorRef && (
            <div style={{ marginTop: 12, background: '#f1f5f9', borderRadius: 6, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: '0.72rem', color: '#475569', flex: 1, wordBreak: 'break-all' }}>{errorRef}</code>
              <button
                className="btn btn--secondary btn--sm"
                style={{ flexShrink: 0 }}
                onClick={() => navigator.clipboard.writeText(errorRef)}
                title="Copy error details"
              >
                Copy
              </button>
            </div>
          )}
          <button className="btn btn-secondary" onClick={handleSignOut} style={{ marginTop: 12 }}>Sign out</button>
        </div>
      </div>
    )
  }

  // Build enriched KidView list — include all User-role members so the family
  // admin can configure allowance for kids who enrolled via invite code before
  // their settings were set up (kidSettings may be undefined initially).
  const kidMembers = familyData.members.filter(m => m.role === 'User')
  const kidViews: KidView[] = kidMembers.map(m => computeKidView(m, allTxns))

  return (
    <div>
      {/* Top-of-page account bar */}
      <div className="account-bar">
        <span className="account-bar__name">{getSignInEmail(account, atClaims)}</span>
        {/* Show role switcher for multi-role users currently in the family view */}
        {isSuperAdmin && familyData && (
          <RoleSwitcher currentView="family" onSwitch={setActiveView} />
        )}
        <button className="btn btn--sm account-bar__signout" onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      {/* Non-fatal refresh error banner — shown when onDataChange fails mid-session */}
      {refreshError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, margin: '8px 16px 0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem', color: '#b91c1c' }}>
          <span style={{ flex: 1 }}>⚠ Refresh failed — showing last loaded data. <code style={{ fontSize: '0.75rem', color: '#7f1d1d', wordBreak: 'break-all' }}>{refreshError}</code></span>
          <button
            className="btn btn--secondary btn--sm"
            style={{ flexShrink: 0 }}
            onClick={() => setRefreshError(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {familyData.currentUserRole === 'FamilyAdmin' ? (
        <AdminApp
          familyData={familyData}
          kidViews={kidViews}
          allTransactions={allTxns}
          chores={chores}
          tithingEnabled={familyData.tithingEnabled}
          onDataChange={() => {
            // Refresh transactions, family data, and chores
            return Promise.all([
              apiFetch<{ transactions: Transaction[] }>('transactions')
                .then(r => setAllTxns(r.transactions)),
              apiFetch<FamilyData>('family')
                .then(data => setFamilyData(data)),
              apiFetch<{ chores: Chore[] }>('chores')
                .then(r => setChores(r.chores)),
            ]).catch((err: unknown) => {
              console.error('[App] onDataChange failed:', err)
              const e = err as Record<string, unknown>
              const status = typeof e?.['status'] === 'number' ? (e['status'] as number) : undefined
              const body = e?.['body'] as Record<string, unknown> | undefined
              const apiCode = typeof body?.['code'] === 'string' ? (body['code'] as string) : undefined
              const parts = [
                status ? `HTTP ${status}` : null,
                apiCode ?? null,
                new Date().toISOString(),
              ].filter(Boolean).join(' · ')
              setRefreshError(parts)
            })
          }}
          onRefreshFamily={() => {
            // Silently re-fetch family membership so newly joined members appear
            apiFetch<FamilyData>('family')
              .then(data => setFamilyData(data))
              .catch(console.error)
            // Also refresh pending invites — a redeemed invite should disappear
            apiFetch<{ codes: FamilyInviteCode[] }>('invites')
              .then(r => setPendingInvites(r.codes.filter(c => !c.used && !c.expired)))
              .catch(console.error)
            // Also refresh transactions — member OIDs can change (e.g. after unlink)
            // which would cause computeKidView to return $0 against stale kidOid values.
            apiFetch<{ transactions: Transaction[] }>('transactions')
              .then(r => setAllTxns(r.transactions))
              .catch(console.error)
          }}
          onRefreshInvites={() => {
            apiFetch<{ codes: FamilyInviteCode[] }>('invites')
              .then(r => setPendingInvites(r.codes.filter(c => !c.used && !c.expired)))
              .catch(console.error)
          }}
          pendingInvites={pendingInvites}
        />
      ) : (
        <UserApp
          currentUserOid={familyData.currentUserOid}
          kidViews={kidViews}
          tithingEnabled={familyData.tithingEnabled}
          onDataChange={() => apiFetch<{ transactions: Transaction[] }>('transactions').then(r => setAllTxns(r.transactions))}
        />
      )}
    </div>
  )
}
