# Allowance App — Architecture

## Overview

Allowance App is a family finance tracker that lets parents set recurring allowances, log transactions (income, purchases, tithing), and track running balances for each child. It is a single-page application (SPA) backed by a serverless Azure Functions API, with all identity managed through Microsoft Entra External ID (CIAM).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8 |
| Authentication (client) | MSAL.js v5 (`@azure/msal-browser`, `@azure/msal-react`) |
| Backend API | Azure Functions v4 (Node.js 20, TypeScript) |
| Token validation (server) | `jose` (JWKS-based JWT verification) |
| Database | Azure Cosmos DB (NoSQL, serverless) |
| Database SDK | `@azure/cosmos` v4 with `DefaultAzureCredential` |
| Hosting — frontend | Azure Static Web Apps (Free tier) |
| Hosting — API | Azure Functions Flex Consumption plan |
| Secrets store | Azure Key Vault |
| Identity provider | Microsoft Entra External ID (CIAM) — `bleytech.ciamlogin.com` |
| Infrastructure-as-code | Bicep via Azure Developer CLI (`azd`) |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                │
│                                                                         │
│  ┌──────────────────────────────────────────┐                          │
│  │  React SPA                               │                          │
│  │  (Azure Static Web Apps)                 │                          │
│  │                                          │                          │
│  │  MSAL.js ──── Auth Code + PKCE ──────────┼──► Entra External ID    │
│  │               (redirect flow)            │    bleytech.ciamlogin.com│
│  │                                          │                          │
│  │  useApi.ts ── Bearer token ──────────────┼──► Azure Functions API  │
│  │               (Authorization header)     │    /api/*               │
│  └──────────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Azure Functions (Flex Consumption)                                     │
│                                                                         │
│  HTTP trigger functions ──► auth middleware ──► familyScope middleware  │
│                                  │                       │             │
│                            JWKS validation          Cosmos DB lookup   │
│                            (jose + Entra JWKS)      (oid → familyId)   │
│                                                           │             │
│                                                    Cosmos DB queries    │
│                                                    (always familyId-    │
│                                                     scoped)             │
│                                                                         │
│  Timer trigger (allowanceScheduler) ─────────────► Cosmos DB           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Azure Cosmos DB (Serverless)                                           │
│  Database: allowance-db                                                 │
│  Partition key: /familyId (all containers)                              │
│                                                                         │
│  families │ users │ transactions │ auditLog │ inviteCodes               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Azure Key Vault                                                        │
│  (future secrets — Cosmos access now uses managed identity)             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend

### Structure

```
src/
├── main.tsx                  # Entry point — MSAL bootstrap + React render
├── App.tsx                   # Root component — role dispatch
├── auth/
│   ├── msalConfig.ts         # MSAL PublicClientApplication config + helpers
│   └── AuthProvider.tsx      # MsalProvider wrapper + LoginGate
├── hooks/
│   ├── useApi.ts             # Authenticated fetch hook (silent token → Bearer)
│   └── useAppRole.ts         # Reads app role from token claims
├── components/
│   ├── user/                 # Kid-facing UI (balance, transaction history)
│   ├── admin/                # Parent-facing UI (add transactions, settings)
│   ├── RolePicker.tsx        # Role selection for multi-role users
│   └── RoleSwitcher.tsx      # Dev-mode role switcher
├── superadmin/               # Super-admin UI (system management)
└── data/
    └── mockData.ts           # Shared computed types (KidView, balance logic)
```

### Authentication Flow

1. `main.tsx` calls `msalInstance.initialize()` → `handleRedirectPromise()` on every page load, processing any OAuth callback before React renders.
2. `LoginGate` in `AuthProvider.tsx` renders the sign-in screen unless `useIsAuthenticated()` returns true.
3. Sign-in uses `loginRedirect()` (Authorization Code + PKCE). State and nonce are stored in both `sessionStorage` and a `Secure` cookie (`storeAuthStateInCookie: true`) to survive browser-restore scenarios.
4. After redirect back to `/auth/callback`, `handleRedirectPromise()` validates state/nonce, sets the active account, and React renders the authenticated app.
5. All API calls go through `useApi.ts` → `acquireTokenSilent()` → `Authorization: Bearer <access-token>`.

### Token Cache

| Setting | Value | Rationale |
|---|---|---|
| `cacheLocation` | `sessionStorage` | Cleared on tab close; limits XSS exposure window |
| `storeAuthStateInCookie` | `true` | Prevents `state_not_found` when browser restores a tab with stale OAuth params in URL |
| `secureCookies` | `true` | `Secure` flag; safe because app is always HTTPS on SWA |

### View Routing

`App.tsx` dispatches to one of three views based on the resolved role:

| View | Component | Role |
|---|---|---|
| Kid view | `UserApp` | `User` (kid) |
| Admin view | `AdminApp` | `FamilyAdmin` (parent) |
| Super admin | `SuperAdminApp` | `SuperAdmin` app role in Entra |

The `/superadmin` path and all sub-paths are rewritten to `index.html` by the SWA config and the super admin UI is rendered inside React, gated by the app role claim.

---

## Backend API

All HTTP functions are Azure Functions v4 HTTP triggers. The middleware pipeline is applied at the start of every function:

```
Request
  └─► validateBearerToken()  — JWKS-validates JWT; extracts oid
        └─► resolveFamilyScope()  — point-reads users container; returns { familyId, role, user }
              └─► business logic  — all Cosmos queries include familyId filter
```

### Family API

| Method | Route | Role | Description |
|---|---|---|---|
| `GET` | `/api/family` | Any | Returns family info, all member profiles, and kid settings |
| `GET` | `/api/transactions` | Any | Returns transactions for the caller's family (filterable by date) |
| `GET` | `/api/auditLog` | `FamilyAdmin` | Returns audit log entries |
| `POST` | `/api/transactions` | `FamilyAdmin` | Add a transaction (Income / Purchase / Tithing) |
| `PATCH` | `/api/transactions/{id}` | `FamilyAdmin` | Edit a transaction |
| `DELETE` | `/api/transactions/{id}` | `FamilyAdmin` | Delete a transaction |
| `PUT` | `/api/settings/{kidOid}` | `FamilyAdmin` | Update allowance settings for a kid |
| `PUT` | `/api/balanceOverride/{kidOid}` | `FamilyAdmin` | Manually set balance floor for a kid |
| `GET` | `/api/invites` | `FamilyAdmin` | List active invite codes |
| `POST` | `/api/invites` | `FamilyAdmin` | Generate an invite code |
| `DELETE` | `/api/invites/{code}` | `FamilyAdmin` | Revoke an invite code |
| `POST` | `/api/invite/redeem` | Unauthenticated* | Redeem an invite code to enroll a new user |

\* `inviteRedeem` validates the Bearer token to extract the enrolling user's `oid`, but the user won't have a family record yet.

### Scheduled Function

| Trigger | Name | Schedule | Description |
|---|---|---|---|
| Timer | `allowanceScheduler` | Every 5 minutes | Finds kids with `nextAllowanceDate <= now`, credits allowance, advances next date |

The scheduler uses a 10-minute idempotency window to detect duplicate runs and avoid double-crediting. See KI-0022 for the distributed lock limitation.

### Super Admin API

The super admin surface uses a separate authentication mechanism: a break-glass bootstrap secret exchanged for a short-lived JWT, independent of Entra identity. This allows system-level operations without requiring an Entra admin account.

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/superadmin/auth` | Bootstrap secret | Validates `BOOTSTRAP_ADMIN_SECRET`; returns signed session JWT. Rate-limited: 5 attempts / IP / 15 min. |
| `GET` | `/api/superadmin/status` | SA session JWT | Returns bootstrap-enabled flag and system config |
| `GET` | `/api/superadmin/families` | SA session JWT | List all families |
| `GET/PUT` | `/api/superadmin/family/{id}` | SA session JWT | Get or update a specific family (e.g., member limit) |
| `GET/PUT/DELETE` | `/api/superadmin/members` | SA session JWT | List, update, or remove family members |
| `GET` | `/api/superadmin/transactions` | SA session JWT | View transactions across all families |
| `POST` | `/api/superadmin/transactions/purge` | SA session JWT | Purge old transactions (updates balance accumulators on user records) |
| `GET/POST/DELETE` | `/api/superadmin/invites` | SA session JWT | Manage invite codes system-wide |

Super admin is disabled (`BOOTSTRAP_ADMIN_ENABLED=false`) in production when not actively needed.

### JWT Validation (Server-Side)

```
Authorization: Bearer <access-token>
  │
  └─► createRemoteJWKSet(JWKS_URI)   — fetches/caches keys from Entra
        └─► jwtVerify(token, JWKS, {
              issuer:   https://{tenantId}.ciamlogin.com/{tenantId}/v2.0
              audience: {clientId}
            })
              └─► payload.oid  — used for all identity lookups (never client-supplied)
```

JWKS keys are cached in-process for 10 minutes with a 30-second cooldown on re-fetch.

---

## Data Model

All containers use `/familyId` as the partition key. Every query MUST include a `familyId` filter — this is the primary data isolation boundary.

### `families`

| Field | Type | Description |
|---|---|---|
| `id` | string | GUID — family identifier |
| `familyId` | string | Same as `id` (partition key) |
| `name` | string | Family display name |
| `memberLimit` | number? | Max members (default: 10, overridable by SA) |
| `createdAt` | ISO 8601 | — |

### `users`

| Field | Type | Description |
|---|---|---|
| `id` / `oid` | string | Entra `oid` claim — used as both document ID and lookup key |
| `familyId` | string | Partition key |
| `displayName` | string | — |
| `role` | `User` \| `FamilyAdmin` | Family-scoped role |
| `kidSettings` | object? | Present for kids receiving allowances (see below) |
| `createdAt` / `updatedAt` | ISO 8601 | — |

**`kidSettings` fields:**

| Field | Description |
|---|---|
| `allowanceEnabled` | Whether the scheduler should credit this kid |
| `allowanceAmount` | Amount per cycle (capped at 10,000) |
| `allowanceFrequency` | `Weekly` \| `Bi-weekly` \| `Monthly` |
| `timezone` | IANA timezone string (e.g., `America/Chicago`) |
| `dayOfWeek` / `timeOfDay` | Schedule anchor for weekly/bi-weekly |
| `nextAllowanceDate` | UTC ISO 8601 — next scheduled credit |
| `balanceOverride` / `tithingOwedOverride` | Manual balance floor set by admin |
| `balanceOverrideAt` | Timestamp of last override; only txns after this date are summed live |
| `purgedBalanceDelta` / `purgedTithingOwedDelta` | Accumulated balance from purged transactions |

### `transactions`

| Field | Type | Description |
|---|---|---|
| `id` | GUID | — |
| `familyId` | string | Partition key |
| `kidOid` | string | Target kid's `oid` |
| `category` | `Income` \| `Purchase` \| `Tithing` | — |
| `amount` | number | Positive; capped at 100,000 |
| `date` | ISO 8601 | User-supplied effective date |
| `notes` | string? | Max 500 characters |
| `createdBy` | string | `oid` of the admin who created it |
| `source` | `manual` \| `scheduler` | Origin |
| `createdAt` / `updatedAt` | ISO 8601 | — |

### `auditLog`

Append-only log of all mutations (transaction add/edit/delete, settings changes, balance overrides). Partitioned by `familyId`.

### `inviteCodes`

| Field | Description |
|---|---|
| `id` / `code` | Random alphanumeric code |
| `familyId` | Partition key |
| `role` | Role the redeemer will receive |
| `generatedBy` | `oid` of the generating admin |
| `expiresAt` | ISO 8601 (default: 7 days from creation) |
| `usedByOid` | `null` until redeemed; set atomically via ETag-conditioned replace |

Invite redemption uses Cosmos DB optimistic concurrency (`_etag` + `IfMatch` condition) to prevent a race where two users redeem the same code simultaneously.

---

## Infrastructure

Defined in `infra/` using Bicep, deployed via `azd provision`.

```
infra/
├── main.bicep                # Subscription-scoped root; creates resource group
└── modules/
    ├── staticWebApp.bicep    # Azure Static Web Apps (Free tier)
    ├── functionApp.bicep     # Flex Consumption plan + storage + RBAC assignments
    ├── cosmosDb.bicep        # Serverless Cosmos account + allowance-db + all containers
    └── keyVault.bicep        # Key Vault (RBAC model; Cosmos access now uses MI)
```

### Resource Naming

Resources use a `resourceToken` derived from `uniqueString(subscriptionId, environmentName, location)` to guarantee globally unique names across deployments.

### Managed Identity & RBAC

The Function App uses a system-assigned managed identity. Bicep assigns:

| Resource | Role | Identity |
|---|---|---|
| Cosmos DB | `Cosmos DB Built-in Data Contributor` (SQL role `00000000-…-0002`) | Function App MI |
| Storage Account | `Storage Blob Data Contributor` | Function App MI |
| Key Vault | `Key Vault Secrets User` | Function App MI |

No connection strings or keys are stored in Application Settings. The Cosmos DB client uses `DefaultAzureCredential` in production.

### Environment Variables (Function App)

| Variable | Source | Description |
|---|---|---|
| `COSMOS_DB_ENDPOINT` | Bicep output | Cosmos DB account URL (triggers MI auth path) |
| `EXTERNAL_ID_TENANT_ID` | AZD environment | Entra External ID tenant GUID |
| `EXTERNAL_ID_CLIENT_ID` | AZD environment | App registration client ID |
| `BOOTSTRAP_ADMIN_SECRET` | Manual / Key Vault | Super admin break-glass secret |
| `BOOTSTRAP_ADMIN_ENABLED` | Manual | `true` only when SA access is needed |
| `BOOTSTRAP_JWT_SECRET` | Manual / Key Vault | Signs super admin session JWTs |

### Vite Build-Time Variables (Frontend)

Injected by AZD from Bicep outputs during `azd deploy web`:

| Variable | Value |
|---|---|
| `VITE_CLIENT_ID` | App registration client ID |
| `VITE_TENANT_ID` | Entra External ID tenant GUID |
| `VITE_AUTHORITY` | `https://bleytech.ciamlogin.com/` |
| `VITE_API_URL` | `https://<func-hostname>/api` |

---

## Deployment

Deployments use the [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/):

```
azd provision     # Creates/updates all Azure resources via Bicep
azd deploy        # Builds and deploys both the API and web services
azd up            # provision + deploy in one step
```

`azure.yaml` defines two services:

| Service | Build | Deploy target |
|---|---|---|
| `api` | `tsc` | Azure Functions (zip deploy) |
| `web` | `vite build` | Azure Static Web Apps |

A `postdeploy` hook in `azure.yaml` deletes the local `.env` file after every deployment to prevent accidental exposure of build-time values.

---

## Security Controls Summary

| Control | Implementation |
|---|---|
| Auth Code + PKCE | Enforced by MSAL v2+ for all public client flows |
| Token validation | Server-side JWKS signature + issuer + audience + exp/nbf via `jose` |
| Family data isolation | All Cosmos queries require `familyId` filter; value sourced from server-side lookup only |
| Managed identity | Function App accesses Cosmos DB and Key Vault without stored credentials |
| No secrets in config | `COSMOS_DB_ENDPOINT` replaces connection string; MI provides access |
| Invite code atomicity | ETag-conditioned Cosmos replace prevents concurrent redemption of the same code |
| Rate limiting | Bootstrap auth endpoint: 5 attempts / IP / 15-minute sliding window |
| HTTP security headers | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`, COOP, Referrer-Policy via SWA config |
| Input validation | Amount caps, notes length limit, ISO date validation on all write endpoints |
| Audit log | All mutations written to append-only `auditLog` container |
| Token storage | `sessionStorage` (cleared on tab close); auth state cookies marked `Secure` |
