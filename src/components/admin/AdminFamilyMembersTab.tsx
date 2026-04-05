import { useState, useEffect, useCallback } from 'react'
import type { KidView, KidSettings, AllowanceFrequency, FamilyInviteCode, FamilyMember } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

interface Props {
  kids: KidView[]
  tithingEnabled: boolean
  onUnsavedStatusChange: (hasUnsaved: boolean) => void
  /** Called after settings are successfully saved so parent can re-fetch kidViews */
  onSettingsSaved: () => void
  /** Called after a local member is successfully created so parent re-fetches family */
  onMemberCreated?: () => void
  /** Caller's own family ID — used to call /api/invites */
  familyId: string
  /** Total members in the family (all roles) */
  memberCount: number
  /** Maximum members allowed (from server) */
  memberLimit: number
}

type LocalSettings = KidSettings

const FREQUENCY_OPTIONS: AllowanceFrequency[] = ['Weekly', 'Bi-weekly', 'Monthly']

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const US_TIMEZONES: { label: string; value: string }[] = [
  { label: 'Eastern Time (ET)',               value: 'America/New_York'    },
  { label: 'Central Time (CT)',               value: 'America/Chicago'     },
  { label: 'Mountain Time (MT)',              value: 'America/Denver'      },
  { label: 'Mountain Time – Arizona (no DST)', value: 'America/Phoenix'   },
  { label: 'Pacific Time (PT)',               value: 'America/Los_Angeles' },
  { label: 'Alaska Time (AKT)',               value: 'America/Anchorage'   },
  { label: 'Hawaii Time (HT)',                value: 'Pacific/Honolulu'    },
]

const DEFAULT_SETTINGS: KidSettings = {
  allowanceEnabled: false,
  allowanceAmount: 5,
  allowanceFrequency: 'Weekly',
  dayOfWeek: 5, // Friday
  timeOfDay: '08:00',
  timezone: 'America/Chicago',
  hourlyWagesEnabled: false,
  hourlyWageRate: 10,
}

// ---------------------------------------------------------------------------
// InviteSection — self-contained component. Manages all state + API calls
// for invite code generation and management. Rendered in both the "no kids
// yet" early return and the normal settings layout.
// ---------------------------------------------------------------------------
interface InviteSectionProps {
  memberCount: number
  memberLimit: number
  /** Actual family members — used to show local accounts in the members table */
  members?: FamilyMember[]
  /** Called after a local member is successfully created so parent re-fetches family */
  onMemberCreated?: () => void
}

