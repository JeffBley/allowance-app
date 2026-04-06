import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Family } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/family/member-order — save member display order (FamilyAdmin only)
// Body: { order: string[] }  — complete ordered list of member OIDs
// Members not present in the array will be appended in their original order.
// ---------------------------------------------------------------------------

async function updateMemberOrder(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateMemberOrder invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: { order?: unknown };
  try {
    body = await request.json() as { order?: unknown };
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!Array.isArray(body.order) || body.order.some(x => typeof x !== 'string')) {
    return { status: 400, jsonBody: { code: 'INVALID_FIELD', message: "'order' must be an array of strings." } };
  }

  const order = body.order as string[];
  if (order.length > 200) {
    return { status: 400, jsonBody: { code: 'INVALID_FIELD', message: "'order' must have at most 200 entries." } };
  }

  // Deduplicate — each OID should appear only once
  const seen = new Set<string>();
  for (const oid of order) {
    if (seen.has(oid)) {
      return { status: 400, jsonBody: { code: 'INVALID_FIELD', message: "'order' must not contain duplicate OIDs." } };
    }
    seen.add(oid);
  }

  try {
    const familiesContainer = getContainer('families');
    const { resource: familyDoc } = await familiesContainer.item(scope.familyId, scope.familyId).read<Family>();
    if (!familyDoc) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family document not found.' } };
    }

    const updated: Family = { ...familyDoc, memberOrder: order };
    await familiesContainer.item(scope.familyId, scope.familyId).replace<Family>(updated);

    context.log(`updateMemberOrder: saved order for family '${scope.familyId}' (${order.length} entries)`);
    return { status: 200, jsonBody: { ok: true } };
  } catch (err) {
    context.error('updateMemberOrder error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to save member order.' } };
  }
}

app.http('updateMemberOrder', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'family/member-order',
  handler: updateMemberOrder,
});
