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

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const kidOidParam = request.query.get('kidOid') ?? undefined;
  const actionParam = request.query.get('action') ?? undefined;
  const fromParam = request.query.get('from') ?? undefined;
  const toParam = request.query.get('to') ?? undefined;

  // Validate action filter if provided
  if (actionParam && !['edit', 'delete', 'member_delete'].includes(actionParam)) {
    return { status: 400, jsonBody: { code: 'INVALID_ACTION', message: 'action must be edit, delete, or member_delete.' } };
  }

  // Validate date params if provided
  if (fromParam && isNaN(Date.parse(fromParam))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: "'from' must be a valid ISO 8601 date string." } };
  }
  if (toParam && isNaN(Date.parse(toParam))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: "'to' must be a valid ISO 8601 date string." } };
  }

  try {
    const container = getContainer('auditLog');

    let query = 'SELECT * FROM c WHERE c.familyId = @familyId';
    const parameters: { name: string; value: string }[] = [
      { name: '@familyId', value: scope.familyId },
    ];

    // Push kidOid filter to Cosmos via the indexed subjectOid field.
    // subjectOid is populated on all new audit entries (edit → transaction's kidOid,
    // delete → transaction's kidOid, member_delete → deleted member's oid).
    // Legacy entries written before this field was added will be absent from
    // kidOid-filtered results, which is acceptable — they predate the filter UI.
    if (kidOidParam) {
      query += ' AND c.subjectOid = @subjectOid';
      parameters.push({ name: '@subjectOid', value: kidOidParam });
    }

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

    return { status: 200, jsonBody: { entries: resources } };
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
