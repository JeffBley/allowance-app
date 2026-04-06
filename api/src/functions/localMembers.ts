import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Family } from '../data/models.js';
import { DEFAULT_MEMBER_LIMIT } from '../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/local-members
//
// Creates a local (no sign-in) user account for the caller's family.
// Only FamilyAdmins can call this endpoint.
//
// Security:
//   - Bearer token required; FamilyAdmin role enforced
//   - familyId is always taken from the validated family scope — never from client input
//   - The new user's oid is a server-generated UUID — it cannot sign in to Entra
//   - displayName is sanitised server-side
//   - Member limit is enforced (same as invite generation)
// ---------------------------------------------------------------------------

async function createLocalMember(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('local-members POST invoked');

  // 1. Validate JWT
  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  // 2. Resolve family scope — must be FamilyAdmin
  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  // 3. Parse and validate request body
  let displayName: string;
  try {
    const body = await request.json() as { displayName?: unknown };
    if (typeof body?.displayName !== 'string' || !body.displayName.trim()) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'displayName' is required." } };
    }
    displayName = body.displayName.trim().replace(/[\x00-\x1f\x7f]/g, '');
    // A value composed entirely of control characters collapses to '' after stripping.
    if (!displayName || displayName.length > 60) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'displayName' must be 1\u201360 characters." } };
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  const { familyId } = scope;

  try {
    const familiesContainer = getContainer('families');
    const usersContainer    = getContainer('users');

    // 4. Check member limit
    const { resource: family } = await familiesContainer.item(familyId, familyId).read<Family>();
    const limit = family?.memberLimit ?? DEFAULT_MEMBER_LIMIT;

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
          message: `This family has reached its member limit (${limit}). Ask a super admin to increase the limit.`,
        },
      };
    }

    // 5. Generate a unique local oid — server-generated UUID, not an Entra OID
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
    context.log(`local-members: created local user '${localOid}' ('${displayName}') in family '${familyId}'`);

    return {
      status: 201,
      jsonBody: {
        member: {
          oid:            newUser.oid,
          displayName:    newUser.displayName,
          role:           newUser.role,
          isLocalAccount: true,
          createdAt:      newUser.createdAt,
        },
      },
    };
  } catch (err) {
    context.error('local-members POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to create local member.' } };
  }
}

app.http('createLocalMember', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'local-members',
  handler: createLocalMember,
});

// ---------------------------------------------------------------------------
// PATCH /api/local-members/{oid}
//
// Renames a local member. Only FamilyAdmins can call this.
// ---------------------------------------------------------------------------
async function updateLocalMember(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('local-members PATCH invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const targetOid = request.params['oid'] as string | undefined;
  if (!targetOid) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Missing oid.' } };

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
    const usersContainer = getContainer('users');
    const { resource: user } = await usersContainer.item(targetOid, scope.familyId).read<User>();

    if (!user || user.familyId !== scope.familyId || !user.isLocalAccount) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Local member not found.' } };
    }

    const updated: User = { ...user, displayName, updatedAt: new Date().toISOString() };
    await usersContainer.item(targetOid, scope.familyId).replace(updated);
    context.log(`local-members PATCH: renamed '${targetOid}' to '${displayName}' in family '${scope.familyId}'`);

    return { status: 200, jsonBody: { oid: updated.oid, displayName: updated.displayName } };
  } catch (err) {
    context.error('local-members PATCH error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update local member.' } };
  }
}

app.http('updateLocalMember', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'local-members/{oid}',
  handler: updateLocalMember,
});

// ---------------------------------------------------------------------------
// DELETE /api/local-members/{oid}
//
// Deletes a local member and all their transactions. Only FamilyAdmins can call this.
// ---------------------------------------------------------------------------
async function deleteLocalMember(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('local-members DELETE invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const targetOid = request.params['oid'] as string | undefined;
  if (!targetOid) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Missing oid.' } };

  try {
    const usersContainer = getContainer('users');
    const { resource: user } = await usersContainer.item(targetOid, scope.familyId).read<User>();

    if (!user || user.familyId !== scope.familyId || !user.isLocalAccount) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Local member not found.' } };
    }

    // Delete all transactions belonging to this local user
    const txnContainer = getContainer('transactions');
    const { resources: txns } = await txnContainer.items
      .query<{ id: string }>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid',
        parameters: [
          { name: '@familyId', value: scope.familyId },
          { name: '@kidOid',   value: targetOid },
        ],
      })
      .fetchAll();

    await Promise.all(txns.map(t => txnContainer.item(t.id, scope.familyId).delete()));
    context.log(`local-members DELETE: removed ${txns.length} transaction(s) for local user '${targetOid}'`);

    // Delete user record
    await usersContainer.item(targetOid, scope.familyId).delete();
    context.log(`local-members DELETE: deleted local user '${targetOid}' from family '${scope.familyId}'`);

    return { status: 204 };
  } catch (err) {
    context.error('local-members DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to delete local member.' } };
  }
}

app.http('deleteLocalMember', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'local-members/{oid}',
  handler: deleteLocalMember,
});
