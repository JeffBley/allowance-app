// ---------------------------------------------------------------------------
// Key Vault — Standard tier, RBAC-enabled
// Provisioned for future secrets (e.g., BOOTSTRAP_ADMIN_SECRET).
// Cosmos DB connection string is no longer stored here — the Function App
// authenticates to Cosmos via managed identity RBAC instead.
// ---------------------------------------------------------------------------

param location string
param tags object

@minLength(3)
@maxLength(24)
param name string

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
    // enablePurgeProtection omitted — defaults to false (disabled) for dev.
    // To enable for prod, add: enablePurgeProtection: true (irreversible).
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = keyVault.name
output uri string = keyVault.properties.vaultUri
