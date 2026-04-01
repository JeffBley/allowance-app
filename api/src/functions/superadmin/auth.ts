import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSecret, validateBootstrapSession, SA_UNAUTHORIZED, SA_DISABLED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { SystemConfig } from '../../data/models.js';

// ---------------------------------------------------------------------------
// In-memory sliding-window rate limiter for the bootstrap auth endpoint.
//   - 5 attempts per IP per 15 minutes.
//   - Resets on Function App cold start (acceptable for a break-glass endpoint).
//   - Map is pruned on each request to prevent unbounded growth.
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_ATTEMPTS = 5;
const ipAttempts = new Map<string, number[]>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSecs: number } {
  const now    = Date.now();
  const cutoff = now - RATE_WINDOW_MS;

  // Prune expired entries across the map to prevent unbounded growth
  for (const [key, times] of ipAttempts.entries()) {
    if (times.every(t => t <= cutoff)) ipAttempts.delete(key);
  }

  const recent = (ipAttempts.get(ip) ?? []).filter(t => t > cutoff);

  if (recent.length >= RATE_MAX_ATTEMPTS) {
    const retryAfterSecs = Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSecs };
  }

  recent.push(now);
  ipAttempts.set(ip, recent);
  return { allowed: true, retryAfterSecs: 0 };
}

function getClientIp(request: HttpRequest): string {
  // Azure Functions appends the true connecting IP as the LAST entry in
  // x-forwarded-for — the leftmost values are user-controlled and must not
  // be trusted for security decisions. Using the rightmost value prevents
  // an attacker from rotating their apparent IP to bypass the rate limiter.
  const xff = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return xff ?? request.headers.get('client-ip') ?? 'unknown';
}

// ---------------------------------------------------------------------------
// POST /api/superadmin/auth
//
// Exchange the bootstrap secret for a short-lived (4-hour) HS256 session JWT.
//
// Request body: { "secret": "<BOOTSTRAP_ADMIN_SECRET value>" }
// Response:     { "token": "<session JWT>" }
//
// Security:
//   - Returns 401 whether disabled or wrong secret — avoids disclosing which
//     condition caused rejection (prevents targeted enumeration)
//   - In-function sliding-window rate limiter: 5 attempts/IP/15 min
//   - Secret is never logged even on failure
// ---------------------------------------------------------------------------

async function postAuth(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('superadmin/auth invoked');

  // Check env-level kill-switch first
  if (process.env['BOOTSTRAP_ADMIN_ENABLED']?.toLowerCase() !== 'true') {
    return SA_DISABLED;
  }

  // Check Cosmos-level kill-switch
  try {
    const container = getContainer('families');
    const { resource } = await container
      .item('system-config', 'system')
      .read<SystemConfig>();
    if (resource?.bootstrapDisabled === true) return SA_DISABLED;
  } catch {
    // No config doc → bootstrap allowed
  }

  // Rate limit AFTER kill-switch checks (disabled endpoint wastes no counter slots)
  const ip = getClientIp(request);
  const { allowed, retryAfterSecs } = checkRateLimit(ip);
  if (!allowed) {
    context.warn(`superadmin/auth: rate limit exceeded for IP ${ip}`);
    return {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSecs) },
      jsonBody: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' },
    };
  }

  let secret: string | undefined;
  try {
    const body = await request.json() as { secret?: unknown };
    if (typeof body?.secret !== 'string') {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'secret\' string field required.' } };
    }
    secret = body.secret;
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  const token = await validateBootstrapSecret(secret);
  if (!token) {
    // Don't distinguish "disabled" vs "wrong secret"
    context.warn('superadmin/auth: authentication attempt failed (wrong secret or disabled)');
    return SA_UNAUTHORIZED;
  }

  context.log('superadmin/auth: session issued');
  return { status: 200, jsonBody: { token } };
}

// ---------------------------------------------------------------------------
// DELETE /api/superadmin/auth
//
// Disables bootstrap at the Cosmos level. Requires a valid session token.
// This is the in-app "turn off bootstrap" action.
// ---------------------------------------------------------------------------

async function deleteAuth(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('superadmin/auth DELETE invoked (disable bootstrap)');

  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  try {
    const container = getContainer('families');

    // Upsert the system config document to set bootstrapDisabled = true
    await container.items.upsert<SystemConfig>({
      id: 'system-config',
      familyId: 'system',
      bootstrapDisabled: true,
      updatedAt: new Date().toISOString(),
    });

    context.log('superadmin: bootstrap disabled via app setting');
    return {
      status: 200,
      jsonBody: {
        message: 'Bootstrap admin access disabled. Re-enable by setting BOOTSTRAP_ADMIN_ENABLED=true in app settings and removing the system-config document.',
      },
    };
  } catch (err) {
    context.error('superadmin/auth DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

app.http('superadminAuth', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'superadmin/auth',
  handler: async (req, ctx) => {
    if (req.method === 'POST')   return postAuth(req, ctx);
    if (req.method === 'DELETE') return deleteAuth(req, ctx);
    return { status: 405 };
  },
});
