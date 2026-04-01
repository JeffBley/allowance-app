import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider, LoginGate, setAuthBootError } from './auth/AuthProvider'
import { msalInstance } from './auth/msalConfig';

const root = createRoot(document.getElementById('app')!);

// All paths — including /superadmin — go through MSAL auth.
// Super admin UI is embedded inside App and gated by the SuperAdmin app role.
// Initialize before rendering so:
//   1. handleRedirectPromise() processes the auth code return from Entra
//   2. The setActiveAccount callback (registered in msalConfig) fires in time
//   3. useIsAuthenticated() has correct state on first render
msalInstance.initialize()
  .then(() => msalInstance.handleRedirectPromise())
  .then(() => {
    // Fallback: if a cached account exists but none is active (e.g. page
    // refresh without a fresh login event), promote the first cached account.
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(accounts[0]);
    }
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { errorCode?: string })?.errorCode ?? '';

    // Always strip stale OAuth params from the URL. The auth code is already
    // consumed or invalid; leaving ?code=...&state=... causes the same error
    // to fire on every reload until the user navigates away.
    try {
      const url = new URL(window.location.href);
      const oauthParams = ['code', 'state', 'session_state', 'error', 'error_description'];
      if (oauthParams.some(p => url.searchParams.has(p))) {
        oauthParams.forEach(p => url.searchParams.delete(p));
        const cleaned = url.pathname + (url.searchParams.size > 0 ? `?${url.searchParams}` : '') + url.hash;
        window.history.replaceState({}, '', cleaned);
      }
    } catch {
      // Non-fatal — URL cleanup is best-effort
    }

    // MSAL v5: when the browser restores a tab that previously had OAuth params
    // in the URL (e.g. /auth/callback?code=...&state=...), sessionStorage is
    // empty (new session) so MSAL can't find the original request. These errors
    // are expected on browser restore — just fall through to the sign-in screen.
    const RECOVERABLE_CODES = [
      'no_token_request_cache_error',   // cached PKCE/state request is gone
      'no_state_in_hash',               // no state param in callback URL
      'unable_to_parse_state',          // state param is malformed
      'hash_does_not_contain_known_properties', // URL params don't match any pending request
      'state_interaction_type_mismatch',
    ];
    if (RECOVERABLE_CODES.includes(code)) {
      // Silently recover: user will see the sign-in screen and can log in fresh.
      console.warn('[boot] MSAL state mismatch on browser restore (expected):', code);
      return;
    }

    // All other errors are genuine misconfigurations — surface them.
    console.error('[boot] MSAL initialization error:', msg);
    setAuthBootError(msg);
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <AuthProvider>
          <LoginGate>
            <App />
          </LoginGate>
        </AuthProvider>
      </StrictMode>,
    );
  });
