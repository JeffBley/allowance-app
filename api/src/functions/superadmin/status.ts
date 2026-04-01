import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getContainer } from '../../data/cosmosClient.js';
import type { SystemConfig } from '../../data/models.js';

// ---------------------------------------------------------------------------
// GET /api/superadmin/status
//
// Public endpoint — no auth required. Returns:
//   - bootstrapEnabled: whether the bootstrap credential is currently active
//     (env var AND Cosmos kill-switch flag must both allow it)
//
// This is intentionally minimal: it doesn't expose secrets, counts, or
// configuration details that could aid enumeration attacks.
// ---------------------------------------------------------------------------

async function getStatus(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('superadmin/status invoked');

  const envEnabled = process.env['BOOTSTRAP_ADMIN_ENABLED']?.toLowerCase() === 'true';

  if (!envEnabled) {
    // Short-circuit: env var is the master override — no need to check Cosmos
    return { status: 200, jsonBody: { bootstrapEnabled: false } };
  }

  // Check the Cosmos-level kill-switch (app-level setting)
  try {
    const container = getContainer('families');
    const { resource } = await container
      .item('system-config', 'system')
      .read<SystemConfig>();

    if (resource?.bootstrapDisabled === true) {
      return { status: 200, jsonBody: { bootstrapEnabled: false } };
    }
  } catch {
    // If the config document doesn't exist yet, bootstrap is allowed
    // (document is only created when the admin explicitly disables it)
  }

  return { status: 200, jsonBody: { bootstrapEnabled: true } };
}

app.http('superadminStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'superadmin/status',
  handler: getStatus,
});
