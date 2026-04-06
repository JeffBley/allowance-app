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

    // 2. Re-attribute all transactions from the old Entra OID to the new local OID
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

    await Promise.all(txns.map(t => txnContainer.item(t.id, familyId).replace({ ...t, kidOid: newLocalOid })));
    context.log(`unlinkMember: migrated ${txns.length} transaction(s) from '${targetOid}' to '${newLocalOid}'`);

    // 3. Delete old user document
    await usersContainer.item(targetOid, familyId).delete();
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
