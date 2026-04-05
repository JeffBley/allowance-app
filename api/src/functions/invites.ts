import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope } from '../middleware/familyScope.js';
import { getContainer, generateInviteCode } from '../data/cosmosClient.js';
import type { InviteCode, Family, User, GenerateInviteRequest } from '../data/models.js';
import { DEFAULT_MEMBER_LIMIT } from '../data/models.js';

// ---------------------------------------------------------------------------
// GET    /api/invites        — list invite codes for the caller's family
// POST   /api/invites        — generate an invite code (FamilyAdmin only)
// DELETE /api/invites/{code} — revoke an unused code   (FamilyAdmin only)
//
// Security:
//   - Bearer token required for all methods
//   - familyId comes from server-side family scope (never from client input)
//   - FamilyAdmin role required for POST and DELETE
//   - FamilyAdmins can invite roles 'User' or 'FamilyAdmin' within their own family only
//   - Invite generation is rejected if the family is already at/over its member limit
//     (authoritative limit enforcement happens at POST /api/invite/redeem)
//   - Revocation is scoped to the caller's family — cross-family revocation is rejected
// ---------------------------------------------------------------------------

async function listInvites(
  familyId: string,
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const container = getContainer('inviteCodes');
    const { resources } = await container.items
      .query<InviteCode>({
        query: 'SELECT * FROM c WHERE c.familyId = @familyId ORDER BY c.createdAt DESC',
        parameters: [{ name: '@familyId', value: familyId }],
      })
      .fetchAll();

    const now = new Date().toISOString();
    const codes = resources.map(c => ({
      code:            c.id,
      familyId:        c.familyId,
      role:            c.role,
      displayNameHint: c.displayNameHint ?? null,
      localMemberOid:  c.localMemberOid ?? null,
      createdAt:       c.createdAt,
      expiresAt:       c.expiresAt,
      expired:         c.expiresAt < now,
      used:            c.usedByOid !== null,
      usedAt:          c.usedAt,
    }));

    return { status: 200, jsonBody: { codes } };
  } catch (err) {
    context.error('invites GET error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to fetch invite codes.' } };
  }
}

async function generateInvite(
  familyId: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  // Parse and validate request body
  let body: GenerateInviteRequest;
  try {
    body = await request.json() as GenerateInviteRequest;
    if (body.role !== 'User' && body.role !== 'FamilyAdmin') {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'role' must be 'User' or 'FamilyAdmin'." } };
    }
    if (body.displayNameHint !== undefined && body.displayNameHint !== null) {
      if (typeof body.displayNameHint !== 'string' || body.displayNameHint.length > 60) {
        return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'displayNameHint' must be a string of at most 60 characters." } };
      }
    }
    if (body.localMemberOid !== undefined && body.localMemberOid !== null) {
      // UUID v4 format check
      if (typeof body.localMemberOid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.localMemberOid)) {
        return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'localMemberOid' must be a valid UUID." } };
      }
    }
    // Family admins always get the standard 7-day expiry — they cannot set expiryDays
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  try {
    const familiesContainer = getContainer('families');
    const usersContainer    = getContainer('users');

    const { resource: family } = await familiesContainer.item(familyId, familyId).read<Family>();
    if (!family) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };
    }

    // For link invites, validate the local member exists (belongs to this family and is a local account)
    let resolvedLocalMemberOid: string | undefined;
    if (body.localMemberOid) {
      const { resource: localUser } = await usersContainer.item(body.localMemberOid, familyId).read<User>();
      if (!localUser || localUser.familyId !== familyId || !localUser.isLocalAccount) {
        return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Local member not found in this family.' } };
      }
      resolvedLocalMemberOid = localUser.oid;
    }

    // Only enforce member limit for regular (non-link) invites — link invites don't add a new member.
    // We count members + active unused non-link codes together against the limit. This ensures every
    // active code is guaranteed a slot if redeemed before expiry, closing the advisory-only TOCTOU gap
    // (KI-0024). The authoritative hard limit is still enforced at POST /api/invite/redeem.
    const inviteContainer = getContainer('inviteCodes');
    if (!resolvedLocalMemberOid) {
      const limit = family.memberLimit ?? DEFAULT_MEMBER_LIMIT;
      const nowIso = new Date().toISOString();

      const [{ resources: currentMembers }, { resources: activeCodeDocs }] = await Promise.all([
        usersContainer.items
          .query<{ id: string }>({
            query: 'SELECT c.id FROM c WHERE c.familyId = @familyId',
            parameters: [{ name: '@familyId', value: familyId }],
          })
          .fetchAll(),
        inviteContainer.items
          .query<{ id: string }>({
            // Active = unused AND not expired AND not a link invite (localMemberOid is null/absent)
            query: `SELECT c.id FROM c
                    WHERE c.familyId = @familyId
                    AND c.usedByOid = null
                    AND c.expiresAt > @now
                    AND (NOT IS_DEFINED(c.localMemberOid) OR c.localMemberOid = null)`,
            parameters: [
              { name: '@familyId', value: familyId },
              { name: '@now',      value: nowIso },
            ],
          })
          .fetchAll(),
      ]);

      const occupiedSlots = currentMembers.length + activeCodeDocs.length;
      if (occupiedSlots >= limit) {
        return {
          status: 409,
          jsonBody: {
            code:    'FAMILY_FULL',
            message: `This family has reached its member limit (${limit}). Remove a member, revoke an unused invite, or ask a super admin to increase the limit.`,
          },
        };
      }
    }
    const now = new Date();
    // Fixed 7-day expiry for family-admin-generated codes
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Generate a unique code — retry on collision (extremely rare)
    let code: string;
    let attempts = 0;
    do {
      code = generateInviteCode();
      const { resource: existing } = await inviteContainer.item(code, code).read<InviteCode>();
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    if (attempts >= 5) {
      context.error('invites POST: could not generate unique code after 5 attempts');
      return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Could not generate a unique invite code. Please try again.' } };
    }

    const invite: InviteCode = {
      id:              code,
      familyId,
      role:            body.role,
      // kidSettings not pre-set for family-admin invites — configured post-enrollment
      kidSettings:     undefined,
      displayNameHint: body.displayNameHint?.trim() || undefined,
      localMemberOid:  resolvedLocalMemberOid,
      createdAt:       now.toISOString(),
      expiresAt,
      usedByOid:       null,
      usedAt:          null,
    };

    await inviteContainer.items.create(invite);
    context.log(`family admin: generated invite code '${code}' for family '${familyId}' (role: ${body.role}${resolvedLocalMemberOid ? ', link for: ' + resolvedLocalMemberOid : ''})`);

    return {
      status: 201,
      jsonBody: {
        code:            invite.id,
        familyId:        invite.familyId,
        role:            invite.role,
        displayNameHint: invite.displayNameHint ?? null,
        localMemberOid:  invite.localMemberOid ?? null,
        createdAt:       invite.createdAt,
        expiresAt:       invite.expiresAt,
        expired:         false,
        used:            false,
        usedAt:          null,
      },
    };
  } catch (err) {
    context.error('invites POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to generate invite code.' } };
  }
}

