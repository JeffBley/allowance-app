// ---------------------------------------------------------------------------
// Super-admin API client — no MSAL, purely bootstrap session token
//
// Session token is stored in sessionStorage as 'sa_token' so it's automatically
// cleared when the browser tab closes. It is never stored in localStorage.
// ---------------------------------------------------------------------------

const SA_TOKEN_KEY = 'sa_token'
const API_BASE     = import.meta.env['VITE_API_URL'] as string ?? '/api'

export function getSaToken(): string | null {
  return sessionStorage.getItem(SA_TOKEN_KEY)
}

export function setSaToken(token: string): void {
  sessionStorage.setItem(SA_TOKEN_KEY, token)
}

export function clearSaToken(): void {
  sessionStorage.removeItem(SA_TOKEN_KEY)
}

export class SaApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message)
    this.name   = 'SaApiError'
    this.status = status
    this.code   = code
  }
}

// ---------------------------------------------------------------------------
// saFetch — supports two auth modes:
//   1. MSAL Bearer token (SSO path): pass msalToken — sent as "Bearer <token>"
//   2. Bootstrap session JWT: reads from sessionStorage — sent as "Bootstrap <token>"
// ---------------------------------------------------------------------------
async function saFetch<T>(
  path: string,
  options: RequestInit = {},
  msalToken?: string,
): Promise<T> {
  const url = `${API_BASE}/${path.replace(/^\//, '')}`

  // Prefer MSAL token (SSO) over bootstrap session token
  let authHeader: string | undefined
  if (msalToken) {
    authHeader = `Bearer ${msalToken}`
  } else {
    const bootstrapToken = getSaToken()
    if (bootstrapToken) authHeader = `Bootstrap ${bootstrapToken}`
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  })

  if (!response.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = response.statusText
    try {
      const body = await response.json() as { code?: string; message?: string }
      code    = body.code    ?? code
      message = body.message ?? message
    } catch { /* ignore */ }
    throw new SaApiError(response.status, code, message)
  }

  // 204 No Content (and any other response with no body) — return undefined
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as unknown as T
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Token provider — set by SuperAdminApp when using SSO path
// ---------------------------------------------------------------------------
let _msalTokenProvider: (() => Promise<string>) | null = null

/** Called by SuperAdminApp to wire in the MSAL token acquisition function. */
export function setSaMsalTokenProvider(provider: (() => Promise<string>) | null): void {
  _msalTokenProvider = provider
}

/** Internal: get a fresh MSAL token if provider is set, otherwise undefined. */
async function getMsalToken(): Promise<string | undefined> {
  if (!_msalTokenProvider) return undefined
  try { return await _msalTokenProvider() } catch { return undefined }
}

