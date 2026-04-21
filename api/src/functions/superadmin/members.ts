import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { User, Transaction, CreateMemberRequest, UpdateMemberRequest } from '../../data/models.js';

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
    // Entra OIDs are UUID v4 GUIDs — validate format to prevent corrupt data
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.oid.trim())) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'oid\' must be a valid UUID (GUID) format.' } };
    }
    if (typeof body?.displayName !== 'string' || !body.displayName.trim()) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' is required.' } };
    }
    if (body.role !== 'User' && body.role !== 'FamilyAdmin') {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'role\' must be \'User\' or \'FamilyAdmin\'.' } };
    }
    // Sanitize displayName — strip control characters.
    // Re-check emptiness after stripping: a string of only control chars collapses to ''.
    body.displayName = body.displayName.trim().replace(/[\x00-\x1f\x7f]/g, '');
    if (!body.displayName || body.displayName.length > 100) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' must be 1\u2013100 characters.' } };
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
    const usersContainer = getContainer('users');
    const { resource: existing } = await usersContainer.item(memberOid, familyId).read<User>();
    if (!existing) return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found in this family.' } };

    // Delete all transactions belonging to this member before removing the user record.
    // Without this, transaction documents with a dangling kidOid accumulate in Cosmos,
    // appear in family-scoped GET /api/transactions results, and are never cleaned up (KI-0083).
    const txnContainer = getContainer('transactions');
    const { resources: txns } = await txnContainer.items
      .query<Transaction>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId AND c.kidOid = @memberOid',
        parameters: [
          { name: '@familyId',  value: familyId  },
          { name: '@memberOid', value: memberOid },
        ],
      })
      .fetchAll();

    let deletedTxnCount = 0;
    try {
      await Promise.all(txns.map(async t => {
        await txnContainer.item(t.id, familyId).delete();
        deletedTxnCount++;
      }));
    } catch (txnDeleteErr) {
      context.error(
        `superadmin/members DELETE: partial transaction delete after ${deletedTxnCount}/${txns.length} ` +
        `for member '${memberOid}'. User record NOT deleted.`,
        txnDeleteErr,
      );
      return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to delete member transactions. User record was not removed — retry.' } };
    }

    await usersContainer.item(memberOid, familyId).delete();
    context.log(`superadmin: deleted member '${memberOid}' and ${deletedTxnCount} transaction(s) from family '${familyId}'`);
    return { status: 200, jsonBody: { deleted: { oid: memberOid, familyId }, transactionsDeleted: deletedTxnCount } };
  } catch (err) {
    context.error('superadmin/members DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function unlinkMember(familyId: string, memberOid: string, request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  try {
    const usersContainer = getContainer('users');
    const { resource: user } = await usersContainer.item(memberOid, familyId).read<User>();

    if (!user || user.familyId !== familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found in this family.' } };
    }
    if (user.isLocalAccount) {
      return { status: 409, jsonBody: { code: 'ALREADY_LOCAL', message: 'This member is already a local account.' } };
    }

    const newLocalOid = crypto.randomUUID();
    const now = new Date().toISOString();

    const newUser: User = {
      ...user,
      id:             newLocalOid,
      oid:            newLocalOid,
      isLocalAccount: true,
      updatedAt:      now,
    };
    await usersContainer.items.create(newUser);

    // Serially migrate transactions with per-item error capture so a partial failure
    // doesn't leave the family with two active user rows pointing at split transaction
    // sets (mirrors inviteRedeem.ts link flow and unlinkMember.ts).
    const txnContainer = getContainer('transactions');
    const { resources: txns } = await txnContainer.items
      .query<Transaction>({
        query: 'SELECT * FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid',
        parameters: [
          { name: '@familyId', value: familyId },
          { name: '@kidOid',   value: memberOid },
        ],
      })
      .fetchAll();

    const failedTxnIds: string[] = [];
    let migratedCount = 0;
    for (const t of txns) {
      try {
        await txnContainer.item(t.id, familyId).replace({ ...t, kidOid: newLocalOid });
        migratedCount++;
      } catch (migrateErr) {
        context.warn(`superadmin unlinkMember: failed to migrate transaction '${t.id}'`, migrateErr);
        failedTxnIds.push(t.id);
      }
    }

    if (failedTxnIds.length > 0) {
      context.error(
        `superadmin unlinkMember: PARTIAL MIGRATION — ${migratedCount}/${txns.length} transactions migrated ` +
        `for '${memberOid}' → '${newLocalOid}'. Failed IDs: [${failedTxnIds.join(', ')}]. Old user retained as recovery anchor.`,
      );
      return {
        status: 500,
        jsonBody: {
          code: 'PARTIAL_MIGRATION',
          message: 'Unlink partially completed. Retry to resume the migration.',
        },
      };
    }

    // Only delete the old user after all transactions migrated. 404 = already deleted by a retry.
    try {
      await usersContainer.item(memberOid, familyId).delete();
    } catch (deleteErr) {
      const errObj = deleteErr as Record<string, unknown>;
      if (errObj['code'] === 404 || errObj['statusCode'] === 404) {
        context.log(`superadmin unlinkMember: old user '${memberOid}' already deleted — continuing`);
      } else {
        throw deleteErr;
      }
    }
    context.log(`superadmin: unlinked member '${memberOid}' → local '${newLocalOid}' in family '${familyId}', migrated ${migratedCount} transaction(s)`);

    return {
      status: 200,
      jsonBody: {
        member: {
          id:             newUser.id,
          oid:            newUser.oid,
          displayName:    newUser.displayName,
          role:           newUser.role,
          isLocalAccount: true,
          createdAt:      newUser.createdAt,
          updatedAt:      newUser.updatedAt,
        },
      },
    };
  } catch (err) {
    context.error('superadmin/members unlink error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

app.http('superadminMemberUnlink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/members/{memberOid}/unlink',
  handler: async (req, ctx) => {
    const familyId  = req.params['familyId'];
    const memberOid = req.params['memberOid'];
    if (!familyId || !memberOid) return { status: 400, jsonBody: { code: 'BAD_REQUEST' } };
    return unlinkMember(familyId, memberOid, req, ctx);
  },
});

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
