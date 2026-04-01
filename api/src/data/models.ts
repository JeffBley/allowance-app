// ---------------------------------------------------------------------------
// Cosmos DB data models — shared types for all API functions
// ---------------------------------------------------------------------------

/** Every document stored in Cosmos must have these fields. */
export interface CosmosDocument {
  id: string;
  familyId: string; // Partition key — all queries must include this
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/** Default maximum number of members per family. SuperAdmin can override per-family. */
export const DEFAULT_MEMBER_LIMIT = 10;

export interface Family extends CosmosDocument {
  name: string;
  createdAt: string; // ISO 8601
  /**
   * Maximum members allowed in this family.
   * When absent the DEFAULT_MEMBER_LIMIT constant applies.
   */
  memberLimit?: number;
  /** When true, admins can define chores and credit kids for completing them. */
  choreBasedIncomeEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Chore
// ---------------------------------------------------------------------------

export interface Chore extends CosmosDocument {
  /** Discriminator so chore documents can be queried within the chores container */
  name: string;
  /** Dollar value of the chore */
  amount: number;
  /**
   * When true, completing this chore does NOT delete it — it acts as a
   * reusable template for recurring chores (e.g. "Mow the lawn" every week).
   */
  isTemplate?: boolean;
  /** oid of admin who created this chore */
  createdBy: string;
  createdAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// User / Kid
// ---------------------------------------------------------------------------

export type AllowanceFrequency = 'Weekly' | 'Bi-weekly' | 'Monthly';

export interface KidSettings {
  allowanceEnabled: boolean;
  allowanceAmount: number;
  allowanceFrequency: AllowanceFrequency;
  /** IANA timezone string, e.g. "America/Chicago" */
  timezone: string;
  /** 0-6 (Sun–Sat), required for Weekly/Bi-weekly */
  dayOfWeek?: number;
  /** "HH:MM" 24-hour local time for allowance credit */
  timeOfDay?: string;
  /** ISO 8601 — the anchor date for bi-weekly schedule calculation */
  biweeklyStartDate?: string;
  /** ISO 8601 — next scheduled allowance date/time (UTC) */
  nextAllowanceDate?: string;
  /** When true, admin can record hours worked instead of a flat amount for income transactions */
  hourlyWagesEnabled?: boolean;
  /** The per-hour rate in dollars, used when hourlyWagesEnabled is true */
  hourlyWageRate?: number;

  // ---------------------------------------------------------------------------
  // Running-balance snapshots — updated server-side on every transaction
  // mutation. When present, these represent the all-time cumulative totals so
  // that balances remain correct even if old transaction records are purged.
  // All three fields are absent on legacy records (pre-snapshot) — callers
  // should fall back to summing from the transactions list in that case.
  // ---------------------------------------------------------------------------
  // Manual balance override — set by a FamilyAdmin via the "Edit Balance" UI.
  // When present, these values represent the known-good balance at a point in
  // time. computeKidView adds all transactions dated AFTER balanceOverrideAt
  // on top of these floor values, so edits/deletes of recent transactions work
  // correctly without requiring an incremental snapshot.
  // ---------------------------------------------------------------------------
  /** Manually-set available balance floor (admin override) */
  balanceOverride?: number;
  /** Manually-set tithing-owed floor (admin override) */
  tithingOwedOverride?: number;
  /** ISO 8601 — timestamp when the override was last set; txns after this apply */
  balanceOverrideAt?: string;

