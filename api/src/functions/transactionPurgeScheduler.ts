import { app, InvocationContext, Timer } from '@azure/functions';
import { getContainer } from '../data/cosmosClient.js';
import type { User, Transaction } from '../data/models.js';

// ---------------------------------------------------------------------------
// Transaction Purge Scheduler — runs once a day
//
// Purges transactions older than 2 years for every kid in every family,
// accumulating their balance/tithing contributions into purgedBalanceDelta
// and purgedTithingOwedDelta on the kid's KidSettings so that computeKidView
// continues to produce correct balances after the records are removed.
//
// Delta accumulation rules (mirrors purgeTransactions.ts):
//   - Only transactions dated AFTER balanceOverrideAt are accumulated.
//   - Transactions before the override anchor are already captured in
//     balanceOverride/tithingOwedOverride and are simply discarded.
//   - Integer-cent arithmetic prevents floating-point drift.
//
// Failure handling:
//   - Per-kid errors are logged and skipped; the scheduler continues.
//   - If the user-doc delta write fails for a kid, the deleted transactions
//     are gone but the delta is missing. The admin can correct via the
//     manual "Set Balance Override" tool. This is the same trade-off
//     documented in the manual purge endpoint (purgeTransactions.ts).
//
// Security: Timer trigger — no inbound HTTP, no auth required.
// ---------------------------------------------------------------------------

async function transactionPurgeScheduler(_timer: Timer, context: InvocationContext): Promise<void> {
  const now = new Date();
  context.log(`[transactionPurgeScheduler] Running at ${now.toISOString()}`);

  // Cutoff = exactly 2 years ago (ISO date string, date portion only for consistent cutoff)
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  const cutoffIso = cutoff.toISOString();

  try {
    const usersContainer = getContainer('users');
    const txnContainer   = getContainer('transactions');

    // Find all kid-role users across all families (cross-partition query).
    const { resources: kids } = await usersContainer.items
      .query<User>({
        query: `SELECT * FROM c WHERE c.role = 'User'`,
      })
      .fetchAll();

    context.log(`[transactionPurgeScheduler] Found ${kids.length} kid(s) to check.`);

    let totalPurged = 0;
    let totalSkipped = 0;

    for (const kid of kids) {
      try {
        // Query transactions for this kid that are older than the cutoff
        const { resources: candidates } = await txnContainer.items.query<Transaction>({
          query: 'SELECT * FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid AND c.date < @cutoff',
          parameters: [
            { name: '@familyId', value: kid.familyId },
            { name: '@kidOid',   value: kid.oid       },
            { name: '@cutoff',   value: cutoffIso      },
          ],
        }).fetchAll();

        if (candidates.length === 0) continue;

        const overrideAt = kid.kidSettings?.balanceOverrideAt ?? null;

        let accBalanceCents     = 0;
        let accTithingOwedCents = 0;
        let purgedCount         = 0;

        for (const txn of candidates) {
          try {
            await txnContainer.item(txn.id, kid.familyId).delete();
            purgedCount++;

            // Only accumulate delta for transactions after the override anchor
            if (!overrideAt || txn.date > overrideAt) {
              const amountCents = Math.round(txn.amount * 100);
              if (txn.category === 'Income') {
                accBalanceCents += amountCents;
                if (txn.tithable !== false) {
                  accTithingOwedCents += Math.round(amountCents * 0.1);
                }
              } else if (txn.category === 'Purchase') {
                accBalanceCents -= amountCents;
              } else if (txn.category === 'Tithing') {
                accBalanceCents     -= amountCents;
                accTithingOwedCents -= amountCents;
              }
            }
          } catch (deleteErr) {
            context.warn(`[transactionPurgeScheduler] Failed to delete txn '${txn.id}' for kid '${kid.oid}'`, deleteErr);
            totalSkipped++;
          }
        }

        if (purgedCount === 0) continue;

        // Write accumulated deltas back to the user doc (add to any existing deltas)
        const roundedBalanceDelta     = accBalanceCents     / 100;
        const roundedTithingOwedDelta = accTithingOwedCents / 100;

        const kidUserEtag = (kid as User & { _etag?: string })._etag;
        const updated: User = {
          ...kid,
          kidSettings: {
            ...kid.kidSettings!,
            purgedBalanceDelta:
              Math.round(((kid.kidSettings?.purgedBalanceDelta ?? 0) + roundedBalanceDelta) * 100) / 100,
            purgedTithingOwedDelta:
              Math.round(((kid.kidSettings?.purgedTithingOwedDelta ?? 0) + roundedTithingOwedDelta) * 100) / 100,
          },
          updatedAt: now.toISOString(),
        };

        try {
          await usersContainer.item(kid.oid, kid.familyId).replace(
            updated,
            kidUserEtag ? { accessCondition: { type: 'IfMatch', condition: kidUserEtag } } : {},
          );
        } catch (replaceErr) {
          const obj = replaceErr as Record<string, unknown>;
          if (obj['code'] === 412 || obj['statusCode'] === 412) {
            // ETag conflict — scheduler was racing with another write (e.g. allowance credit).
            // The deleted transactions are gone; the delta will be missing until the next
            // scheduled run naturally re-attempts (no new candidates → no-op next time,
            // so the delta stays missing). Admin can correct via manual balance override.
            context.warn(
              `[transactionPurgeScheduler] ETag conflict writing delta for kid '${kid.oid}' ` +
              `— ${purgedCount} transactions deleted but delta not applied. ` +
              `Admin may need to set a manual balance override.`,
            );
            totalSkipped += purgedCount;
            continue;
          }
          throw replaceErr;
        }

        context.log(
          `[transactionPurgeScheduler] kid '${kid.oid}' (${kid.displayName}): ` +
          `purged ${purgedCount}/${candidates.length} txns, ` +
          `balanceDelta=${roundedBalanceDelta}, tithingOwedDelta=${roundedTithingOwedDelta}`,
        );
        totalPurged += purgedCount;

      } catch (kidErr) {
        context.error(`[transactionPurgeScheduler] Error processing kid '${kid.oid}':`, kidErr);
        // Continue to next kid — one kid failure must not abort the whole run
      }
    }

    context.log(`[transactionPurgeScheduler] Done. totalPurged=${totalPurged}, totalSkipped=${totalSkipped}`);

  } catch (err) {
    context.error('[transactionPurgeScheduler] Unhandled error:', err);
    // Do not rethrow — a scheduler crash should not be a fatal Functions failure
  }
}

// Timer trigger — once a day at 03:00 UTC
// NCRONTAB format: {second} {minute} {hour} {day} {month} {day-of-week}
app.timer('transactionPurgeScheduler', {
  schedule: '0 0 3 * * *',
  handler: transactionPurgeScheduler,
  runOnStartup: false,
});
