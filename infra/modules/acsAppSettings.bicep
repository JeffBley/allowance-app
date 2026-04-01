// ---------------------------------------------------------------------------
// Patch Function App app settings to add ACS endpoint + sender address.
// This module runs AFTER both the functionApp and acsEmail modules so neither
// has a circular dependency on the other.
// ---------------------------------------------------------------------------

param functionAppName string
param acsEndpoint string
param acsSenderAddress string

// Reference the existing function app — no new resource is created.
resource funcApp 'Microsoft.Web/sites@2023-12-01' existing = {
  name: functionAppName
}

// Retrieve the current app settings so we can merge rather than overwrite.
// Note: listSettings returns the full key/value map.
var existingSettings = list('${funcApp.id}/config/appsettings', '2023-12-01').properties

// Merge ACS settings into existing settings.
resource acsAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: funcApp
  name: 'appsettings'
  properties: union(existingSettings, {
    ACS_ENDPOINT: acsEndpoint
    ACS_SENDER_ADDRESS: acsSenderAddress
  })
}
