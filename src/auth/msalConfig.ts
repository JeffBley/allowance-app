import type { Configuration, AuthenticationResult } from '@azure/msal-browser';
import { PublicClientApplication, EventType } from '@azure/msal-browser';

// ---------------------------------------------------------------------------
// MSAL configuration for Entra External ID (CIAM)
//
// Environment variables are injected at build time by Vite (VITE_ prefix).
// For local development, copy .env.local.example → .env.local and fill in values.
// For production, AZD injects these from Bicep outputs during `azd deploy`.
//
// Security decisions:
//   - cacheLocation: 'sessionStorage'  → tokens don't persist across browser tabs
//     and are cleared when the browser tab is closed. localStorage would persist
//     across sessions but increases XSS exposure window.
//   - storeAuthStateInCookie: false     → cookies add complexity; session storage
//     is sufficient for this app.
//   - Auth Code + PKCE is enforced by MSAL v2+ for public clients (no client secret).
// ---------------------------------------------------------------------------

const CLIENT_ID = import.meta.env['VITE_CLIENT_ID'] as string;
const TENANT_ID = import.meta.env['VITE_TENANT_ID'] as string;

// Authority URL for Entra External ID — trailing slash is required for CIAM
const AUTHORITY = import.meta.env['VITE_AUTHORITY'] as string ?? 'https://bleytech.ciamlogin.com/';

if (!CLIENT_ID || CLIENT_ID === 'placeholder') {
  console.warn(
    '[msalConfig] VITE_CLIENT_ID is not set. Authentication will not work. ' +
    'Create .env.local with VITE_CLIENT_ID=<your-client-id>.'
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    // CIAM authority — points to bleytech.ciamlogin.com
    authority: AUTHORITY,
    // knownAuthorities must include the CIAM domain to avoid authority validation errors
    knownAuthorities: ['bleytech.ciamlogin.com'],
    redirectUri: `${window.location.origin}/auth/callback`,
    postLogoutRedirectUri: `${window.location.origin}/`,
  },
  cache: {
    // sessionStorage: tokens cleared when tab closes, reducing XSS exposure window
    // vs localStorage which persists across sessions.
    //
    // Note: MSAL Browser v5 removed storeAuthStateInCookie (was a v2/v3 option).
    // The "state is missing" error on browser restore is handled in main.tsx by
    // catching no_token_request_cache_error and similar, cleaning the URL, and
    // silently falling back to the sign-in screen.
    cacheLocation: 'sessionStorage',
  },
};

/**
 * Scopes requested at login (identity only).
 *
 * Best practice: only request OIDC scopes here. The API resource scope is
 * requested separately via acquireTokenSilent in useApi.ts. This prevents
 * login from failing if the API scope hasn't been exposed/consented yet,
 * and follows the principle of least privilege at sign-in time.
 */
export const loginRequest = {
  scopes: [
    'openid',
    'profile',
    'offline_access',
  ],
};

/**
 * Scopes to request when acquiring tokens silently for API calls.
 * Omit OIDC scopes — only request the API scope for access tokens.
 */
export const apiTokenRequest = {
  scopes: [`api://${CLIENT_ID}/AllowanceApp.Access`],
};

/** API base URL — injected by Vite from the AZD output at build time. */
export const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
export const TENANT_ID_VALUE = TENANT_ID;

/**
 * Decodes the payload of a JWT access token without verifying the signature.
 * Safe to use client-side for cosmetic purposes (display name) only.
 * Never use this for authorization decisions.
 */
export function parseAccessTokenClaims(accessToken: string): Record<string, unknown> {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return {}
    // Pad base64url to standard base64 before decoding
    const padded  = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4), '='
    )
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Extracts the user's sign-in email address from token claims.
 *
 * In Entra External ID (CIAM), the `email` claim in the ID token holds the
 * address the user signed up with — this is always a real email, never a
 * GUID-based UPN. Falls back to `preferred_username` if present and looks
 * like email, then to `account.username` as a last resort.
 */