  // ---------------------------------------------------------------------------
  // Purge accumulators — rolling sum of balance/tithing contributions from
  // transactions that have been purged from the database. Only transactions
  // dated AFTER balanceOverrideAt are accumulated here; transactions before
  // the override date are already captured in balanceOverride/tithingOwedOverride
  // and are simply discarded when purged. Both fields are reset to 0 whenever
  // a new manual balance override is set.
  // ---------------------------------------------------------------------------
  /**
   * Net balance contribution (income − expenses) of all purged transactions
   * dated after balanceOverrideAt. Added to balanceOverride + live-txn sum.
   */
  purgedBalanceDelta?: number;
  /**
   * Net tithing-owed contribution (tithableIncome * 0.1 − tithingPaid) of all
   * purged transactions dated after balanceOverrideAt. Added to tithingOwedOverride
   * + live-txn tithing sum.
   */
  purgedTithingOwedDelta?: number;
}

export type UserRole = 'User' | 'FamilyAdmin';

export interface User extends CosmosDocument {
  /** oid claim from Entra External ID — also used as document id */
  oid: string;
  displayName: string;
  role: UserRole;
  /** Present only for users who receive an allowance */
  kidSettings?: KidSettings;
  /**
   * When true this user was created directly by a FamilyAdmin or SuperAdmin
   * without an Entra account. They cannot sign in and are managed entirely by
   * the admin. The oid is a server-generated UUID, not an Entra OID.
   */
  isLocalAccount?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export type TransactionCategory = 'Income' | 'Purchase' | 'Tithing';

export interface Transaction extends CosmosDocument {
  kidOid: string;
  category: TransactionCategory;
  /** Positive for Income, negative for Purchase/Tithing */
  amount: number;
  notes: string;
  /** ISO 8601 — when the transaction is effective */
  date: string;
  /**
   * For Income transactions only — true means 10% counts toward Tithing Owed.
   * Defaults to true when absent so existing records behave as before.
   */
  tithable?: boolean;
  /** oid of admin who created it, or "scheduler" for automatic allowance */
  createdBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export type AuditAction = 'edit' | 'delete' | 'member_delete' | 'member_rename';

export interface AuditLogEntry extends CosmosDocument {
  action: AuditAction;
  /** oid of the FamilyAdmin who performed the action */
  performedBy: string;
  performedByName?: string;
  /** Email of the admin who acted — preferred over OID for display (not GUID UPN) */
  performedByEmail?: string;
  timestamp: string; // ISO 8601
  /**
   * The kid this entry relates to — indexed top-level field used by getAuditLog
   * to push the kidOid filter down to Cosmos instead of filtering in-memory.
   *   edit/delete   → kidOid of the affected transaction
   *   member_delete → oid of the deleted member
   */
  subjectOid?: string;
  /** Present for 'edit' and 'delete' actions */
  targetTransactionId?: string;
  /** Snapshot before the change (present for edit/delete) */
  before?: Partial<Transaction>;
  /** Snapshot after the change (present for edit only) */
  after?: Partial<Transaction>;
  // Fields present only for 'member_delete' action:
  /** OID of the deleted member */
  memberOid?: string;
  memberDisplayName?: string;
  /** Last known balance at time of deletion */
  lastBalance?: number;
  /** Last known tithing owed at time of deletion */
  lastTithingOwed?: number;
  /** Number of transactions deleted alongside the member */
  transactionCount?: number;
  // Fields present only for 'member_rename' action:
  /** Display name before the rename */
  previousDisplayName?: string;
}

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

export interface AddTransactionRequest {
  kidOid: string;
  category: TransactionCategory;
  amount: number;
  notes: string;
  date: string;
  /** For Income only — whether this income counts toward Tithing Owed (default: true) */
  tithable?: boolean;
}

export interface EditTransactionRequest {
  category?: TransactionCategory;
  amount?: number;
  notes?: string;
  date?: string;
  /** For Income only — whether this income counts toward Tithing Owed */
  tithable?: boolean;
}

export interface UpdateSettingsRequest {
  kidOid: string;
  /** Optional — when provided, updates the member's display name */
  displayName?: string;
  kidSettings: KidSettings;
}

export interface BalanceOverrideRequest {
  kidOid: string;
  /** New available balance to set as the floor */
  balance: number;
  /** New tithing-owed amount to set as the floor */
  tithingOwed: number;
}

export interface PurgeTransactionsRequest {
  /** oid of the kid whose transactions are being purged */
  kidOid: string;
  /**
   * ISO 8601 date string. Transactions with date strictly before this value
   * will be purged. Transactions on or after this date are kept.
   */
  beforeDate: string;
}

export interface CreateChoreRequest {
  name: string;
  amount: number;
  isTemplate?: boolean;
}

export interface UpdateChoreRequest {
  name?: string;
  amount?: number;
  isTemplate?: boolean;
}

export interface CompleteChoreRequest {
  kidOid: string;
  tithable: boolean;
  /** ISO 8601 date to use for the transaction; defaults to today if absent */
  date?: string;
}

export interface UpdateFamilySettingsRequest {
  choreBasedIncomeEnabled: boolean;
}

/** Standard API error shape */
export interface ApiError {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Super-admin system configuration document
// Stored in the 'families' container with id='system-config', familyId='system'
// ---------------------------------------------------------------------------

export interface SystemConfig extends CosmosDocument {
  /** When true, bootstrap admin credential is refused even if env var is set */
  bootstrapDisabled?: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Super-admin request shapes
// ---------------------------------------------------------------------------

export interface CreateFamilyRequest {
  id: string;        // slug, e.g. "family-bley"
  name: string;
}

export interface UpdateFamilyRequest {
  name: string;
  /** Override the default member limit (1–100). */
  memberLimit?: number;
}

export interface CreateMemberRequest {
  oid: string;
  displayName: string;
  role: UserRole;
  kidSettings?: KidSettings;
}

export interface UpdateMemberRequest {
  displayName?: string;
  role?: UserRole;
  kidSettings?: KidSettings;
}

// ---------------------------------------------------------------------------
// Invite Codes
// Stored in the 'inviteCodes' container, partition key = /id (the code itself)
// ---------------------------------------------------------------------------

export interface InviteCode {
  /** The 8-char alphanumeric code — also the document id and partition key */
  id: string;
  familyId: string;
  role: UserRole;
  /** Optional pre-set allowance settings (for User role) */
  kidSettings?: KidSettings;
  /** Optional pre-set display name hint */
  displayNameHint?: string;
  /**
   * When set, redeeming this code will link the new Entra account to the
   * existing local (no sign-in) user identified by this OID, migrating
   * all their transactions to the new Entra identity.
   */
  localMemberOid?: string;
  createdAt: string;         // ISO 8601
  expiresAt: string;         // ISO 8601 — 7 days after creation
  /** OID of the user who redeemed the code, null if unused */
  usedByOid: string | null;
  usedAt: string | null;     // ISO 8601
}

export interface GenerateInviteRequest {
  role: UserRole;
  kidSettings?: KidSettings;
  displayNameHint?: string;
  /** Expiry in days, defaults to 7 */
  expiryDays?: number;
  /**
   * When provided, the generated code is a "link" invite: redeeming it will
   * merge the redeemer's Entra identity onto the specified local account
   * (migrating transactions) rather than creating a brand-new user record.
   */
  localMemberOid?: string;
}
