import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBearerToken, UNAUTHORIZED, FORBIDDEN } from '../middleware/auth.js';
import { resolveFamilyScope, NOT_ENROLLED } from '../middleware/familyScope.js';
import { getContainer } from '../data/cosmosClient.js';
import { EmailClient } from '@azure/communication-email';
import { DefaultAzureCredential } from '@azure/identity';
import type { InviteCode } from '../data/models.js';

// ---------------------------------------------------------------------------
// POST /api/invites/{code}/email
// Sends an invite email to the provided address from the existing invite code.
//
// Security:
//   - Bearer token required; FamilyAdmin role required
//   - The invite code must belong to the caller's family
//   - Email address is validated (basic RFC 5322 local-part + domain check)
//   - ACS sends via managed identity — no connection string stored
//   - Rate limit: one email per minute per invite code (prevents spam abuse)
// ---------------------------------------------------------------------------

// Basic RFC 5322-inspired email validation — not exhaustive but rejects
// obvious injection attempts (quotes, brackets, newlines, etc.)
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

/** Escapes a string for safe inclusion in an HTML context. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// In-memory rate limit: code -> last sent timestamp (ms).
// Resets on cold start, which is acceptable for this low-frequency operation.
const lastSentAt = new Map<string, number>()
const RATE_LIMIT_MS = 60_000 // 1 minute

async function sendInviteEmail(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('sendInviteEmail invoked');

  const auth = await validateBearerToken(request, context);
  if (!auth) return UNAUTHORIZED;

  const scope = await resolveFamilyScope(auth.payload.oid, context);
  if (!scope) return NOT_ENROLLED;

  if (scope.role !== 'FamilyAdmin') return FORBIDDEN;

  const code = request.params['code'];
  if (!code) {
    return { status: 400, jsonBody: { code: 'MISSING_CODE', message: 'Invite code is required.' } };
  }

  let body: { email?: unknown };
  try {
    body = await request.json() as { email?: unknown };
  } catch {
    return { status: 400, jsonBody: { code: 'INVALID_BODY', message: 'Request body must be valid JSON.' } };
  }

  const recipientEmail = typeof body.email === 'string' ? body.email.trim() : '';
  if (!recipientEmail || !EMAIL_RE.test(recipientEmail) || recipientEmail.length > 254) {
    return { status: 400, jsonBody: { code: 'INVALID_EMAIL', message: 'A valid email address is required.' } };
  }

  // Rate limit check
  const lastSent = lastSentAt.get(code);
  if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
    return {
      status: 429,
      jsonBody: { code: 'RATE_LIMITED', message: 'An email for this code was sent recently. Please wait a moment before trying again.' },
    };
  }

  try {
    const container = getContainer('inviteCodes');
    const { resource: invite } = await container.item(code, code).read<InviteCode>();

    // Reject if code doesn't exist or belongs to a different family
    if (!invite || invite.familyId !== scope.familyId) {
      return { status: 404, jsonBody: { code: 'NOT_FOUND', message: 'Invite code not found.' } };
    }

    // Reject if already used or expired
    if (invite.usedByOid) {
      return { status: 409, jsonBody: { code: 'ALREADY_USED', message: 'This invite code has already been redeemed.' } };
    }
    const now = new Date().toISOString();
    if (invite.expiresAt < now) {
      return { status: 409, jsonBody: { code: 'EXPIRED', message: 'This invite code has expired. Please generate a new one.' } };
    }

    // Read ACS config from env — set by Bicep acsAppSettings module
    const acsEndpoint     = process.env.ACS_ENDPOINT;
    const acsSenderAddress = process.env.ACS_SENDER_ADDRESS;

    // App URL — used to build the invite deep-link. Fail fast if not configured.
    const appUrl = process.env.APP_URL;
    if (!acsEndpoint || !acsSenderAddress || !appUrl) {
      context.warn('ACS_ENDPOINT, ACS_SENDER_ADDRESS, or APP_URL not configured');
      return { status: 503, jsonBody: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sending is not configured on this deployment.' } };
    }
    const inviteLink = `${appUrl}?invite=${encodeURIComponent(code)}`;

    const recipientName    = invite.displayNameHint ?? 'there';
    const recipientNameHtml = escapeHtml(recipientName);
    const roleLabel = invite.role === 'FamilyAdmin' ? 'family admin' : 'family member';
    const expiresDate = new Date(invite.expiresAt).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });

    const emailClient = new EmailClient(acsEndpoint, new DefaultAzureCredential());

    // Both link and standard invites use the same "You've been invited!" template.
    const subject = `You've been invited to join the family allowance app`;

    const plainTextBody = [
      `Hi ${recipientName},`,
      '',
      // Only include the link-account sentence for link invites (localMemberOid set).
      // For regular new-member invites this text is meaningless to the recipient.
      ...(invite.localMemberOid
        ? [`Your family admin has set up a link so you can sign in to your existing local account with a Microsoft account.`, '']
        : []),
      `You've been invited to join as a ${roleLabel}.`,
      '',
      `Your invite code is: ${code}`,
      '',
      `Or click the link below to get started:`,
      inviteLink,
      '',
      `This invite expires on ${expiresDate}. It can only be used once.`,
      '',
      `If you weren't expecting this, you can ignore this email.`,
    ].join('\n');

    const htmlBody = `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; font-size: 17px; line-height: 1.55; color: #1f2937;">
            <h2 style="color: #1d4ed8; font-size: 24px; margin: 0 0 16px;">You've been invited!</h2>
            <p style="margin: 0 0 12px;">Hi ${recipientNameHtml},</p>
            <p style="margin: 0 0 24px;">You've been invited to join as a <strong>${roleLabel}</strong> in the family allowance app.</p>
            <p style="margin: 0 0 24px;">
              <a href="${inviteLink}"
                 style="background:#1d4ed8;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:17px;display:inline-block;">
                Accept Invitation
              </a>
            </p>
            <p style="color:#374151; font-size: 16px; margin: 0 0 8px;">
              Or enter this code manually when prompted:
            </p>
            <p style="background:#f1f5f9; border-radius:8px; padding:16px 20px; margin:0 0 20px; text-align:center;">
              <code style="font-size:2em; font-weight:700; letter-spacing:0.18em; color:#1d4ed8; font-family:monospace;">${code}</code>
            </p>
            <p style="color:#6b7280;font-size:15px; margin:0 0 24px;">This invite expires on ${expiresDate} and can only be used once.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;"/>
            <p style="color:#9ca3af;font-size:14px; margin:0;">If you weren't expecting this invitation, you can safely ignore this email.</p>
          </div>
        `;

    const message = {
      senderAddress: acsSenderAddress,
      recipients: {
        to: [{ address: recipientEmail, displayName: recipientName }],
      },
      content: {
        subject,
        plainText: plainTextBody,
        html: htmlBody,
      },
    };

    const poller = await emailClient.beginSend(message);
    await poller.pollUntilDone();

    lastSentAt.set(code, Date.now());
    context.log(`sendInviteEmail: sent invite email for code '${code}' to '${recipientEmail}'`);

    return { status: 200, jsonBody: { message: 'Invite email sent.' } };
  } catch (err) {
    context.error('sendInviteEmail error', err);
    return { status: 500, jsonBody: { code: 'INTERNAL_ERROR', message: 'Failed to send invite email.' } };
  }
}

app.http('sendInviteEmail', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invites/{code}/email',
  handler: sendInviteEmail,
});
