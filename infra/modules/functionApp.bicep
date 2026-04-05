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

@description('The Key Vault name (in the same resource group) — provisioned for future secrets.')
param keyVaultName string

@description('Cosmos DB account name — used to assign the SQL Data Contributor role to the Function App identity.')
param cosmosDbAccountName string

@description('Cosmos DB account endpoint — used by the Function App to connect via managed identity.')
param cosmosDbEndpoint string

@description('Default hostname of the Static Web App (for CORS allowlist).')
param swaHostname string

@description('Entra External ID tenant ID — used by API for JWT validation.')
param externalIdTenantId string = ''

@description('App registration client ID — used by API for JWT audience validation.')
param externalIdClientId string = ''

@description('When true, adds http://localhost:5173 to CORS allowed origins. Set to true for dev environments only.')
param allowLocalhostCors bool = false

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
        // Keep one warm instance for the allowanceScheduler timer trigger.
        // Without this, Flex Consumption scales to zero and timer triggers
        // never fire — the function host only wakes on HTTP demand.
        alwaysReady: [
          {
            name: 'function:allowanceScheduler'
            instanceCount: 1
          }
        ]
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
// Role assignments — all must complete before app settings
// ---------------------------------------------------------------------------

resource existingKeyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// Cosmos DB account reference — used for the SQL RBAC role assignment below
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' existing = {
  name: cosmosDbAccountName
}

// Cosmos DB Built-in Data Contributor — lets the Function App read/write all containers.
// Role definition ID 00000000-0000-0000-0000-000000000002 is the well-known built-in role.
resource cosmosDataContributorRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, funcApp.id, '00000000-0000-0000-0000-000000000002')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: funcApp.identity.principalId
    scope: cosmosAccount.id
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

    // Cosmos DB endpoint — the Function App connects via managed identity.
    // The 'Cosmos DB Built-in Data Contributor' SQL role is assigned above.
    // Requires RBAC propagation (~5 min) before the first request after provisioning.
    COSMOS_DB_ENDPOINT: cosmosDbEndpoint

    // Entra External ID — JWT validation in auth middleware
    EXTERNAL_ID_TENANT_ID: externalIdTenantId
    EXTERNAL_ID_CLIENT_ID: externalIdClientId
    EXTERNAL_ID_AUTHORITY: 'https://bleytech.ciamlogin.com/'

    // App URL — used to build invite deep-links in outbound emails
    APP_URL: 'https://${swaHostname}'
  }
  dependsOn: [cosmosDataContributorRole, storageBlobRole]
}

// ---------------------------------------------------------------------------
// CORS — allow SWA hostname and local dev server
// ---------------------------------------------------------------------------

resource corsConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: funcApp
  name: 'web'
  properties: {
    cors: {
      allowedOrigins: union(
        ['https://${swaHostname}'],
        allowLocalhostCors ? ['http://localhost:5173'] : []
      )
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
