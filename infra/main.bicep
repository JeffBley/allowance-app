targetScope = 'subscription'

// ---------------------------------------------------------------------------
// Parameters — values injected by AZD from environment variables
// ---------------------------------------------------------------------------

@minLength(1)
@maxLength(64)
@description('Name of the AZD environment (e.g., dev, prod). Used in resource naming.')
param environmentName string

@minLength(1)
@description('Primary Azure region for all resources.')
param location string

@description('Entra External ID (CIAM) tenant ID for bleytech.onmicrosoft.com. Set via: azd env set EXTERNAL_ID_TENANT_ID <value>')
param externalIdTenantId string = ''

@description('App registration client ID in the External ID tenant. Set after app registration via: azd env set EXTERNAL_ID_CLIENT_ID <value>')
param externalIdClientId string = ''

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

// Globally-unique token derived from subscription + env + location
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))

var resourceGroupName = 'rg-allowance-${environmentName}'
var tags = { 'azd-env-name': environmentName }

// ---------------------------------------------------------------------------
// Resource Group
// ---------------------------------------------------------------------------

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Cosmos DB — serverless NoSQL, all app data
// ---------------------------------------------------------------------------

module cosmosDb './modules/cosmosDb.bicep' = {
  name: 'cosmosDb'
  scope: rg
  params: {
    location: location
    tags: tags
    accountName: 'cosmos-allow-${take(resourceToken, 12)}'
  }
}

// ---------------------------------------------------------------------------
// Key Vault — stores Cosmos DB connection string (and future secrets)
// ---------------------------------------------------------------------------

module keyVault './modules/keyVault.bicep' = {
  name: 'keyVault'
  scope: rg
  params: {
    location: location
    tags: tags
    name: 'kv-${take(resourceToken, 16)}'
    // Cosmos DB connection string is no longer stored here.
    // The Function App connects to Cosmos via managed identity.
  }
}

// ---------------------------------------------------------------------------
// Static Web App — Free tier, hosts the React SPA
// Deployed first so its hostname can be passed to the Function App for CORS.
// ---------------------------------------------------------------------------

module staticWebApp './modules/staticWebApp.bicep' = {
  name: 'staticWebApp'
  scope: rg
  params: {
    location: location
    tags: tags
    name: 'swa-allowance-${environmentName}'
  }
}

// ---------------------------------------------------------------------------
// Application Insights + Log Analytics — telemetry for the Function App
// ---------------------------------------------------------------------------

module appInsights './modules/appInsights.bicep' = {
  name: 'appInsights'
  scope: rg
  params: {
    location: location
    tags: tags
    name: 'appi-allow-${take(resourceToken, 12)}'
  }
}

// ---------------------------------------------------------------------------
// Azure Functions — Consumption plan, JWT-secured HTTP API + scheduler
// Depends on SWA hostname (for CORS) and Key Vault (for secrets).
// ---------------------------------------------------------------------------

module functionApp './modules/functionApp.bicep' = {
  name: 'functionApp'
  scope: rg
  params: {
    location: location
    tags: tags
    name: 'func-allow-${take(resourceToken, 12)}'
    storageAccountName: 'st${take(resourceToken, 16)}'
    keyVaultName: keyVault.outputs.name
    cosmosDbAccountName: cosmosDb.outputs.accountName
    cosmosDbEndpoint: cosmosDb.outputs.endpoint
    swaHostname: staticWebApp.outputs.defaultHostname
    externalIdTenantId: externalIdTenantId
    externalIdClientId: externalIdClientId
    appInsightsConnectionString: appInsights.outputs.connectionString
  }
}

// ---------------------------------------------------------------------------
// Azure Communication Services Email
// ---------------------------------------------------------------------------

module acsEmail './modules/acsEmail.bicep' = {
  name: 'acsEmail'
  scope: rg
  params: {
    location: location
    tags: tags
    name: take(resourceToken, 16)
    functionAppPrincipalId: functionApp.outputs.principalId
  }
}

// ---------------------------------------------------------------------------
// Outputs — consumed by AZD; VITE_* vars are injected into the Vite build
// ---------------------------------------------------------------------------

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroupName
output AZURE_STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
output AZURE_FUNCTION_APP_NAME string = functionApp.outputs.name
output AZURE_COSMOS_ACCOUNT_NAME string = cosmosDb.outputs.accountName
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name

// Vite build-time env vars — injected by AZD during `azd deploy web`
output VITE_API_URL string = 'https://${functionApp.outputs.defaultHostname}/api'
output VITE_TENANT_ID string = externalIdTenantId
output VITE_CLIENT_ID string = externalIdClientId
@description('CIAM authority URL — always ends with trailing slash for External ID.')
output VITE_AUTHORITY string = 'https://bleytech.ciamlogin.com/'

// ACS Email — consumed by the postprovision hook to patch Function App settings
output ACS_ENDPOINT string = 'https://${acsEmail.outputs.commServiceEndpoint}'
output ACS_SENDER_ADDRESS string = acsEmail.outputs.senderAddress
