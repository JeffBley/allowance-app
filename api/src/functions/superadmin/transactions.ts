import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { Transaction, AddTransactionRequest } from '../../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// POST /api/superadmin/families/{familyId}/transactions
//   — add a transaction on behalf of a family (SuperAdmin only)
// ---------------------------------------------------------------------------

async function addTransaction(
  familyId: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: AddTransactionRequest;
  try {
    body = await request.json() as AddTransactionRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!body.kidOid || !body.category || body.amount == null || !body.date) {
    return { status: 400, jsonBody: { code: 'MISSING_FIELDS', message: 'kidOid, category, amount, and date are required.' } };
  }
  if (!['Income', 'Purchase', 'Tithing'].includes(body.category)) {
    return { status: 400, jsonBody: { code: 'INVALID_CATEGORY', message: 'category must be Income, Purchase, or Tithing.' } };
  }
  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0 || body.amount > 100000) {
    return { status: 400, jsonBody: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number no greater than 100,000.' } };
  }
  if (isNaN(Date.parse(body.date))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: 'date must be a valid ISO 8601 string.' } };
  }
  const normalizedDate = new Date(body.date).toISOString();
  // Strip ASCII control characters from notes (consistent with addTransaction.ts / editTransaction.ts).
  const sanitizedNotes = (body.notes ?? '').replace(/[\x00-\x1f\x7f]/g, '');
  if (sanitizedNotes.length > 500) {
    return { status: 400, jsonBody: { code: 'INVALID_NOTES', message: 'notes must be 500 characters or fewer.' } };
  }

  try {
    const usersContainer = getContainer('users');
    // Verify kidOid belongs to this family
    const { resource: kid } = await usersContainer.item(body.kidOid, familyId).read();
    if (!kid) {
      return { status: 400, jsonBody: { code: 'INVALID_KID', message: 'kidOid does not belong to this family.' } };
    }

    const now = new Date().toISOString();
    const transaction: Transaction = {
      id:        randomUUID(),
      familyId,
      kidOid:    body.kidOid,
      category:  body.category,
      amount:    body.amount,
      notes:     sanitizedNotes,
      date:      normalizedDate,
      tithable:  body.category === 'Income' ? (body.tithable !== false) : undefined,
      createdBy: session.method === 'sso' && session.oid ? `superadmin:${session.oid}` : 'superadmin:bootstrap',
      createdAt: now,
    };

    const container = getContainer('transactions');
    const { resource } = await container.items.create(transaction);

    context.log(`superadmin: added ${body.category} transaction for kid '${body.kidOid}' in family '${familyId}'`);
    return { status: 201, jsonBody: { transaction: resource } };
  } catch (err) {
    context.error('superadmin/transactions POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction.' } };
  }
}

app.http('saAddTransaction', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/transactions',
  handler: async (req, ctx) => {
    const familyId = req.params['familyId'] ?? '';
    if (!familyId) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Missing familyId.' } };
    return addTransaction(familyId, req, ctx);
  },
});
