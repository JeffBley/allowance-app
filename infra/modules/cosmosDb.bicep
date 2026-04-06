// ---------------------------------------------------------------------------
// Cosmos DB — serverless NoSQL account + allowance-db database + containers
// All containers use /familyId as the partition key for data isolation.
// ---------------------------------------------------------------------------

param location string
param tags object

@minLength(3)
@maxLength(44)
param accountName string

// ---------------------------------------------------------------------------
// Cosmos DB Account (Serverless — pay-per-request, no provisioned throughput)
// ---------------------------------------------------------------------------

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      // Serverless billing — no RU/s provisioning required
      { name: 'EnableServerless' }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    // disableLocalAuth: false — key-based auth is left enabled as a safe-migration
    // fallback. Set to true (and re-run azd provision) once managed identity
    // access is confirmed working in production to eliminate the account key entirely.
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
    enableFreeTier: false
    enableAutomaticFailover: false
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: 'allowance-db'
  properties: {
    resource: { id: 'allowance-db' }
  }
}

// ---------------------------------------------------------------------------
// Containers — all partitioned by /familyId for family-scoped data isolation
// ---------------------------------------------------------------------------

var containerNames = ['families', 'users', 'transactions', 'chores']

resource dbContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = [
  for containerName in containerNames: {
    parent: database
    name: containerName
    properties: {
      resource: {
        id: containerName
        partitionKey: {
          paths: ['/familyId']
          kind: 'Hash'
          version: 2
        }
        indexingPolicy: {
          indexingMode: 'consistent'
          automatic: true
          includedPaths: [{ path: '/*' }]
          excludedPaths: [{ path: '/"_etag"/?' }]
        }
      }
    }
  }
]

// inviteCodes uses /id as partition key (codes are looked up by code value directly)
resource inviteCodesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: 'inviteCodes'
  properties: {
    resource: {
      id: 'inviteCodes'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        // version omitted to match the existing container's original partition key definition
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }]
      }
      // TTL enabled — invite codes auto-expire from storage after 30 days
      // (the expiresAt field provides the application-level expiry check)
      defaultTtl: 2592000
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output accountName string = cosmosAccount.name
output endpoint string = cosmosAccount.properties.documentEndpoint
// Note: connectionString output removed — Function App now uses managed identity.
// The account key is no longer used and should not be distributed.
