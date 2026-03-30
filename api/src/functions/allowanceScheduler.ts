import { app, InvocationContext, Timer } from '@azure/functions';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Transaction } from '../data/models.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Allowance Scheduler — runs every 5 minutes
// Finds all kids whose nextAllowanceDate has passed and credits their allowance.
//
// Security: This is a server-side timer trigger — no inbound HTTP, no auth needed.
// Idempotency: Before inserting, checks for a recent transaction from the scheduler
// to avoid double-crediting on restart/re-execution edge cases.
// ---------------------------------------------------------------------------

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
      const nextDate = new Date(ks.nextAllowanceDate!);

      // Idempotency check: look for a scheduler-created transaction within a 10-minute window
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
        context.log(`[allowanceScheduler] Skipping ${user.displayName} — transaction already exists in window.`);
        continue;
      }

      // Create the allowance transaction
      const transaction: Transaction = {
        id: randomUUID(),
        familyId: user.familyId,
        kidOid: user.oid,
        category: 'Income',
        amount: ks.allowanceAmount,
        notes: 'Automatic allowance',
        date: nextDate.toISOString(),
        createdBy: 'scheduler',
        createdAt: now.toISOString(),
      };

      await txnContainer.items.create(transaction);
      context.log(`[allowanceScheduler] Credited $${ks.allowanceAmount} to ${user.displayName}.`);

      // Compute next allowance date
      const nextAllowanceDate = computeNextDate(ks.nextAllowanceDate!, ks);

      // Update user's nextAllowanceDate
      const updatedUser: User = {
        ...user,
        kidSettings: {
          ...ks,
          nextAllowanceDate: nextAllowanceDate.toISOString(),
        },
        updatedAt: now.toISOString(),
      };

      await usersContainer.item(user.id, user.familyId).replace(updatedUser);
      context.log(`[allowanceScheduler] Next allowance for ${user.displayName}: ${nextAllowanceDate.toISOString()}`);
    }
  } catch (err) {
    context.error('[allowanceScheduler] Unhandled error:', err);
    // Do not rethrow — a scheduler crash should not be a fatal Functions failure
  }
}

/**
 * Computes the next allowance date from the current one, respecting
 * the frequency and day-of-week settings.
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
      // Always the 1st of the next month at the same time
      const next = new Date(current);
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(1);
      return next;
    }

    default:
      // Fallback — add 7 days
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
