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

  const hasChore      = typeof body.choreBasedIncomeEnabled === 'boolean';
  const hasTithing    = typeof body.tithingEnabled === 'boolean';
  const hasFamilyName = typeof body.familyName === 'string';
  if (!hasChore && !hasTithing && !hasFamilyName) {
    return { status: 400, jsonBody: { code: 'INVALID_FIELD', message: 'Request must include choreBasedIncomeEnabled, tithingEnabled, or familyName.' } };
  }
  if (hasFamilyName) {
    // Strip control characters before validating length so an all-control-char payload
    // doesn't pass the length check then collapse to '' on storage.
    const name = (body.familyName as string).trim().replace(/[\x00-\x1f\x7f]/g, '');
    if (name.length < 1 || name.length > 60) {
      return { status: 400, jsonBody: { code: 'INVALID_FIELD', message: 'familyName must be 1–60 characters.' } };
    }
  }

  try {
    const familiesContainer = getContainer('families');
    const { resource: familyDoc } = await familiesContainer.item(scope.familyId, scope.familyId).read<Family>();
    if (!familyDoc) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family document not found.' } };
    }
    // Capture ETag for conditional replace — prevents last-writer-wins on concurrent admin saves.
    const familyEtag = (familyDoc as Family & { _etag?: string })._etag;

    const updated: Family = { ...familyDoc };
    if (hasChore)      updated.choreBasedIncomeEnabled = body.choreBasedIncomeEnabled;
    if (hasTithing)    updated.tithingEnabled = body.tithingEnabled;
    if (hasFamilyName) {
      // Already validated above after stripping control characters
      updated.name              = (body.familyName as string).trim().replace(/[\x00-\x1f\x7f]/g, '');
      updated.nameIsPlaceholder = false;
    }

    try {
      await familiesContainer.item(scope.familyId, scope.familyId).replace<Family>(
        updated,
        familyEtag ? { accessCondition: { type: 'IfMatch', condition: familyEtag } } : {},
      );
    } catch (replaceErr) {
      const obj = replaceErr as Record<string, unknown>;
      if (obj['code'] === 412 || obj['statusCode'] === 412) {
        return { status: 409, jsonBody: { code: 'CONFLICT', message: 'Family settings were modified concurrently. Please reload and try again.' } };
      }
      throw replaceErr;
    }

    return {
      status: 200,
      jsonBody: {
        choreBasedIncomeEnabled: updated.choreBasedIncomeEnabled ?? false,
        tithingEnabled:          updated.tithingEnabled ?? true,
        familyName:              updated.nameIsPlaceholder ? null : updated.name,
      },
    };
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
