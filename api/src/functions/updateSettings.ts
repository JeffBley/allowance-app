import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import type { UpdateSettingsRequest, KidSettings } from '../data/models.js';

// ---------------------------------------------------------------------------
// PATCH /api/settings — update a kid's allowance settings (FamilyAdmin only)
// ---------------------------------------------------------------------------

async function updateSettings(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('updateSettings invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;
  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  let body: UpdateSettingsRequest;
  try {
    body = await request.json() as UpdateSettingsRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!body.kidOid || !body.kidSettings) {
    return { status: 400, jsonBody: { code: 'MISSING_FIELDS', message: 'kidOid and kidSettings are required.' } };
  }

  // Validate the settings object
  const ks = body.kidSettings;
  if (typeof ks.allowanceEnabled !== 'boolean') {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'allowanceEnabled must be a boolean.' } };
  }
  if (ks.allowanceEnabled) {
    if (typeof ks.allowanceAmount !== 'number' || ks.allowanceAmount <= 0 || ks.allowanceAmount > 10000) {
      return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'allowanceAmount must be a positive number no greater than 10,000.' } };
    }
    if (!['Weekly', 'Bi-weekly', 'Monthly'].includes(ks.allowanceFrequency)) {
      return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'allowanceFrequency must be Weekly, Bi-weekly, or Monthly.' } };
    }
  }

  // M-2: Validate timezone — must be a valid IANA timezone string (e.g. "America/Chicago").
  // Uses Intl.DateTimeFormat which throws on unknown timezone identifiers.
  if (typeof ks.timezone !== 'string' || ks.timezone.length === 0 || ks.timezone.length > 64) {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'timezone must be a non-empty IANA timezone string (≤ 64 characters).' } };
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: ks.timezone });
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: `'${ks.timezone}' is not a valid IANA timezone identifier.` } };
  }

  // Validate optional timeOfDay (HH:MM in 24-hour format)
  if (ks.timeOfDay !== undefined && !/^\d{2}:\d{2}$/.test(ks.timeOfDay)) {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'timeOfDay must be in HH:MM format.' } };
  }

  // Validate optional dayOfWeek (0 = Sunday … 6 = Saturday)
  if (ks.dayOfWeek !== undefined && (!Number.isInteger(ks.dayOfWeek) || ks.dayOfWeek < 0 || ks.dayOfWeek > 6)) {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'dayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday).' } };
  }

  // Validate optional biweeklyStartDate (ISO 8601)
  if (ks.biweeklyStartDate !== undefined && isNaN(Date.parse(ks.biweeklyStartDate))) {
    return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'biweeklyStartDate must be a valid ISO 8601 date string.' } };
  }

  // M-3: Validate hourlyWageRate when hourlyWagesEnabled is true
  if (ks.hourlyWagesEnabled === true) {
    if (typeof ks.hourlyWageRate !== 'number' || isNaN(ks.hourlyWageRate) || !isFinite(ks.hourlyWageRate) || ks.hourlyWageRate <= 0 || ks.hourlyWageRate > 1000) {
      return { status: 400, jsonBody: { code: 'INVALID_SETTINGS', message: 'hourlyWageRate must be a positive number no greater than 1,000 when hourlyWagesEnabled is true.' } };
    }
  }

  try {
    const usersContainer = getContainer('users');

    // Point-read — kidOid is the document id, familyId is the partition key
    const { resource: kidUser } = await usersContainer.item(body.kidOid, scope.familyId).read();

    if (!kidUser) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Kid not found in this family.' } };
    }

    // Work on a mutable copy so we can patch fields server-side.
    const ks: KidSettings = { ...body.kidSettings };

    // Preserve balance override fields — these are managed exclusively by
    // PATCH /balance-override and must never be clobbered by a settings save.
    // The frontend only sends allowance/schedule settings, so these fields
    // would otherwise be silently dropped, resetting the balance to zero.
    const existingKs = kidUser.kidSettings as KidSettings | undefined;
    if (existingKs?.balanceOverride      !== undefined) ks.balanceOverride      = existingKs.balanceOverride;
    if (existingKs?.tithingOwedOverride  !== undefined) ks.tithingOwedOverride  = existingKs.tithingOwedOverride;
    if (existingKs?.balanceOverrideAt    !== undefined) ks.balanceOverrideAt    = existingKs.balanceOverrideAt;
    if (existingKs?.purgedBalanceDelta   !== undefined) ks.purgedBalanceDelta   = existingKs.purgedBalanceDelta;
    if (existingKs?.purgedTithingOwedDelta !== undefined) ks.purgedTithingOwedDelta = existingKs.purgedTithingOwedDelta;

    // Auto-compute nextAllowanceDate when:
    //   (a) allowance is being enabled for the first time (no existing date), or
    //   (b) the schedule configuration has changed (frequency / day / bi-weekly anchor).
    // If the scheduler has already set a future date and nothing changed, preserve it.
    if (ks.allowanceEnabled) {
      const existing = kidUser.kidSettings as KidSettings | undefined;
      const scheduleChanged =
        !existing?.allowanceEnabled ||
        !ks.nextAllowanceDate ||
        existing?.allowanceFrequency !== ks.allowanceFrequency ||
        existing?.dayOfWeek !== ks.dayOfWeek ||
        existing?.biweeklyStartDate !== ks.biweeklyStartDate;

      if (scheduleChanged) {
        ks.nextAllowanceDate = computeInitialNextDate(ks).toISOString();
        context.log(`[updateSettings] Computed initial nextAllowanceDate: ${ks.nextAllowanceDate}`);
      }
    }

    // Optionally update displayName if provided
    const newDisplayName = typeof body.displayName === 'string'
      ? body.displayName.trim().replace(/\s+/g, ' ')
      : undefined;
    if (newDisplayName !== undefined && (newDisplayName.length === 0 || newDisplayName.length > 60)) {
      return { status: 400, jsonBody: { code: 'INVALID_NAME', message: 'Display name must be between 1 and 60 characters.' } };
    }

    const updated = {
      ...kidUser,
      ...(newDisplayName !== undefined ? { displayName: newDisplayName } : {}),
      kidSettings: ks,
      updatedAt: new Date().toISOString(),
    };

    // ETag-conditioned replace — prevents clobbering the scheduler's nextAllowanceDate advance.
    // If the scheduler fired between our read and this write, we get a 412 and return 409 CONFLICT
    // so the client can retry (it will re-read the user doc with the fresh nextAllowanceDate).
    const etag = (kidUser as Record<string, unknown> & { _etag?: string })._etag;
    try {
      const { resource: saved } = await usersContainer.item(body.kidOid, scope.familyId).replace(
        updated,
        etag ? { accessCondition: { type: 'IfMatch', condition: etag } } : {},
      );

      return {
        status: 200,
        jsonBody: {
          user: {
            oid: saved.oid,
            displayName: saved.displayName,
            role: saved.role,
            kidSettings: saved.kidSettings,
          },
        },
      };
    } catch (replaceErr) {
      const obj = replaceErr as Record<string, unknown>;
      if (obj['code'] === 412 || obj['statusCode'] === 412) {
        // Another write (typically the scheduler advancing nextAllowanceDate) won the race.
        // Return 409 so the client can reload and retry.
        return { status: 409, jsonBody: { code: 'CONFLICT', message: 'Settings were modified concurrently. Please reload and try again.' } };
      }
      throw replaceErr;
    }
  } catch (err) {
    context.error('updateSettings error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update settings.' } };
  }
}

