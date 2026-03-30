import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { AuditLogEntry } from '../data/models.js';

// ---------------------------------------------------------------------------
// GET /api/audit-log[?kidOid=xxx&action=edit|delete&from=ISO&to=ISO]
// FamilyAdmin only.
// ---------------------------------------------------------------------------

async function getAuditLog(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getAuditLog invoked');

  const auth = await validateBearerToken(request);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const kidOidParam = request.query.get('kidOid') ?? undefined;
  const actionParam = request.query.get('action') ?? undefined;
  const fromParam = request.query.get('from') ?? undefined;
  const toParam = request.query.get('to') ?? undefined;

  // Validate action filter if provided
  if (actionParam && !['edit', 'delete'].includes(actionParam)) {
    return { status: 400, jsonBody: { code: 'INVALID_ACTION', message: 'action must be edit or delete.' } };
  }

  try {
    const container = getContainer('auditLog');

    let query = 'SELECT * FROM c WHERE c.familyId = @familyId';
    const parameters: { name: string; value: string }[] = [
      { name: '@familyId', value: scope.familyId },
    ];

    if (actionParam) {
      query += ' AND c.action = @action';
      parameters.push({ name: '@action', value: actionParam });
    }

    if (fromParam) {
      query += ' AND c.timestamp >= @from';
      parameters.push({ name: '@from', value: fromParam });
    }

    if (toParam) {
      query += ' AND c.timestamp <= @to';
      parameters.push({ name: '@to', value: toParam });
    }

    query += ' ORDER BY c.timestamp DESC';

    const { resources } = await container.items
      .query<AuditLogEntry>({ query, parameters })
      .fetchAll();

    // If kidOid filter requested, filter in memory after the family-scoped query
    // (auditLog.before.kidOid is nested, not a top-level indexed field)
    const filtered = kidOidParam
      ? resources.filter(entry => entry.before?.kidOid === kidOidParam || entry.after?.kidOid === kidOidParam)
      : resources;

    return { status: 200, jsonBody: { entries: filtered } };
  } catch (err) {
    context.error('getAuditLog error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit log.' } };
  }
}

app.http('getAuditLog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit-log',
  handler: getAuditLog,
});
