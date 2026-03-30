import React, { useEffect, useState } from 'react';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { EventType } from '@azure/msal-browser';
import type { AuthenticationResult } from '@azure/msal-browser';
import { msalInstance, loginRequest } from './msalConfig';

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
  useEffect(() => {
    // Handle redirect response on page load (auth code exchange result)
    msalInstance.initialize().then(() => {
      msalInstance.handleRedirectPromise().catch((err: unknown) => {
        // Log redirect errors without exposing sensitive details
        console.error('[AuthProvider] Redirect error:', err instanceof Error ? err.message : String(err));
      });
    });

    // Set the active account when a user logs in
    const callbackId = msalInstance.addEventCallback((event) => {
      if (
        event.eventType === EventType.LOGIN_SUCCESS &&
        event.payload
      ) {
        const payload = event.payload as AuthenticationResult;
        msalInstance.setActiveAccount(payload.account);
      }
    });

    return () => {
      if (callbackId) msalInstance.removeEventCallback(callbackId);
    };
  }, []);

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
      // Use redirect flow — more reliable on mobile than popup
      await instance.loginRedirect(loginRequest);
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
    return (
      <div className="auth-signin">
        <div className="auth-signin-card">
          <h1>Allowance App</h1>
          <p>Sign in with your Microsoft account to continue.</p>
          <button
            className="btn btn-primary"
            onClick={handleSignIn}
            disabled={signingIn}
          >
            {signingIn ? 'Redirecting...' : 'Sign in'}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
