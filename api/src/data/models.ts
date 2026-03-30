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

export interface Family extends CosmosDocument {
  name: string;
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
}

export type UserRole = 'User' | 'FamilyAdmin';

export interface User extends CosmosDocument {
  /** oid claim from Entra External ID — also used as document id */
  oid: string;
  displayName: string;
  role: UserRole;
  /** Present only for users who receive an allowance */
  kidSettings?: KidSettings;
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
  /** oid of admin who created it, or "scheduler" for automatic allowance */
  createdBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export type AuditAction = 'edit' | 'delete';

export interface AuditLogEntry extends CosmosDocument {
  action: AuditAction;
  /** oid of the FamilyAdmin who performed the action */
  performedBy: string;
  performedByName?: string;
  timestamp: string; // ISO 8601
  targetTransactionId: string;
  /** Snapshot before the change (always present) */
  before: Partial<Transaction>;
  /** Snapshot after the change (undefined for delete) */
  after?: Partial<Transaction>;
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
}

export interface EditTransactionRequest {
  category?: TransactionCategory;
  amount?: number;
  notes?: string;
  date?: string;
}

export interface UpdateSettingsRequest {
  kidOid: string;
  kidSettings: KidSettings;
}

/** Standard API error shape */
export interface ApiError {
  code: string;
  message: string;
}
