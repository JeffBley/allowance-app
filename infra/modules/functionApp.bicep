// ---------------------------------------------------------------------------
// Azure Functions — Flex Consumption plan, Node.js 20, TypeScript
// Flex Consumption uses a different quota bucket than Y1 Dynamic — avoids
// the "Dynamic VMs" quota limitation common on personal/VSE subscriptions.
// System-assigned managed identity is used to access Key Vault.
//
// Deployment order within this module:
//   1. storageAccount + managed identity for storage (parallel)
//   2. hostingPlan (Flex Consumption, Linux)
//   3. funcApp site (establishes MI + principalId)
//   4. kvSecretsUserRole + storageBlobRole (parallel, then wait)
//   5. appSettings (Key Vault reference for Cosmos DB connection string)
//   6. corsConfig
// ---------------------------------------------------------------------------

param location string
param tags object

@minLength(2)
@maxLength(60)
param name string

@minLength(3)
@maxLength(24)
@description('Storage account name — must be lowercase alphanumeric, ≤24 chars.')
param storageAccountName string

@description('The Key Vault name (in the same resource group) to grant access to.')
param keyVaultName string

@description('Full Key Vault secret URI for the Cosmos DB connection string.')
param cosmosDbConnectionStringSecretUri string

@description('Default hostname of the Static Web App (for CORS allowlist).')
param swaHostname string

@description('Entra External ID tenant ID — used by API for JWT validation.')
param externalIdTenantId string = ''

@description('App registration client ID — used by API for JWT audience validation.')
param externalIdClientId string = ''

// ---------------------------------------------------------------------------
// Storage Account (required by Flex Consumption — identity-based connection)
// ---------------------------------------------------------------------------

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// Flex Consumption requires this container to exist for deployment package uploads
resource deploymentPackagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storageAccount.name}/default/deploymentpackages'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// Flex Consumption Hosting Plan (Linux, FC1 SKU)
// This avoids the "Dynamic VMs" quota limitation of the Y1 Consumption plan.
// ---------------------------------------------------------------------------

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${name}'
  location: location
  tags: tags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: {
    reserved: true // Required for Linux
  }
}

// ---------------------------------------------------------------------------
// Function App site — Flex Consumption, Linux, Node 20
// System-assigned identity established here for Key Vault + Storage access.
// ---------------------------------------------------------------------------

resource funcApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageAccount.properties.primaryEndpoints.blob}deploymentpackages'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Role assignments — both must complete before app settings (KV reference)
// ---------------------------------------------------------------------------

resource existingKeyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// Key Vault Secrets User — lets the Function App read secrets
resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(existingKeyVault.id, funcApp.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: existingKeyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
    )
    principalId: funcApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Blob Data Contributor — required by Flex Consumption for identity-based deployment package storage
resource storageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, funcApp.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor
    )
    principalId: funcApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// App Settings — applied after KV + Storage role assignments
// Flex Consumption doesn't use AzureWebJobsStorage connection string —
// storage access uses managed identity (role assigned above).
// ---------------------------------------------------------------------------

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: funcApp
  name: 'appsettings'
  properties: {
    FUNCTIONS_EXTENSION_VERSION: '~4'

    // Cosmos DB connection string via Key Vault reference.
    // Requires Key Vault Secrets User role (assigned above).
    COSMOS_DB_CONNECTION_STRING: '@Microsoft.KeyVault(SecretUri=${cosmosDbConnectionStringSecretUri})'

    // Entra External ID — JWT validation in auth middleware
    EXTERNAL_ID_TENANT_ID: externalIdTenantId
    EXTERNAL_ID_CLIENT_ID: externalIdClientId
    EXTERNAL_ID_AUTHORITY: 'https://bleytech.ciamlogin.com/'
  }
  dependsOn: [kvSecretsUserRole, storageBlobRole]
}

// ---------------------------------------------------------------------------
// CORS — allow SWA hostname and local dev server
// ---------------------------------------------------------------------------

resource corsConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: funcApp
  name: 'web'
  properties: {
    cors: {
      allowedOrigins: [
        'http://localhost:5173' // Vite dev server
        'https://${swaHostname}' // Production SWA
      ]
      supportCredentials: false // Credentials sent via Authorization header, not cookies
    }
    // Disable remote debugging in all environments
    remoteDebuggingEnabled: false
  }
  dependsOn: [appSettings]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = funcApp.name
output resourceId string = funcApp.id
output defaultHostname string = funcApp.properties.defaultHostName
output principalId string = funcApp.identity.principalId
