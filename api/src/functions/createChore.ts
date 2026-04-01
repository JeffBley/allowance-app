import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Chore, CreateChoreRequest } from '../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// POST /api/chores — create a chore (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function createChore(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('createChore invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: CreateChoreRequest;
  try {
    body = await request.json() as CreateChoreRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  // Validate name
  const name = (body.name ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!name) {
    return { status: 400, jsonBody: { code: 'MISSING_NAME', message: 'name is required.' } };
  }
  if (name.length > 100) {
    return { status: 400, jsonBody: { code: 'INVALID_NAME', message: 'name must be 100 characters or fewer.' } };
  }

  // Validate amount
  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0 || body.amount > 10000) {
    return { status: 400, jsonBody: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number no greater than 10,000.' } };
  }

  try {
    const container = getContainer('chores');
    const now = new Date().toISOString();

    const chore: Chore = {
      id: randomUUID(),
      familyId: scope.familyId,
      name,
      amount: Math.round(body.amount * 100) / 100, // normalize to 2 decimal places
      isTemplate: body.isTemplate === true,
      createdBy: auth.payload.oid,
      createdAt: now,
    };

    await container.items.create(chore);

    return { status: 201, jsonBody: { chore } };
  } catch (err) {
    context.error('createChore error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to create chore.' } };
  }
}

app.http('createChore', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'chores',
  handler: createChore,
});
