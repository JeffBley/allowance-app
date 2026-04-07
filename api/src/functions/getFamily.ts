import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Family } from '../data/models.js';
import { DEFAULT_MEMBER_LIMIT } from '../data/models.js';

// ---------------------------------------------------------------------------
// GET /api/family — returns the current user's family info + all kid profiles
// Accessible by both User and FamilyAdmin roles.
// ---------------------------------------------------------------------------

async function getFamily(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getFamily invoked');

  // 1. Validate JWT
  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  // 2. Resolve family membership
  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  try {
    // 3. Get all users in this family (family-scoped query)
    const usersContainer    = getContainer('users');
    const familiesContainer = getContainer('families');

    const [{ resources: allUsers }, { resource: familyDoc }] = await Promise.all([
      usersContainer.items
        .query<User>({
          query: 'SELECT * FROM c WHERE c.familyId = @familyId',
          parameters: [{ name: '@familyId', value: scope.familyId }],
        })
        .fetchAll(),
      familiesContainer.item(scope.familyId, scope.familyId).read<Family>(),
    ]);

    // 4. Strip sensitive fields before returning to client.
    // Security: User-role callers only receive their own kidSettings.
    // Siblings' financial data (allowanceAmount, balanceOverride, etc.) is
    // trimmed to prevent within-family information disclosure (KI-0088).
    const callerOid = auth.payload.oid;
    const sanitizedUsers = allUsers.map(({ id, oid, displayName, role, kidSettings, isLocalAccount }) => ({
      id,
      oid,
      displayName,
      role,
      // FamilyAdmins see full kidSettings for all members.
      // User-role callers only receive their own kidSettings; peer records get undefined.
      kidSettings: scope.role === 'FamilyAdmin' || oid === callerOid ? kidSettings : undefined,
      isLocalAccount,
    }));

    // 5. Apply saved member order if one exists
    const memberOrder = familyDoc?.memberOrder ?? [];
    if (memberOrder.length > 0) {
      sanitizedUsers.sort((a, b) => {
        const ai = memberOrder.indexOf(a.oid);
        const bi = memberOrder.indexOf(b.oid);
        return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      });
    }

    return {
      status: 200,
      jsonBody: {
        familyId:          scope.familyId,
        // Hide the placeholder name — family admins will be prompted to set a real one
        // on first login; until then familyName is null.
        familyName:        familyDoc?.nameIsPlaceholder ? null : (familyDoc?.name ?? null),
        currentUserOid:    auth.payload.oid,
        currentUserRole:   scope.role,
        memberLimit:       familyDoc?.memberLimit ?? DEFAULT_MEMBER_LIMIT,
        choreBasedIncomeEnabled: familyDoc?.choreBasedIncomeEnabled ?? false,
        tithingEnabled:          familyDoc?.tithingEnabled ?? true,
        members:           sanitizedUsers,
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
