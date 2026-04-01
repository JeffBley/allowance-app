import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer, generateFamilyId } from '../../data/cosmosClient.js';
import type { Family, User } from '../../data/models.js';

// ---------------------------------------------------------------------------
// GET  /api/superadmin/families  — list all families
// POST /api/superadmin/families  — create a new family
// ---------------------------------------------------------------------------

async function getFamilies(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  try {
    const familiesContainer = getContainer('families');
    const usersContainer    = getContainer('users');

    // Fetch all family documents (exclude the system-config document)
    const { resources: families } = await familiesContainer.items
      .query<Family & { _ts?: number }>({
        query: 'SELECT * FROM c WHERE c.id != @sysId ORDER BY c._ts DESC',
        parameters: [{ name: '@sysId', value: 'system-config' }],
      })
      .fetchAll();

    // Fetch member counts per family in one cross-partition query
    const { resources: memberCounts } = await usersContainer.items
      .query<{ familyId: string; memberCount: number }>({
        query: 'SELECT c.familyId, COUNT(1) AS memberCount FROM c GROUP BY c.familyId',
      })
      .fetchAll();

    const countMap = Object.fromEntries(memberCounts.map(r => [r.familyId, r.memberCount]));

    const result = families.map(f => ({
      id:          f.id,
      familyId:    f.familyId,
      name:        f.name,
      createdAt:   f.createdAt,
      memberCount: countMap[f.familyId] ?? 0,
    }));

    return { status: 200, jsonBody: { families: result } };
  } catch (err) {
    context.error('superadmin/families GET error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function createFamily(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: { name: string };
  try {
    body = await request.json() as { name: string };
    if (typeof body?.name !== 'string' || body.name.trim().length < 1 || body.name.length > 100) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'name\' must be 1-100 characters.' } };
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  try {
    const container = getContainer('families');
    const now = new Date().toISOString();

    // Generate a unique 8-char ID — retry on the rare collision
    let familyId: string;
    let attempts = 0;
    do {
      familyId = generateFamilyId();
      const { resource: existing } = await container.item(familyId, familyId).read<Family>();
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    if (attempts >= 5) {
      return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Could not generate unique family ID.' } };
    }

    const newFamily: Family = {
      id:        familyId,
      familyId:  familyId,
      name:      body.name.trim(),
      createdAt: now,
    };

    await container.items.create(newFamily);
    context.log(`superadmin: created family '${familyId}' ("${newFamily.name}")`);
    return { status: 201, jsonBody: { family: newFamily } };
  } catch (err) {
    context.error('superadmin/families POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

app.http('superadminFamilies', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families',
  handler: async (req, ctx) => {
    if (req.method === 'GET')  return getFamilies(req, ctx);
    if (req.method === 'POST') return createFamily(req, ctx);
    return { status: 405 };
  },
});
