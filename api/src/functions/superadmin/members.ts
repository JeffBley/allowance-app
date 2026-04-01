import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { User, CreateMemberRequest, UpdateMemberRequest } from '../../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/superadmin/families/{familyId}/members     — add member to family
// PUT  /api/superadmin/families/{familyId}/members/{oid} — update member
// DELETE /api/superadmin/families/{familyId}/members/{oid} — remove member
// ---------------------------------------------------------------------------

async function createMember(familyId: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: CreateMemberRequest;
  try {
    body = await request.json() as CreateMemberRequest;
    if (typeof body?.oid !== 'string' || !body.oid.trim()) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'oid\' is required.' } };
    }
    if (typeof body?.displayName !== 'string' || !body.displayName.trim()) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' is required.' } };
    }
    if (body.role !== 'User' && body.role !== 'FamilyAdmin') {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'role\' must be \'User\' or \'FamilyAdmin\'.' } };
    }
    // Sanitize displayName — strip control characters
    body.displayName = body.displayName.trim().replace(/[\x00-\x1f\x7f]/g, '');
    if (body.displayName.length > 100) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' must be ≤ 100 characters.' } };
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  try {
    // Verify the family exists
    const familiesContainer = getContainer('families');
    const { resource: family } = await familiesContainer.item(familyId, familyId).read();
    if (!family) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };

    const usersContainer = getContainer('users');

    // Check if this oid is already in a family (oid should be globally unique)
    const { resources: existing } = await usersContainer.items
      .query<User>({
        query: 'SELECT c.id, c.familyId FROM c WHERE c.oid = @oid',
        parameters: [{ name: '@oid', value: body.oid }],
      }).fetchAll();

    if (existing.length > 0) {
      return {
        status: 409,
        jsonBody: {
          code: 'CONFLICT',
          message: `A user with oid '${body.oid}' already exists (in family '${existing[0].familyId}').`,
        },
      };
    }

    const now = new Date().toISOString();
    const newUser: User = {
      id:          body.oid,
      familyId,
      oid:         body.oid,
      displayName: body.displayName,
      role:        body.role,
      kidSettings: body.kidSettings,
      createdAt:   now,
      updatedAt:   now,
    };

    await usersContainer.items.create(newUser);
    context.log(`superadmin: added member '${body.oid}' (${body.role}) to family '${familyId}'`);
    return { status: 201, jsonBody: { member: newUser } };
  } catch (err) {
    context.error('superadmin/members POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function updateMember(familyId: string, memberOid: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: UpdateMemberRequest;
  try {
    body = await request.json() as UpdateMemberRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  // Validate fields present in body
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.length > 100) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' must be 1-100 characters.' } };
    }
    body.displayName = body.displayName.trim().replace(/[\x00-\x1f\x7f]/g, '');
  }
  if (body.role !== undefined && body.role !== 'User' && body.role !== 'FamilyAdmin') {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'role\' must be \'User\' or \'FamilyAdmin\'.' } };
  }

  try {
    const container = getContainer('users');
    const { resource: existing } = await container.item(memberOid, familyId).read<User>();
    if (!existing) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found in this family.' } };

    const updated: User = {
      ...existing,
      displayName: body.displayName ?? existing.displayName,
      role:        body.role        ?? existing.role,
      // When kidSettings is provided, merge it onto the existing value so that
      // balance-floor fields (balanceOverride, tithingOwedOverride, balanceOverrideAt,
      // purgedBalanceDelta, purgedTithingOwedDelta) set by PATCH /balance-override are
      // not silently wiped by a partial settings payload from the SA UI.
      kidSettings: body.kidSettings !== undefined
        ? {
            ...existing.kidSettings,
            ...body.kidSettings,
            // Preserve financial floor fields unless the caller explicitly included them
            ...(existing.kidSettings?.balanceOverride      !== undefined && body.kidSettings.balanceOverride      === undefined && { balanceOverride:      existing.kidSettings.balanceOverride }),
            ...(existing.kidSettings?.tithingOwedOverride  !== undefined && body.kidSettings.tithingOwedOverride  === undefined && { tithingOwedOverride:  existing.kidSettings.tithingOwedOverride }),
            ...(existing.kidSettings?.balanceOverrideAt    !== undefined && body.kidSettings.balanceOverrideAt    === undefined && { balanceOverrideAt:    existing.kidSettings.balanceOverrideAt }),
            ...(existing.kidSettings?.purgedBalanceDelta   !== undefined && body.kidSettings.purgedBalanceDelta   === undefined && { purgedBalanceDelta:   existing.kidSettings.purgedBalanceDelta }),
            ...(existing.kidSettings?.purgedTithingOwedDelta !== undefined && body.kidSettings.purgedTithingOwedDelta === undefined && { purgedTithingOwedDelta: existing.kidSettings.purgedTithingOwedDelta }),
          }
        : existing.kidSettings,
      updatedAt:   new Date().toISOString(),
    };

    await container.item(memberOid, familyId).replace(updated);
    context.log(`superadmin: updated member '${memberOid}' in family '${familyId}'`);
    return { status: 200, jsonBody: { member: updated } };
  } catch (err) {
    context.error('superadmin/members PUT error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function deleteMember(familyId: string, memberOid: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  try {
    const container = getContainer('users');
    const { resource: existing } = await container.item(memberOid, familyId).read<User>();
    if (!existing) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found in this family.' } };

    await container.item(memberOid, familyId).delete();
    context.log(`superadmin: deleted member '${memberOid}' from family '${familyId}'`);
    return { status: 200, jsonBody: { deleted: { oid: memberOid, familyId } } };
  } catch (err) {
    context.error('superadmin/members DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

app.http('superadminMembers', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/members',
  handler: async (req, ctx) => {
    const familyId = req.params['familyId'];
    if (!familyId) return { status: 400, jsonBody: { code: 'BAD_REQUEST' } };
    if (req.method === 'POST') return createMember(familyId, req, ctx);
    return { status: 405 };
  },
});

app.http('superadminMember', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/members/{memberOid}',
  handler: async (req, ctx) => {
    const familyId  = req.params['familyId'];
    const memberOid = req.params['memberOid'];
    if (!familyId || !memberOid) return { status: 400, jsonBody: { code: 'BAD_REQUEST' } };
    if (req.method === 'PUT')    return updateMember(familyId, memberOid, req, ctx);
    if (req.method === 'DELETE') return deleteMember(familyId, memberOid, req, ctx);
    return { status: 405 };
  },
});
