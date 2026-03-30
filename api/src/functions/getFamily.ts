import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { User } from '../data/models.js';

// ---------------------------------------------------------------------------
// GET /api/family — returns the current user's family info + all kid profiles
// Accessible by both User and FamilyAdmin roles.
// ---------------------------------------------------------------------------

async function getFamily(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getFamily invoked');

  // 1. Validate JWT
  const auth = await validateBearerToken(request);
  if (!auth) return UNAUTHORIZED;

  // 2. Resolve family membership
  const scope = await resolveFamilyScope(auth.payload.oid);
  if (!scope) return NOT_ENROLLED;

  try {
    // 3. Get all users in this family (family-scoped query)
    const usersContainer = getContainer('users');
    const { resources: allUsers } = await usersContainer.items
      .query<User>({
        query: 'SELECT * FROM c WHERE c.familyId = @familyId',
        parameters: [{ name: '@familyId', value: scope.familyId }],
      })
      .fetchAll();

    // 4. Strip sensitive fields before returning to client
    const sanitizedUsers = allUsers.map(({ id, oid, displayName, role, kidSettings }) => ({
      id,
      oid,
      displayName,
      role,
      kidSettings,
    }));

    return {
      status: 200,
      jsonBody: {
        familyId: scope.familyId,
        currentUserOid: auth.payload.oid,
        currentUserRole: scope.role,
        members: sanitizedUsers,
      },
    };
  } catch (err) {
    context.error('getFamily error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to fetch family data.' } };
  }
}

app.http('getFamily', {
  methods: ['GET'],
  authLevel: 'anonymous', // Auth handled by our JWT middleware
  route: 'family',
  handler: getFamily,
});
