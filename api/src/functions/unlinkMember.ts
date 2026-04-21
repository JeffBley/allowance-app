import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Transaction } from '../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/members/{oid}/unlink
//
// Converts an enrolled (Entra-linked) User into a local account. A new UUID
// is generated as the local OID; all transactions are re-attributed to it and
// the original Entra-OID user document is deleted. After conversion the member
// can be re-linked to a different Entra account via the "Link account" flow.
//
// Security:
//   - Bearer token required; FamilyAdmin role enforced
//   - familyId is always taken from the validated family scope — never from client input
//   - Only User-role, non-local members can be unlinked
//   - FamilyAdmin accounts cannot be unlinked (they must sign in to manage the family)
// ---------------------------------------------------------------------------

async function unlinkMember(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('unlinkMember invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const targetOid = request.params['oid'] as string | undefined;
  if (!targetOid) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Missing oid.' } };

  const { familyId } = scope;

  try {
    const usersContainer = getContainer('users');
    const { resource: user } = await usersContainer.item(targetOid, familyId).read<User>();

    if (!user || user.familyId !== familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found.' } };
    }
    if (user.isLocalAccount) {
      return { status: 409, jsonBody: { code: 'ALREADY_LOCAL', message: 'This member is already a local account.' } };
    }
    if (user.role !== 'User') {
      return { status: 409, jsonBody: { code: 'INVALID_ROLE', message: 'Only User-role members can have their linked account removed.' } };
    }

    const newLocalOid = crypto.randomUUID();
    const now = new Date().toISOString();

    // 1. Create new local user document with the generated UUID
    const newUser: User = {
      ...user,
      id:             newLocalOid,
      oid:            newLocalOid,
      isLocalAccount: true,
      updatedAt:      now,
    };
    await usersContainer.items.create(newUser);

    // 2. Re-attribute all transactions from the old Entra OID to the new local OID.
    //
    // Migrate serially with per-item error capture (mirrors inviteRedeem.ts link flow).
    // If ANY migration fails we do NOT delete the old user — it remains as a recovery
    // anchor so orphaned transactions remain queryable. The WHERE kidOid = @targetOid
    // query is naturally idempotent on retry: transactions already re-attributed to the
    // new local OID won't appear, so a retry only processes the remaining failures.
    const txnContainer = getContainer('transactions');
    const { resources: txns } = await txnContainer.items
      .query<Transaction>({
        query: 'SELECT * FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid',
        parameters: [
          { name: '@familyId', value: familyId },
          { name: '@kidOid',   value: targetOid },
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
        context.warn(`unlinkMember: failed to migrate transaction '${t.id}'`, migrateErr);
        failedTxnIds.push(t.id);
      }
    }

    if (failedTxnIds.length > 0) {
      // Partial migration — old Entra-linked user intentionally retained as recovery anchor.
      // The admin can retry the unlink call (retry will re-query and only process remaining
      // un-migrated transactions). The new local user also stays; re-running unlinkMember
      // will fail with a 409 on the create, but the caller can instead invoke a manual retry
      // tool or re-migrate via Cosmos Data Explorer. Two user rows is the safe failure mode.
      context.error(
        `unlinkMember: PARTIAL MIGRATION — ${migratedCount}/${txns.length} transactions migrated for '${targetOid}' → '${newLocalOid}'. ` +
        `Failed IDs: [${failedTxnIds.join(', ')}]. Old user retained as recovery anchor.`,
      );
      return {
        status: 500,
        jsonBody: {
          code: 'PARTIAL_MIGRATION',
          message: 'Unlink partially completed. Please contact a super admin to resume the migration.',
        },
      };
    }
    context.log(`unlinkMember: migrated ${migratedCount} transaction(s) from '${targetOid}' to '${newLocalOid}'`);

    // 3. Delete old user document — only reached when all transactions migrated.
    // A 404 here means a previous retry already deleted it; treat as success.
    try {
      await usersContainer.item(targetOid, familyId).delete();
    } catch (deleteErr) {
      const errObj = deleteErr as Record<string, unknown>;
      if (errObj['code'] === 404 || errObj['statusCode'] === 404) {
        context.log(`unlinkMember: old user '${targetOid}' already deleted (retry path) — continuing`);
      } else {
        throw deleteErr;
      }
    }
    context.log(`unlinkMember: removed enrolled user '${targetOid}', created local '${newLocalOid}' in family '${familyId}'`);

    return {
      status: 200,
      jsonBody: {
        member: {
          oid:            newUser.oid,
          displayName:    newUser.displayName,
          role:           newUser.role,
          isLocalAccount: true,
          kidSettings:    newUser.kidSettings,
          createdAt:      newUser.createdAt,
          updatedAt:      newUser.updatedAt,
        },
      },
    };
  } catch (err) {
    context.error('unlinkMember error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to unlink member.' } };
  }
}

app.http('unlinkMember', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'members/{oid}/unlink',
  handler: unlinkMember,
});
