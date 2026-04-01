// ---------------------------------------------------------------------------
// Frontend data types — aligned with the Azure Functions API models.
// NO mock values — all data comes from /api/* endpoints.
// ---------------------------------------------------------------------------

export type AllowanceFrequency = 'Weekly' | 'Bi-weekly' | 'Monthly'
export type TransactionCategory = 'Income' | 'Purchase' | 'Tithing'
export type UserRole = 'User' | 'FamilyAdmin'

export interface KidSettings {
  allowanceEnabled: boolean
  allowanceAmount: number
  allowanceFrequency: AllowanceFrequency
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek?: number
  timeOfDay?: string    // 'HH:MM' 24-hour
  timezone: string      // IANA, e.g. 'America/Chicago'
  biweeklyStartDate?: string
  nextAllowanceDate?: string
  /** When true, admin can record hours worked instead of a flat amount for income transactions */
  hourlyWagesEnabled?: boolean
  /** The per-hour rate in dollars, used when hourlyWagesEnabled is true */
  hourlyWageRate?: number
  // Balance override — manually set by admin; transactions after balanceOverrideAt are added on top
  balanceOverride?: number
  tithingOwedOverride?: number
  balanceOverrideAt?: string
  // Purge accumulators — rolling sum of contributions from purged transactions (post-override)
  purgedBalanceDelta?: number
  purgedTithingOwedDelta?: number
}

export interface Transaction {
  id: string
  date: string                  // ISO 8601 datetime from API
  category: TransactionCategory
  amount: number                // always positive; category determines sign
  notes: string
  kidOid?: string               // present in admin/all-transactions views
  createdBy?: string            // 'scheduler' | admin oid
  /** Income only — true (or absent) means 10% counts toward Tithing Owed */
  tithable?: boolean
}

export interface FamilyMember {
  oid: string
  displayName: string
  role: UserRole
  kidSettings?: KidSettings
  /** True for admin-created local accounts with no Entra sign-in */
  isLocalAccount?: boolean
}

/** Response from GET /api/family */
export interface FamilyData {
  familyId: string
  currentUserOid: string
  currentUserRole: UserRole
  /** Maximum members allowed in this family (default 10, adjustable by SuperAdmin). */
  memberLimit: number
  members: FamilyMember[]
}

/** Invite code shape from GET /api/invites and POST /api/invites */
export interface FamilyInviteCode {
  code: string
  familyId: string
  role: UserRole
  displayNameHint: string | null
  /** Set for link-invite codes that will merge with an existing local account on redemption */
  localMemberOid?: string | null
  createdAt: string
  expiresAt: string
  expired: boolean
  used: boolean
  usedAt: string | null
}

/** Computed/enriched view for a kid — built from FamilyMember + Transaction[] */
export interface KidView extends FamilyMember {
  balance: number
  tithingOwed: number
  lastTithingPaid: string | null
  transactions: Transaction[]
}

/** Audit log entry from GET /api/audit-log */
export interface AuditLogEntry {
  id: string
  familyId: string
  action: 'edit' | 'delete' | 'member_delete'
  performedBy: string         // oid of admin who acted
  performedByName?: string
  /** Actual email of the admin — preferred over name/oid for display */
  performedByEmail?: string
  timestamp: string           // ISO 8601
  /** Kid this entry relates to — populated server-side, used for Cosmos-side filtering */
  subjectOid?: string
  // Present for 'edit' and 'delete' actions
  targetTransactionId?: string
  before?: Partial<Transaction> & { kidOid?: string }
  after?: Partial<Transaction>
  // Present for 'member_delete' action
  memberOid?: string
  memberDisplayName?: string
  lastBalance?: number
  lastTithingOwed?: number
  transactionCount?: number
}

// ---------------------------------------------------------------------------
// Helper: compute derived fields for a kid from their transactions
// ---------------------------------------------------------------------------

export function computeKidView(member: FamilyMember, allTransactions: Transaction[]): KidView {
  const txns = allTransactions.filter(t => t.kidOid === member.oid)
  const ks = member.kidSettings

  // Compute balance relative to the override floor.
  // If balanceOverrideAt is set, only transactions STRICTLY AFTER the override date
  // are summed on top of the override amount. Same-day transactions (>= today) are
  // intentionally excluded — when an admin sets an override they are capturing the
  // full current balance including any transactions from that same day. Including
  // same-day transactions would double-count them (KI-fix).
  const overrideAt = ks?.balanceOverrideAt
  const overrideDate = overrideAt ? overrideAt.slice(0, 10) : null
  const txnsForBalance = overrideDate ? txns.filter(t => t.date.slice(0, 10) > overrideDate) : txns

  // purgedBalanceDelta accumulates contributions from transactions that have been deleted
  // from the database but whose financial impact must still be counted.
  // Accumulate in integer cents to prevent floating-point drift across many transactions.
  const balanceCents =
    Math.round((ks?.balanceOverride     ?? 0) * 100) +
    Math.round((ks?.purgedBalanceDelta  ?? 0) * 100) +
    txnsForBalance.reduce(
      (sum, t) => sum + Math.round(t.amount * 100) * (t.category === 'Income' ? 1 : -1),
      0,
    );
  const balance = balanceCents / 100;

  const tithingOwed = (() => {
    const tixns = overrideDate ? txns.filter(t => t.date.slice(0, 10) > overrideDate) : txns
    // Accumulate in integer cents to prevent floating-point drift
    const tithableIncomeCents = tixns
      .filter(t => t.category === 'Income' && t.tithable !== false)
      .reduce((s, t) => s + Math.round(t.amount * 100), 0)
    const paidCents = tixns.filter(t => t.category === 'Tithing').reduce((s, t) => s + Math.round(t.amount * 100), 0)
    // 10% of tithable income minus payments, all in cents, then floor at 0
    const owedCents =
      Math.round((ks?.tithingOwedOverride     ?? 0) * 100) +
      Math.round((ks?.purgedTithingOwedDelta  ?? 0) * 100) +
      Math.round(tithableIncomeCents * 0.1) -
      paidCents
    return Math.max(0, owedCents) / 100
  })()

  const lastTithingPaid = txns
    .filter(t => t.category === 'Tithing')
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null

  return { ...member, balance, tithingOwed, lastTithingPaid, transactions: txns }
}

