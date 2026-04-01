import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { User, Family } from '../../data/models.js';
import { DEFAULT_MEMBER_LIMIT } from '../../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/superadmin/families/{familyId}/members/local
//
// Creates a local (no sign-in) user account in any family.
//
// Security:
//   - Bootstrap session required
//   - familyId comes from validated URL path
//   - The new user's oid is a server-generated UUID — it cannot sign in to Entra
//   - displayName is sanitised server-side
//   - Member limit is enforced
// ---------------------------------------------------------------------------

async function createLocalMember(
  familyId: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  // Parse and validate request body
  let displayName: string;
  try {
    const body = await request.json() as { displayName?: unknown };
    if (typeof body?.displayName !== 'string' || !body.displayName.trim()) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'displayName' is required." } };
    }
    displayName = body.displayName.trim().replace(/[\x00-\x1f\x7f]/g, '');
    if (displayName.length > 60) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'displayName' must be ≤ 60 characters." } };
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  try {
    const familiesContainer = getContainer('families');
    const usersContainer    = getContainer('users');

    // Verify family exists
    const { resource: family } = await familiesContainer.item(familyId, familyId).read<Family>();
    if (!family) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };
    }

    // Enforce member limit
    const limit = family.memberLimit ?? DEFAULT_MEMBER_LIMIT;
    const { resources: currentMembers } = await usersContainer.items
      .query<{ id: string }>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId',
        parameters: [{ name: '@familyId', value: familyId }],
      })
      .fetchAll();

    if (currentMembers.length >= limit) {
      return {
        status: 409,
        jsonBody: {
          code:    'FAMILY_FULL',
          message: `This family has reached its member limit (${limit}).`,
        },
      };
    }

    const localOid = crypto.randomUUID();
    const now = new Date().toISOString();
    const newUser: User = {
      id:             localOid,
      familyId,
      oid:            localOid,
      displayName,
      role:           'User',
      isLocalAccount: true,
      createdAt:      now,
      updatedAt:      now,
    };

    await usersContainer.items.create(newUser);
    context.log(`superadmin: created local user '${localOid}' ('${displayName}') in family '${familyId}'`);

    return {
      status: 201,
      jsonBody: {
        member: {
          id:             newUser.id,
          oid:            newUser.oid,
          displayName:    newUser.displayName,
          role:           newUser.role,
          isLocalAccount: true,
          createdAt:      newUser.createdAt,
          updatedAt:      newUser.updatedAt,
        } satisfies Partial<User>,
      },
    };
  } catch (err) {
    context.error('superadmin/localMembers POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to create local member.' } };
  }
}

app.http('superadminCreateLocalMember', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/members/local',
  handler: (req, ctx) => {
    const familyId = req.params['familyId'];
    if (!familyId) return Promise.resolve({ status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'familyId is required.' } });
    return createLocalMember(familyId, req, ctx);
  },
});
