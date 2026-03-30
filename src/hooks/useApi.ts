import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useCallback } from 'react';
import { apiTokenRequest, API_BASE_URL } from '../auth/msalConfig';

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
        throw err;
      }

      const url = `${API_BASE_URL}/${path.replace(/^\//, '')}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          // Bearer token in Authorization header — never in URL
          Authorization: `Bearer ${accessToken}`,
        },
      });

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
