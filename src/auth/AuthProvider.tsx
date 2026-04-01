import React, { useState } from 'react';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { msalInstance, loginRequest } from './msalConfig';

// ---------------------------------------------------------------------------
// Module-level boot error — set by main.tsx before React renders so that
// LoginGate can display what went wrong during MSAL initialization.
// ---------------------------------------------------------------------------
let _bootError: string | null = null;
export function setAuthBootError(msg: string) { _bootError = msg; }
export function getAuthBootError() { return _bootError; }

// ---------------------------------------------------------------------------
// AuthProvider — wraps the app with MSAL context
//
// During development, if VITE_CLIENT_ID is not set, the provider still mounts
// so the mock role-switcher in App.tsx can be used (see DEV_MODE flag).
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // MSAL is initialized and the active account is set before this component
  // mounts (see main.tsx bootstrap). MsalProvider here provides React context.
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}

// ---------------------------------------------------------------------------
// LoginGate — renders children only when authenticated; otherwise shows sign-in
// ---------------------------------------------------------------------------

interface LoginGateProps {
  children: React.ReactNode;
}

export function LoginGate({ children }: LoginGateProps) {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      // Use redirect flow — more reliable on mobile than popup.
      // redirectStartPage tells MSAL to navigate back to the current URL
      // (including any ?invite= query param) after auth completes, rather
      // than always landing at the app root.
      //
      // If the user arrived via an invite link, set prompt=create so Entra
      // External ID shows the sign-up (account creation) flow rather than
      // the default sign-in form — new users following an invite likely don't
      // have an account yet.
      const hasInvite = new URLSearchParams(window.location.search).has('invite');
      await instance.loginRedirect({
        ...loginRequest,
        redirectStartPage: window.location.href,
        ...(hasInvite ? { prompt: 'create' } : {}),
      });
    } catch (err) {
      console.error('[LoginGate] Sign-in error:', err instanceof Error ? err.message : String(err));
      setSigningIn(false);
    }
  };

  if (inProgress !== 'none') {
    return (
      <div className="auth-loading">
        <p>Signing you in...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    const bootError = getAuthBootError();
    return (
      <div className="auth-signin">
        <div className="auth-signin-card">
          <div className="auth-signin-card__logo" aria-hidden="true">💰</div>
          <h1 className="auth-signin-card__title">Allowance App</h1>
          <p className="auth-signin-card__subtitle">
            Track allowances, spending, and savings for your whole family.
          </p>
          {bootError && (
            <div className="auth-signin-card__error" role="alert">
              <strong>Sign-in error:</strong> {bootError}
              <br />
              <button
                className="sa-link"
                type="button"
                style={{ fontSize: '0.8rem', marginTop: 6 }}
                onClick={() => { sessionStorage.clear(); window.location.replace('/'); }}
              >
                Clear session &amp; retry
              </button>
            </div>
          )}
          <button
            className="auth-signin-card__btn"
            onClick={handleSignIn}
            disabled={signingIn}
          >
            {signingIn ? (
              <>
                <span className="auth-signin-card__btn-spinner" aria-hidden="true" />
                Redirecting…
              </>
            ) : (
              'Sign in to continue'
            )}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
