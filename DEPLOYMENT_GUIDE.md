# Allowance App — Deployment Guide

This guide walks through a complete first-time deployment, from zero to a running production environment.  
It also covers the Entra External ID configuration and ongoing operational tasks.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Repository Setup](#2-repository-setup)
3. [Entra External ID — Tenant & User Flow](#3-entra-external-id--tenant--user-flow)
4. [Entra — App Registration](#4-entra--app-registration)
5. [Entra — App Roles (Super Admin)](#5-entra--app-roles-super-admin)
6. [Azure Infrastructure — First Provision](#6-azure-infrastructure--first-provision)
7. [Post-Provision: Bootstrap Secret](#7-post-provision-bootstrap-secret)
8. [Deploy Application Code](#8-deploy-application-code)
9. [Smoke Test](#9-smoke-test)
10. [Local Development Setup](#10-local-development-setup)
11. [Ongoing Operations](#11-ongoing-operations)
12. [Architecture Reference](#12-architecture-reference)

---

## 1. Prerequisites

Install these tools before starting.

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 20 LTS | https://nodejs.org |
| Azure Functions Core Tools | v4 | `npm install -g azure-functions-core-tools@4` |
| Azure Developer CLI (`azd`) | latest | https://aka.ms/azd |
| Azure CLI (`az`) | 2.60 | https://aka.ms/installazurecli |
| PowerShell | 7+ | https://aka.ms/powershell |

Verify:

```powershell
node --version
func --version
azd version
az version
```

You also need:
- An **Azure subscription** with Contributor + User Access Administrator on the subscription or resource group (role assignments are made by Bicep).
- An **Entra External ID tenant** (`*.onmicrosoft.com`) — see step 3 if you don't have one yet.

---

## 2. Repository Setup

```powershell
git clone <repo-url> "Allowance App"
Set-Location "Allowance App"

# Frontend dependencies
npm install

# API dependencies
Set-Location api
npm install
Set-Location ..
```

---

## 3. Entra External ID — Tenant & User Flow

The app uses **Entra External ID (CIAM)** for all end-user authentication. This is a separate tenant from the Azure subscription tenant.

### 3a. Create the External ID tenant (if you don't have one)

1. In the [Azure portal](https://portal.azure.com), search **Microsoft Entra External ID** > **Overview** > **Create a tenant**.
2. Choose **External** (customer-facing), fill in the domain prefix (e.g., `bleytech`), and select a region.
3. Note your **Tenant ID** (GUID) and the custom domain (`<prefix>.onmicrosoft.com`).

> **If you already have a tenant**, switch to it now:  
> Portal top-right → "Switch directory" → select your External ID tenant.

### 3b. Create a Sign-up / Sign-in User Flow

1. In the External ID tenant: **User flows** > **+ New user flow**.
2. Select **Sign up and sign in (recommended)**.
3. Name it (e.g., `SignUpSignIn`).
4. Identity providers: check **Email with password** (and optionally social providers).
5. User attributes to collect: **Display Name** (or **Given Name** + **Surname** if you want `given_name`/`family_name` in the token).
6. Token claims to return: **Display Name**, **Given Name**, **Surname**, **Email Addresses**.
7. Click **Create**.

---

## 4. Entra — App Registration

Still in the **External ID tenant**:

### 4a. Create the registration

1. **App registrations** > **+ New registration**.
2. Name: `Allowance App` (or similar).
3. Supported account types: **Accounts in this organizational directory only** (single tenant within External ID).
4. Redirect URI: leave blank for now — added in the next step.
5. Click **Register**.
6. Copy the **Application (client) ID** — you'll need this throughout.

### 4b. Add the SPA redirect URI

1. Open the registration > **Authentication** > **+ Add a platform**.
2. Select **Single-page application**.
3. Redirect URI: `https://<your-swa-hostname>.azurestaticapps.net/` (you'll get this after provisioning — see step 6d).
4. Also add `http://localhost:5173/` for local development.
5. Under "Implicit grant and hybrid flows", ensure **both checkboxes are unchecked** (PKCE flow is used; implicit is not needed).
6. Click **Configure**.

> **Important**: The redirect URI must use the **Single-page application** platform type, not "Web".  
> Using "Web" type will cause `AADSTS9002326` errors.

### 4c. Expose an API scope

1. **Expose an API** > **+ Add a scope**.
2. If prompted to set an Application ID URI, accept the default (`api://<client-id>`).
3. Scope name: `AllowanceApp.Access`
4. Who can consent: **Admins and users**
5. Admin consent display name: `Access the Allowance App API`
6. Enable the scope > **Add scope**.

The full scope URI will be: `api://<client-id>/AllowanceApp.Access`

### 4d. Grant API permission to itself

1. **API permissions** > **+ Add a permission** > **My APIs**.
2. Select your `Allowance App` registration.
3. Check `AllowanceApp.Access` > **Add permissions**.
4. Click **Grant admin consent for \<tenant\>** > confirm.

### 4e. Link the user flow to the app

1. **Overview** (of the app registration) > scroll to **Essentials** > click the link under **Managed application in local directory**.
2. In the enterprise app: **User flows** > add your `SignUpSignIn` flow.

Alternatively: in the **User flows** blade, select your flow > **Applications** > **+ Add application** > pick your registration.

---

## 5. Entra — App Roles (Super Admin)

This enables designated accounts to access the Super Admin console without the bootstrap secret.

### 5a. Define the app role

1. In the **app registration** (not enterprise app): **App roles** > **+ Create app role**.

   | Field | Value |
   |-------|-------|
   | Display name | `Super Admin` |
   | Allowed member types | **Users/Groups** |
   | Value | **`SuperAdmin`** ← must match exactly |
   | Description | `Full super admin access to manage families` |
   | Enable this app role | ✅ checked |

2. Click **Apply**.

### 5b. Assign the role to a user

1. Switch to the **enterprise application** view:  
   **Azure Active Directory** > **Enterprise applications** > search for `Allowance App`.
2. **Users and groups** > **+ Add user/group**.
3. Users: select the account(s) that need super admin access.
4. Role: select **Super Admin**.
5. Click **Assign**.

> The `roles` claim only appears in tokens issued **after** the assignment.  
> Sign out and sign back in to get an updated token.

---

## 6. Azure Infrastructure — First Provision

### 6a. Authenticate

```powershell
# Authenticate to the Azure SUBSCRIPTION tenant (not the External ID tenant)
azd auth login

# Optionally verify the active subscription
az account show --query "{name:name, id:id}" -o table
```

### 6b. Initialize the azd environment

```powershell
Set-Location "c:\GitHub\Allowance App"

# Create a new azd environment (e.g., named "app" or "prod")
azd env new app
```

### 6c. Set External ID values

```powershell
# Your External ID tenant ID (GUID)
azd env set EXTERNAL_ID_TENANT_ID "0b59b81c-986d-4a76-9777-cc5a883950b5"

# App registration client ID from step 4a
azd env set EXTERNAL_ID_CLIENT_ID "<your-client-id>"
```

### 6d. Provision Azure resources

```powershell
azd provision
```

This creates (in `rg-allowance-<env>`, East US 2 by default):
- **Azure Cosmos DB** (serverless, `allowance-db` database, 5 containers)
- **Azure Key Vault** (Standard, RBAC-enabled, stores bootstrap admin secret)
- **Azure Functions** (Flex Consumption, Node 20, Linux, system-assigned identity)
- **Azure Static Web Apps** (Free tier)
- **Application Insights** + **Log Analytics Workspace** (30-day retention)
- **Azure Communication Services** — Email service, AzureManagedDomain, and Communication Services resource for outbound invite emails

Role assignments created by Bicep:
- Function App identity → **Cosmos DB Built-in Data Contributor** on Cosmos DB
- Function App identity → **Storage Blob Data Contributor** on storage account
- Function App identity → **Storage Queue Data Contributor** on storage account
- Function App identity → **Storage Table Data Contributor** on storage account
- Function App identity → **Key Vault Secrets User** on Key Vault
- Function App identity → **Communication and Email Service Owner** on ACS

After provisioning completes, the `postprovision` hook automatically patches the Function App with the ACS endpoint and sender address — no manual step needed for email.

### 6e. Add the production redirect URI

Take the SWA hostname from the provision output and add it to the app registration (step 4b) if you haven't already:

```
https://<swa-hostname>.azurestaticapps.net/
```

---

## 7. Post-Provision: Bootstrap Secret

The super-admin bootstrap path requires a secret stored in Key Vault and enabled via an app setting. This is a **break-glass** mechanism; see step 5 to use SSO instead.

> **Note**: The Cosmos DB connection is handled via managed identity — no connection string is stored in Key Vault. Key Vault is used solely for the bootstrap admin secret (and optionally `BOOTSTRAP_JWT_SECRET`).

### 7a. Generate a strong secret

```powershell
# Generate a 48-character random secret
$secret = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
Write-Host $secret
```

### 7b. Store in Key Vault

```powershell
$kvName = (azd env get-values | Select-String "AZURE_KEY_VAULT_NAME").ToString().Split("=")[1].Trim('"')

az keyvault secret set `
  --vault-name $kvName `
  --name "BootstrapAdminSecret" `
  --value $secret
```

### 7c. Enable bootstrap in the Function App

```powershell
$funcName = (azd env get-values | Select-String "AZURE_FUNCTION_APP_NAME").ToString().Split("=")[1].Trim('"')
$rg = (azd env get-values | Select-String "AZURE_RESOURCE_GROUP").ToString().Split("=")[1].Trim('"')

# Generate a second secret for signing SA session JWTs (different from the bootstrap login secret)
$jwtSecret = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(36))

az webapp config appsettings set `
  --name $funcName `
  --resource-group $rg `
  --settings `
    BOOTSTRAP_ADMIN_ENABLED=true `
    "BOOTSTRAP_ADMIN_SECRET=$secret" `
    "BOOTSTRAP_JWT_SECRET=$jwtSecret"
```

> **Security note**: Store the raw secret somewhere safe (e.g., your password manager). It is transmitted only once when logging into the bootstrap gate. After SSO super admin is working, set `BOOTSTRAP_ADMIN_ENABLED=false`.

---

## 8. Deploy Application Code

```powershell
Set-Location "c:\GitHub\Allowance App"
azd deploy
```

This builds and deploys both services:
- **`web`** — Vite production build → Static Web Apps
- **`api`** — TypeScript compile → Azure Functions (Flex Consumption)

The azd pre-package hook automatically reads `VITE_*` environment variables from the azd env and writes them into `.env` before the Vite build, so the frontend is correctly configured.

### Deploying a single service

```powershell
azd deploy --service api   # API only
azd deploy --service web   # Frontend only
```

> **Note**: `azd deploy` deploys code only. To update infrastructure or app settings, use `azd provision` (settings) or `az webapp config appsettings set` (individual settings without full re-provision).

---

## 9. Smoke Test

After deployment:

1. **API health check**:
   ```powershell
   Invoke-RestMethod "https://<func-hostname>/api/superadmin/status"
   # Expected: { bootstrapEnabled: true/false }
   ```

2. **Frontend loads**: Open `https://<swa-hostname>.azurestaticapps.net/` — should see the sign-in screen.

3. **Sign in**: Click sign in, complete the Entra External ID user flow. First-time users land on the Activation Screen (invite code entry).

4. **Super Admin** (SSO path): Sign in with an account that has the `SuperAdmin` role assigned (step 5b). The Super Admin console should load directly or via the role picker.

5. **Super Admin** (bootstrap path): Navigate to `/superadmin` and enter the bootstrap secret from step 7a.

---

## 10. Local Development Setup

### 10a. Frontend

```powershell
# Copy the example and fill in values
Copy-Item .env.local.example .env
# Edit .env:
#   VITE_CLIENT_ID=<app-registration-client-id>
#   VITE_API_URL=http://localhost:7071/api   (leave as-is for local dev)

npm run dev
# Opens at http://localhost:5173
```

### 10b. API

Requires [Azure Cosmos DB Emulator](https://aka.ms/cosmosdb-emulator) running locally.

```powershell
Set-Location api

# local.settings.json is already pre-filled with emulator defaults.
# Update EXTERNAL_ID_CLIENT_ID with your actual app registration client ID:
# (edit api/local.settings.json — this file is gitignored)

npm start
# API runs at http://localhost:7071/api
```

Key values in `api/local.settings.json`:

| Setting | Description |
|---------|-------------|
| `COSMOS_DB_CONNECTION_STRING` | Emulator connection string (pre-filled; local emulator does not support AAD) |
| `EXTERNAL_ID_TENANT_ID` | Your External ID tenant GUID |
| `EXTERNAL_ID_CLIENT_ID` | Your app registration client ID |
| `BOOTSTRAP_ADMIN_ENABLED` | `"true"` to enable bootstrap login locally |
| `BOOTSTRAP_ADMIN_SECRET` | Any string ≥ 32 chars for local testing |
| `BOOTSTRAP_JWT_SECRET` | Any string ≥ 32 chars for signing local SA session JWTs |

---

## 11. Ongoing Operations

### Re-deploying after code changes

```powershell
azd deploy
```

### Updating an app setting without full re-provision

```powershell
az webapp config appsettings set `
  --name <func-app-name> `
  --resource-group <resource-group> `
  --settings KEY=VALUE
```

> After changing `EXTERNAL_ID_CLIENT_ID` in `azd env`, run the `az webapp config appsettings set` command above **in addition to** `azd deploy` — `azd deploy` updates code only, not app settings.

### Disabling the bootstrap secret (recommended after SSO is verified)

```powershell
az webapp config appsettings set `
  --name <func-app-name> `
  --resource-group <resource-group> `
  --settings BOOTSTRAP_ADMIN_ENABLED=false
```

### Rotating the bootstrap secret

1. Generate a new secret (step 7a).
2. Update Key Vault:
   ```powershell
   az keyvault secret set --vault-name <kv-name> --name BootstrapAdminSecret --value <new-secret>
   ```
3. Update the Function App app setting (step 7c). Old sessions using the previous secret JWT will fail immediately (JWT signature won't verify).

### Adding a new super admin user

1. **Enterprise applications** → `Allowance App` → **Users and groups** → **+ Add user/group**.
2. Select the user, assign the **Super Admin** role.
3. The user must sign out and sign in again to receive the updated `roles` claim.

### Removing super admin access

1. **Enterprise applications** → `Allowance App` → **Users and groups**.
2. Select the assignment, click **Remove**.
3. Old tokens remain valid until they expire (default: 1 hour). For immediate revocation, use the **Revoke sessions** button on the user's profile in Entra.

---

## 12. Architecture Reference

```
                ┌─────────────────────────────┐
                │   Entra External ID (CIAM)  │
                │   bleytech.onmicrosoft.com  │
                │   ┌───────────────────────┐ │
                │   │  App Registration     │ │
                │   │  Scope: AllowanceApp  │ │
                │   │  Role: SuperAdmin     │ │
                │   └───────────────────────┘ │
                └──────────────┬──────────────┘
                               │ OIDC / MSAL
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                        Azure Subscription                         │
│  ┌─────────────────────┐       ┌────────────────────────────────┐ │
│  │  Static Web App     │──────▶│  Azure Functions (Flex)        │ │
│  │  React 19 + Vite    │ HTTPS │  TypeScript / Node 20          │ │
│  │  MSAL Auth Code +   │       │  JWT validation (auth.ts)      │ │
│  │  PKCE               │       │  Bootstrap or SSO super admin  │ │
│  └─────────────────────┘       └──┬──────────────┬─────────────┘ │
│                                   │ MI           │ MI+telemetry  │
│                        ┌──────────▼──────┐  ┌───▼────────────┐  │
│                        │  Key Vault      │  │  App Insights  │  │
│                        │  BootstrapSecret│  │  + Log Analytics│  │
│                        └─────────────────┘  └────────────────┘  │
│                                   │ MI                           │
│                        ┌──────────▼──────┐                       │
│                        │  Cosmos DB      │                       │
│                        │  (serverless)   │                       │
│                        │  families       │                       │
│                        │  users          │                       │
│                        │  transactions   │                       │
│                        │  chores         │                       │
│                        │  inviteCodes    │                       │
│                        └─────────────────┘                       │
│                                   │ MI                           │
│                        ┌──────────▼──────┐                       │
│                        │  ACS Email      │                       │
│                        │  (invite emails)│                       │
│                        └─────────────────┘                       │
└───────────────────────────────────────────────────────────────────┘
```

### Resource naming

Resources are named using a unique token derived from subscription ID + environment name + location:

| Resource | Pattern |
|----------|---------|
| Resource group | `rg-allowance-<env>` |
| Cosmos DB | `cosmos-allow-<token12>` |
| Key Vault | `kv-<token16>` |
| Function App | `func-allow-<token12>` |
| Static Web App | `swa-allowance-<env>` |
| Storage account | `st<token16>` |
| Application Insights | `appi-allow-<token12>` |
| Log Analytics workspace | `log-appi-allow-<token12>` |
| ACS Email service | `email-<token16>` |
| ACS Communication Services | `acs-<token16>` |

### Environment variables injected into Function App

| Setting | Source | Purpose |
|---------|--------|---------|
| `COSMOS_DB_ENDPOINT` | Bicep output | Cosmos DB account URL (MI auth) |
| `EXTERNAL_ID_TENANT_ID` | azd env | JWT issuer validation |
| `EXTERNAL_ID_CLIENT_ID` | azd env | JWT audience validation |
| `EXTERNAL_ID_AUTHORITY` | Bicep hardcoded | CIAM authority base URL |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Bicep / App Insights | Function App telemetry |
| `AzureWebJobsStorage__accountName` | Bicep | Storage account for Flex Consumption (identity-based) |
| `AzureWebJobsStorage__credential` | Bicep | `"managedidentity"` |
| `APP_URL` | Bicep | Frontend URL for invite email deep-links |
| `ACS_ENDPOINT` | postprovision hook | ACS Communication Services endpoint |
| `ACS_SENDER_ADDRESS` | postprovision hook | ACS managed sender address |
| `BOOTSTRAP_ADMIN_ENABLED` | Manual (step 7c) | Enable/disable bootstrap gate |
| `BOOTSTRAP_ADMIN_SECRET` | Manual (step 7c) | Raw secret for bootstrap login |
| `BOOTSTRAP_JWT_SECRET` | Manual (step 7c) | Signs super admin session JWTs |

### VITE environment variables (injected at build time)

| Variable | Source | Purpose |
|----------|--------|---------|
| `VITE_API_URL` | azd output | Function App API base URL |
| `VITE_CLIENT_ID` | azd env | MSAL app registration client ID |
| `VITE_TENANT_ID` | azd env | MSAL tenant ID |
| `VITE_AUTHORITY` | azd output | CIAM authority URL |

---

## Troubleshooting

### `AADSTS9002326` — redirect URI mismatch

The redirect URI registered in Entra is the wrong platform type. Go to **Authentication** in the app registration, delete the URI from the "Web" section, and re-add it under **Single-page application**.

### 401 from the API after sign-in

Check that `EXTERNAL_ID_TENANT_ID` in the Function App app settings matches the GUID of the External ID tenant (not your subscription tenant). The issuer in the JWT uses the GUID subdomain (`https://<tenant-guid>.ciamlogin.com/...`), not the custom domain.

```powershell
# Check what's currently set
az webapp config appsettings list --name <func-app-name> --resource-group <rg> `
  --query "[?name=='EXTERNAL_ID_TENANT_ID' || name=='EXTERNAL_ID_CLIENT_ID']" -o table
```

### Super Admin console shows 401

Verify the `roles` claim is in the token:
1. Sign in and capture the access token (browser DevTools → Network → find a request to the API → copy the `Authorization: Bearer <token>` value).
2. Paste the token at https://jwt.ms and look for `"roles": ["SuperAdmin"]`.
3. If missing, confirm the role assignment in **Enterprise applications** and sign out + back in.

### Changes to `EXTERNAL_ID_CLIENT_ID` not taking effect

`azd deploy` does not update app settings — it only deploys code. After changing the value in azd env, push it to the live Function App:

```powershell
az webapp config appsettings set `
  --name <func-app-name> `
  --resource-group <rg> `
  --settings EXTERNAL_ID_CLIENT_ID=<new-value>
```
