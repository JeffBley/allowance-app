// ---------------------------------------------------------------------------
// Azure Static Web Apps — Free tier, hosts the React SPA
// The 'azd-service-name: web' tag is required for AZD to identify this resource
// as the deployment target for the 'web' service in azure.yaml.
// ---------------------------------------------------------------------------

param location string
param tags object
param name string

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // AZD handles CI/CD deployment; skip auto-generating a GitHub Actions workflow
    // from the portal — AZD's own workflow is used instead.
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname

// Full URI for CORS configuration in the Function App
output uri string = 'https://${staticWebApp.properties.defaultHostname}'