async function revokeInvite(
  familyId: string,
  code: string,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const container = getContainer('inviteCodes');
    const { resource: invite } = await container.item(code, code).read<InviteCode>();

    if (!invite || invite.familyId !== familyId) {
      // familyId check prevents cross-family revocation
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Invite code not found.' } };
    }

    await container.item(code, code).delete();
    context.log(`family admin: revoked/deleted invite '${code}' for family '${familyId}'`);
    return { status: 204 };
  } catch (err) {
    context.error('invites DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to revoke invite code.' } };
  }
}

async function updateInvite(
  familyId: string,
  code: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: { displayNameHint?: string | null };
  try {
    body = await request.json() as { displayNameHint?: string | null };
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  if (body.displayNameHint !== undefined && body.displayNameHint !== null) {
    if (typeof body.displayNameHint !== 'string' || body.displayNameHint.length > 60) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'displayNameHint' must be a string of at most 60 characters." } };
    }
  }

  try {
    const container = getContainer('inviteCodes');
    const { resource: invite } = await container.item(code, code).read<InviteCode>();

    if (!invite || invite.familyId !== familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Invite code not found.' } };
    }

    // Reject updates to already-used or expired codes — the change would have no effect
    if (invite.usedByOid !== null) {
      return { status: 409, jsonBody: { code: 'ALREADY_USED', message: 'This invite code has already been redeemed.' } };
    }
    const nowCheck = new Date().toISOString();
    if (invite.expiresAt < nowCheck) {
      return { status: 410, jsonBody: { code: 'CODE_EXPIRED', message: 'This invite code has expired.' } };
    }

    const updated: InviteCode = {
      ...invite,
      displayNameHint: body.displayNameHint?.trim() || undefined,
    };
    await container.item(code, code).replace(updated);
    context.log(`family admin: updated invite '${code}' for family '${familyId}'`);

    const now = new Date().toISOString();
    return {
      status: 200,
      jsonBody: {
        code:            updated.id,
        familyId:        updated.familyId,
        role:            updated.role,
        displayNameHint: updated.displayNameHint ?? null,
        createdAt:       updated.createdAt,
        expiresAt:       updated.expiresAt,
        expired:         updated.expiresAt < now,
        used:            updated.usedByOid !== null,
        usedAt:          updated.usedAt,
      },
    };
  } catch (err) {
    context.error('invites PATCH error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to update invite code.' } };
  }
}

// ---------------------------------------------------------------------------
// Route registrations
// ---------------------------------------------------------------------------

app.http('familyAdminInvites', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'invites',
  handler: async (req, ctx) => {
    const auth = await validateBearerToken(req, ctx);
    if (!auth) return UNAUTHORIZED;

    const scope = await resolveFamilyScope(auth.payload.oid, ctx);
    if (!scope) return { status: 404, jsonBody: { code: 'NOT_ENROLLED', message: 'User is not enrolled in a family.' } };

    // GET is accessible to all family members; POST requires FamilyAdmin
    if (req.method === 'POST' && scope.role !== 'FamilyAdmin') return FORBIDDEN;

    if (req.method === 'GET')  return listInvites(scope.familyId, req, ctx);
    if (req.method === 'POST') return generateInvite(scope.familyId, req, ctx);
    return { status: 405 };
  },
});

app.http('familyAdminInviteRevoke', {
  methods: ['DELETE', 'PATCH'],
  authLevel: 'anonymous',
  route: 'invites/{code}',
  handler: async (req, ctx) => {
    const auth = await validateBearerToken(req, ctx);
    if (!auth) return UNAUTHORIZED;

    const scope = await resolveFamilyScope(auth.payload.oid, ctx);
    if (!scope)                       return { status: 404, jsonBody: { code: 'NOT_ENROLLED' } };
    if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

    const code = req.params['code'] ?? '';
    if (!code) return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Missing invite code.' } };

    if (req.method === 'PATCH')  return updateInvite(scope.familyId, code, req, ctx);
    if (req.method === 'DELETE') return revokeInvite(scope.familyId, code, ctx);
    return { status: 405 };
  },
});
