import { app, InvocationContext, Timer } from '@azure/functions';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Transaction } from '../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Allowance Scheduler — runs every 5 minutes
// Finds all kids whose nextAllowanceDate has passed and credits their allowance.
//
// Security: This is a server-side timer trigger — no inbound HTTP, no auth needed.
//
// Concurrency / distributed-lock strategy (Flex Consumption multi-instance):
//   Step 1 — Claim: ETag-conditioned replace advances nextAllowanceDate BEFORE
//            creating the transaction. Only one instance wins per user per cycle;
//            concurrent instances get a 412 and skip.
//   Step 2 — Create: Transaction is inserted after the claim succeeds.
//   Step 3 — Idempotency check: Still present as a recovery guard in case a
//            process crashes after the claim but before the transaction write.
//            On the next scheduler run the date has already advanced, so no crash
//            recovery is needed — but the check protects against any edge case
//            where the same date window is processed twice.
// ---------------------------------------------------------------------------

/** Returns true when err is a Cosmos 412 Precondition Failed (ETag mismatch). */
function isETagConflict(err: unknown): boolean {
  if (err != null && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    return obj['code'] === 412 || obj['statusCode'] === 412;
  }
  return false;
}

async function allowanceScheduler(_timer: Timer, context: InvocationContext): Promise<void> {
  const now = new Date();
  context.log(`[allowanceScheduler] Running at ${now.toISOString()}`);

  try {
    const usersContainer = getContainer('users');
    const txnContainer = getContainer('transactions');

    // Find all users with allowance enabled whose next date has passed.
    // Cross-partition query — scans all families; acceptable at low scale.
    // For higher scale, maintain a separate 'pendingAllowances' feed.
    const { resources: dueUsers } = await usersContainer.items
      .query<User>({
        query: `SELECT * FROM c 
                WHERE c.kidSettings.allowanceEnabled = true 
                AND c.kidSettings.nextAllowanceDate <= @now`,
        parameters: [{ name: '@now', value: now.toISOString() }],
      })
      .fetchAll();

    context.log(`[allowanceScheduler] Found ${dueUsers.length} kid(s) with allowance due.`);

    for (const user of dueUsers) {
      if (!user.kidSettings) continue;

      const ks = user.kidSettings;

      // Defensive guard: allowanceAmount must be a valid positive number.
      // The API validates this on write, but direct DB edits could introduce bad data.
      if (typeof ks.allowanceAmount !== 'number' || !isFinite(ks.allowanceAmount) || ks.allowanceAmount <= 0) {
        context.warn(`[allowanceScheduler] Skipping ${user.displayName} — invalid allowanceAmount: ${ks.allowanceAmount}`);
        continue;
      }

      const nextDate = new Date(ks.nextAllowanceDate!);

      // Compute the next allowance date.  Wrapped in try/catch so a bad record
      // for one user doesn't crash the entire scheduler run.
      let nextAllowanceDate: Date;
      try {
        nextAllowanceDate = computeNextDate(ks.nextAllowanceDate!, ks);
      } catch (computeErr) {
        context.error(`[allowanceScheduler] Failed to compute next date for ${user.displayName}:`, computeErr);
        continue;
      }

      // ── Step 1: Claim this cycle atomically via ETag-conditioned replace ──────
      // Advance nextAllowanceDate BEFORE creating the transaction. If two instances
      // race here, only one wins; the other gets a 412 and skips. This eliminates
      // the read-modify-write race on nextAllowanceDate (KI-0022).
      const etag = (user as User & { _etag: string })._etag;
      const claimedUser: User = {
        ...user,
        kidSettings: {
          ...ks,
          nextAllowanceDate: nextAllowanceDate.toISOString(),
        },
        updatedAt: now.toISOString(),
      };

      try {
        await usersContainer.item(user.id, user.familyId).replace(
          claimedUser,
          { accessCondition: { type: 'IfMatch', condition: etag } },
        );
      } catch (claimErr) {
        if (isETagConflict(claimErr)) {
          // Another instance already claimed this cycle — skip.
          context.log(`[allowanceScheduler] Skipping ${user.displayName} — cycle already claimed by another instance.`);
          continue;
        }
        // Unexpected error — log and skip this user rather than crashing the whole run.
        context.error(`[allowanceScheduler] Failed to claim cycle for ${user.displayName}:`, claimErr);
        continue;
      }

      context.log(`[allowanceScheduler] Claimed cycle for ${user.displayName}. Next allowance: ${nextAllowanceDate.toISOString()}`);

      // ── Step 2: Idempotency check (recovery guard) ────────────────────────────
      // If a previous run crashed after the claim but before the transaction write,
      // this window check prevents double-crediting on the re-run.
      const windowStart = new Date(nextDate.getTime() - 10 * 60 * 1000).toISOString();
      const windowEnd = new Date(nextDate.getTime() + 10 * 60 * 1000).toISOString();

      const { resources: existing } = await txnContainer.items
        .query<Transaction>({
          query: `SELECT TOP 1 c.id FROM c 
                  WHERE c.familyId = @familyId 
                  AND c.kidOid = @kidOid 
                  AND c.createdBy = 'scheduler' 
                  AND c.date >= @windowStart 
                  AND c.date <= @windowEnd`,
          parameters: [
            { name: '@familyId', value: user.familyId },
            { name: '@kidOid', value: user.oid },
            { name: '@windowStart', value: windowStart },
            { name: '@windowEnd', value: windowEnd },
          ],
        })
        .fetchAll();

      if (existing.length > 0) {
        context.log(`[allowanceScheduler] Skipping ${user.displayName} — transaction already exists in window (crash recovery).`);
        continue;
      }

      // ── Step 3: Create the allowance transaction ──────────────────────────────
      const transaction: Transaction = {
        id: randomUUID(),
        familyId: user.familyId,
        kidOid: user.oid,
        category: 'Income',
        amount: ks.allowanceAmount,
        notes: 'Automatic allowance',
        date: nextDate.toISOString(),
        tithable: true,  // automatic allowance is always tithable
        createdBy: 'scheduler',
        createdAt: now.toISOString(),
      };

      await txnContainer.items.create(transaction);
      context.log(`[allowanceScheduler] Credited $${ks.allowanceAmount} to ${user.displayName}.`);
    }
  } catch (err) {
    context.error('[allowanceScheduler] Unhandled error:', err);
    // Do not rethrow — a scheduler crash should not be a fatal Functions failure
  }
}