// ---------------------------------------------------------------------------
// Updated saFetch wrapper that auto-acquires MSAL token when available
// ---------------------------------------------------------------------------
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const msalToken = await getMsalToken()
  return saFetch<T>(path, options, msalToken)
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function fetchStatus(): Promise<{ bootstrapEnabled: boolean }> {
  return saFetch('superadmin/status')
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function loginBootstrap(secret: string): Promise<string> {
  const { token } = await saFetch<{ token: string }>('superadmin/auth', {
    method: 'POST',
    body: JSON.stringify({ secret }),
  })
  return token
}

export async function disableBootstrap(): Promise<void> {
  await apiFetch('superadmin/auth', { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

export interface SaFamily {
  id: string
  familyId: string
  name: string
  createdAt: string
  memberCount: number
  /** Maximum members allowed. Defaults to 10 when not set. */
  memberLimit: number
}

export interface SaMember {
  id: string
  oid: string
  displayName: string
  role: 'User' | 'FamilyAdmin'
  kidSettings?: Record<string, unknown>
  isLocalAccount?: boolean
  createdAt: string
  updatedAt: string
}

export async function listFamilies(): Promise<SaFamily[]> {
  const { families } = await apiFetch<{ families: SaFamily[] }>('superadmin/families')
  return families
}

export async function createFamily(): Promise<SaFamily> {
  const { family } = await apiFetch<{ family: SaFamily }>('superadmin/families', {
    method: 'POST',
    body: '{}',
  })
  return family
}

export async function getFamily(familyId: string): Promise<{ family: SaFamily; members: SaMember[] }> {
  return apiFetch(`superadmin/families/${encodeURIComponent(familyId)}`)
}

export async function updateFamily(familyId: string, name: string, memberLimit?: number): Promise<SaFamily> {
  const { family } = await apiFetch<{ family: SaFamily }>(
    `superadmin/families/${encodeURIComponent(familyId)}`,
    { method: 'PUT', body: JSON.stringify({ name, memberLimit }) },
  )
  return family
}

export async function deleteFamily(familyId: string): Promise<void> {
  await apiFetch(`superadmin/families/${encodeURIComponent(familyId)}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface CreateMemberPayload {
  oid: string
  displayName: string
  role: 'User' | 'FamilyAdmin'
  kidSettings?: {
    allowanceEnabled: boolean
    allowanceAmount: number
    allowanceFrequency: string
    dayOfWeek?: number
    timeOfDay?: string
    timezone: string
  }
}

export async function createMember(familyId: string, payload: CreateMemberPayload): Promise<SaMember> {
  const { member } = await apiFetch<{ member: SaMember }>(
    `superadmin/families/${encodeURIComponent(familyId)}/members`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
  return member
}

export async function createLocalMember(familyId: string, displayName: string): Promise<SaMember> {
  const { member } = await apiFetch<{ member: SaMember }>(
    `superadmin/families/${encodeURIComponent(familyId)}/members/local`,
    { method: 'POST', body: JSON.stringify({ displayName }) },
  )
  return member
}

export async function updateMember(
  familyId: string,
  memberOid: string,
  payload: Partial<CreateMemberPayload>,
): Promise<SaMember> {
  const { member } = await apiFetch<{ member: SaMember }>(
    `superadmin/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberOid)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  )
  return member
}

export async function deleteMember(familyId: string, memberOid: string): Promise<void> {
  await apiFetch(
    `superadmin/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberOid)}`,
    { method: 'DELETE' },
  )
}

export async function unlinkMember(familyId: string, memberOid: string): Promise<SaMember> {
  const { member } = await apiFetch<{ member: SaMember }>(
    `superadmin/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberOid)}/unlink`,
    { method: 'POST', body: '{}' },
  )
  return member
}

// ---------------------------------------------------------------------------
// Invite Codes
// ---------------------------------------------------------------------------

export interface SaInviteCode {
  code: string
  familyId: string
  role: 'User' | 'FamilyAdmin'
  displayNameHint: string | null
  createdAt: string
  expiresAt: string
  expired: boolean
  used: boolean
  usedAt: string | null
}

export interface GenerateInvitePayload {
  role: 'User' | 'FamilyAdmin'
  displayNameHint?: string
  expiryDays?: number
  localMemberOid?: string
}

export async function listInvites(familyId: string): Promise<SaInviteCode[]> {
  const { codes } = await apiFetch<{ codes: SaInviteCode[] }>(
    `superadmin/families/${encodeURIComponent(familyId)}/invites`,
  )
  return codes
}

export async function generateInvite(familyId: string, payload: GenerateInvitePayload): Promise<SaInviteCode> {
  return apiFetch<SaInviteCode>(
    `superadmin/families/${encodeURIComponent(familyId)}/invites`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export async function revokeInvite(familyId: string, code: string): Promise<void> {
  await apiFetch(
    `superadmin/families/${encodeURIComponent(familyId)}/invites/${encodeURIComponent(code)}`,
    { method: 'DELETE' },
  )
}

export async function sendInviteEmail(familyId: string, code: string, email: string): Promise<void> {
  await apiFetch(
    `superadmin/families/${encodeURIComponent(familyId)}/invites/${encodeURIComponent(code)}/email`,
    { method: 'POST', body: JSON.stringify({ email }) },
  )
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface AddTransactionPayload {
  kidOid:    string
  category:  'Income' | 'Purchase' | 'Tithing'
  amount:    number
  notes:     string
  date:      string
  tithable?: boolean  // Income only — default: true
}

export async function addTransaction(
  familyId: string,
  payload: AddTransactionPayload,
): Promise<{ transaction: unknown }> {
  return apiFetch(
    `superadmin/families/${encodeURIComponent(familyId)}/transactions`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

// ---------------------------------------------------------------------------
// Purge Transactions
// ---------------------------------------------------------------------------

export interface PurgeTransactionsPayload {
  kidOid: string
  /** ISO 8601 — transactions with date strictly before this are purged */
  beforeDate: string
}

export interface PurgeTransactionsResult {
  purgedCount: number
  skippedCount: number
  purgedBalanceDelta: number
  purgedTithingOwedDelta: number
}

export async function purgeTransactions(
  familyId: string,
  payload: PurgeTransactionsPayload,
): Promise<PurgeTransactionsResult> {
  return apiFetch(
    `superadmin/families/${encodeURIComponent(familyId)}/purge-transactions`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

