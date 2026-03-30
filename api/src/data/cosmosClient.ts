import { CosmosClient, Database } from '@azure/cosmos';

// ---------------------------------------------------------------------------
// Cosmos DB client — singleton, initialized once per Function App instance
// ---------------------------------------------------------------------------

let _db: Database | null = null;

/**
 * Returns a lazily-initialized Cosmos DB database handle.
 * The connection string is read from the environment variable set via Key Vault
 * reference in Azure, or from local.settings.json during local development.
 */
export function getDatabase(): Database {
  if (_db) return _db;

  const connectionString = process.env['COSMOS_DB_CONNECTION_STRING'];
  if (!connectionString) {
    throw new Error('COSMOS_DB_CONNECTION_STRING environment variable is not set.');
  }

  const client = new CosmosClient(connectionString);
  _db = client.database('allowance-db');
  return _db;
}

/**
 * Returns a typed container reference.
 * @param name - One of: 'families' | 'users' | 'transactions' | 'auditLog'
 */
export function getContainer(name: 'families' | 'users' | 'transactions' | 'auditLog') {
  return getDatabase().container(name);
}