/**
 * Computes the next allowance date from the current one.
 *
 * Advances by a fixed number of UTC days from the current fire timestamp.
 * This preserves the exact UTC fire time (e.g. "12:30 UTC = 8:30 AM ET").
 * Note: if DST transitions occur between cycles, the local-clock display of
 * the fire time may shift by one hour, but the UTC basis remains consistent.
 * Timezone-aware re-computation only happens in computeInitialNextDate
 * (updateSettings.ts) when the schedule is explicitly reconfigured.
 */
function computeNextDate(
  currentDateIso: string,
  ks: NonNullable<User['kidSettings']>
): Date {
  const current = new Date(currentDateIso);

  switch (ks.allowanceFrequency) {
    case 'Weekly':
      return addDays(current, 7);

    case 'Bi-weekly':
      return addDays(current, 14);

    case 'Monthly': {
      // 1st of next month, same UTC time of day.
      const next = new Date(current);
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(1);
      return next;
    }

    default:
      return addDays(current, 7);
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Timer trigger — every 5 minutes
// NCRONTAB format: {second} {minute} {hour} {day} {month} {day-of-week}
app.timer('allowanceScheduler', {
  schedule: '0 */5 * * * *',
  handler: allowanceScheduler,
  runOnStartup: false, // Avoid running on every cold start/deployment
});
