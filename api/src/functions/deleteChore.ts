import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Chore } from '../data/models.js';

// ---------------------------------------------------------------------------
// DELETE /api/chores/{choreId} — delete a chore (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function deleteChore(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('deleteChore invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const choreId = request.params['choreId'];
  if (!choreId) {
    return { status: 400, jsonBody: { code: 'MISSING_ID', message: 'choreId is required.' } };
  }

  try {
    const container = getContainer('chores');
    // Read first to confirm the chore belongs to this family
    const { resource: existing } = await container.item(choreId, scope.familyId).read<Chore>();
    if (!existing || existing.familyId !== scope.familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Chore not found.' } };
    }

    await container.item(choreId, scope.familyId).delete();

    return { status: 204 };
  } catch (err) {
    context.error('deleteChore error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to delete chore.' } };
  }
}

app.http('deleteChore', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'chores/{choreId}',
  handler: deleteChore,
});
