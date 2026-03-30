import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { UpdateSettingsRequest } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/settings — update a kid's allowance settings (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function updateSettings(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateSettings invoked');

  const auth = await validateBearerToken(request);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: UpdateSettingsRequest;
  try {
    body = await request.json() as UpdateSettingsRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!body.kidOid || !body.kidSettings) {
    return { status: 400, jsonBody: { code: 'MISSING_FIELDS', message: 'kidOid and kidSettings are required.' } };
  }

  // Validate the settings object
  const ks = body.kidSettings;
  if (typeof ks.allowanceEnabled !== 'boolean') {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'allowanceEnabled must be a boolean.' } };
  }
  if (ks.allowanceEnabled) {
    if (typeof ks.allowanceAmount !== 'number' || ks.allowanceAmount <= 0) {
      return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'allowanceAmount must be a positive number.' } };
    }
    if (!['Weekly', 'Bi-weekly', 'Monthly'].includes(ks.allowanceFrequency)) {
      return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'allowanceFrequency must be Weekly, Bi-weekly, or Monthly.' } };
    }
  }

  try {
    const usersContainer = getContainer('users');

    // Point-read — kidOid is the document id, familyId is the partition key
    const { resource: kidUser } = await usersContainer.item(body.kidOid, scope.familyId).read();

    if (!kidUser) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Kid not found in this family.' } };
    }

    const updated = {
      ...kidUser,
      kidSettings: body.kidSettings,
      updatedAt: new Date().toISOString(),
    };

    const { resource: saved } = await usersContainer.item(body.kidOid, scope.familyId).replace(updated);

    return {
      status: 200,
      jsonBody: {
        user: {
          oid: saved.oid,
          displayName: saved.displayName,
          role: saved.role,
          kidSettings: saved.kidSettings,
        },
      },
    };
  } catch (err) {
    context.error('updateSettings error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update settings.' } };
  }
}

app.http('updateSettings', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'settings',
  handler: updateSettings,
});
