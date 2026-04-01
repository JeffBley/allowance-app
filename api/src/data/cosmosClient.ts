import { CosmosClient, Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

// ---------------------------------------------------------------------------
// Cosmos DB client — singleton, initialized once per Function App instance
//
// Auth strategy:
//   Production  → COSMOS_DB_ENDPOINT + managed identity (DefaultAzureCredential)
//                 The Function App's system-assigned identity is granted the
//                 "Cosmos DB Built-in Data Contributor" SQL role via Bicep.
//   Local dev   → COSMOS_DB_CONNECTION_STRING (Cosmos emulator key-based auth,
//                 since the local emulator does not support AAD credentials).
// ---------------------------------------------------------------------------

let _db: Database | null = null;

export function getDatabase(): Database {
  if (_db) return _db;

  const endpoint         = process.env['COSMOS_DB_ENDPOINT'];
  const connectionString = process.env['COSMOS_DB_CONNECTION_STRING'];

  let client: CosmosClient;

  if (endpoint) {
    // Production: managed identity — no secrets stored, no connection string needed
    client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  } else if (connectionString) {
    // Local development: Cosmos emulator uses a fixed key (not AAD-capable)
    client = new CosmosClient(connectionString);
  } else {
    throw new Error(
      'Cosmos DB configuration missing. Set COSMOS_DB_ENDPOINT (production) or ' +
      'COSMOS_DB_CONNECTION_STRING (local dev) environment variable.'
    );
  }

  _db = client.database('allowance-db');
  return _db;
}

/**
 * Returns a typed container reference.
 * @param name - One of: 'families' | 'users' | 'transactions' | 'auditLog' | 'inviteCodes'
 */
export function getContainer(name: 'families' | 'users' | 'transactions' | 'auditLog' | 'inviteCodes') {
  return getDatabase().container(name);
}

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

const INVITE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/i/l to reduce confusion

/**
 * Generates a random 8-char alphanumeric invite code.
 * Uses rejection sampling to eliminate modulo bias (256 % 31 = 8 without this).
 */
export function generateInviteCode(): string {
  const len   = INVITE_CHARS.length;       // 31
  const limit = 256 - (256 % len);         // 248 — highest byte value that maps uniformly
  const result: string[] = [];
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  for (const b of buf) {
    if (b < limit) {
      result.push(INVITE_CHARS[b % len]);
      if (result.length === 8) break;
    }
  }
  // Extremely unlikely to exhaust 32 bytes for 8 chars; fill if needed
  while (result.length < 8) {
    const extra = new Uint8Array(8);
    crypto.getRandomValues(extra);
    for (const b of extra) {
      if (b < limit) {
        result.push(INVITE_CHARS[b % len]);
        if (result.length === 8) break;
      }
    }
  }
  return result.join('');
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates a random 8-char lowercase alphanumeric family ID.
 * Uses rejection sampling to eliminate modulo bias (256 % 36 = 4 without this).
 */
export function generateFamilyId(): string {
  const len   = ID_CHARS.length;          // 36
  const limit = 256 - (256 % len);        // 252 — highest byte value that maps uniformly
  const result: string[] = [];
  // Over-sample; in the worst case we need ~1.6% more bytes than 8
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let i = 0;
  for (const b of buf) {
    if (b < limit) {
      result.push(ID_CHARS[b % len]);
      if (result.length === 8) break;
    }
    i++;
  }
  // Extremely unlikely to need more than 32 bytes for 8 chars; fill if needed
  while (result.length < 8) {
    const extra = new Uint8Array(8);
    crypto.getRandomValues(extra);
    for (const b of extra) {
      if (b < limit) {
        result.push(ID_CHARS[b % len]);
        if (result.length === 8) break;
      }
    }
  }
  return result.join('');
}
