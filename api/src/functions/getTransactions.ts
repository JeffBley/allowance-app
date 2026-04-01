import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Transaction } from '../data/models.js';

// ---------------------------------------------------------------------------
// GET /api/transactions[?kidOid=xxx&from=ISO&to=ISO]
// Returns transactions for the caller's family.
//   - User role: only sees their own transactions (filtered by oid)
//   - FamilyAdmin role: can see all family members (filtered by optional kidOid param)
// ---------------------------------------------------------------------------

async function getTransactions(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getTransactions invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  // Parse optional query params
  const kidOidParam = request.query.get('kidOid') ?? undefined;
  const fromParam = request.query.get('from') ?? undefined;
  const toParam = request.query.get('to') ?? undefined;

  // Validate date params if provided
  if (fromParam && isNaN(Date.parse(fromParam))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: "'from' must be a valid ISO 8601 date string." } };
  }
  if (toParam && isNaN(Date.parse(toParam))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: "'to' must be a valid ISO 8601 date string." } };
  }

  // Security: Users can only see their own transactions regardless of kidOid param
  const effectiveKidOid = scope.role === 'User' ? auth.payload.oid : kidOidParam;

  try {
    const container = getContainer('transactions');

    let query = 'SELECT * FROM c WHERE c.familyId = @familyId';
    const parameters: { name: string; value: string }[] = [
      { name: '@familyId', value: scope.familyId },
    ];

    if (effectiveKidOid) {
      query += ' AND c.kidOid = @kidOid';
      parameters.push({ name: '@kidOid', value: effectiveKidOid });
    }

    if (fromParam) {
      query += ' AND c.date >= @from';
      parameters.push({ name: '@from', value: fromParam });
    }

    if (toParam) {
      query += ' AND c.date <= @to';
      parameters.push({ name: '@to', value: toParam });
    }

    query += ' ORDER BY c.date DESC';

    const { resources } = await container.items
      .query<Transaction>({ query, parameters })
      .fetchAll();

    return { status: 200, jsonBody: { transactions: resources } };
  } catch (err) {
    context.error('getTransactions error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions.' } };
  }
}

app.http('getTransactions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'transactions',
  handler: getTransactions,
});
