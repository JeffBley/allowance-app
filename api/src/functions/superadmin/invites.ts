import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBootstrapSession, SA_UNAUTHORIZED } from '../../middleware/superadminAuth.js';
import { getContainer, generateInviteCode } from '../../data/cosmosClient.js';
import { EmailClient } from '@azure/communication-email';
import { DefaultAzureCredential } from '@azure/identity';
import type { InviteCode, GenerateInviteRequest, Family, User } from '../../data/models.js';

// ---------------------------------------------------------------------------
// GET    /api/superadmin/families/{familyId}/invites  — list invite codes
// POST   /api/superadmin/families/{familyId}/invites  — generate an invite code
// DELETE /api/superadmin/families/{familyId}/invites/{code}  — revoke a code
// ---------------------------------------------------------------------------

async function listInvites(familyId: string, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const container = getContainer('inviteCodes');
    // Cross-partition query on familyId — acceptable for admin view
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
      createdAt:       c.createdAt,
      expiresAt:       c.expiresAt,
      expired:         c.expiresAt < now,
      used:            c.usedByOid !== null,
      usedAt:          c.usedAt,
    }));

    return { status: 200, jsonBody: { codes } };
  } catch (err) {
    context.error('superadmin/invites GET error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

async function generateInvite(
  familyId: string,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: GenerateInviteRequest;
  try {
    body = await request.json() as GenerateInviteRequest;
    if (body.role !== 'User' && body.role !== 'FamilyAdmin') {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'role\' must be User or FamilyAdmin.' } };
    }
    if (typeof body.expiryDays === 'number' && (body.expiryDays < 1 || body.expiryDays > 90)) {
      return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: '\'expiryDays\' must be between 1 and 90.' } };
    }
    if (body.localMemberOid !== undefined && body.localMemberOid !== null) {
      if (typeof body.localMemberOid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.localMemberOid)) {
        return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: "'localMemberOid' must be a valid UUID." } };
      }
    }
  } catch {
    return { status: 400, jsonBody: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } };
  }

  try {
    // Verify family exists
    const familiesContainer = getContainer('families');
    const { resource: family } = await familiesContainer.item(familyId, familyId).read<Family>();
    if (!family) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Family not found.' } };
    }

    // For link invites, validate the local member exists and belongs to this family
    let resolvedLocalMemberOid: string | undefined;
    if (body.localMemberOid) {
      const usersContainer = getContainer('users');
      const { resource: localUser } = await usersContainer.item(body.localMemberOid, familyId).read<User>();
      if (!localUser || localUser.familyId !== familyId || !localUser.isLocalAccount) {
        return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Local member not found in this family.' } };
      }
      resolvedLocalMemberOid = localUser.oid;
    }

    const container = getContainer('inviteCodes');
    const now = new Date();
    const expiryDays = body.expiryDays ?? 7;
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

    // Generate a unique code — retry on collision (extremely rare)
    let code: string;
    let attempts = 0;
    do {
      code = generateInviteCode();
      const { resource: existing } = await container.item(code, code).read<InviteCode>();
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    if (attempts >= 5) {
      return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Could not generate unique invite code.' } };
    }

    const invite: InviteCode = {
      id:              code,
      familyId,
      role:            body.role,
      kidSettings:     body.role === 'User' ? body.kidSettings : undefined,
      displayNameHint: body.displayNameHint?.trim().replace(/[\x00-\x1f\x7f]/g, '') || undefined,
      localMemberOid:  resolvedLocalMemberOid,
      createdAt:       now.toISOString(),
      expiresAt,
      usedByOid:       null,
      usedAt:          null,
    };

    await container.items.create(invite);
    context.log(`superadmin: generated invite code '${code}' for family '${familyId}' (role: ${body.role}${resolvedLocalMemberOid ? ', link for: ' + resolvedLocalMemberOid : ''})`);

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
      },
    };
  } catch (err) {
    context.error('superadmin/invites POST error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
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
      // Treat as already-revoked — idempotent success so the UI doesn't show a spurious error.
      context.log(`superadmin: revoke '${code}' — not found (already revoked or never existed), returning 204`);
      return { status: 204 };
    }
    if (invite.usedByOid !== null) {
      return { status: 409, jsonBody: { code: 'ALREADY_USED', message: 'Code has already been redeemed and cannot be revoked.' } };
    }

    await container.item(code, code).delete();
    context.log(`superadmin: revoked invite code '${code}' for family '${familyId}'`);

    return { status: 204 };
  } catch (err) {
    context.error('superadmin/invites DELETE error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR' } };
  }
}

// ---------------------------------------------------------------------------
// Route registrations
// ---------------------------------------------------------------------------

app.http('superadminInvites', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/invites',
  handler: async (req, ctx) => {
    const session = await validateBootstrapSession(req, ctx);
    if (!session) return SA_UNAUTHORIZED;

    const familyId = req.params['familyId'] ?? '';
    if (!familyId) return { status: 400, jsonBody: { code: 'BAD_REQUEST' } };

    if (req.method === 'GET')  return listInvites(familyId, ctx);
    if (req.method === 'POST') return generateInvite(familyId, req, ctx);
    return { status: 405 };
  },
});

