import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { EditTransactionRequest, Transaction } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/transactions/{id} — edit a transaction (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function editTransaction(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('editTransaction invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
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
  if (body.amount != null && (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0 || body.amount > 100000)) {
    return { status: 400, jsonBody: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number no greater than 100,000.' } };
  }

  // Validate and sanitize notes if provided: strip control characters (KI-0089), then check length.
  const sanitizedNotes = body.notes != null ? body.notes.replace(/[\x00-\x1f\x7f]/g, '') : undefined;
  if (sanitizedNotes != null && sanitizedNotes.length > 500) {
    return { status: 400, jsonBody: { code: 'INVALID_NOTES', message: 'notes must be 500 characters or fewer.' } };
  }

  // Validate category if provided
  if (body.category && !['Income', 'Purchase', 'Tithing'].includes(body.category)) {
    return { status: 400, jsonBody: { code: 'INVALID_CATEGORY', message: 'category must be Income, Purchase, or Tithing.' } };
  }

  // Validate and normalize date if provided (KI-0066)
  let normalizedDate: string | undefined;
  if (body.date) {
    if (isNaN(Date.parse(body.date))) {
      return { status: 400, jsonBody: { code: 'INVALID_DATE', message: 'date must be a valid ISO 8601 string.' } };
    }
    normalizedDate = new Date(body.date).toISOString();
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
      kidOid: existing.kidOid,
    };

    // Apply updates (only fields present in the request body)
    const updated: Transaction = {
      ...existing,
      ...(body.category && { category: body.category }),
      ...(body.amount != null && { amount: body.amount }),
      ...(sanitizedNotes != null && { notes: sanitizedNotes }),
      ...(normalizedDate !== undefined && { date: normalizedDate }),
      // tithable only applies to Income; preserve existing value when not in body
      ...(body.category === 'Income' || (!body.category && existing.category === 'Income')
        ? { tithable: body.tithable !== undefined ? body.tithable : existing.tithable }
        : { tithable: undefined }),
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
