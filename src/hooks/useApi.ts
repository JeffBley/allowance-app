import { useMsal } from '@azure/msal-react';
import { BrowserAuthError, InteractionRequiredAuthError } from '@azure/msal-browser';
import { useCallback } from 'react';
import { apiTokenRequest, API_BASE_URL } from '../auth/msalConfig';

/**
 * Browser-side MSAL error codes that indicate the local cache is in a bad
 * state and a full reset (clearCache + sign-in) is the correct recovery.
 *
 * These commonly happen when:
 *  - A previous redirect was interrupted, leaving `interaction_in_progress`
 *  - Third-party cookies are blocked, breaking silent iframe renew
 *    (`monitor_window_timeout`, `empty_window_error`)
 *  - Browser was restored from a snapshot with stale PKCE state
 *
 * These are NOT server errors — auto-redirecting via acquireTokenRedirect
 * can loop or fail silently, so we surface them to the UI for an explicit
 * user-initiated reset (KI-0102).
 */
const STALE_BROWSER_AUTH_CODES = new Set<string>([
  'interaction_in_progress',
  'monitor_window_timeout',
  'empty_window_error',
  'no_token_request_cache_error',
  'invalid_state',
  'hash_empty_error',
]);

function isAuthCacheStale(err: unknown): boolean {
  if (err instanceof InteractionRequiredAuthError) return true;
  if (err instanceof BrowserAuthError) {
    return STALE_BROWSER_AUTH_CODES.has(err.errorCode);
  }
  return false;
}

// ---------------------------------------------------------------------------
// useApi — authenticated fetch hook
//
// Acquires an access token silently (using refresh token) before each request.
// Falls back to interactive redirect if the token can't be obtained silently
// (e.g., session expired, consent required).
//
// Security:
//   - Token is passed in Authorization header (not URL) to avoid logging exposure
//   - Never caches tokens in component state — always fetches from MSAL cache
//   - Does not log token values
// ---------------------------------------------------------------------------

export type FetchOptions = Omit<RequestInit, 'headers'>;

export function useApi() {
  const { instance, accounts } = useMsal();

  const apiFetch = useCallback(
    async <T>(path: string, options: FetchOptions = {}): Promise<T> => {
      // Acquire token silently; fall back to redirect if interaction is required
      let accessToken: string;
      try {
        const account = accounts[0];
        if (!account) throw new Error('No authenticated account found.');

        const tokenResponse = await instance.acquireTokenSilent({
          ...apiTokenRequest,
          account,
        });
        accessToken = tokenResponse.accessToken;
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) {
          // Session expired or consent needed — redirect to sign-in
          await instance.acquireTokenRedirect({ ...apiTokenRequest, account: accounts[0] });
          // acquireTokenRedirect never returns; the page will redirect
          throw err;
        }
        // Tag stale-cache errors so the UI can offer a "reset & sign in" recovery
        // without auto-redirecting (which can loop). See KI-0102.
        if (isAuthCacheStale(err)) {
          throw Object.assign(
            new Error('Authentication cache is stale. Please reset session.'),
            { _authStale: true, _source: 'auth', cause: err }
          );
        }
        throw err;
      }

      const url = `${API_BASE_URL}/${path.replace(/^\//, '')}`;
      let response: Response;
      try {
        response = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            // Bearer token in Authorization header — never in URL
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } catch (netErr) {
        // fetch() rejects on network failures (DNS, offline, CORS preflight
        // failure, TLS error). These produce no HTTP status. Tag so the UI
        // can show a network-specific message instead of "API error".
        throw Object.assign(
          new Error('Network request failed.'),
          { _networkError: true, cause: netErr }
        );
      }

      if (!response.ok) {
        // Parse error body if available, otherwise use status text
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = { message: response.statusText };
        }
        throw Object.assign(new Error(`API error ${response.status}`), {
          status: response.status,
          body: errorBody,
        });
      }

      // 204 No Content — return empty object
      if (response.status === 204) return {} as T;

      return response.json() as Promise<T>;
    },
    [instance, accounts]
  );

  return { apiFetch };
}
