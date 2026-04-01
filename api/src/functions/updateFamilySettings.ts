import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Family, UpdateFamilySettingsRequest } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/family/settings — update family-level settings (FamilyAdmin only)
//
// Currently supports: choreBasedIncomeEnabled
// ---------------------------------------------------------------------------

async function updateFamilySettings(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateFamilySettings invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: UpdateFamilySettingsRequest;
  try {
    body = await request.json() as UpdateFamilySettingsRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (typeof body.choreBasedIncomeEnabled !== 'boolean') {
    return { status: 400, jsonBody: { code: 'INVALID_FIELD', message: 'choreBasedIncomeEnabled must be a boolean.' } };
  }

  try {
    const familiesContainer = getContainer('families');
    const { resource: familyDoc } = await familiesContainer.item(scope.familyId, scope.familyId).read<Family>();
    if (!familyDoc) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family document not found.' } };
    }

    await familiesContainer.item(scope.familyId, scope.familyId).replace<Family>({
      ...familyDoc,
      choreBasedIncomeEnabled: body.choreBasedIncomeEnabled,
    });

    return { status: 200, jsonBody: { choreBasedIncomeEnabled: body.choreBasedIncomeEnabled } };
  } catch (err) {
    context.error('updateFamilySettings error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update family settings.' } };
  }
}

app.http('updateFamilySettings', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'family/settings',
  handler: updateFamilySettings,
});
