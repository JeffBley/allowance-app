import type { Configuration } from '@azure/msal-browser';
import { PublicClientApplication } from '@azure/msal-browser';

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
    cacheLocation: 'sessionStorage',
  },
};

/**
 * Scopes requested at login.
 * - openid, profile: standard OIDC scopes for user identity claims (incl. oid)
 * - offline_access: enables refresh token rotation for silent token renewal
 * - api scope: grants access to the Azure Functions backend
 */
export const loginRequest = {
  scopes: [
    'openid',
    'profile',
    'offline_access',
    `api://${CLIENT_ID}/AllowanceApp.Access`,
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

export const msalInstance = new PublicClientApplication(msalConfig);
