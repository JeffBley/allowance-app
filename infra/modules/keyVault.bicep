// ---------------------------------------------------------------------------
// Key Vault — Standard tier, RBAC-enabled, stores the Cosmos DB connection string
// The Function App's managed identity will be granted Secrets User access
// from the functionApp module (after the identity is created).
// ---------------------------------------------------------------------------

param location string
param tags object

@minLength(3)
@maxLength(24)
param name string

@secure()
@description('Cosmos DB connection string to store as a secret.')
param cosmosDbConnectionString string

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    // Use the subscription's tenant (where resources are deployed), not the
    // External ID tenant. Access policies / RBAC assignments reference the
    // Function App's managed identity in this tenant.
    tenantId: subscription().tenantId
    // RBAC authorization — use role assignments instead of legacy access policies
    enableRbacAuthorization: true
    // Soft delete protects against accidental / malicious deletion
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    // Purge protection prevents permanent deletion during retention period
    enablePurgeProtection: false // Keep false for dev; enable for prod
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// Cosmos DB connection string secret
// ---------------------------------------------------------------------------

resource cosmosDbSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'CosmosDbConnectionString'
  properties: {
    value: cosmosDbConnectionString
    attributes: {
      enabled: true
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = keyVault.name
output uri string = keyVault.properties.vaultUri

// Full secret URI used in Function App settings as a Key Vault reference
output cosmosDbSecretUri string = '${keyVault.properties.vaultUri}secrets/${cosmosDbSecret.name}/'
