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
    // Disable local (key-based) auth in favour of managed identity where possible.
    // NOTE: Key-based auth is still needed for the connection string stored in Key Vault
    // so we leave this enabled. Revisit when adopting RBAC-only access.
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

var containerNames = ['families', 'users', 'transactions', 'auditLog']

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

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output accountName string = cosmosAccount.name
output endpoint string = cosmosAccount.properties.documentEndpoint

// @secure() prevents the connection string from appearing in deployment logs
@secure()
output connectionString string = 'AccountEndpoint=${cosmosAccount.properties.documentEndpoint};AccountKey=${cosmosAccount.listKeys().primaryMasterKey}'
