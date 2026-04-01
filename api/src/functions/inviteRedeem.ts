import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED } from '../middleware/auth.js';
import { getContainer } from '../data/cosmosClient.js';
import type { InviteCode, Family, User, Transaction } from '../data/models.js';
import { DEFAULT_MEMBER_LIMIT } from '../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/invite/redeem
//
// Authenticated (MSAL Bearer token required). Called by a newly signed-up user
// to link their Entra account to a family using an invite code.
//
// Security controls:
//   - Requires a valid Entra JWT (oid extracted from validated token)
//   - Code validated: exists, not expired, not already used
//   - familyId comes from the code document (server-side) — never from client
//   - Role comes from the code document — never from client
//   - Idempotent: if user already has a record, returns 409 ALREADY_ENROLLED
//   - TOCTOU fix: invite is atomically claimed via ETag-conditioned replace
//     BEFORE the user record is created, preventing two concurrent callers
//     from both enrolling with the same code.
// ---------------------------------------------------------------------------

interface RedeemRequest {
  code: string;
  displayName: string;
}

/** Returns true when err is a Cosmos 412 Precondition Failed (ETag mismatch). */
function isETagConflict(err: unknown): boolean {
  if (err != null && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    return obj['code'] === 412 || obj['statusCode'] === 412;
  }
  return false;
}

