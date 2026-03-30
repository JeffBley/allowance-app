import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { EditTransactionRequest, Transaction, AuditLogEntry } from '../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// PATCH /api/transactions/{id} — edit a transaction (FamilyAdmin only)
// Records an audit log entry with before/after snapshot.
// ---------------------------------------------------------------------------

async function editTransaction(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('editTransaction invoked');

  const auth = await validateBearerToken(request);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const transactionId = request.params['id'];
  if (!transactionId) {
    return { status: 400, jsonBody: { code: 'MISSING_ID', message: 'Transaction ID is required in the URL path.' } };
  }

  let body: EditTransactionRequest;
  try {
    body = await request.json() as EditTransactionRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  // Validate amount if provided
  if (body.amount != null && (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0)) {
    return { status: 400, jsonBody: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number.' } };
  }

  // Validate category if provided
  if (body.category && !['Income', 'Purchase', 'Tithing'].includes(body.category)) {
    return { status: 400, jsonBody: { code: 'INVALID_CATEGORY', message: 'category must be Income, Purchase, or Tithing.' } };
  }

  try {
    const txnContainer = getContainer('transactions');

    // Point-read with familyId as partition key — ensures we only touch own family's data
    const { resource: existing } = await txnContainer.item(transactionId, scope.familyId).read<Transaction>();

    if (!existing) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Transaction not found.' } };
    }

    // Snapshot before
    const before: Partial<Transaction> = {
      category: existing.category,
      amount: existing.amount,
      notes: existing.notes,
      date: existing.date,
    };

    // Apply updates (only fields present in the request body)
    const updated: Transaction = {
      ...existing,
      ...(body.category && { category: body.category }),
      ...(body.amount != null && { amount: body.amount }),
      ...(body.notes != null && { notes: body.notes }),
      ...(body.date && { date: body.date }),
    };

    // Snapshot after
    const after: Partial<Transaction> = {
      category: updated.category,
      amount: updated.amount,
      notes: updated.notes,
      date: updated.date,
    };

    // Persist the updated transaction
    const { resource: savedTxn } = await txnContainer.item(transactionId, scope.familyId).replace(updated);

    // Write audit log entry
    const auditEntry: AuditLogEntry = {
      id: randomUUID(),
      familyId: scope.familyId,
      action: 'edit',
      performedBy: auth.payload.oid,
      timestamp: new Date().toISOString(),
      targetTransactionId: transactionId,
      before,
      after,
    };
    await getContainer('auditLog').items.create(auditEntry);

    return { status: 200, jsonBody: { transaction: savedTxn } };
  } catch (err) {
    context.error('editTransaction error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update transaction.' } };
  }
}

app.http('editTransaction', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'transactions/{id}',
  handler: editTransaction,
});
