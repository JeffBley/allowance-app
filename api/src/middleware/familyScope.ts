import { getContainer } from '../data/cosmosClient.js';
import type { User, UserRole } from '../data/models.js';

// ---------------------------------------------------------------------------
// Family scope resolution — maps oid → { familyId, role, user }
//
// Security: ALL API functions must call resolveFamilyScope() before querying
// Cosmos DB. Every subsequent query MUST include a familyId filter. This is
// the primary data isolation boundary between families.
// ---------------------------------------------------------------------------

export interface FamilyScope {
  familyId: string;
  role: UserRole;
  user: User;
}

/**
 * Looks up the user record for the given oid.
 * Returns null if the user doesn't exist in the database (not yet enrolled).
 *
 * Security: uses the oid from the *validated* JWT payload — never from client input.
 */
export async function resolveFamilyScope(oid: string): Promise<FamilyScope | null> {
  try {
    // oid is also the document id in the users container.
    // We need to query (not point-read) because we don't know the familyId (partition key) yet.
    // Once we have familyId, subsequent queries use point-reads for efficiency.
    const container = getContainer('users');

    const query = {
      query: 'SELECT * FROM c WHERE c.oid = @oid',
      parameters: [{ name: '@oid', value: oid }],
    };

    const { resources } = await container.items.query<User>(query).fetchAll();

    if (resources.length === 0) {
      return null; // User not enrolled in any family
    }

    if (resources.length > 1) {
      // Should not happen — each oid is enrolled in exactly one family.
      // Log and use the first result defensively.
      console.warn(`[familyScope] oid ${oid} found in ${resources.length} family records; using first.`);
    }

    const user = resources[0];
    return {
      familyId: user.familyId,
      role: user.role,
      user,
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error(`[familyScope] Failed to resolve family for oid ${oid}: ${errMessage}`);
    throw err; // Re-throw — caller handles as 500
  }
}

/** HTTP 404 response for unenrolled users */
export const NOT_ENROLLED = {
  status: 404,
  jsonBody: {
    code: 'NOT_ENROLLED',
    message: 'User is not enrolled in a family. Contact your family admin.',
  },
} as const;
