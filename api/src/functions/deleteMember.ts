import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Transaction } from '../data/models.js';

// ---------------------------------------------------------------------------
// DELETE /api/members/{oid}
//
// Removes an enrolled (Entra-backed) family member and all their transactions.
// Only FamilyAdmins can call this.
//
// Security controls:
//   - Requires valid Entra JWT; caller must be FamilyAdmin
//   - Target validated to belong to the caller's family (no cross-family deletes)
//   - Admin cannot delete themselves (prevents accidental family lock-out)
//   - local accounts are rejected (use DELETE /api/local-members/:oid for those)
// ---------------------------------------------------------------------------

async function deleteMember(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('deleteMember invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const targetOid = request.params['oid'] ?? '';
  if (!targetOid) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Missing member OID.' } };

  // Prevent admin from deleting themselves
  if (targetOid === auth.payload.oid) {
    return { status: 400, jsonBody: { code: 'CANNOT_DELETE_SELF', message: 'You cannot remove yourself from the family.' } };
  }

  try {
    const usersContainer = getContainer('users');
    const { resource: user } = await usersContainer.item(targetOid, scope.familyId).read<User>();

    if (!user || user.familyId !== scope.familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Member not found in this family.' } };
    }
    if (user.isLocalAccount) {
      return { status: 400, jsonBody: { code: 'USE_LOCAL_DELETE', message: 'Use DELETE /api/local-members/:oid for local accounts.' } };
    }

    // Delete all transactions belonging to this user
    const txnContainer = getContainer('transactions');
    const { resources: txns } = await txnContainer.items
      .query<Transaction>({
        query: 'SELECT c.id FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid',
        parameters: [
          { name: '@familyId', value: scope.familyId },
          { name: '@kidOid',   value: targetOid },
        ],
      })
      .fetchAll();

    // Delete all transactions. Promise.all rejects if any individual delete fails;
    // on partial failure the outer catch returns 500 and the user record is left
    // intact — the admin can retry. Log how many succeeded before the failure
    // so any manually cleaned-up records are visible in the function logs.
    let deletedCount = 0;
    try {
      await Promise.all(txns.map(async t => {
        await txnContainer.item(t.id, scope.familyId).delete();
        deletedCount++;
      }));
    } catch (txnDeleteErr) {
      context.error(
        `deleteMember: partial transaction delete failure after ${deletedCount}/${txns.length} deletes for member '${targetOid}'. User record NOT deleted.`,
        txnDeleteErr,
      );
      throw txnDeleteErr; // Re-throw to outer catch → returns 500; user record stays intact.
    }
    context.log(`deleteMember: removed ${txns.length} transaction(s) for member '${targetOid}'`);

    // Delete the user record
    await usersContainer.item(targetOid, scope.familyId).delete();
    context.log(`deleteMember: deleted member '${targetOid}' from family '${scope.familyId}'`);

    return { status: 204 };
  } catch (err) {
    context.error('deleteMember error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to delete member.' } };
  }
}

app.http('deleteMember', {
  methods: ['DELETE'],
  authLevel: 'anonymous', // Auth handled by our JWT middleware
  route: 'members/{oid}',
  handler: deleteMember,
});
