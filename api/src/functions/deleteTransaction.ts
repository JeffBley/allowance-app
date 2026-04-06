import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Transaction, AuditLogEntry } from '../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// DELETE /api/transactions/{id} — delete a transaction (FamilyAdmin only)
// Records an audit log entry with the deleted transaction snapshot.
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

    // Read first to capture the snapshot for the audit log
    const { resource: existing } = await txnContainer.item(transactionId, scope.familyId).read<Transaction>();

    if (!existing) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Transaction not found.' } };
    }

    // Delete the transaction
    await txnContainer.item(transactionId, scope.familyId).delete();

    // Write audit log entry — non-fatal: the delete is the authoritative operation.
    // Wrapping in its own catch prevents a failed log write from returning 500
    // after the transaction has already been permanently removed.
    try {
      const performedByEmail = typeof auth.payload['email'] === 'string' ? auth.payload['email'] : undefined;

      const auditEntry: AuditLogEntry = {
        id: randomUUID(),
        familyId: scope.familyId,
        action: 'delete',
        performedBy: auth.payload.oid,
        performedByEmail,
        timestamp: new Date().toISOString(),
        subjectOid: existing.kidOid,
        targetTransactionId: transactionId,
        before: {
          category: existing.category,
          amount: existing.amount,
          notes: existing.notes,
          date: existing.date,
          kidOid: existing.kidOid,
        },
      };
      await getContainer('auditLog').items.create(auditEntry);
    } catch (auditErr) {
      context.warn(`deleteTransaction: audit log write failed for txn ${transactionId} — transaction was deleted successfully`, auditErr);
    }

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
