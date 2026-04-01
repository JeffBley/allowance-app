import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { Chore } from '../data/models.js';

// ---------------------------------------------------------------------------
// GET /api/chores — list all chores for the family (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function getChores(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getChores invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  try {
    const container = getContainer('chores');
    const { resources: chores } = await container.items
      .query<Chore>({
        query: 'SELECT * FROM c WHERE c.familyId = @familyId ORDER BY c.createdAt ASC',
        parameters: [{ name: '@familyId', value: scope.familyId }],
      })
      .fetchAll();

    return { status: 200, jsonBody: { chores } };
  } catch (err) {
    context.error('getChores error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to fetch chores.' } };
  }
}

app.http('getChores', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'chores',
  handler: getChores,
});
