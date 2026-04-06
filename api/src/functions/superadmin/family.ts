import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { Family, User, UpdateFamilyRequest } from '../../data/models.js';
import { DEFAULT_MEMBER_LIMIT } from '../../data/models.js';

// ---------------------------------------------------------------------------
// GET    /api/superadmin/families/{familyId}   — get family + its members
// PUT    /api/superadmin/families/{familyId}   — update family name
// DELETE /api/superadmin/families/{familyId}   — delete family + all its users
// ---------------------------------------------------------------------------

async function getFamily(familyId: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  try {
    const familiesContainer = getContainer('families');
    const usersContainer    = getContainer('users');

    const { resource: family } = await familiesContainer.item(familyId, familyId).read<Family>();
    if (!family) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };

    const { resources: members } = await usersContainer.items
      .query<User>({
        query: 'SELECT * FROM c WHERE c.familyId = @familyId',
        parameters: [{ name: '@familyId', value: familyId }],
      })
      .fetchAll();

    return {
      status: 200,
      jsonBody: {
        family: {
          id:          family.id,
          familyId:    family.familyId,
          name:        family.name,
          createdAt:   family.createdAt,
          memberLimit: family.memberLimit ?? DEFAULT_MEMBER_LIMIT,
        },
        members: members.map(m => ({
          id:             m.id,
          oid:            m.oid,
          displayName:    m.displayName,
          role:           m.role,
          isLocalAccount: m.isLocalAccount ?? false,
          kidSettings:    m.kidSettings,
          createdAt:      m.createdAt,
          updatedAt:      m.updatedAt,
        })),
      },
    };
  } catch (err) {
    context.error('superadmin/family GET error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function updateFamily(familyId: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: UpdateFamilyRequest;
  try {
    body = await request.json() as UpdateFamilyRequest;
    if (typeof body?.name !== 'string' || body.name.trim().length < 1 || body.name.length > 100) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'name' (1\u2013100 chars) is required." } };
    }
    if (body.memberLimit !== undefined) {
      if (!Number.isInteger(body.memberLimit) || body.memberLimit < 1 || body.memberLimit > 100) {
        return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'memberLimit' must be an integer between 1 and 100." } };
      }
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  try {
    const container = getContainer('families');
    const { resource: existing } = await container.item(familyId, familyId).read<Family>();
    if (!existing) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };

    const updated: Family = {
      ...existing,
      // Strip control characters for consistency with member/chore name sanitization
      name: body.name.trim().replace(/[\x00-\x1f\x7f]/g, ''),
      memberLimit: body.memberLimit ?? existing.memberLimit,
    };
    await container.item(familyId, familyId).replace(updated);
    context.log(`superadmin: updated family '${familyId}' (name=${updated.name}, memberLimit=${updated.memberLimit ?? DEFAULT_MEMBER_LIMIT})`);
    return {
      status: 200,
      jsonBody: {
        family: {
          ...updated,
          memberLimit: updated.memberLimit ?? DEFAULT_MEMBER_LIMIT,
        },
      },
    };
  } catch (err) {
    context.error('superadmin/family PUT error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function deleteFamily(familyId: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  try {
    const familiesContainer = getContainer('families');
    const usersContainer    = getContainer('users');
    const txnContainer      = getContainer('transactions');
    const inviteContainer   = getContainer('inviteCodes');

    const { resource: existing } = await familiesContainer.item(familyId, familyId).read<Family>();
    if (!existing) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };

    // Fetch all documents to delete across all containers in parallel
    const [
      { resources: users },
      { resources: txns },
      { resources: invites },
    ] = await Promise.all([
      usersContainer.items.query<{ id: string }>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId',
        parameters: [{ name: '@familyId', value: familyId }],
      }).fetchAll(),
      txnContainer.items.query<{ id: string }>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId',
        parameters: [{ name: '@familyId', value: familyId }],
      }).fetchAll(),
      // inviteCodes use the code itself as partition key — cross-partition query by familyId
      inviteContainer.items.query<{ id: string }>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId',
        parameters: [{ name: '@familyId', value: familyId }],
      }).fetchAll(),
    ]);

    // Delete all collected documents in parallel across all containers
    await Promise.all([
      ...users.map(u    => usersContainer.item(u.id, familyId).delete()),
      ...txns.map(t     => txnContainer.item(t.id, familyId).delete()),
      // inviteCodes: partition key = code id (not familyId)
      ...invites.map(c  => inviteContainer.item(c.id, c.id).delete()),
    ]);

    // Delete the family document itself
    await familiesContainer.item(familyId, familyId).delete();

    context.log(`superadmin: deleted family '${familyId}' + ${users.length} members, ${txns.length} txns, ${invites.length} invite codes`);
    return { status: 200, jsonBody: { deleted: { familyId, memberCount: users.length } } };
  } catch (err) {
    context.error('superadmin/family DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

app.http('superadminFamily', {
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}',
  handler: async (req, ctx) => {
    const familyId = req.params['familyId'];
    if (!familyId) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'familyId required.' } };
    if (req.method === 'GET')    return getFamily(familyId, req, ctx);
    if (req.method === 'PUT')    return updateFamily(familyId, req, ctx);
    if (req.method === 'DELETE') return deleteFamily(familyId, req, ctx);
    return { status: 405 };
  },
});