app.http('superadminInviteRevoke', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/invites/{code}',
  handler: async (req, ctx) => {
    const session = await validateBootstrapSession(req, ctx);
    if (!session) return SA_UNAUTHORIZED;

    const familyId = req.params['familyId'] ?? '';
    const code     = req.params['code'] ?? '';
    if (!familyId || !code) return { status: 400, jsonBody: { code: 'BAD_REQUEST' } };

    return revokeInvite(familyId, code, ctx);
  },
});

// ---------------------------------------------------------------------------
// POST superadmin/families/{familyId}/invites/{code}/email
// Send an invite email for any family's pending invite code.
// ---------------------------------------------------------------------------

const EMAIL_RE_SA = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const lastSentAtSA = new Map<string, number>();
const SA_RATE_LIMIT_MS = 60_000;

app.http('superadminInviteEmail', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'superadmin/families/{familyId}/invites/{code}/email',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const session = await validateBootstrapSession(req, ctx);
    if (!session) return SA_UNAUTHORIZED;

    const familyId = req.params['familyId'] ?? '';
    const code     = req.params['code'] ?? '';
    if (!familyId || !code) return { status: 400, jsonBody: { code: 'BAD_REQUEST' } };

    let body: { email?: unknown };
    try { body = await req.json() as { email?: unknown }; }
    catch { return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Invalid JSON body.' } }; }

    const recipientEmail = typeof body.email === 'string' ? body.email.trim() : '';
    if (!recipientEmail || !EMAIL_RE_SA.test(recipientEmail) || recipientEmail.length > 254) {
      return { status: 400, jsonBody: { code: 'INVALID_EMAIL', message: 'A valid email address is required.' } };
    }

    const lastSent = lastSentAtSA.get(code);
    if (lastSent && Date.now() - lastSent < SA_RATE_LIMIT_MS) {
      return { status: 429, jsonBody: { code: 'RATE_LIMITED', message: 'An email was sent for this code recently. Please wait.' } };
    }

    try {
      const container = getContainer('inviteCodes');
      const { resource: invite } = await container.item(code, code).read<InviteCode>();

      if (!invite || invite.familyId !== familyId) {
        return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Invite code not found.' } };
      }
      if (invite.usedByOid) {
        return { status: 409, jsonBody: { code: 'ALREADY_USED', message: 'This invite code has already been redeemed.' } };
      }
      if (invite.expiresAt < new Date().toISOString()) {
        return { status: 409, jsonBody: { code: 'EXPIRED', message: 'This invite code has expired.' } };
      }

      const acsEndpoint      = process.env.ACS_ENDPOINT;
      const acsSenderAddress = process.env.ACS_SENDER_ADDRESS;
      const appUrl           = process.env.APP_URL;
      if (!acsEndpoint || !acsSenderAddress || !appUrl) {
        ctx.warn('ACS_ENDPOINT, ACS_SENDER_ADDRESS, or APP_URL not configured');
        return { status: 503, jsonBody: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sending is not configured on this deployment.' } };
      }

      const inviteLink        = `${appUrl}?invite=${encodeURIComponent(code)}`;
      const roleLabel         = invite.role === 'FamilyAdmin' ? 'family admin' : 'family member';
      const expiresDate   = new Date(invite.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      const emailClient = new EmailClient(acsEndpoint, new DefaultAzureCredential());
      const poller = await emailClient.beginSend({
        senderAddress: acsSenderAddress,
        recipients: { to: [{ address: recipientEmail }] },
        content: {
          subject: `You've been invited to join the family allowance app`,
          plainText: [
            `Hi there,`,
            '',
            `You've been invited to join as a ${roleLabel}.`,
            '',
            `Your invite code is: ${code}`,
            '',
            `Or click the link below to get started:`,
            inviteLink,
            '',
            `This invite expires on ${expiresDate}. It can only be used once.`,
          ].join('\n'),
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
              <h2 style="color:#1d4ed8;">You've been invited!</h2>
              <p>Hi there,</p>
              <p>You've been invited to join as a <strong>${roleLabel}</strong>.</p>
              <p style="margin:24px 0;">
                <a href="${inviteLink}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                  Accept Invitation
                </a>
              </p>
              <p style="color:#6b7280;font-size:0.9em;">Or enter this code manually:<br/>
                <code style="font-size:1.1em;letter-spacing:0.1em;">${code}</code></p>
              <p style="color:#6b7280;font-size:0.85em;">Expires ${expiresDate}. Single use.</p>
            </div>`,
        },
      });

      // Record the send attempt BEFORE awaiting completion so that even if
      // the background poll throws (ACS transient failure), the rate window is
      // still consumed and a rapid retry is throttled (mirrors family-admin
      // sendInviteEmail.ts / KI-0068).
      lastSentAtSA.set(code, Date.now());

      // Fire pollUntilDone() in the background for telemetry only — pollUntilDone
      // blocks 30-60 s waiting for ACS delivery confirmation, which would leave the
      // UI stuck on "Sending\u2026". The email is already submitted to ACS at this point.
      poller.pollUntilDone().then(() => {
        ctx.log(`superadminInviteEmail: ACS confirmed delivery for code '${code}'`);
      }).catch((pollErr: unknown) => {
        ctx.warn(`superadminInviteEmail: ACS delivery poll failed for code '${code}'`, pollErr);
      });

      ctx.log(`superadmin: submitted invite email for code '${code}' to '${recipientEmail}'`);

      return { status: 200, jsonBody: { message: 'Invite email sent.' } };
    } catch (err) {
      ctx.error('superadminInviteEmail error', err);
      return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to send invite email.' } };
    }
  },
});
