// ---------------------------------------------------------------------------
// Azure Communication Services — Email
// Provisions:
//   1. ACS Email Service (the sending infrastructure, hosted in the same region)
//   2. An email domain under the free AzureManagedDomain (.azurecomm.net)
//   3. A Communication Services resource that links to the email domain
//   4. A role assignment granting the Function App's managed identity the
//      "Communication and Email Service Owner" role so it can send email
//      without a connection string.
// ---------------------------------------------------------------------------

param location string
param tags object

@description('Base name used for all ACS resources.')
param name string

@description('Principal ID of the Function App system-assigned managed identity.')
param functionAppPrincipalId string

// ---------------------------------------------------------------------------
// ACS Email Service
// The email service must be in a supported region. Use the same region as the
// rest of the deployment when supported; ACS Email is GA in most Azure regions.
// ---------------------------------------------------------------------------

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: 'email-${name}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'United States'
  }
}

// Azure-managed domain — free, no DNS setup required.
// Sender address will be: DoNotReply@<guid>.azurecomm.net
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
  }
}

// ---------------------------------------------------------------------------
// Communication Services resource
// This is what the SDK talks to; it links back to the email domain above.
// ---------------------------------------------------------------------------

resource commService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: 'acs-${name}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'United States'
    linkedDomains: [
      emailDomain.id
    ]
  }
}

// ---------------------------------------------------------------------------
// Role assignment — Communication and Email Service Owner
// Allows the Function App's managed identity to send email via ACS without
// storing a connection string. Role ID: 6a8d2034-9c7f-4b00-bb84-5f5f8c55c68c
// ---------------------------------------------------------------------------

resource acsOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(commService.id, functionAppPrincipalId, '09976791-48a7-449e-bb21-39d1a415f350')
  scope: commService
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '09976791-48a7-449e-bb21-39d1a415f350'  // Communication and Email Service Owner
    )
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('The ACS Communication Services endpoint (e.g. https://<name>.communication.azure.com)')
output commServiceEndpoint string = commService.properties.hostName

@description('The sender email address on the AzureManagedDomain')
output senderAddress string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
