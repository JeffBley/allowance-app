import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { AuditLogEntry } from '../../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/superadmin/families/{familyId}/purge-audit-log
//
// Deletes audit log entries for a family whose timestamp is strictly before
// the supplied `beforeDate`. Returns counts of purged and skipped records.
// ---------------------------------------------------------------------------

async function purgeAuditLog(
  familyId: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('purgeAuditLog invoked for family', familyId);

  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: { beforeDate?: string };
  try {
    body = await request.json() as { beforeDate?: string };
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!body.beforeDate || isNaN(Date.parse(body.beforeDate))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: 'beforeDate must be a valid ISO 8601 string.' } };
  }

  try {
    const container = getContainer('auditLog');

    const { resources: candidates } = await container.items.query<AuditLogEntry>({
      query: 'SELECT * FROM c WHERE c.familyId = @familyId AND c.timestamp < @beforeDate',
      parameters: [
        { name: '@familyId',   value: familyId         },
        { name: '@beforeDate', value: body.beforeDate   },
      ],
    }).fetchAll();

    if (candidates.length === 0) {
      return { status: 200, jsonBody: { purgedCount: 0, skippedCount: 0 } };
    }

    let purgedCount  = 0;
    let skippedCount = 0;

    for (const entry of candidates) {
      try {
        await container.item(entry.id, familyId).delete();
        purgedCount++;
      } catch (err) {
        context.warn('Failed to delete audit log entry', entry.id, err);
        skippedCount++;
      }
    }

    return { status: 200, jsonBody: { purgedCount, skippedCount } };
  } catch (err) {
    context.error('purgeAuditLog error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to purge audit log.' } };
  }
}

app.http('superadminPurgeAuditLog', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/purge-audit-log',
  handler: (req, ctx) => {
    const familyId = req.params['familyId'];
    if (!familyId) return Promise.resolve({ status: 400, jsonBody: { code: 'MISSING_PARAM', message: 'familyId is required.' } });
    return purgeAuditLog(familyId, req, ctx);
  },
});
