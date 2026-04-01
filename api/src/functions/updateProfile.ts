import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';

// ---------------------------------------------------------------------------
// PATCH /api/profile — update the current user's own display name
//
// Called by the frontend after login when the ID token carries fresh "First Name"
// / "Last Name" custom attribute claims that differ from the stored displayName.
//
// Security controls:
//   - Requires a valid Entra JWT; oid comes from the validated token only
//   - User can only update their own record (oid-scoped point-write)
//   - displayName is trimmed and bounded to 1-60 chars server-side
//   - Returns 204 No Content on success (no data leakage)
// ---------------------------------------------------------------------------

interface UpdateProfileRequest {
  displayName: string;
}

async function updateProfile(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateProfile invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  let body: UpdateProfileRequest;
  try {
    body = await request.json() as UpdateProfileRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Request body must be valid JSON.' } };
  }

  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName || displayName.length > 60) {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' must be 1-60 characters.' } };
  }

  // No-op if nothing changed (avoid unnecessary write)
  if (displayName === scope.user.displayName) {
    return { status: 204 };
  }

  try {
    const usersContainer = getContainer('users');
    // Point-write scoped to the current user's own record — oid is the document id
    await usersContainer.item(scope.user.id, scope.familyId).patch([
      { op: 'replace', path: '/displayName', value: displayName },
    ]);
    context.log(`updateProfile: updated displayName for oid ${auth.payload.oid} → '${displayName}'`);
    return { status: 204 };
  } catch (err) {
    context.error('updateProfile error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update profile.' } };
  }
}

app.http('updateProfile', {
  methods: ['PATCH'],
  authLevel: 'anonymous', // Auth handled by our JWT middleware
  route: 'profile',
  handler: updateProfile,
});