export function getSignInEmail(
  account: import('@azure/msal-browser').AccountInfo | undefined | null,
  accessTokenClaims?: Record<string, unknown>,
): string {
  if (!account) return '';
  const claims = account.idTokenClaims as Record<string, unknown> | undefined
  // email claim is the canonical real email in External ID ID tokens
  const emailClaim = typeof claims?.['email'] === 'string' ? claims['email'].trim()
                     : typeof accessTokenClaims?.['email'] === 'string' ? (accessTokenClaims['email'] as string).trim()
                     : ''
  if (emailClaim) return emailClaim;
  // preferred_username is sometimes the real email (not valid for CIAM UPNs)
  const preferred = typeof claims?.['preferred_username'] === 'string' ? (claims['preferred_username'] as string).trim() : ''
  if (preferred && preferred.includes('@') && !preferred.endsWith('.onmicrosoft.com')) return preferred;
  // Last resort — account.username may be a GUID UPN in CIAM tenants
  return account.username ?? '';
}

/**
 * Builds a display name from MSAL account claims.
 *
 * Priority order:
 *   1. "First Name" + "Last Name" custom claims from the ID token
 *      (Entra CIAM custom attributes, emitted with the exact display-name
 *      of the attribute as the claim key)
 *   2. given_name + family_name (standard OIDC claims — kept as fallback
 *      for accounts that pre-date the custom attribute migration)
 *   3. name claim (may be "unknown" in CIAM until user attributes are collected)
 *   4. real email from the email claim (never the GUID-based CIAM UPN)
 */
export function getDisplayName(
  account: import('@azure/msal-browser').AccountInfo | undefined | null,
  accessTokenClaims?: Record<string, unknown>,
): string {
  if (!account) return '';
  const claims = account.idTokenClaims as Record<string, unknown> | undefined

  // 1. Custom attributes: "First_Name" / "Last_Name" (ID token, then AT fallback)
  const customGiven  = typeof claims?.['First_Name']  === 'string' ? claims['First_Name'].trim()
                       : typeof accessTokenClaims?.['First_Name'] === 'string' ? (accessTokenClaims['First_Name'] as string).trim()
                       : ''
  const customFamily = typeof claims?.['Last_Name']   === 'string' ? claims['Last_Name'].trim()
                       : typeof accessTokenClaims?.['Last_Name'] === 'string' ? (accessTokenClaims['Last_Name'] as string).trim()
                       : ''
  if (customGiven || customFamily) return [customGiven, customFamily].filter(Boolean).join(' ');

  // 2. Standard OIDC claims fallback (given_name / family_name)
  const given  = typeof claims?.['given_name']  === 'string' ? claims['given_name'].trim()
                 : typeof accessTokenClaims?.['given_name'] === 'string' ? (accessTokenClaims['given_name'] as string).trim()
                 : ''
  const family = typeof claims?.['family_name'] === 'string' ? claims['family_name'].trim()
                 : typeof accessTokenClaims?.['family_name'] === 'string' ? (accessTokenClaims['family_name'] as string).trim()
                 : ''
  if (given || family) return [given, family].filter(Boolean).join(' ');

  const name = account.name?.trim();
  if (name && name.toLowerCase() !== 'unknown') return name;
  // Use real email rather than the GUID-based CIAM UPN
  return getSignInEmail(account, accessTokenClaims);
}

export const msalInstance = new PublicClientApplication(msalConfig);

// ---------------------------------------------------------------------------
// Register the setActiveAccount callback at module-load time — BEFORE any
// rendering — so it fires when MsalProvider processes the redirect response.
//
// If this were registered in a useEffect it would run after the first render,
// meaning MsalProvider could fire LOGIN_SUCCESS before the listener exists,
// leaving no active account and causing useIsAuthenticated() to return false.
// ---------------------------------------------------------------------------
msalInstance.addEventCallback((event) => {
  if (
    (
      event.eventType === EventType.LOGIN_SUCCESS ||
      event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
    ) &&
    event.payload
  ) {
    const payload = event.payload as AuthenticationResult;
    if (payload.account) {
      msalInstance.setActiveAccount(payload.account);
    }
  }
});
