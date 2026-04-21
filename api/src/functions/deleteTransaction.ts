import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Transaction } from '../data/models.js';

// ---------------------------------------------------------------------------
// DELETE /api/transactions/{id} — delete a transaction (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function deleteTransaction(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('deleteTransaction invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const transactionId = request.params['id'];
  if (!transactionId) {
    return { status: 400, jsonBody: { code: 'MISSING_ID', message: 'Transaction ID is required in the URL path.' } };
  }

  try {
    const txnContainer = getContainer('transactions');

    // Read first to verify the transaction exists and belongs to this family.
    // (We must read via the familyId partition key so a 404 here means "not in this family"
    // rather than a blind cross-partition delete that would quietly succeed if the ID existed
    // under a different partition.)
    const { resource: existing } = await txnContainer.item(transactionId, scope.familyId).read<Transaction>();

    if (!existing) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Transaction not found.' } };
    }

    // Delete the transaction
    await txnContainer.item(transactionId, scope.familyId).delete();

    return { status: 204 }; // No content — successful deletion
  } catch (err) {
    // A Cosmos 404 from the .delete() call means a concurrent request already deleted this
    // transaction. Return 404 (the resource is gone) rather than 500.
    const errObj = err as Record<string, unknown>;
    if (errObj['code'] === 404 || errObj['statusCode'] === 404) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Transaction not found.' } };
    }
    context.error('deleteTransaction error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to delete transaction.' } };
  }
}

app.http('deleteTransaction', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'transactions/{id}',
  handler: deleteTransaction,
});