export function InviteSection({ memberCount, memberLimit, members = [], onMemberCreated }: InviteSectionProps) {
  const { apiFetch } = useApi()

  // ── Add Member wizard ─────────────────────────────────────────────────────
  const [showAddWizard, setShowAddWizard]     = useState(false)
  // 'invite' | 'local' | null — which sub-form is open
  const [wizardMode, setWizardMode]           = useState<'invite' | 'local' | null>(null)
  const [localName, setLocalName]             = useState('')
  const [creatingLocal, setCreatingLocal]     = useState(false)
  const [localError, setLocalError]           = useState<string | null>(null)

  // ── List ─────────────────────────────────────────────────────────────────
  const [invites, setInvites]               = useState<FamilyInviteCode[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)

  // ── Generate form ─────────────────────────────────────────────────────────
  const [inviteRole, setInviteRole]                 = useState<'User' | 'FamilyAdmin'>('User')
  const [inviteNameHint, setInviteNameHint]         = useState('')
  const [inviteEmailAddress, setInviteEmailAddress] = useState('')
  const [generatingInvite, setGeneratingInvite]     = useState(false)
  const [sendingInviteEmail, setSendingInviteEmail] = useState(false)
  const [genError, setGenError]                     = useState<string | null>(null)
  const [newCode, setNewCode]                       = useState<FamilyInviteCode | null>(null)

  // ── Kebab menu ────────────────────────────────────────────────────────────
  const [openMenuCode, setOpenMenuCode] = useState<string | null>(null)

  // ── Show Code modal ───────────────────────────────────────────────────────
  const [showCodeFor, setShowCodeFor] = useState<FamilyInviteCode | null>(null)

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editingInvite, setEditingInvite]   = useState<FamilyInviteCode | null>(null)
  const [editNameHint, setEditNameHint]     = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError]           = useState<string | null>(null)

  // ── Revoke confirmation ───────────────────────────────────────────────────
  const [confirmRevokeCode, setConfirmRevokeCode] = useState<FamilyInviteCode | null>(null)
  const [revokingCode, setRevokingCode]           = useState<string | null>(null)

  // ── Delete confirmation ───────────────────────────────────────────────────
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<FamilyInviteCode | null>(null)
  const [deletingCode, setDeletingCode]         = useState<string | null>(null)

  // ── Regenerate (expired codes) ────────────────────────────────────────────
  const [regeneratingCode, setRegeneratingCode] = useState<string | null>(null)

  // ── Send Email ───────────────────────────────────────────────────────────
  const [emailInvite, setEmailInvite]   = useState<FamilyInviteCode | null>(null)
  const [emailAddress, setEmailAddress] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailError, setEmailError]     = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState(false)

  // ── Enrolled (Entra-backed) member name edit ────────────────────────────
  const [openEnrolledMenu, setOpenEnrolledMenu]             = useState<string | null>(null)
  const [editingEnrolled, setEditingEnrolled]               = useState<FamilyMember | null>(null)
  const [editEnrolledName, setEditEnrolledName]             = useState('')
  const [editEnrolledSubmitting, setEditEnrolledSubmitting] = useState(false)
  const [editEnrolledError, setEditEnrolledError]           = useState<string | null>(null)
  // Delete
  const [deleteEnrolledFor, setDeleteEnrolledFor]           = useState<FamilyMember | null>(null)
  const [deletingEnrolled, setDeletingEnrolled]             = useState<string | null>(null)

  // ── Local member kebab ────────────────────────────────────────────────────
  const [openLocalMenu, setOpenLocalMenu]             = useState<string | null>(null)
  // Edit
  const [editingLocal, setEditingLocal]               = useState<FamilyMember | null>(null)
  const [editLocalName, setEditLocalName]             = useState('')
  const [editLocalSubmitting, setEditLocalSubmitting] = useState(false)
  const [editLocalError, setEditLocalError]           = useState<string | null>(null)
  // Delete confirmation
  const [deleteLocalFor, setDeleteLocalFor]           = useState<FamilyMember | null>(null)
  const [deletingLocal, setDeletingLocal]             = useState<string | null>(null)
  // Link an account — wizard (mirrors Invite account flow)
  const [linkingMember, setLinkingMember]           = useState<FamilyMember | null>(null)
  const [linkRole, setLinkRole]                     = useState<'User' | 'FamilyAdmin'>('User')
  const [linkNameHint, setLinkNameHint]             = useState('')
  const [linkEmailAddress, setLinkEmailAddress]     = useState('')
  const [generatingLinkCode, setGeneratingLinkCode] = useState(false)
  const [sendingLinkEmail, setSendingLinkEmail]     = useState(false)
  const [linkGenError, setLinkGenError]             = useState<string | null>(null)

  const isFamilyFull = memberCount >= memberLimit

  // Load invites
  const loadInvites = useCallback(async () => {
    setInvitesLoading(true)
    try {
      const data = await apiFetch<{ codes: FamilyInviteCode[] }>('invites')
      setInvites(data.codes)
    } catch {
      // non-fatal — invite section will show empty state
    } finally {
      setInvitesLoading(false)
    }
  }, [apiFetch])

  useEffect(() => { loadInvites() }, [loadInvites])

  // Generate invite — returns the created code, or null on error (error stored in genError)
  async function doGenerateInvite(): Promise<FamilyInviteCode | null> {
    setGenError(null)
    try {
      const created = await apiFetch<FamilyInviteCode>('invites', {
        method: 'POST',
        body: JSON.stringify({ role: inviteRole, displayNameHint: inviteNameHint.trim() || undefined }),
      })
      setNewCode(created)
      setInvites(prev => [created, ...prev])
      return created
    } catch (err) {
      const apiErr = err as { body?: { code?: string; message?: string } }
      if (apiErr?.body?.code === 'FAMILY_FULL') {
        setGenError(apiErr.body?.message ?? 'Family is at its member limit.')
      } else {
        setGenError('Failed to generate invite code. Please try again.')
      }
      return null
    }
  }

  // Generate code only (no email)
  async function handleGenerateCodeOnly(e: React.FormEvent) {
    e.preventDefault()
    setGeneratingInvite(true)
    const created = await doGenerateInvite()
    setGeneratingInvite(false)
    if (created) {
      setShowAddWizard(false)
      setInviteNameHint('')
      setInviteEmailAddress('')
    }
  }

  // Generate code then send email
  async function handleSendInviteWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setSendingInviteEmail(true)
    const created = await doGenerateInvite()
    if (!created) { setSendingInviteEmail(false); return }
    try {
      await apiFetch(`invites/${encodeURIComponent(created.code)}/email`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmailAddress.trim() }),
      })
    } catch {
      // Non-fatal — code was created; show it even if email failed
      setGenError('Code generated but the email could not be sent. Share the code manually.')
    } finally {
      setSendingInviteEmail(false)
    }
    setShowAddWizard(false)
    setInviteNameHint('')
    setInviteEmailAddress('')
  }

  // Revoke a pending code (marks it invalid, removes from list)
  async function handleRevokeConfirmed() {
    if (!confirmRevokeCode) return
    const inv = confirmRevokeCode
    setRevokingCode(inv.code)
    setConfirmRevokeCode(null)
    try {
      await apiFetch(`invites/${encodeURIComponent(inv.code)}`, { method: 'DELETE' })
      setInvites(prev => prev.filter(c => c.code !== inv.code))
      if (newCode?.code === inv.code) setNewCode(null)
    } catch {
      // silent — row stays, user can retry
    } finally {
      setRevokingCode(null)
    }
  }

  // Delete any invite record (pending, redeemed, or expired)
  async function handleDeleteConfirmed() {
    if (!deleteConfirmFor) return
    const inv = deleteConfirmFor
    setDeletingCode(inv.code)
    setDeleteConfirmFor(null)
    try {
      await apiFetch(`invites/${encodeURIComponent(inv.code)}`, { method: 'DELETE' })
      setInvites(prev => prev.filter(c => c.code !== inv.code))
      if (newCode?.code === inv.code) setNewCode(null)
    } catch {
      // silent
    } finally {
      setDeletingCode(null)
    }
  }

  // Re-generate a new code with the same role + name hint as an expired one
  async function handleRegenerate(inv: FamilyInviteCode) {
    setRegeneratingCode(inv.code)
    try {
      const created = await apiFetch<FamilyInviteCode>('invites', {
        method: 'POST',
        body: JSON.stringify({ role: inv.role, displayNameHint: inv.displayNameHint || undefined }),
      })
      setNewCode(created)
      setInvites(prev => [created, ...prev])
    } catch {
      // silent — user can retry
    } finally {
      setRegeneratingCode(null)
    }
  }

  // Send invite email
  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!emailInvite) return
    setEmailError(null)
    setSendingEmail(true)
    try {
      await apiFetch(`invites/${encodeURIComponent(emailInvite.code)}/email`, {
        method: 'POST',
        body: JSON.stringify({ email: emailAddress.trim() }),
      })
      setEmailSuccess(true)
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setEmailError(apiErr?.body?.message ?? 'Failed to send email. Please try again.')
    } finally {
      setSendingEmail(false)
    }
  }

  function openEmailModal(inv: FamilyInviteCode) {
    setEmailInvite(inv)
    setEmailAddress('')
    setEmailError(null)
    setEmailSuccess(false)
  }

  // Open edit modal
  function openEdit(inv: FamilyInviteCode) {
    setEditingInvite(inv)
    setEditNameHint(inv.displayNameHint ?? '')
    setEditError(null)
  }

  // Save edited name hint via PATCH
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingInvite) return
    setEditSubmitting(true)
    setEditError(null)
    try {
      const updated = await apiFetch<FamilyInviteCode>(
        `invites/${encodeURIComponent(editingInvite.code)}`,
        { method: 'PATCH', body: JSON.stringify({ displayNameHint: editNameHint.trim() || null }) },
      )
      setInvites(prev => prev.map(c => c.code === updated.code ? updated : c))
      setEditingInvite(null)
    } catch {
      setEditError('Failed to update. Please try again.')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleCreateLocal(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    const name = localName.trim()
    if (!name) { setLocalError('Name is required.'); return }
    if (name.length > 60) { setLocalError('Name must be 60 characters or fewer.'); return }
    setCreatingLocal(true)
    try {
      await apiFetch('local-members', {
        method: 'POST',
        body: JSON.stringify({ displayName: name }),
      })
      setShowAddWizard(false)
      setWizardMode(null)
      setLocalName('')
      onMemberCreated?.()
    } catch (err) {
      const apiErr = err as { body?: { code?: string; message?: string } }
      if (apiErr?.body?.code === 'FAMILY_FULL') {
        setLocalError(apiErr.body?.message ?? 'Family is at its member limit.')
      } else {
        setLocalError('Failed to create local member. Please try again.')
      }
    } finally {
      setCreatingLocal(false)
    }
  }

  // ── Local member edit ─────────────────────────────────────────────────────
  async function handleEditLocalSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingLocal) return
    const name = editLocalName.trim()
    if (!name) { setEditLocalError('Name is required.'); return }
    if (name.length > 60) { setEditLocalError('Name must be 60 characters or fewer.'); return }
    setEditLocalSubmitting(true)
    setEditLocalError(null)
    try {
      await apiFetch(`local-members/${encodeURIComponent(editingLocal.oid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name }),
      })
      setEditingLocal(null)
      onMemberCreated?.() // re-fetch family to reflect new name
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setEditLocalError(apiErr?.body?.message ?? 'Failed to update. Please try again.')
    } finally {
      setEditLocalSubmitting(false)
    }
  }

  // ── Local member delete ───────────────────────────────────────────────────
  async function handleDeleteLocalConfirmed() {
    if (!deleteLocalFor) return
    const m = deleteLocalFor
    setDeletingLocal(m.oid)
    setDeleteLocalFor(null)
    try {
      await apiFetch(`local-members/${encodeURIComponent(m.oid)}`, { method: 'DELETE' })
      onMemberCreated?.() // re-fetch family to remove the row
    } catch {
      // silent — UI will still show the member; user can retry
    } finally {
      setDeletingLocal(null)
    }
  }

  // ── Link an account ───────────────────────────────────────────────────────
  // Generates a special invite code for a local member. When redeemed by an
  // Entra user, their identity is merged onto the local account (settings +
  // transaction history are preserved; the local UUID record is deleted).
  // ── Enrolled member name edit ─────────────────────────────────────────────
  async function handleEditEnrolledSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingEnrolled) return
    const name = editEnrolledName.trim()
    if (!name) { setEditEnrolledError('Name is required.'); return }
    if (name.length > 60) { setEditEnrolledError('Name must be 60 characters or fewer.'); return }
    setEditEnrolledSubmitting(true)
    setEditEnrolledError(null)
    try {
      await apiFetch(`members/${encodeURIComponent(editingEnrolled.oid)}/name`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name }),
      })
      setEditingEnrolled(null)
      onMemberCreated?.() // re-fetch family to reflect new name
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setEditEnrolledError(apiErr?.body?.message ?? 'Failed to update. Please try again.')
    } finally {
      setEditEnrolledSubmitting(false)
    }
  }

  async function handleDeleteEnrolledConfirmed() {
    if (!deleteEnrolledFor) return
    const m = deleteEnrolledFor
    setDeletingEnrolled(m.oid)
    setDeleteEnrolledFor(null)
    try {
      await apiFetch(`members/${encodeURIComponent(m.oid)}`, { method: 'DELETE' })
      onMemberCreated?.() // re-fetch family
    } catch {
      // silent — row stays, user can retry
    } finally {
      setDeletingEnrolled(null)
    }
  }

  function openLinkWizard(m: FamilyMember) {
    setLinkingMember(m)
    setLinkRole('User')
    setLinkNameHint(m.displayName)
    setLinkEmailAddress('')
    setLinkGenError(null)
  }

  async function doGenerateLinkCode(m: FamilyMember): Promise<FamilyInviteCode | null> {
    setLinkGenError(null)
    try {
      const created = await apiFetch<FamilyInviteCode>('invites', {
        method: 'POST',
        body: JSON.stringify({ role: linkRole, displayNameHint: linkNameHint.trim() || m.displayName, localMemberOid: m.oid }),
      })
      setInvites(prev => [created, ...prev])
      setNewCode(created)
      return created
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setLinkGenError(apiErr?.body?.message ?? 'Failed to generate link code. Please try again.')
      return null
    }
  }

  async function handleLinkGenerateCodeOnly(e: React.FormEvent) {
    e.preventDefault()
    if (!linkingMember) return
    setGeneratingLinkCode(true)
    const created = await doGenerateLinkCode(linkingMember)
    setGeneratingLinkCode(false)
    if (created) setLinkingMember(null)
  }

  async function handleLinkSendWithEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!linkingMember) return
    setSendingLinkEmail(true)
    const created = await doGenerateLinkCode(linkingMember)
    if (!created) { setSendingLinkEmail(false); return }
    try {
      await apiFetch(`invites/${encodeURIComponent(created.code)}/email`, {
        method: 'POST',
        body: JSON.stringify({ email: linkEmailAddress.trim() }),
      })
    } catch {
      setLinkGenError('Code generated but the email could not be sent. Share the code manually.')
      setSendingLinkEmail(false)
      return
    }
    setSendingLinkEmail(false)
    setLinkingMember(null)
  }

  return (
    <>
      {/* Invisible overlay — closes kebab menus when clicking outside */}
      {(openMenuCode !== null || openLocalMenu !== null || openEnrolledMenu !== null) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => { setOpenMenuCode(null); setOpenLocalMenu(null); setOpenEnrolledMenu(null) }} />
      )}

      <div className="family-members-invites">
        <div className="sa-section-header">
          <div>
            <h3 className="section-title" style={{ margin: 0 }}>Members</h3>
            <p className="form-hint" style={{ margin: '2px 0 0' }}>
              {memberCount} of {memberLimit} members
              {isFamilyFull && <span className="invite-limit-badge"> · Family is full</span>}
            </p>
          </div>
          {!isFamilyFull && (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => { setShowAddWizard(true); setWizardMode(null); setLocalName(''); setLocalError(null); setGenError(null) }}
            >
              + Add Member
            </button>
          )}
        </div>

        {isFamilyFull && (
          <div className="sa-bootstrap-warning" role="alert" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
            <span className="sa-bootstrap-warning__text">
              This family has reached its member limit of {memberLimit}. A super admin can increase the limit.
            </span>
          </div>
        )}

        {/* Newly generated code — prominent display */}
        {newCode && (
          <div className="sa-invite-new-code">
            <p className="sa-invite-new-code__label">
              {newCode.localMemberOid
                ? `✅ Link invite code — share this with ${newCode.displayNameHint ?? 'the local member'}. When they sign in and enter it, their account will be merged with the existing local account:`
                : `✅ New invite code — share this with ${newCode.displayNameHint ?? 'the recipient'}:`}
            </p>
            <div className="sa-invite-code-display">
              <code className="sa-invite-code-value">{newCode.code}</code>
              <button
                className="btn btn--secondary btn--sm"
                type="button"
                onClick={() => navigator.clipboard.writeText(newCode.code)}
              >
                Copy
              </button>
            </div>
            <p className="sa-invite-new-code__hint">
              Role: <strong>{newCode.role}</strong> · Expires:{' '}
              {new Date(newCode.expiresAt).toLocaleDateString()} · Single use
            </p>
            <button className="sa-link" type="button" style={{ fontSize: '0.8rem' }} onClick={() => setNewCode(null)}>
              Dismiss
            </button>
          </div>
        )}

        {invitesLoading && (
          <div className="sa-loading"><div className="app-loading__spinner" /></div>
        )}

        {!invitesLoading && (invites.length > 0 || members.some(m => m.isLocalAccount)) && (
          <div className="table-wrapper" style={{ marginTop: 8, overflow: 'visible' }}>
            <table className="transactions-table sa-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Name</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* Enrolled (Entra-backed) accounts */}
                {members.filter(m => !m.isLocalAccount).map(m => {
                  const isBusy = deletingEnrolled === m.oid
                  return (
                  <tr key={m.oid}>
                    <td>
                      <span className={`sa-role-badge sa-role-badge--${m.role === 'FamilyAdmin' ? 'admin' : 'user'}`}>
                        {m.role === 'FamilyAdmin' ? 'Family Admin' : 'User'}
                      </span>
                    </td>
                    <td>{m.displayName}</td>
                    <td className="td-date">—</td>
                    <td>
                      <span className="sa-invite-status sa-invite-status--used">Active</span>
                    </td>
                    <td className="td-actions">
                      <div className="kebab-menu">
                        <button
                          className="kebab-btn"
                          onClick={() => setOpenEnrolledMenu(prev => prev === m.oid ? null : m.oid)}
                          disabled={isBusy}
                          aria-label="Actions"
                          aria-expanded={openEnrolledMenu === m.oid}
                        >
                          {isBusy ? '…' : '⋯'}
                        </button>
                        {openEnrolledMenu === m.oid && (
                          <div className="kebab-dropdown" role="menu">
                            <button
                              className="kebab-dropdown__item"
                              role="menuitem"
                              onClick={() => { setOpenEnrolledMenu(null); setEditingEnrolled(m); setEditEnrolledName(m.displayName); setEditEnrolledError(null) }}
                            >
                              Edit
                            </button>
                            <button
                              className="kebab-dropdown__item kebab-dropdown__item--danger"
                              role="menuitem"
                              onClick={() => { setOpenEnrolledMenu(null); setDeleteEnrolledFor(m) }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })}
                {/* Local (no sign-in) accounts */}
                {members.filter(m => m.isLocalAccount).map(m => {
                  const isBusy = deletingLocal === m.oid
                  return (
                    <tr key={m.oid}>
                      <td>
                        <span className="sa-role-badge sa-role-badge--local">Local</span>
                      </td>
                      <td>{m.displayName}</td>
                      <td className="td-date">—</td>
                      <td>
                        <span className="sa-invite-status sa-invite-status--used">Active</span>
                      </td>
                      <td className="td-actions">
                        <div className="kebab-menu">
                          <button
                            className="kebab-btn"
                            onClick={() => setOpenLocalMenu(prev => prev === m.oid ? null : m.oid)}
                            disabled={isBusy}
                            aria-label="Actions"
                            aria-expanded={openLocalMenu === m.oid}
                          >
                            {isBusy ? '…' : '⋯'}
                          </button>
                          {openLocalMenu === m.oid && (
                            <div className="kebab-dropdown" role="menu">
                              <button
                                className="kebab-dropdown__item"
                                role="menuitem"
                                onClick={() => { setOpenLocalMenu(null); setEditingLocal(m); setEditLocalName(m.displayName); setEditLocalError(null) }}
                              >
                                Edit
                              </button>
                              <button
                                className="kebab-dropdown__item"
                                role="menuitem"
                                onClick={() => { setOpenLocalMenu(null); openLinkWizard(m) }}
                              >
                                Link an account
                              </button>
                              <button
                                className="kebab-dropdown__item kebab-dropdown__item--danger"
                                role="menuitem"
                                onClick={() => { setOpenLocalMenu(null); setDeleteLocalFor(m) }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {invites.filter(inv => !inv.used).map(inv => {
                  const isPending = !inv.used && !inv.expired
                  const isBusy    = revokingCode === inv.code || deletingCode === inv.code || regeneratingCode === inv.code
                  const statusLabel = inv.used ? 'Activated' : inv.expired ? 'Expired' : 'Pending'
                  const statusClass = inv.used ? 'used'       : inv.expired ? 'expired'  : 'active'
                  return (
                    <tr key={inv.code}>
                      <td>
                        <span className={`sa-role-badge sa-role-badge--${inv.role === 'FamilyAdmin' ? 'admin' : inv.localMemberOid ? 'link' : 'user'}`}>
                          {inv.role === 'FamilyAdmin' ? 'Family Admin' : 'User'}{inv.localMemberOid ? ' · Link' : ''}
                        </span>
                      </td>
                      <td>{inv.displayNameHint ?? '—'}</td>
                      <td className="td-date">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                      <td>
                        <span className={`sa-invite-status sa-invite-status--${statusClass}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="td-actions">
                        <div className="kebab-menu">
                          <button
                            className="kebab-btn"
                            onClick={() => setOpenMenuCode(prev => prev === inv.code ? null : inv.code)}
                            disabled={isBusy}
                            aria-label="Actions"
                            aria-expanded={openMenuCode === inv.code}
                          >
                            {isBusy ? '…' : '⋯'}
                          </button>
                          {openMenuCode === inv.code && (
                            <div className="kebab-dropdown" role="menu">
                              {isPending && (
                                <>
                                  <button
                                    className="kebab-dropdown__item"
                                    role="menuitem"
                                    onClick={() => { setOpenMenuCode(null); setShowCodeFor(inv) }}
                                  >
                                    Show Code
                                  </button>
                                  <button
                                    className="kebab-dropdown__item"
                                    role="menuitem"
                                    onClick={() => { setOpenMenuCode(null); openEmailModal(inv) }}
                                  >
                                    Send Email
                                  </button>
                                  <button
                                    className="kebab-dropdown__item"
                                    role="menuitem"
                                    onClick={() => { setOpenMenuCode(null); setConfirmRevokeCode(inv) }}
                                  >
                                    Revoke Code
                                  </button>
                                </>
                              )}
                              {inv.expired && (
                                <button
                                  className="kebab-dropdown__item"
                                  role="menuitem"
                                  onClick={() => { setOpenMenuCode(null); handleRegenerate(inv) }}
                                >
                                  Generate New Code
                                </button>
                              )}
                              <button
                                className="kebab-dropdown__item"
                                role="menuitem"
                                onClick={() => { setOpenMenuCode(null); openEdit(inv) }}
                              >
                                Edit
                              </button>
                              <button
                                className="kebab-dropdown__item kebab-dropdown__item--danger"
                                role="menuitem"
                                onClick={() => { setOpenMenuCode(null); setDeleteConfirmFor(inv) }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Show Code modal ──────────────────────────────────────────────────── */}
      {showCodeFor && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="show-code-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="show-code-title">Invite Code</p>
            <div className="sa-dialog__body">
              <p>
                {showCodeFor.displayNameHint
                  ? <>Code for <strong>{showCodeFor.displayNameHint}</strong>:</>
                  : 'Share this code with the recipient:'}
              </p>
              <div className="sa-invite-code-display">
                <code className="sa-invite-code-value">{showCodeFor.code}</code>
                <button
                  className="btn btn--secondary btn--sm"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(showCodeFor.code)}
                >
                  Copy
                </button>
              </div>
              <p>Role: <strong>{showCodeFor.role}</strong> · Expires: {new Date(showCodeFor.expiresAt).toLocaleDateString()} · Single use</p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--primary" onClick={() => setShowCodeFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit name hint modal ─────────────────────────────────────────────── */}
      {editingInvite && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-inv-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="edit-inv-title">Edit Invite</p>
            <form onSubmit={handleEditSubmit}>
              <div className="sa-dialog__body">
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="edit-inv-hint">Name</label>
                  <input
                    id="edit-inv-hint"
                    className="form-input"
                    type="text"
                    placeholder="e.g. Jacob"
                    maxLength={60}
                    value={editNameHint}
                    onChange={e => setEditNameHint(e.target.value)}
                    autoFocus
                  />
                </div>
                {editError && <p className="sa-form-error" role="alert">{editError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setEditingInvite(null)}
                  disabled={editSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={editSubmitting}>
                  {editSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Send Email modal ─────────────────────────────────────────────────────────────────── */}
      {emailInvite && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="send-email-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="send-email-title">Send Invite Email</p>
            {emailSuccess ? (
              <div className="sa-dialog__body">
                <p>✅ Invite email sent to <strong>{emailAddress}</strong>.</p>
              </div>
            ) : (
              <form onSubmit={handleSendEmail}>
                <div className="sa-dialog__body">
                  <p style={{ marginBottom: 12 }}>
                    {emailInvite.localMemberOid
                      ? <>Send the <strong>account link code</strong>{emailInvite.displayNameHint && <> for <strong>{emailInvite.displayNameHint}</strong></>} to an email address. The recipient will use it to link their Microsoft account to the existing local account.</>  
                      : <>Send the invite code{emailInvite.displayNameHint && <> for <strong>{emailInvite.displayNameHint}</strong></>}{' '}to an email address.</>}
                  </p>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="send-email-addr">Email Address</label>
                    <input
                      id="send-email-addr"
                      className="form-input"
                      type="email"
                      placeholder="recipient@example.com"
                      maxLength={254}
                      value={emailAddress}
                      onChange={e => setEmailAddress(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  {emailError && <p className="sa-form-error" role="alert">{emailError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setEmailInvite(null)}
                    disabled={sendingEmail}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={sendingEmail || !emailAddress.trim()}>
                    {sendingEmail ? 'Sending…' : 'Send Email'}
                  </button>
                </div>
              </form>
            )}
            {emailSuccess && (
              <div className="sa-dialog__actions">
                <button className="btn btn--primary" onClick={() => setEmailInvite(null)}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Revoke confirmation ──────────────────────────────────────────────── */}
      {confirmRevokeCode && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Revoke Invite Code?</p>
            <div className="sa-dialog__body">
              <p>
                Revoke the pending invite code
                {confirmRevokeCode.displayNameHint && <> for <strong>{confirmRevokeCode.displayNameHint}</strong></>}?
                {' '}The recipient will no longer be able to use it to join the family.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmRevokeCode(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleRevokeConfirmed}>Revoke</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ──────────────────────────────────────────────── */}
      {deleteConfirmFor && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Delete Invite Record?</p>
            <div className="sa-dialog__body">
              <p>
                Permanently delete this invite record
                {deleteConfirmFor.displayNameHint && <> for <strong>{deleteConfirmFor.displayNameHint}</strong></>}?
                {' '}This cannot be undone.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setDeleteConfirmFor(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDeleteConfirmed}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete enrolled member confirmation ────────────────────────────── */}
      {deleteEnrolledFor && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Remove Member?</p>
            <div className="sa-dialog__body">
              <p>
                Permanently remove <strong>{deleteEnrolledFor.displayName}</strong> from the family?
                {' '}Their allowance history will also be deleted. This cannot be undone.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setDeleteEnrolledFor(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDeleteEnrolledConfirmed}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit enrolled member name modal ─────────────────────────────────── */}
      {editingEnrolled && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-enrolled-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="edit-enrolled-title">Edit Name</p>
            <form onSubmit={handleEditEnrolledSubmit}>
              <div className="sa-dialog__body">
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="edit-enrolled-name">Name</label>
                  <input
                    id="edit-enrolled-name"
                    className="form-input"
                    type="text"
                    maxLength={60}
                    value={editEnrolledName}
                    onChange={e => setEditEnrolledName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                {editEnrolledError && <p className="sa-form-error" role="alert">{editEnrolledError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button type="button" className="btn btn--secondary" onClick={() => setEditingEnrolled(null)} disabled={editEnrolledSubmitting}>Cancel</button>
                <button type="submit" className="btn btn--primary" disabled={editEnrolledSubmitting || !editEnrolledName.trim()}>
                  {editEnrolledSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit local member modal ───────────────────────────────────────────── */}
      {editingLocal && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-local-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="edit-local-title">Edit Local Member</p>
            <form onSubmit={handleEditLocalSubmit}>
              <div className="sa-dialog__body">
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="edit-local-name">Name</label>
                  <input
                    id="edit-local-name"
                    className="form-input"
                    type="text"
                    maxLength={60}
                    value={editLocalName}
                    onChange={e => setEditLocalName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                {editLocalError && <p className="sa-form-error" role="alert">{editLocalError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button type="button" className="btn btn--secondary" onClick={() => setEditingLocal(null)} disabled={editLocalSubmitting}>Cancel</button>
                <button type="submit" className="btn btn--primary" disabled={editLocalSubmitting || !editLocalName.trim()}>
                  {editLocalSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete local member confirmation ─────────────────────────────────── */}
      {deleteLocalFor && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Delete Local Member?</p>
            <div className="sa-dialog__body">
              <p>
                Permanently delete <strong>{deleteLocalFor.displayName}</strong>? Their allowance history will be removed.
                {' '}This cannot be undone.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setDeleteLocalFor(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDeleteLocalConfirmed}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link account wizard ───────────────────────────────────────────────── */}
      {linkingMember && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="link-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="link-wizard-title">
              Link Account for {linkingMember.displayName}
            </p>
            <form onSubmit={handleLinkSendWithEmail}>
              <div className="sa-dialog__body">
                <p className="form-hint" style={{ marginBottom: 12 }}>
                  Generate an invite code for this local account. When redeemed, the person's sign-in will
                  be linked and their balance and transaction history will carry over.
                </p>
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="link-email">Email address</label>
                  <input
                    id="link-email"
                    className="form-input"
                    type="email"
                    placeholder="recipient@example.com"
                    maxLength={254}
                    value={linkEmailAddress}
                    onChange={e => setLinkEmailAddress(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="link-hint">Name (optional)</label>
                  <input
                    id="link-hint"
                    className="form-input"
                    type="text"
                    placeholder="e.g. Jacob"
                    maxLength={60}
                    value={linkNameHint}
                    onChange={e => setLinkNameHint(e.target.value)}
                  />
                </div>
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="link-role">Role</label>
                  <select
                    id="link-role"
                    className="form-select"
                    value={linkRole}
                    onChange={e => setLinkRole(e.target.value as 'User' | 'FamilyAdmin')}
                  >
                    <option value="User">User (kid with allowance)</option>
                    <option value="FamilyAdmin">Family Admin (parent/manager)</option>
                  </select>
                </div>
                {linkGenError && <p className="sa-form-error" role="alert">{linkGenError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setLinkingMember(null)}
                  disabled={generatingLinkCode || sendingLinkEmail}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleLinkGenerateCodeOnly}
                  disabled={generatingLinkCode || sendingLinkEmail}
                >
                  {generatingLinkCode ? 'Generating…' : 'Generate code only'}
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={generatingLinkCode || sendingLinkEmail || !linkEmailAddress.trim()}
                >
                  {sendingLinkEmail ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add Member wizard ─────────────────────────────────────────────────── */}
      {showAddWizard && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="add-member-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="add-member-wizard-title">Add Member</p>

            {/* Step 1: choose type */}
            {wizardMode === null && (
              <div className="sa-dialog__body">
                <div className="add-member-wizard">
                  <button
                    className="add-member-wizard__option"
                    onClick={() => { setWizardMode('invite'); setInviteNameHint(''); setInviteEmailAddress(''); setGenError(null) }}
                  >
                    <span className="add-member-wizard__option-title">Invite account</span>
                    <span className="add-member-wizard__option-desc">
                      Generate an invite code the person can use to sign in and see their own account information.
                    </span>
                  </button>
                  <button
                    className="add-member-wizard__option"
                    onClick={() => setWizardMode('local')}
                  >
                    <span className="add-member-wizard__option-title">Create local account</span>
                    <span className="add-member-wizard__option-desc">
                      Create a member that only you can manage. They won't have a sign-in or see their own account.
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 2a: invite account form */}
            {wizardMode === 'invite' && (
              <form onSubmit={handleSendInviteWithEmail}>
                <div className="sa-dialog__body">
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="finv-email">Email address</label>
                    <input
                      id="finv-email"
                      className="form-input"
                      type="email"
                      placeholder="recipient@example.com"
                      maxLength={254}
                      value={inviteEmailAddress}
                      onChange={e => setInviteEmailAddress(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="finv-hint">Name (optional)</label>
                    <input
                      id="finv-hint"
                      className="form-input"
                      type="text"
                      placeholder="e.g. Jacob"
                      maxLength={60}
                      value={inviteNameHint}
                      onChange={e => setInviteNameHint(e.target.value)}
                    />
                  </div>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="finv-role">Role</label>
                    <select
                      id="finv-role"
                      className="form-select"
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as 'User' | 'FamilyAdmin')}
                    >
                      <option value="User">User (kid with allowance)</option>
                      <option value="FamilyAdmin">Family Admin (parent/manager)</option>
                    </select>
                  </div>
                  {genError && <p className="sa-form-error" role="alert">{genError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setWizardMode(null)}
                    disabled={generatingInvite || sendingInviteEmail}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={handleGenerateCodeOnly}
                    disabled={generatingInvite || sendingInviteEmail}
                  >
                    {generatingInvite ? 'Generating…' : 'Generate code only'}
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={generatingInvite || sendingInviteEmail || !inviteEmailAddress.trim()}
                  >
                    {sendingInviteEmail ? 'Sending…' : 'Send invite'}
                  </button>
                </div>
              </form>
            )}

            {/* Step 2b: local account form */}
            {wizardMode === 'local' && (
              <form onSubmit={handleCreateLocal}>
                <div className="sa-dialog__body">
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="local-member-name">Name</label>
                    <input
                      id="local-member-name"
                      className="form-input"
                      type="text"
                      placeholder="e.g. Emma"
                      maxLength={60}
                      value={localName}
                      onChange={e => setLocalName(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  {localError && <p className="sa-form-error" role="alert">{localError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button type="button" className="btn btn--secondary" onClick={() => setWizardMode(null)} disabled={creatingLocal}>Back</button>
                  <button type="submit" className="btn btn--primary" disabled={creatingLocal || !localName.trim()}>
                    {creatingLocal ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            )}

            {wizardMode === null && (
              <div className="sa-dialog__actions">
                <button className="btn btn--secondary" onClick={() => setShowAddWizard(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Returns the next upcoming date (from today) that falls on `dayIndex` (0=Sun … 6=Sat).
// If today is that day, returns next week.
function getNextDayOccurrence(dayIndex: number, offsetWeeks = 0): Date {
  const today    = new Date()
  const todayDay = today.getDay()
  let daysUntil  = dayIndex - todayDay
  if (daysUntil <= 0) daysUntil += 7
  const result = new Date(today)
  result.setDate(today.getDate() + daysUntil + offsetWeeks * 7)
  return result
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function format12h(time24: string): string {
  const [hStr, mStr] = time24.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12  = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

function settingsEqual(a: LocalSettings, b: LocalSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Whether saving these settings should trigger the bi-weekly start dialog
function needsBiweeklyStartDialog(edited: LocalSettings, saved: LocalSettings): boolean {
  if (edited.allowanceFrequency !== 'Bi-weekly') return false
  // Show if frequency changed to bi-weekly, or if the day of week changed while bi-weekly
  return saved.allowanceFrequency !== 'Bi-weekly' || edited.dayOfWeek !== saved.dayOfWeek
}

export default function AdminFamilyMembersTab({ kids, tithingEnabled, onUnsavedStatusChange, onSettingsSaved, onMemberCreated, familyId, memberCount, memberLimit }: Props) {
  const [selectedId, setSelectedId]     = useState<string>(() => kids[0]?.oid ?? '')
  const [pendingKidId, setPendingKidId] = useState<string | null>(null)

  const [savedPerKid, setSavedPerKid] = useState<Record<string, LocalSettings>>(() =>
    Object.fromEntries(kids.map(k => [k.oid, { ...(k.kidSettings ?? DEFAULT_SETTINGS) }]))
  )

  const [edited, setEdited] = useState<LocalSettings>(() => ({
    ...(kids[0]?.kidSettings ?? DEFAULT_SETTINGS),
  }))

  // Bi-weekly start dialog state
  const [showBiweeklyDialog, setShowBiweeklyDialog] = useState(false)

  // Save state
  const { apiFetch } = useApi()
  const [isSaving, setIsSaving]     = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)

  // Edit Balance state
  const [editBalanceKid, setEditBalanceKid]       = useState<string | null>(null)
  const [editBalanceValue, setEditBalanceValue]   = useState('')
  const [editTithingValue, setEditTithingValue]   = useState('')
  const [editBalanceSubmitting, setEditBalanceSubmitting] = useState(false)
  const [editBalanceError, setEditBalanceError]   = useState<string | null>(null)

  function openEditBalance(kidOid: string) {
    const k = kids.find(kk => kk.oid === kidOid)
    setEditBalanceValue(String(k?.balance ?? 0))
    setEditTithingValue(String(k?.tithingOwed ?? 0))
    setEditBalanceError(null)
    setEditBalanceKid(kidOid)
  }

  async function handleEditBalanceSave() {
    if (!editBalanceKid) return
    const balance = parseFloat(editBalanceValue)
    const tithingOwed = parseFloat(editTithingValue)
    if (isNaN(balance)) {
      setEditBalanceError('Available balance must be a number.')
      return
    }
    if (isNaN(tithingOwed) || tithingOwed < 0) {
      setEditBalanceError('Tithing owed must be a non-negative number.')
      return
    }
    setEditBalanceSubmitting(true)
    setEditBalanceError(null)
    try {
      const result = await apiFetch('balance-override', {
        method: 'PATCH',
        body: JSON.stringify({ kidOid: editBalanceKid, balance, tithingOwed }),
      }) as { balanceOverride: number; tithingOwedOverride: number; balanceOverrideAt: string }
      // Propagate override fields so savedPerKid stays in sync (used for display)
      setSavedPerKid(prev => ({
        ...prev,
        [editBalanceKid]: {
          ...(prev[editBalanceKid] ?? DEFAULT_SETTINGS),
          balanceOverride:    result.balanceOverride,
          tithingOwedOverride: result.tithingOwedOverride,
          balanceOverrideAt:  result.balanceOverrideAt,
        },
      }))
      setEditBalanceKid(null)
      onSettingsSaved() // re-fetch family so kid.balance reflects the new override
    } catch {
      setEditBalanceError('Failed to save. Please try again.')
    } finally {
      setEditBalanceSubmitting(false)
    }
  }

  const currentSaved = savedPerKid[selectedId] ?? DEFAULT_SETTINGS
  const hasUnsaved   = !settingsEqual(edited, currentSaved)

  useEffect(() => {
    onUnsavedStatusChange(hasUnsaved)
  }, [hasUnsaved, onUnsavedStatusChange])

  function doSelectKid(id: string) {
    setSelectedId(id)
    const k = kids.find(k => k.oid === id)
    setEdited({ ...(savedPerKid[id] ?? k?.kidSettings ?? DEFAULT_SETTINGS) })
    setPendingKidId(null)
  }

  function handleKidClick(id: string) {
    if (id === selectedId) return
    if (hasUnsaved) {
      setPendingKidId(id)
    } else {
      doSelectKid(id)
    }
  }

  function handleDiscardAndSwitch() {
    if (pendingKidId) doSelectKid(pendingKidId)
  }

  async function commitSave(biweeklyStartDate?: string) {
    const settingsToSave: KidSettings = biweeklyStartDate
      ? { ...edited, biweeklyStartDate }
      : { ...edited }
    setIsSaving(true)
    setSaveError(null)
    try {
      const result = await apiFetch<{ user: { oid: string; displayName: string; role: string; kidSettings: KidSettings } }>('settings', {
        method: 'PATCH',
        body: JSON.stringify({ kidOid: selectedId, kidSettings: settingsToSave }),
      })
      // Use the server's response to sync local state — the server may have computed
      // nextAllowanceDate (or preserved the scheduler's date) which the client doesn't know.
      const savedSettings = result.user.kidSettings
      setSavedPerKid(prev => ({ ...prev, [selectedId]: savedSettings }))
      setEdited({ ...savedSettings })
      setShowBiweeklyDialog(false)
      onSettingsSaved()
    } catch {
      setSaveError('Failed to save settings. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveClick() {
    if (needsBiweeklyStartDialog(edited, currentSaved)) {
      setShowBiweeklyDialog(true)
    } else {
      await commitSave()
    }
  }

  function updateField<K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) {
    setEdited(prev => ({ ...prev, [key]: value }))
  }

  const kid         = kids.find(k => k.oid === selectedId)
  const showDayTime = edited.allowanceEnabled &&
    (edited.allowanceFrequency === 'Weekly' || edited.allowanceFrequency === 'Bi-weekly')

  const dayIndex = edited.dayOfWeek ?? 0

  // Dates for bi-weekly start dialog
  const nextOccurrence      = getNextDayOccurrence(dayIndex, 0)
  const followingOccurrence = getNextDayOccurrence(dayIndex, 1)
  const tzLabel = US_TIMEZONES.find(t => t.value === edited.timezone)?.label ?? edited.timezone

  if (!kid) {
    return (
      <div className="family-members-layout">
        <p style={{ marginBottom: 24 }}>No kids enrolled yet. Use the Settings tab to invite members.</p>
      </div>
    )
  }

  return (
    <div className="family-members-layout">

      {/* Left panel — kid list (desktop); hidden on mobile in favour of the dropdown */}
      <div className="kid-list">
        {kids.map(k => (
          <button
            key={k.oid}
            className={`kid-list__item${selectedId === k.oid ? ' kid-list__item--active' : ''}`}
            onClick={() => handleKidClick(k.oid)}
          >
            <span className="kid-list__avatar">{k.displayName.charAt(0)}</span>
            <span className="kid-list__info">
              <span className="kid-list__name">{k.displayName}</span>
            </span>
            {selectedId === k.oid && hasUnsaved && (
              <span className="kid-list__unsaved-dot" title="Unsaved changes" />
            )}
          </button>
        ))}
      </div>

      {/* Mobile kid picker — dropdown replaces the sidebar on small screens */}
      <select
        className="kid-selector-mobile"
        value={selectedId}
        onChange={e => handleKidClick(e.target.value)}
        aria-label="Select family member"
      >
        {kids.map(k => (
          <option key={k.oid} value={k.oid}>{k.displayName}</option>
        ))}
      </select>

      {/* Right panel — settings form */}
      <div className="kid-settings-panel">

        {/* Unsaved changes confirmation (when switching kids) */}
        {pendingKidId && (
          <div className="unsaved-inline-banner" role="alert">
            <p className="unsaved-inline-banner__text">
              <strong>Unsaved changes</strong> — switching to {kids.find(k => k.oid === pendingKidId)?.displayName} will discard your edits for {kid.displayName}.
            </p>
            <div className="unsaved-inline-banner__actions">
              <button className="btn btn--secondary btn--sm" onClick={() => setPendingKidId(null)}>
                Keep Editing
              </button>
              <button className="btn btn--danger btn--sm" onClick={handleDiscardAndSwitch}>
                Discard &amp; Switch
              </button>
            </div>
          </div>
        )}

        <div className="settings-form">
          <div className="settings-form__header">
            <h3 className="settings-form__title">{kid.displayName}&apos;s Settings</h3>
            {hasUnsaved && <span className="unsaved-badge">Unsaved changes</span>}
          </div>

          {/* Automatic Allowance toggle */}
          <div className="form-field">
            <div className="form-toggle-row">
              <div>
                <span className="form-label">Automatic Allowance</span>
                <p className="form-hint">Automatically deposit allowance on a schedule.</p>
              </div>
              <label className="toggle-switch" aria-label="Toggle automatic allowance">
                <input
                  type="checkbox"
                  checked={edited.allowanceEnabled}
                  onChange={e => updateField('allowanceEnabled', e.target.checked)}
                />
                <span className="toggle-switch__track" />
              </label>
            </div>
          </div>

          {/* Allowance sub-fields */}
          {edited.allowanceEnabled && (
            <div className="allowance-sub-fields">

              {/* Amount */}
              <div className="form-field">
                <label className="form-label" htmlFor="allowance-amount">Allowance Amount</label>
                <div className="amount-input-wrapper amount-input-wrapper--sm">
                  <span className="amount-input-prefix">$</span>
                  <input
                    id="allowance-amount"
                    className="amount-input amount-input--sm"
                    type="number"
                    min="0"
                    step="0.50"
                    value={edited.allowanceAmount}
                    onChange={e => updateField('allowanceAmount', parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Frequency */}
              <div className="form-field">
                <label className="form-label" htmlFor="allowance-freq">Frequency</label>
                <select
                  id="allowance-freq"
                  className="form-select"
                  value={edited.allowanceFrequency}
                  onChange={e => updateField('allowanceFrequency', e.target.value as AllowanceFrequency)}
                >
                  {FREQUENCY_OPTIONS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              {/* Day of week — Weekly / Bi-weekly only */}
              {showDayTime && (
                <>
                  <div className="form-field">
                    <label className="form-label" htmlFor="allowance-day">Day of the Week</label>
                    <p className="form-hint">Which day the deposit will occur.</p>
                    <select
                      id="allowance-day"
                      className="form-select"
                      value={dayIndex}
                      onChange={e => updateField('dayOfWeek', parseInt(e.target.value, 10))}
                    >
                      {DAYS_OF_WEEK.map((d, i) => (
                        <option key={d} value={i}>{d}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Monthly fixed-date notice */}
              {edited.allowanceFrequency === 'Monthly' && (
                <div className="form-field">
                  <div className="monthly-notice">
                    <span className="monthly-notice__icon">📅</span>
                    <p className="monthly-notice__text">
                      Monthly allowances always deposit on the <strong>1st of each month</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Time + timezone — all frequencies */}
              {edited.allowanceEnabled && (
                  <div className="form-field form-field--row">
                    <div className="form-field-sub">
                      <label className="form-label" htmlFor="allowance-time">Time of Day</label>
                      <input
                        id="allowance-time"
                        className="form-select"
                        type="time"
                        value={edited.timeOfDay ?? '08:00'}
                        onChange={e => updateField('timeOfDay', e.target.value)}
                      />
                    </div>
                    <div className="form-field-sub form-field-sub--grow">
                      <label className="form-label" htmlFor="allowance-tz">Timezone</label>
                      <select
                        id="allowance-tz"
                        className="form-select form-select--full"
                        value={edited.timezone}
                        onChange={e => updateField('timezone', e.target.value)}
                      >
                        {US_TIMEZONES.map(tz => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
              )}

            </div>
          )}

          {/* Hourly Wages */}
          <div className="form-field">
            <div className="form-toggle-row">
              <div>
                <span className="form-label">Hourly Wages</span>
                <p className="form-hint">Allow recording hours worked instead of a flat amount for income transactions.</p>
              </div>
              <label className="toggle-switch" aria-label="Toggle hourly wages">
                <input
                  type="checkbox"
                  checked={edited.hourlyWagesEnabled ?? false}
                  onChange={e => updateField('hourlyWagesEnabled', e.target.checked)}
                />
                <span className="toggle-switch__track" />
              </label>
            </div>
          </div>

          {edited.hourlyWagesEnabled && (
            <div className="allowance-sub-fields">
              <div className="form-field">
                <label className="form-label" htmlFor="hourly-wage-rate">Hourly Wage Rate</label>
                <div className="amount-input-wrapper amount-input-wrapper--sm">
                  <span className="amount-input-prefix">$</span>
                  <input
                    id="hourly-wage-rate"
                    className="amount-input amount-input--sm"
                    type="number"
                    min="0"
                    step="0.25"
                    value={edited.hourlyWageRate ?? 10}
                    onChange={e => updateField('hourlyWageRate', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <p className="form-hint" style={{ marginTop: 4 }}>per hour</p>
              </div>
            </div>
          )}

          {/* Edit Balance */}
          <div className="edit-balance-section">
            <div className="edit-balance-section__header">
              <h4 className="edit-balance-section__title">Balance Override</h4>
              {savedPerKid[selectedId]?.balanceOverrideAt && (
                <span className="edit-balance-section__meta">
                  Last set {new Date(savedPerKid[selectedId]!.balanceOverrideAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
            <p className="form-hint" style={{ marginBottom: 12 }}>
              Manually correct {kid.displayName}&apos;s balance and tithing owed. Future transactions apply on top of these values.
            </p>

            {editBalanceKid === selectedId ? (
              <div className="edit-balance-form">
                <div className="edit-balance-form__fields">
                  <div className="edit-balance-form__field">
                    <label className="form-label" htmlFor="edit-balance">Available Balance</label>
                    <div className="amount-input-wrapper amount-input-wrapper--sm">
                      <span className="amount-input-prefix">$</span>
                      <input
                        id="edit-balance"
                        className="amount-input amount-input--sm"
                        type="number"
                        step="0.01"
                        value={editBalanceValue}
                        onChange={e => setEditBalanceValue(e.target.value)}
                        autoFocus
                      />
                    </div>
                  </div>
                  {tithingEnabled && (
                  <div className="edit-balance-form__field">
                    <label className="form-label" htmlFor="edit-tithing">Tithing Owed</label>
                    <div className="amount-input-wrapper amount-input-wrapper--sm">
                      <span className="amount-input-prefix">$</span>
                      <input
                        id="edit-tithing"
                        className="amount-input amount-input--sm"
                        type="number"
                        min="0"
                        step="0.01"
                        value={editTithingValue}
                        onChange={e => setEditTithingValue(e.target.value)}
                      />
                    </div>
                  </div>
                  )}
                </div>
                {editBalanceError && (
                  <p className="sa-form-error" role="alert" style={{ marginBottom: 8 }}>{editBalanceError}</p>
                )}
                <div className="edit-balance-form__actions">
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => setEditBalanceKid(null)}
                    disabled={editBalanceSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={handleEditBalanceSave}
                    disabled={editBalanceSubmitting}
                  >
                    {editBalanceSubmitting ? 'Saving…' : 'Save Balance'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => openEditBalance(selectedId)}
              >
                Edit Balance
              </button>
            )}
          </div>

          {/* Save button */}
          <div className="settings-form__footer">
            {saveError && <p className="sa-form-error" role="alert" style={{ marginBottom: 8 }}>{saveError}</p>}
            <button
              className="btn btn--primary"
              onClick={handleSaveClick}
              disabled={!hasUnsaved || isSaving}
            >
              {isSaving ? 'Saving…' : hasUnsaved ? 'Save Changes' : 'Saved ✓'}
            </button>
          </div>

        </div>
      </div>

      {/* Bi-weekly start date dialog */}
      {showBiweeklyDialog && (
        <div className="unsaved-nav-overlay" role="dialog" aria-modal="true" aria-label="Choose first deposit date">
          <div className="biweekly-start-dialog">
            <p className="biweekly-start-dialog__title">When should the first deposit happen?</p>
            <p className="biweekly-start-dialog__body">
              {kid.displayName}&apos;s allowance is set to deposit every other{' '}
              <strong>{DAYS_OF_WEEK[dayIndex]}</strong> at{' '}
              <strong>{format12h(edited.timeOfDay ?? '08:00')}</strong>{' '}
              <strong>({tzLabel})</strong>.
              After the first deposit, it will repeat every two weeks.
            </p>
            <div className="biweekly-start-options">
              <button
                className="biweekly-start-option"
                onClick={() => commitSave(nextOccurrence.toISOString())}
              >
                <span className="biweekly-start-option__label">Next occurrence</span>
                <span className="biweekly-start-option__date">{formatDateLong(nextOccurrence)}</span>
              </button>
              <button
                className="biweekly-start-option"
                onClick={() => commitSave(followingOccurrence.toISOString())}
              >
                <span className="biweekly-start-option__label">Following week</span>
                <span className="biweekly-start-option__date">{formatDateLong(followingOccurrence)}</span>
              </button>
            </div>
            <button
              className="btn btn--secondary btn--sm biweekly-start-dialog__cancel"
              onClick={() => setShowBiweeklyDialog(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}


    </div>
  )
}
