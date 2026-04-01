import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';

// ---------------------------------------------------------------------------
// PATCH /api/members/:oid/name — update any family member's display name
//
// Called by a FamilyAdmin from the Settings tab to rename any enrolled member
// (local or Entra-backed). The admin-set name is the source of truth and
// will not be overridden by ID token claims.
//
// Security controls:
//   - Requires a valid Entra JWT (caller must be FamilyAdmin)
//   - Target oid is validated to belong to the caller's family (no cross-family writes)
//   - displayName is server-side trimmed and bounded to 1-60 chars
// ---------------------------------------------------------------------------

interface UpdateNameRequest {
  displayName: string;
}

async function updateMemberName(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateMemberName invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  // Target oid comes from the URL — never trusted for auth, only for lookup
  const targetOid = request.params['oid'] ?? '';
  if (!targetOid) {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Member OID is required.' } };
  }

  let body: UpdateNameRequest;
  try {
    body = await request.json() as UpdateNameRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Request body must be valid JSON.' } };
  }

  const displayName = typeof body?.displayName === 'string'
    ? body.displayName.trim().replace(/\s+/g, ' ')
    : '';

  if (!displayName || displayName.length > 60) {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' must be 1-60 characters.' } };
  }

  try {
    const usersContainer = getContainer('users');

    // Verify the target member exists AND belongs to the caller's family (security boundary)
    const { resource: targetUser } = await usersContainer.item(targetOid, scope.familyId).read();
    if (!targetUser || targetUser.familyId !== scope.familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found in this family.' } };
    }

    // No-op if name is already the same
    if (displayName === targetUser.displayName) {
      return { status: 204 };
    }

    await usersContainer.item(targetOid, scope.familyId).patch([
      { op: 'replace', path: '/displayName', value: displayName },
    ]);

    context.log(`updateMemberName: admin ${auth.payload.oid} renamed member ${targetOid} → '${displayName}'`);
    return { status: 204 };
  } catch (err) {
    context.error('updateMemberName error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update member name.' } };
  }
}

app.http('updateMemberName', {
  methods: ['PATCH'],
  authLevel: 'anonymous', // Auth handled by our JWT middleware
  route: 'members/{oid}/name',
  handler: updateMemberName,
});
