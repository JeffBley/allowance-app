import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import type { HttpRequest, InvocationContext } from '@azure/functions';

// ---------------------------------------------------------------------------
// JWT validation for Entra External ID (CIAM) tokens
//
// Security controls applied:
//   - Signature validated via JWKS (remote key set, cached per Function instance)
//   - Issuer validated against expected External ID tenant
//   - Audience validated against known client ID
//   - Expiry (exp) and not-before (nbf) validated by jose automatically
// ---------------------------------------------------------------------------

// Read config from environment (set in azure.yaml → infra → App Settings)
const TENANT_ID = process.env['EXTERNAL_ID_TENANT_ID'] ?? '';
const CLIENT_ID = process.env['EXTERNAL_ID_CLIENT_ID'] ?? '';

if (!TENANT_ID || !CLIENT_ID) {
  // Log a warning at startup — functions will return 401 for all requests until configured.
  console.warn('[auth] EXTERNAL_ID_TENANT_ID or EXTERNAL_ID_CLIENT_ID is not set. All API calls will be rejected.');
}

// ---------------------------------------------------------------------------
// Entra External ID (CIAM) uses the tenant ID as the subdomain for token
// issuance — regardless of any custom domain used for the login UX.
//
// Token iss format: https://{tenantId}.ciamlogin.com/{tenantId}/v2.0
// Custom domain (bleytech.ciamlogin.com) is login UX only; tokens always
// carry the GUID-subdomain issuer.
// ---------------------------------------------------------------------------
const CIAM_BASE = `https://${TENANT_ID}.ciamlogin.com`;

// JWKS endpoint — fetched from the tenant ID subdomain authority
const JWKS_URI = new URL(`/${TENANT_ID}/discovery/v2.0/keys`, CIAM_BASE);

// Expected token issuer — must match exactly what Entra puts in the iss claim
const EXPECTED_ISSUER = `${CIAM_BASE}/${TENANT_ID}/v2.0`;

/**
 * Remote JWKS set — cached in memory for the lifetime of the Function App instance.
 * jose automatically handles JWKS key rotation by re-fetching on unknown key ID.
 */
const JWKS = createRemoteJWKSet(JWKS_URI, {
  // Cache keys for up to 10 minutes; on unknown kid, re-fetch immediately
  cacheMaxAge: 600_000,
  cooldownDuration: 30_000,
});

export interface AuthResult {
  /** Validated JWT payload with oid guaranteed present */
  payload: JWTPayload & { oid: string };
}

/**
 * Validates the Bearer token in the Authorization header.
 *
 * @throws Never — returns null on failure so callers can return 401/403 cleanly.
 */
export async function validateBearerToken(request: HttpRequest, context?: InvocationContext): Promise<AuthResult | null> {
  const logWarn = (msg: string) => context ? context.warn(msg) : console.warn(msg);
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null; // Missing or malformed Authorization header
    }

    const token = authHeader.slice(7); // Strip "Bearer "

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: EXPECTED_ISSUER,
      audience: CLIENT_ID,
      // jose validates exp and nbf automatically
    });

    // oid claim is required — used to look up family membership
    const oid = payload['oid'];
    if (typeof oid !== 'string' || !oid) {
      logWarn('[auth] Token missing oid claim');
      return null;
    }

    return { payload: { ...payload, oid } };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logWarn(`[auth] Token validation failed: ${errMessage}`);
    return null;
  }
}

/** Shared 401 response body */
export const UNAUTHORIZED = { status: 401, jsonBody: { code: 'UNAUTHORIZED', message: 'Valid Bearer token required.' } } as const;

/** Shared 403 response body */
export const FORBIDDEN = { status: 403, jsonBody: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } } as const;
