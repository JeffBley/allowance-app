import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Chore, UpdateChoreRequest } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/chores/{choreId} — update a chore (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function updateChore(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateChore invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const choreId = request.params['choreId'];
  if (!choreId) {
    return { status: 400, jsonBody: { code: 'MISSING_ID', message: 'choreId is required.' } };
  }

  let body: UpdateChoreRequest;
  try {
    body = await request.json() as UpdateChoreRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  try {
    const container = getContainer('chores');
    const { resource: existing } = await container.item(choreId, scope.familyId).read<Chore>();
    if (!existing || existing.familyId !== scope.familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Chore not found.' } };
    }

    const update: Chore = { ...existing };

    if (body.name !== undefined) {
      const name = body.name.replace(/[\x00-\x1f\x7f]/g, '').trim();
      if (!name) return { status: 400, jsonBody: { code: 'INVALID_NAME', message: 'name cannot be empty.' } };
      if (name.length > 100) return { status: 400, jsonBody: { code: 'INVALID_NAME', message: 'name must be 100 characters or fewer.' } };
      update.name = name;
    }

    if (body.amount !== undefined) {
      if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0 || body.amount > 10000) {
        return { status: 400, jsonBody: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number no greater than 10,000.' } };
      }
      update.amount = Math.round(body.amount * 100) / 100;
    }

    if (body.isTemplate !== undefined) {
      update.isTemplate = body.isTemplate === true;
    }

    await container.item(choreId, scope.familyId).replace(update);

    return { status: 200, jsonBody: { chore: update } };
  } catch (err) {
    context.error('updateChore error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update chore.' } };
  }
}

app.http('updateChore', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'chores/{choreId}',
  handler: updateChore,
});
