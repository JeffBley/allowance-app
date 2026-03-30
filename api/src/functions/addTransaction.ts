import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { AddTransactionRequest, Transaction } from '../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// POST /api/transactions — add a transaction (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function addTransaction(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('addTransaction invoked');

  const auth = await validateBearerToken(request);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid);
  if (!scope) return NOT_ENROLLED;

  // Only FamilyAdmin can add transactions
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: AddTransactionRequest;
  try {
    body = await request.json() as AddTransactionRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  // Validate required fields
  if (!body.kidOid || !body.category || body.amount == null || !body.date) {
    return { status: 400, jsonBody: { code: 'MISSING_FIELDS', message: 'kidOid, category, amount, and date are required.' } };
  }

  // Validate category
  if (!['Income', 'Purchase', 'Tithing'].includes(body.category)) {
    return { status: 400, jsonBody: { code: 'INVALID_CATEGORY', message: 'category must be Income, Purchase, or Tithing.' } };
  }

  // Validate amount: positive number
  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0) {
    return { status: 400, jsonBody: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number.' } };
  }

  // Validate date is a parseable ISO 8601 string
  if (isNaN(Date.parse(body.date))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: 'date must be a valid ISO 8601 string.' } };
  }

  try {
    const container = getContainer('transactions');
    const now = new Date().toISOString();

    const transaction: Transaction = {
      id: randomUUID(),
      familyId: scope.familyId, // Always sourced from server-side scope, never from client
      kidOid: body.kidOid,
      category: body.category,
      amount: body.amount,
      notes: body.notes ?? '',
      date: body.date,
      createdBy: auth.payload.oid,
      createdAt: now,
    };

    const { resource } = await container.items.create(transaction);

    return { status: 201, jsonBody: { transaction: resource } };
  } catch (err) {
    context.error('addTransaction error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction.' } };
  }
}

app.http('addTransaction', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'transactions',
  handler: addTransaction,
});