async function redeemInvite(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('invite/redeem invoked');

  // 1. Validate MSAL token — get the caller's oid
  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const { oid } = auth.payload;

  // 2. Parse and validate request body
  let body: RedeemRequest;
  try {
    body = await request.json() as RedeemRequest;
    if (typeof body?.code !== 'string' || !/^[a-z0-9]{8}$/.test(body.code)) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid invite code format.' } };
    }
    if (typeof body?.displayName !== 'string' || body.displayName.trim().length < 1 || body.displayName.length > 60) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'displayName\' must be 1-60 characters.' } };
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid request body.' } };
  }

  const code = body.code.toLowerCase().trim();
  // Strip ASCII control characters (consistent with localMembers.ts and superadmin/members.ts)
  const displayName = body.displayName.trim().replace(/[\x00-\x1f\x7f]/g, '');

  try {
    const usersContainer  = getContainer('users');
    const inviteContainer = getContainer('inviteCodes');

    // 3. Check the user isn't already enrolled in any family (fast fail)
    const { resources: existingUsers } = await usersContainer.items
      .query<User>({
        query: 'SELECT c.oid, c.familyId FROM c WHERE c.oid = @oid',
        parameters: [{ name: '@oid', value: oid }],
      })
      .fetchAll();

    if (existingUsers.length > 0) {
      return {
        status: 409,
        jsonBody: {
          code: 'ALREADY_ENROLLED',
          message: 'This account is already enrolled in a family.',
        },
      };
    }

    // 4. Read the invite code (point read — /id partition key), capturing _etag for CAS
    const { resource: invite } = await inviteContainer.item(code, code).read<InviteCode>();

    if (!invite) {
      // Deliberate: don't distinguish "not found" from "expired" to prevent enumeration
      return { status: 404, jsonBody: { code: 'INVALID_CODE', message: 'Invite code not found or has expired.' } };
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Track whether this is a retry of a previously-claimed-but-incomplete redemption.
    // Used later in step 7b to allow the link flow to continue past user-creation 409
    // without returning ALREADY_ENROLLED, and in step 5b to skip expiry for retry paths.
    const isRetry = invite.usedByOid === oid;

    // 5a. If this exact OID previously claimed the code but user creation failed, allow retry.
    //     Any other non-null usedByOid means a different user already redeemed it.
    if (invite.usedByOid !== null && invite.usedByOid !== oid) {
      return { status: 409, jsonBody: { code: 'CODE_USED', message: 'This invite code has already been used.' } };
    }

    // 5b. Check expiry — only for un-claimed codes.
    //     If this OID already atomically claimed the code (usedByOid === oid) but creation
    //     failed, we must allow retry even after the code's expiry time has passed; otherwise
    //     a partially-failed redemption becomes permanently unrecoverable after expiry.
    if (invite.usedByOid === null && invite.expiresAt < nowIso) {
      return { status: 410, jsonBody: { code: 'CODE_EXPIRED', message: 'This invite code has expired. Ask your admin to generate a new one.' } };
    }

    // 5c. Enforce family member limit — skip for link invites (not adding a new member).
    if (invite.usedByOid === null && !invite.localMemberOid) {
      const familiesContainer  = getContainer('families');
      const { resource: familyDoc } = await familiesContainer.item(invite.familyId, invite.familyId).read<Family>();
      const limit = familyDoc?.memberLimit ?? DEFAULT_MEMBER_LIMIT;

      const { resources: currentMembers } = await usersContainer.items
        .query<{ id: string }>({
          query: 'SELECT c.id FROM c WHERE c.familyId = @familyId',
          parameters: [{ name: '@familyId', value: invite.familyId }],
        })
        .fetchAll();

      if (currentMembers.length >= limit) {
        return {
          status: 409,
          jsonBody: {
            code:    'FAMILY_FULL',
            message: `This family has reached its member limit of ${limit}. Please contact your family admin.`,
          },
        };
      }
    }

    // 6. Atomically claim the invite using an ETag-conditioned replace.
    //    This is the TOCTOU fix: only one concurrent caller wins this replace;
    //    all others get a 412 and are returned CODE_USED.
    //    We only perform this step when the code is not yet claimed (usedByOid === null).
    if (invite.usedByOid === null) {
      const etag = (invite as InviteCode & { _etag: string })._etag;
      const claimedInvite: InviteCode = { ...invite, usedByOid: oid, usedAt: nowIso };
      try {
        await inviteContainer.item(code, code).replace(
          claimedInvite,
          { accessCondition: { type: 'IfMatch', condition: etag } },
        );
      } catch (replaceErr) {
        if (isETagConflict(replaceErr)) {
          // Another concurrent request claimed this code between our read and replace.
          return { status: 409, jsonBody: { code: 'CODE_USED', message: 'This invite code has already been used.' } };
        }
        throw replaceErr; // Unexpected error — re-throw to outer catch
      }
    }

    // 7. Create or merge the user record.
    //    For link invites: merge the Entra identity onto the existing local account,
    //    migrating all transactions across to the new Entra OID.
    //    For regular invites: create a new user record as before.
    if (invite.localMemberOid) {
      // ── Link flow: merge Entra identity onto existing local account ──────────
      const localOid = invite.localMemberOid;

      // 7a. Read the local user; fail gracefully if already migrated or deleted
      const { resource: localUser } = await usersContainer.item(localOid, invite.familyId).read<User>();
      if (!localUser || !localUser.isLocalAccount || localUser.familyId !== invite.familyId) {
        context.warn(`invite/redeem link: local user '${localOid}' not found or already linked`);
        return { status: 409, jsonBody: { code: 'ALREADY_LINKED', message: 'This local account has already been linked or no longer exists.' } };
      }

      // 7b. Create the new Entra-backed user record, inheriting settings from the local account.
      // Role comes from the invite code (set to the local member's role by the admin).
      const linkedUser: User = {
        id:          oid,
        familyId:    invite.familyId,
        oid,
        displayName,
        role:        invite.role,
        kidSettings: localUser.kidSettings,
        createdAt:   localUser.createdAt,  // preserve original creation date
        updatedAt:   nowIso,
      };
      try {
        await usersContainer.items.create(linkedUser);
      } catch (createErr) {
        if ((createErr as Record<string, unknown>)?.['code'] === 409) {
          if (isRetry) {
            // This is a retry of a previously-claimed redemption. The Entra user was
            // already created in the previous attempt — continue to transaction migration
            // rather than blocking recovery with ALREADY_ENROLLED.
            context.log(`invite/redeem link: retry path — Entra user '${oid}' already exists, continuing transaction migration`);
          } else {
            return { status: 409, jsonBody: { code: 'ALREADY_ENROLLED', message: 'This account is already enrolled in a family.' } };
          }
        } else {
          throw createErr;
        }
      }

      // 7c. Migrate all transactions from local UUID → Entra OID.
      //
      // The WHERE kidOid = @localOid query is naturally idempotent on retry: transactions
      // already migrated to the Entra OID in a previous attempt won't appear here, so only
      // un-migrated ones are processed. This means a retry safely resumes where it left off.
      //
      // We migrate serially with per-item error capture rather than Promise.all so that:
      //   (a) a single Cosmos transient error doesn't abort the entire migration, and
      //   (b) we know exactly which IDs need manual recovery if any do fail.
      //
      // If ANY migration fails we do NOT delete the old local user — it stays in the
      // database as a recovery anchor so orphaned transactions remain queryable.
      const txnContainer = getContainer('transactions');
      const { resources: txnsToMigrate } = await txnContainer.items
        .query<Transaction>({
          query: 'SELECT * FROM c WHERE c.familyId = @familyId AND c.kidOid = @kidOid',
          parameters: [
            { name: '@familyId', value: invite.familyId },
            { name: '@kidOid',   value: localOid },
          ],
        })
        .fetchAll();

      const failedTxnIds: string[] = [];
      let migratedCount = 0;
      for (const t of txnsToMigrate) {
        try {
          await txnContainer.item(t.id, t.familyId).replace({ ...t, kidOid: oid });
          migratedCount++;
        } catch (migrateErr) {
          context.warn(`invite/redeem link: failed to migrate transaction '${t.id}'`, migrateErr);
          failedTxnIds.push(t.id);
        }
      }

      if (failedTxnIds.length > 0) {
        // Partial migration — old local user intentionally left intact as a recovery anchor.
        // The admin can retry redemption (retry path will re-query and attempt only the
        // remaining un-migrated transactions) or repair manually via Cosmos Data Explorer.
        context.error(
          `invite/redeem link: PARTIAL MIGRATION — ${migratedCount}/${txnsToMigrate.length} transactions migrated for oid '${oid}'. ` +
          `Failed IDs: [${failedTxnIds.join(', ')}]. ` +
          `Local user '${localOid}' retained as recovery anchor. Retry redemption to resume.`,
        );
        return {
          status: 500,
          jsonBody: {
            code: 'PARTIAL_MIGRATION',
            message: 'Enrollment partially completed. Please try again to resume the migration, or contact your administrator.',
          },
        };
      }

      context.log(`invite/redeem link: migrated ${migratedCount} transaction(s) from '${localOid}' → '${oid}'`);

      // 7d. Delete the old local user record — only reached when all transactions migrated.
      // A 404 here means a previous retry already deleted it; treat as success.
      try {
        await usersContainer.item(localOid, invite.familyId).delete();
      } catch (deleteErr) {
        const errCode = (deleteErr as Record<string, unknown>)?.['code'];
        const errStatus = (deleteErr as Record<string, unknown>)?.['statusCode'];
        if (errCode === 404 || errStatus === 404) {
          context.log(`invite/redeem link: local user '${localOid}' already deleted (retry path) — continuing`);
        } else {
          throw deleteErr;
        }
      }
      context.log(`invite/redeem link: linked local user '${localOid}' → Entra oid '${oid}' in family '${invite.familyId}'`);

    } else {
      // ── Regular flow: create a brand-new user record ──────────────────────
      const newUser: User = {
        id:          oid,
        familyId:    invite.familyId,
        oid,
        displayName,
        role:        invite.role,
        kidSettings: invite.role === 'User' ? invite.kidSettings : undefined,
        createdAt:   nowIso,
        updatedAt:   nowIso,
      };

      try {
        await usersContainer.items.create(newUser);
      } catch (createErr) {
        // 409 from usersContainer means user somehow already exists — treat as ALREADY_ENROLLED
        if ((createErr as Record<string, unknown>)?.['code'] === 409) {
          context.warn(`invite/redeem: user '${oid}' already exists despite enrollment check — returning ALREADY_ENROLLED`);
          return { status: 409, jsonBody: { code: 'ALREADY_ENROLLED', message: 'This account is already enrolled in a family.' } };
        }
        // Any other failure: the invite is already claimed but no user was created.
        // Log enough detail for manual recovery (admin can insert the user record directly).
        context.error(`invite/redeem: CRITICAL — invite '${code}' claimed by '${oid}' but user creation failed. Manual recovery required.`, createErr);
        return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to complete enrollment. Please contact your administrator.' } };
      }
    } // end if/else link vs regular flow

    context.log(`invite/redeem: enrolled oid '${oid}' into family '${invite.familyId}' as '${invite.role}'`);

    return {
      status: 201,
      jsonBody: {
        enrolled:  true,
        familyId:  invite.familyId,
        role:      invite.role,
        displayName,
      },
    };
  } catch (err) {
    context.error('invite/redeem error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to redeem invite code.' } };
  }
}

app.http('inviteRedeem', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invite/redeem',
  handler: redeemInvite,
});
