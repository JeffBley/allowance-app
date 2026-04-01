import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { validateBearerToken } from './auth.js';

// ---------------------------------------------------------------------------
// Bootstrap super-admin authentication
//
// Two accepted auth paths for super-admin endpoints:
//
//   1. Bootstrap secret (break-glass):
//      - POST /api/superadmin/auth with raw secret → session JWT
//      - Subsequent calls: Authorization: Bootstrap <jwt>
//      - Controlled by BOOTSTRAP_ADMIN_ENABLED env var
//
//   2. Entra SSO with SuperAdmin app role:
//      - Authorization: Bearer <msal-access-token>
//      - Token must have roles: ["SuperAdmin"] claim
//      - App role defined in Entra app registration
//
// Security controls:
//   - Raw secret transmitted ONCE; all subsequent calls use signed session JWT
//   - Session JWT carries only role claim, no user identity
//   - MSAL path validates full token (issuer, audience, signature, exp)
//   - Fails closed: missing/malformed config → all calls rejected
// ---------------------------------------------------------------------------

const SESSION_DURATION_SECONDS = 4 * 60 * 60; // 4 hours

function getSecret(): Uint8Array {
  const secret = process.env['BOOTSTRAP_ADMIN_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('BOOTSTRAP_ADMIN_SECRET is not set or is too short (minimum 32 characters).');
  }
  return new TextEncoder().encode(secret);
}

function isBootstrapEnabled(): boolean {
  return process.env['BOOTSTRAP_ADMIN_ENABLED']?.toLowerCase() === 'true';
}

/**
 * Validates the raw bootstrap secret and returns a signed session JWT if valid.
 * Returns null if bootstrap is disabled or the secret is wrong.
 */
export async function validateBootstrapSecret(candidateSecret: string): Promise<string | null> {
  if (!isBootstrapEnabled()) return null;

  const expected = process.env['BOOTSTRAP_ADMIN_SECRET'];
  if (!expected) return null;

  // Constant-time comparison to mitigate timing attacks
  if (!timingSafeStringEqual(candidateSecret, expected)) return null;

  try {
    const secret = getSecret();
    const token = await new SignJWT({ role: 'superadmin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
      .setJti(crypto.randomUUID())
      .setIssuer('allowance-app/bootstrap')
      .setAudience('allowance-app/superadmin')
      .sign(secret);
    return token;
  } catch {
    return null;
  }
}

export interface SuperAdminAuthResult {
  role: 'superadmin';
  /** OID of the authenticated user — present for SSO path, undefined for bootstrap path */
  oid?: string;
  /** Which auth method was used */
  method: 'bootstrap' | 'sso';
}

/**
 * Validates a super-admin request. Accepts either:
 *   - Bootstrap session JWT  → Authorization: Bootstrap <token>
 *   - MSAL Bearer token with roles: ["SuperAdmin"]  → Authorization: Bearer <token>
 *
 * Returns null (→ 401) if neither path succeeds.
 */
export async function validateBootstrapSession(
  request: HttpRequest,
  context?: InvocationContext,
): Promise<SuperAdminAuthResult | null> {
  const authHeader = request.headers.get('authorization') ?? '';

  // Path 1: MSAL Bearer token with SuperAdmin app role
  if (authHeader.startsWith('Bearer ')) {
    const auth = await validateBearerToken(request, context);
    if (!auth) return null;

    const roles = auth.payload['roles'];
    const hasRole = Array.isArray(roles) && roles.includes('SuperAdmin');
    if (!hasRole) {
      (context ?? console).warn(`[superadminAuth] Bearer token present but missing SuperAdmin role (oid: ${auth.payload.oid})`);
      return null;
    }
    return { role: 'superadmin', oid: auth.payload.oid, method: 'sso' };
  }

  // Path 2: Bootstrap session JWT (break-glass)
  if (authHeader.startsWith('Bootstrap ')) {
    if (!isBootstrapEnabled()) return null;
    try {
      const token = authHeader.slice(10);
      const secret = getSecret();
      const { payload } = await jwtVerify(token, secret, {
        issuer: 'allowance-app/bootstrap',
        audience: 'allowance-app/superadmin',
        requiredClaims: ['role', 'jti', 'exp'],
      });
      if ((payload as JWTPayload & { role?: string }).role !== 'superadmin') return null;
      return { role: 'superadmin', method: 'bootstrap' };
    } catch {
      return null;
    }
  }

  return null;
}

/** Constant-time string comparison to mitigate timing attacks */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Encode both as UTF-8 bytes and pad to the same length before comparing.
  // Length difference is still leaked (different buffer sizes), so we always
  // compare against the longer of the two to keep iteration count consistent.
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ba.length, bb.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  // timingSafeEqual requires same-length buffers and is constant-time
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

/** Canonical 401 response for super-admin endpoints */
export const SA_UNAUTHORIZED = {
  status: 401,
  jsonBody: { code: 'SA_UNAUTHORIZED', message: 'Super admin access required. Sign in with an account that has the SuperAdmin role, or use the bootstrap secret.' },
} as const;

/** Canonical 403 response when bootstrap is explicitly disabled */
export const SA_DISABLED = {
  status: 403,
  jsonBody: {
    code: 'BOOTSTRAP_DISABLED',
    message: 'Bootstrap admin access is disabled. Use SSO.',
  },
} as const;
