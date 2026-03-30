// ---------------------------------------------------------------------------
// Azure Functions — Consumption (Y1) plan, Node.js 20, TypeScript
// System-assigned managed identity is used to access Key Vault.
// App settings use a Key Vault reference for the Cosmos DB connection string.
//
// Deployment order within this module:
//   1. storageAccount + hostingPlan (parallel)
//   2. funcApp site (establishes managed identity + principalId)
//   3. kvSecretsUserRole (grants Function App MI read access to Key Vault)
//   4. appSettings (depends on role assignment — uses KV reference)
//   5. corsConfig (allow SWA hostname + localhost)
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
// Storage Account (required by Consumption plan Functions host)
// ---------------------------------------------------------------------------

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS' // Locally redundant — sufficient for Functions internal storage
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// ---------------------------------------------------------------------------
// Consumption Hosting Plan (Y1 / Dynamic)
// ---------------------------------------------------------------------------

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${name}'
  location: location
  tags: tags
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {
    reserved: false // Windows
  }
}

// ---------------------------------------------------------------------------
// Function App site (system-assigned identity established here)
// App settings are applied in a separate resource (appSettings) below,
// AFTER the Key Vault role is assigned, to ensure the KV reference resolves.
// ---------------------------------------------------------------------------

resource funcApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      // Minimum TLS 1.2 for all inbound connections
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Runtime settings — app settings applied separately below
      nodeVersion: '~20'
    }
  }
}

// ---------------------------------------------------------------------------
// Role assignment: Function App MI → Key Vault Secrets User
// This must complete BEFORE the app settings with the KV reference are applied.
// Role GUID: 4633458b-17de-408a-b874-0445c86b69e6 = Key Vault Secrets User
// ---------------------------------------------------------------------------

resource existingKeyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Deterministic GUID ensures idempotent role assignment
  name: guid(existingKeyVault.id, funcApp.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: existingKeyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User (read-only)
    )
    principalId: funcApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// App Settings — applied after KV role assignment to ensure reference resolves
// ---------------------------------------------------------------------------

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: funcApp
  name: 'appsettings'
  properties: {
    // Azure Functions host settings
    AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
    WEBSITE_CONTENTAZUREFILECONNECTIONSTRING: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
    WEBSITE_CONTENTSHARE: toLower(name)
    FUNCTIONS_EXTENSION_VERSION: '~4'
    FUNCTIONS_WORKER_RUNTIME: 'node'
    WEBSITE_NODE_DEFAULT_VERSION: '~20'

    // Cosmos DB connection string via Key Vault reference.
    // Requires the managed identity to have Key Vault Secrets User role (assigned above).
    // Note: RBAC propagation can take up to 5 minutes; the app may fail on cold start
    // immediately after provisioning. A restart after 5 minutes resolves this. See KI-0004.
    COSMOS_DB_CONNECTION_STRING: '@Microsoft.KeyVault(SecretUri=${cosmosDbConnectionStringSecretUri})'

    // Entra External ID settings — used by the auth middleware for JWT validation
    EXTERNAL_ID_TENANT_ID: externalIdTenantId
    EXTERNAL_ID_CLIENT_ID: externalIdClientId
    EXTERNAL_ID_AUTHORITY: 'https://bleytech.ciamlogin.com/'

    // Application Insights (connection string populated by Bicep if AI resource added later)
    // APPLICATIONINSIGHTS_CONNECTION_STRING: ''
  }
  dependsOn: [kvSecretsUserRole] // Ensures KV role exists before KV reference is applied
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
