import { useMsal } from '@azure/msal-react'

// ---------------------------------------------------------------------------
// useAppRole — reads the `roles` claim from the active account's id-token claims
//
// Roles are injected by Entra when an app role is assigned to the user in the
// "Enterprise applications" blade.  They appear as string[] in idTokenClaims.
//
// Security: we only trust claims from the active MSAL account.  The API
// independently validates the token and roles claim server-side—this hook is
// UI-only and must NOT be used as the sole security gate.
// ---------------------------------------------------------------------------

export type AppRole = 'SuperAdmin'

export function useAppRoles(): AppRole[] {
  const { accounts } = useMsal()
  const active = accounts[0]
  if (!active) return []

  // idTokenClaims is typed as object | undefined; cast safely
  const claims = active.idTokenClaims as Record<string, unknown> | undefined
  const roles = claims?.['roles']

  if (!Array.isArray(roles)) return []

  // Filter to only known roles so unexpected role strings don't leak through
  return roles.filter((r): r is AppRole => r === 'SuperAdmin')
}

/** Convenience: returns true if the user has the SuperAdmin app role */
export function useIsSuperAdmin(): boolean {
  return useAppRoles().includes('SuperAdmin')
}
