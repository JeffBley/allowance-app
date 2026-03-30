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

  const auth = await validateBearerToken(request);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid);
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

    // Write audit log entry with full snapshot
    const auditEntry: AuditLogEntry = {
      id: randomUUID(),
      familyId: scope.familyId,
      action: 'delete',
      performedBy: auth.payload.oid,
      timestamp: new Date().toISOString(),
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

    return { status: 204 }; // No content — successful deletion
  } catch (err) {
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