app.http('updateSettings', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'settings',
  handler: updateSettings,
});

// ---------------------------------------------------------------------------
// Computes the first (initial) allowance date from "now" based on the
// schedule settings.  Used when allowance is enabled for the first time or
// when the schedule configuration changes.  All dates are stored as UTC ISO
// strings; times are fixed at 12:00 UTC as a neutral midday reference.
// ---------------------------------------------------------------------------
function computeInitialNextDate(ks: KidSettings): Date {
  const now = new Date();

  if (ks.allowanceFrequency === 'Monthly') {
    // 1st of next month at noon UTC
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(1);
    d.setUTCHours(12, 0, 0, 0);
    return d;
  }

  if (ks.allowanceFrequency === 'Bi-weekly' && ks.biweeklyStartDate) {
    // Advance from the chosen anchor by 14-day increments until the result
    // is strictly in the future.
    const start = new Date(ks.biweeklyStartDate);
    start.setUTCHours(12, 0, 0, 0);
    while (start <= now) {
      start.setUTCDate(start.getUTCDate() + 14);
    }
    return start;
  }

  // Weekly (and Bi-weekly fallback without an anchor): find the next
  // occurrence of dayOfWeek (UTC), starting from tomorrow.
  const target = ks.dayOfWeek ?? 0;
  const d = new Date(now);
  d.setUTCHours(12, 0, 0, 0);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() !== target);
  return d;
}
