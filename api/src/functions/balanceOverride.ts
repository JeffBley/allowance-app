import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { BalanceOverrideRequest, User } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/balance-override — manually set a kid's balance floor (FamilyAdmin)
//
// Sets balanceOverride, tithingOwedOverride, and balanceOverrideAt on the
// kid's User document. The frontend then computes the displayed balance as:
//   balanceOverride + sum(transactions after balanceOverrideAt)
// This gives admins a "break-glass" correction tool while keeping transactions
// as the authoritative source of truth going forward.
// ---------------------------------------------------------------------------

async function balanceOverride(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('balanceOverride invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: BalanceOverrideRequest;
  try {
    body = await request.json() as BalanceOverrideRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!body.kidOid) {
    return { status: 400, jsonBody: { code: 'MISSING_FIELDS', message: 'kidOid is required.' } };
  }
  if (typeof body.balance !== 'number' || isNaN(body.balance) || !isFinite(body.balance) || Math.abs(body.balance) > 1_000_000) {
    return { status: 400, jsonBody: { code: 'INVALID_BALANCE', message: 'balance must be a finite number with absolute value ≤ 1,000,000.' } };
  }
  if (typeof body.tithingOwed !== 'number' || isNaN(body.tithingOwed) || body.tithingOwed < 0) {
    return { status: 400, jsonBody: { code: 'INVALID_TITHING', message: 'tithingOwed must be a non-negative number.' } };
  }

  try {
    const usersContainer = getContainer('users');
    const { resource: kidUser } = await usersContainer.item(body.kidOid, scope.familyId).read<User>();

    if (!kidUser) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Kid not found in this family.' } };
    }

    const overrideAt = new Date().toISOString();

    const updated: User = {
      ...kidUser,
      kidSettings: {
        ...kidUser.kidSettings!,
        balanceOverride:      Math.round(body.balance     * 100) / 100,
        tithingOwedOverride:  Math.round(body.tithingOwed * 100) / 100,
        balanceOverrideAt:    overrideAt,
        // Reset purge accumulators — their contributions up to this point are
        // now captured in balanceOverride / tithingOwedOverride above.
        purgedBalanceDelta:     0,
        purgedTithingOwedDelta: 0,
      },
      updatedAt: overrideAt,
    };

    // ETag-conditioned replace — prevents a concurrent scheduler advance of nextAllowanceDate
    // from being silently overwritten by this balance-floor update.
    // If a 412 occurs, return 409 CONFLICT so the client can reload and retry.
    const etag = (kidUser as unknown as { _etag?: string })._etag;
    try {
      const { resource: saved } = await usersContainer.item(body.kidOid, scope.familyId).replace(
        updated,
        etag ? { accessCondition: { type: 'IfMatch', condition: etag } } : {},
      );

      context.log(`balanceOverride: set balance=${body.balance}, tithingOwed=${body.tithingOwed} for kid '${body.kidOid}'`);

      const ks = (saved ?? updated).kidSettings!;

      return {
        status: 200,
        jsonBody: {
          kidOid:              body.kidOid,
          balanceOverride:     ks.balanceOverride,
          tithingOwedOverride: ks.tithingOwedOverride,
          balanceOverrideAt:   ks.balanceOverrideAt,
        },
      };
    } catch (replaceErr) {
      const obj = replaceErr as Record<string, unknown>;
      if (obj['code'] === 412 || obj['statusCode'] === 412) {
        return { status: 409, jsonBody: { code: 'CONFLICT', message: 'Balance was modified concurrently. Please reload and try again.' } };
      }
      throw replaceErr;
    }
  } catch (err) {
    context.error('balanceOverride error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update balance override.' } };
  }
}

app.http('balanceOverride', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'balance-override',
  handler: balanceOverride,
});
