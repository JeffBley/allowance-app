import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer } from '../../data/cosmosClient.js';
import type { Transaction, User, PurgeTransactionsRequest } from '../../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/superadmin/families/{familyId}/purge-transactions
//
// Purges old transactions for a specific kid and accumulates their balance
// and tithing-owed contributions into two delta fields on the kid's
// KidSettings document (purgedBalanceDelta, purgedTithingOwedDelta). This
// ensures that even after old records are deleted, computeKidView continues
// to produce the correct balance by using:
//
//   balance = balanceOverride + purgedBalanceDelta + Σ(live txns after overrideAt)
//
// Only transactions dated AFTER balanceOverrideAt are accumulated into the
// deltas; transactions before the override date are already captured in the
// override values themselves and are simply discarded when purged.
//
// SAFETY ORDER: transactions are deleted one-by-one, and we accumulate only
// the delta for records we successfully delete. The user document is written
// once at the end with the total accumulated delta. If the final user write
// fails, the deleted transactions are gone but the delta is missing — the
// admin can correct with a manual balance override. This edge case is
// documented in .internal/KNOWN_ISSUES.md.
// ---------------------------------------------------------------------------

async function purgeTransactions(
  familyId: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('purgeTransactions invoked for family', familyId);

  const session = await validateBootstrapSession(request, context);
  if (!session) return SA_UNAUTHORIZED;

  let body: PurgeTransactionsRequest;
  try {
    body = await request.json() as PurgeTransactionsRequest;
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  if (!body.kidOid) {
    return { status: 400, jsonBody: { code: 'MISSING_FIELDS', message: 'kidOid is required.' } };
  }
  if (!body.beforeDate || isNaN(Date.parse(body.beforeDate))) {
    return { status: 400, jsonBody: { code: 'INVALID_DATE', message: 'beforeDate must be a valid ISO 8601 string.' } };
  }

  try {
    const usersContainer = getContainer('users');
    const txnContainer   = getContainer('transactions');

    // Read the kid's user document to get the override anchor date and current deltas
    const { resource: kidUser } = await usersContainer.item(body.kidOid, familyId).read<User>();
    if (!kidUser) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Kid not found in this family.' } };
    }

    const overrideAt = kidUser.kidSettings?.balanceOverrideAt;

    // Query all transactions for this kid before the cutoff date
    const { resources: candidates } = await txnContainer.items.query<Transaction>({
      query: 'SELECT * FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid AND c.date < @beforeDate',
      parameters: [
        { name: '@familyId',   value: familyId        },
        { name: '@kidOid',     value: body.kidOid      },
        { name: '@beforeDate', value: body.beforeDate  },
      ],
    }).fetchAll();

    if (candidates.length === 0) {
      return { status: 200, jsonBody: { purgedCount: 0, purgedBalanceDelta: 0, purgedTithingOwedDelta: 0 } };
    }

    // Accumulate deltas only for transactions that fall AFTER the override anchor.
    // Transactions before the anchor are already captured in balanceOverride /
    // tithingOwedOverride, so we just discard them without touching the deltas.
    // Accumulate in integer cents to prevent floating-point drift across many transactions.
    let accBalanceCents     = 0;
    let accTithingOwedCents = 0;
    let purgedCount         = 0;

    for (const txn of candidates) {
      try {
        await txnContainer.item(txn.id, familyId).delete();
        purgedCount++;

        // Only accumulate delta for post-override transactions
        if (!overrideAt || txn.date > overrideAt) {
          const amountCents = Math.round(txn.amount * 100);
          if (txn.category === 'Income') {
            accBalanceCents += amountCents;
            if (txn.tithable !== false) {
              // 10% tithing owed — round per-transaction to avoid float drift
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
        // Log but continue — partial purge is acceptable; un-deleted transactions
        // remain in the live list and will continue to be summed correctly.
        context.warn(`purgeTransactions: failed to delete txn ${txn.id}`, deleteErr);
      }
    }

    if (purgedCount === 0) {
      return { status: 200, jsonBody: { purgedCount: 0, purgedBalanceDelta: 0, purgedTithingOwedDelta: 0 } };
    }

    // Convert integer cents → dollar amounts for storage
    const roundedBalanceDelta     = accBalanceCents     / 100;
    const roundedTithingOwedDelta = accTithingOwedCents / 100;

    // Write accumulated deltas to the user doc (add to any existing deltas)
    const now     = new Date().toISOString();
    const updated: User = {
      ...kidUser,
      kidSettings: {
        ...kidUser.kidSettings!,
        purgedBalanceDelta:
          Math.round(((kidUser.kidSettings?.purgedBalanceDelta ?? 0) + roundedBalanceDelta) * 100) / 100,
        purgedTithingOwedDelta:
          Math.round(((kidUser.kidSettings?.purgedTithingOwedDelta ?? 0) + roundedTithingOwedDelta) * 100) / 100,
      },
      updatedAt: now,
    };
    await usersContainer.item(body.kidOid, familyId).replace(updated);

    context.log(
      `purgeTransactions: purged ${purgedCount}/${candidates.length} transactions for kid '${body.kidOid}'`,
      `balanceDelta=${roundedBalanceDelta}, tithingOwedDelta=${roundedTithingOwedDelta}`,
    );

    return {
      status: 200,
      jsonBody: {
        purgedCount,
        skippedCount:         candidates.length - purgedCount,
        purgedBalanceDelta:   roundedBalanceDelta,
        purgedTithingOwedDelta: roundedTithingOwedDelta,
      },
    };
  } catch (err) {
    context.error('purgeTransactions error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Purge operation failed.' } };
  }
}

app.http('saPurgeTransactions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/purge-transactions',
  handler: (req, ctx) => purgeTransactions(req.params['familyId'], req, ctx),
});
