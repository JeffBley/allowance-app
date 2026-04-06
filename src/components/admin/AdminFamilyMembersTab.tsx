import { useState, useEffect, useRef } from 'react'
import type { KidView, KidSettings, AllowanceFrequency, FamilyInviteCode, FamilyMember } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

interface Props {
  kids: KidView[]
  members: FamilyMember[]
  /** Active (unused, non-expired) invite codes for this family */
  pendingInvites: FamilyInviteCode[]
  tithingEnabled: boolean
  onUnsavedStatusChange: (hasUnsaved: boolean) => void
  /** Called after settings are successfully saved so parent can re-fetch kidViews */
  onSettingsSaved: () => void
  /** Called after a local member is successfully created so parent re-fetches family */
  onMemberCreated?: () => void
  /** Called after an invite is created, edited, or revoked so parent re-fetches invites */
  onRefreshInvites?: () => void
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
  /** Called after a local member is successfully created so parent re-fetches family */
  onMemberCreated?: () => void
  /** Called after an invite code is successfully generated so parent re-fetches invites */
  onInviteCreated?: () => void
}

export function InviteSection({ memberCount, memberLimit, onMemberCreated, onInviteCreated }: InviteSectionProps) {
  const { apiFetch } = useApi()

  // ── Add Member wizard ─────────────────────────────────────────────────────
  const [showAddWizard, setShowAddWizard]     = useState(false)
  // 'invite' | 'local' | null — which sub-form is open
  const [wizardMode, setWizardMode]           = useState<'invite' | 'local' | null>(null)
  const [localName, setLocalName]             = useState('')
  const [creatingLocal, setCreatingLocal]     = useState(false)
  const [localError, setLocalError]           = useState<string | null>(null)

  // ── Generate form ─────────────────────────────────────────────────────────
  const [inviteRole, setInviteRole]                 = useState<'User' | 'FamilyAdmin'>('User')
  const [inviteNameHint, setInviteNameHint]         = useState('')
  const [inviteEmailAddress, setInviteEmailAddress] = useState('')
  const [generatingInvite, setGeneratingInvite]     = useState(false)
  const [sendingInviteEmail, setSendingInviteEmail] = useState(false)
  const [genError, setGenError]                     = useState<string | null>(null)
  const [newCode, setNewCode]                       = useState<FamilyInviteCode | null>(null)

  const isFamilyFull = memberCount >= memberLimit

  // Generate invite — returns the created code, or null on error (error stored in genError)
  async function doGenerateInvite(): Promise<FamilyInviteCode | null> {
    setGenError(null)
    try {
      const created = await apiFetch<FamilyInviteCode>('invites', {
        method: 'POST',
        body: JSON.stringify({ role: inviteRole, displayNameHint: inviteNameHint.trim() || undefined }),
      })
      setNewCode(created)
      onInviteCreated?.()
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
    const emailTrimmed = inviteEmailAddress.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setGenError('That email address doesn’t look right — please double-check it and try again.')
      return
    }
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
      setShowAddWizard(false)
      setInviteNameHint('')
      setInviteEmailAddress('')
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

  return (
    <>
      {/* Newly generated code — shown below the member list */}
      {newCode && (
        <div className="sa-invite-new-code" style={{ margin: '8px 0 0' }}>
          <p className="sa-invite-new-code__label">
            ✅ New code for {newCode.displayNameHint ?? 'member'}:
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

      {isFamilyFull ? (
        <div className="kid-list__add-footer">
          <p className="form-hint" style={{ margin: 0, fontSize: '0.8rem' }}>
            Family is at its limit of {memberLimit}. A super admin can increase the limit.
          </p>
        </div>
      ) : (
        <div className="kid-list__add-footer">
          <button
            className="btn btn--secondary btn--sm"
            style={{ width: '100%' }}
            onClick={() => { setShowAddWizard(true); setWizardMode(null); setLocalName(''); setLocalError(null); setGenError(null) }}
          >
            + Add Member
          </button>
        </div>
      )}

      {/* ── Add Member wizard ─────────────────────────────────────────────────── */}
      {showAddWizard && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="add-member-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="add-member-wizard-title">Add Member</p>

            {wizardMode === null && (
              <div className="sa-dialog__body">
                <p style={{ marginBottom: '16px', fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Do you want this person to have their own sign-in?
                </p>
                <div className="add-member-wizard">
                  <button
                    className="add-member-wizard__option"
                    onClick={() => { setWizardMode('invite'); setInviteNameHint(''); setInviteEmailAddress(''); setGenError(null) }}
                  >
                    <span className="add-member-wizard__option-title">Yes</span>
                    <span className="add-member-wizard__option-desc">
                      Send them an invite so they can sign in and see their own account.
                    </span>
                  </button>
                  <button
                    className="add-member-wizard__option"
                    onClick={() => setWizardMode('local')}
                  >
                    <span className="add-member-wizard__option-title">No</span>
                    <span className="add-member-wizard__option-desc">
                      Create a member that only you manage. They won't have a sign-in.
                    </span>
                  </button>
                </div>
              </div>
            )}

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

export default function AdminFamilyMembersTab({ kids, members, pendingInvites, tithingEnabled, onUnsavedStatusChange, onSettingsSaved, onMemberCreated, onRefreshInvites, familyId, memberCount, memberLimit }: Props) {
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

  // ── Rearrange members ─────────────────────────────────────────────────────
  const [rearrangeMode, setRearrangeMode]     = useState(false)
  const [reorderList, setReorderList]         = useState<FamilyMember[]>([])
  const [isSavingOrder, setIsSavingOrder]     = useState(false)
  const [saveOrderError, setSaveOrderError]   = useState<string | null>(null)
  const dragSourceRef = useRef<number | null>(null)

  // Edit Balance state
  const [editBalanceKid, setEditBalanceKid]       = useState<string | null>(null)
  const [editBalanceValue, setEditBalanceValue]   = useState('')
  const [editTithingValue, setEditTithingValue]   = useState('')
  const [editBalanceSubmitting, setEditBalanceSubmitting] = useState(false)
  const [editBalanceError, setEditBalanceError]   = useState<string | null>(null)

  // ── Member edit / delete state ─────────────────────────────────────────────
  const [editingEnrolled, setEditingEnrolled]               = useState<FamilyMember | null>(null)
  const [editEnrolledName, setEditEnrolledName]             = useState('')
  const [editEnrolledSubmitting, setEditEnrolledSubmitting] = useState(false)
  const [editEnrolledError, setEditEnrolledError]           = useState<string | null>(null)
  const [deleteEnrolledFor, setDeleteEnrolledFor]           = useState<FamilyMember | null>(null)
  const [deletingEnrolled, setDeletingEnrolled]             = useState<string | null>(null)
  const [editingLocal, setEditingLocal]                     = useState<FamilyMember | null>(null)
  const [editLocalName, setEditLocalName]                   = useState('')
  const [editLocalSubmitting, setEditLocalSubmitting]       = useState(false)
  const [editLocalError, setEditLocalError]                 = useState<string | null>(null)
  const [deleteLocalFor, setDeleteLocalFor]                 = useState<FamilyMember | null>(null)
  const [deletingLocal, setDeletingLocal]                   = useState<string | null>(null)

  // ── Ellipsis context menu ─────────────────────────────────────────────────
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  function openMenu(oid: string, btn: HTMLButtonElement) {
    if (openMenuFor === oid) { setOpenMenuFor(null); setMenuPos(null); return }
    const r = btn.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    setOpenMenuFor(oid)
  }

  function closeMenu() {
    setOpenMenuFor(null)
    setMenuPos(null)
  }

  // ── Link account flow ─────────────────────────────────────────────────────
  const [linkAccountFor, setLinkAccountFor]       = useState<FamilyMember | null>(null)
  const [linkCode, setLinkCode]                   = useState<FamilyInviteCode | null>(null)
  const [linkGenerating, setLinkGenerating]       = useState(false)
  const [linkError, setLinkError]                 = useState<string | null>(null)
  const [linkEmail, setLinkEmail]                 = useState('')
  const [linkSendingEmail, setLinkSendingEmail]   = useState(false)

  async function handleOpenLinkAccount(m: FamilyMember) {
    setOpenMenuFor(null)
    setLinkAccountFor(m)
    setLinkCode(null)
    setLinkError(null)
    setLinkEmail('')
    setLinkGenerating(true)
    try {
      const created = await apiFetch<FamilyInviteCode>('invites', {
        method: 'POST',
        body: JSON.stringify({ role: m.role, displayNameHint: m.displayName, localMemberOid: m.oid }),
      })
      setLinkCode(created)
    } catch (err) {
      const apiErr = err as { body?: { code?: string; message?: string } }
      setLinkError(apiErr?.body?.message ?? 'Failed to generate link code. Please try again.')
    } finally {
      setLinkGenerating(false)
    }
  }

  async function handleLinkSendEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!linkCode || !linkEmail.trim()) return
    setLinkSendingEmail(true)
    setLinkError(null)
    try {
      await apiFetch(`invites/${encodeURIComponent(linkCode.code)}/email`, {
        method: 'POST',
        body: JSON.stringify({ email: linkEmail.trim() }),
      })
      setLinkAccountFor(null)
      setLinkCode(null)
    } catch {
      setLinkError('Code generated but the email could not be sent. Share the code manually.')
    } finally {
      setLinkSendingEmail(false)
    }
  }
  const [selectedAdminOid, setSelectedAdminOid] = useState<string | null>(null)
  const selectedAdmin = members.find(m => m.oid === selectedAdminOid) ?? null

  function handleAdminClick(oid: string) {
    setSelectedAdminOid(oid)
    setSelectedId('')          // deselect any kid
    setSelectedInviteCode(null)
  }

  const [selectedInviteCode, setSelectedInviteCode] = useState<string | null>(null)
  const selectedInvite = pendingInvites.find(i => i.code === selectedInviteCode) ?? null
  const [editedInviteName, setEditedInviteName]           = useState('')
  const [editedInviteRole, setEditedInviteRole]           = useState<'User' | 'FamilyAdmin'>('User')
  const [editedInviteSettings, setEditedInviteSettings]   = useState<LocalSettings>({ ...DEFAULT_SETTINGS })
  const [inviteHasUnsaved, setInviteHasUnsaved]           = useState(false)
  const [inviteSaving, setInviteSaving]                   = useState(false)
  const [inviteSaveError, setInviteSaveError]             = useState<string | null>(null)
  const [deleteInviteFor, setDeleteInviteFor]             = useState<FamilyInviteCode | null>(null)
  const [deletingInvite, setDeletingInvite]               = useState<string | null>(null)

  function handleSelectInvite(code: string) {
    if (code === selectedInviteCode) return
    const invite = pendingInvites.find(i => i.code === code)
    if (!invite) return
    setSelectedInviteCode(code)
    setSelectedId('')          // deselect any kid
    setSelectedAdminOid(null)  // deselect any admin
    setEditedInviteName(invite.displayNameHint ?? '')
    setEditedInviteRole(invite.role)
    setEditedInviteSettings({ ...DEFAULT_SETTINGS, ...(invite.kidSettings ?? {}) })
    setInviteHasUnsaved(false)
    setInviteSaveError(null)
  }

  function updateInviteField<K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) {
    setEditedInviteSettings(prev => ({ ...prev, [key]: value }))
    setInviteHasUnsaved(true)
  }

  async function handleSaveInviteSettings() {
    if (!selectedInvite) return
    setInviteSaving(true)
    setInviteSaveError(null)
    try {
      await apiFetch(`invites/${selectedInvite.code}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayNameHint: editedInviteName.trim() || null,
          role: editedInviteRole,
          kidSettings: editedInviteRole === 'User' ? editedInviteSettings : null,
        }),
      })
      setInviteHasUnsaved(false)
      onRefreshInvites?.()
    } catch {
      setInviteSaveError('Failed to save. Please try again.')
    } finally {
      setInviteSaving(false)
    }
  }

  async function handleRevokeInviteConfirmed() {
    if (!deleteInviteFor) return
    const code = deleteInviteFor.code
    setDeletingInvite(code)
    try {
      await apiFetch(`invites/${code}`, { method: 'DELETE' })
      if (selectedInviteCode === code) setSelectedInviteCode(null)
      setDeleteInviteFor(null)
      onRefreshInvites?.()
      onMemberCreated?.()   // refresh family slot count
    } catch {
      setDeleteInviteFor(null)
      onRefreshInvites?.()
    } finally {
      setDeletingInvite(null)
    }
  }

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

  // ── Member name edit / delete API handlers ────────────────────────────────
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
      onMemberCreated?.()
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
      onMemberCreated?.()
    } catch {
      // silent
    } finally {
      setDeletingEnrolled(null)
    }
  }

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
      onMemberCreated?.()
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setEditLocalError(apiErr?.body?.message ?? 'Failed to update. Please try again.')
    } finally {
      setEditLocalSubmitting(false)
    }
  }

  async function handleDeleteLocalConfirmed() {
    if (!deleteLocalFor) return
    const m = deleteLocalFor
    setDeletingLocal(m.oid)
    setDeleteLocalFor(null)
    try {
      await apiFetch(`local-members/${encodeURIComponent(m.oid)}`, { method: 'DELETE' })
      onMemberCreated?.()
    } catch {
      // silent
    } finally {
      setDeletingLocal(null)
    }
  }

  const currentSaved = savedPerKid[selectedId] ?? DEFAULT_SETTINGS
  // Only consider kid settings "unsaved" when a kid is actually selected.
  // When an admin or invite is selected, selectedId is '' and savedPerKid['']
  // doesn't exist, which would incorrectly make hasUnsaved true.
  const hasUnsaved   = !!selectedId && !settingsEqual(edited, currentSaved)

  useEffect(() => {
    onUnsavedStatusChange(hasUnsaved || inviteHasUnsaved)
  }, [hasUnsaved, inviteHasUnsaved, onUnsavedStatusChange])

  function doSelectKid(id: string) {
    setSelectedId(id)
    setSelectedInviteCode(null)   // deselect any pending invite
    setSelectedAdminOid(null)     // deselect any admin
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

  // ── Drag-to-reorder handlers ──────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragSourceRef.current = index
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    const src = dragSourceRef.current
    if (src === null || src === index) return
    setReorderList(prev => {
      const next = [...prev]
      const [moved] = next.splice(src, 1)
      next.splice(index, 0, moved)
      return next
    })
    dragSourceRef.current = index
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
  }

  async function handleSaveOrder() {
    setIsSavingOrder(true)
    setSaveOrderError(null)
    try {
      await apiFetch('family/member-order', {
        method: 'PATCH',
        body: JSON.stringify({ order: reorderList.map(m => m.oid) }),
      })
      setRearrangeMode(false)
      onMemberCreated?.()
    } catch {
      setSaveOrderError('Failed to save order. Please try again.')
    } finally {
      setIsSavingOrder(false)
    }
  }

  const kid         = kids.find(k => k.oid === selectedId)
  const showDayTime = edited.allowanceEnabled &&
    (edited.allowanceFrequency === 'Weekly' || edited.allowanceFrequency === 'Bi-weekly')

  const dayIndex = edited.dayOfWeek ?? 0

  // Dates for bi-weekly start dialog
  const nextOccurrence      = getNextDayOccurrence(dayIndex, 0)
  const followingOccurrence = getNextDayOccurrence(dayIndex, 1)
  const tzLabel = US_TIMEZONES.find(t => t.value === edited.timezone)?.label ?? edited.timezone

  return (
    <div className="family-members-layout">

      {/* Left panel — all members list (desktop); hidden on mobile */}
      <div className="kid-list-column">
        <div className="kid-list">
          {/* Normal member list — hidden in rearrange mode */}
          {!rearrangeMode && members.map(m => {
            const isKid    = m.role === 'User'
            const isActive = isKid
              ? selectedId === m.oid
              : selectedAdminOid === m.oid
            const isBusy   = deletingEnrolled === m.oid || deletingLocal === m.oid
            const roleLabel = m.isLocalAccount ? 'Local' : m.role === 'FamilyAdmin' ? 'Admin' : 'User'
            return (
              <div key={m.oid} className={`kid-list__item${isActive ? ' kid-list__item--active' : ''}`}>
                <button
                  className="kid-list__select-area"
                  onClick={() => isKid ? handleKidClick(m.oid) : handleAdminClick(m.oid)}
                  disabled={isBusy}
                >
                  <span className={`kid-list__avatar${isKid ? '' : ' kid-list__avatar--admin'}`}>
                    {m.displayName.charAt(0)}
                  </span>
                  <span className="kid-list__info">
                    <span className="kid-list__name">{m.displayName}</span>
                  </span>
                  {isKid && isActive && hasUnsaved && <span className="kid-list__unsaved-dot" title="Unsaved changes" />}
                </button>
              </div>
            )
          })}

          {/* Pending invites — appear below confirmed members, hidden in rearrange mode */}
          {!rearrangeMode && pendingInvites.map(invite => {
            const isInviteActive = selectedInviteCode === invite.code
            const isBusy = deletingInvite === invite.code
            const name = invite.displayNameHint || 'Invited member'
            return (
              <div key={invite.code} className={`kid-list__item${isInviteActive ? ' kid-list__item--active' : ''}`}>
                <button
                  className="kid-list__select-area"
                  onClick={() => handleSelectInvite(invite.code)}
                  disabled={isBusy}
                >
                  <span className="kid-list__avatar kid-list__avatar--pending">{name.charAt(0).toUpperCase()}</span>
                  <span className="kid-list__info">
                    <span className="kid-list__name">{name}</span>
                    <span className="kid-list__pending-badge">Pending</span>
                  </span>
                </button>
              </div>
            )
          })}

          {/* Drag-to-reorder list — visible only in rearrange mode */}
          {rearrangeMode && reorderList.map((m, index) => {
            const isKid = m.role === 'User'
            return (
              <div
                key={m.oid}
                className="kid-list__item kid-list__item--draggable"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={e => handleDragOver(e, index)}
                onDrop={handleDrop}
              >
                <span className="kid-list__drag-handle" aria-hidden="true">⠿</span>
                <span className={`kid-list__avatar${isKid ? '' : ' kid-list__avatar--admin'}`}>
                  {m.displayName.charAt(0)}
                </span>
                <span className="kid-list__info">
                  <span className="kid-list__name">{m.displayName}</span>
                </span>
              </div>
            )
          })}
        </div>

        <InviteSection memberCount={memberCount} memberLimit={memberLimit} onMemberCreated={() => { onMemberCreated?.(); onRefreshInvites?.() }} onInviteCreated={onRefreshInvites} />

        {/* Rearrange save/cancel controls */}
        {rearrangeMode && (
          <div className="kid-list__add-footer">
            {saveOrderError && (
              <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', margin: '0 0 8px 0' }} role="alert">
                {saveOrderError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn--primary btn--sm"
                style={{ flex: 1 }}
                onClick={handleSaveOrder}
                disabled={isSavingOrder}
              >
                {isSavingOrder ? 'Saving…' : 'Save order'}
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => setRearrangeMode(false)}
                disabled={isSavingOrder}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Rearrange members button — only shown when there are 2+ confirmed members */}
        {!rearrangeMode && members.length >= 2 && (
          <div className="kid-list__add-footer">
            <button
              className="btn btn--secondary btn--sm"
              style={{ width: '100%' }}
              onClick={() => { setReorderList([...members]); setRearrangeMode(true); setSaveOrderError(null) }}
            >
              Rearrange members
            </button>
          </div>
        )}
      </div>

      {/* Mobile kid picker — dropdown and Add Member button for small screens */}
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

        {!kid && !selectedInvite && !selectedAdmin && (
          <p style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>
            {kids.length === 0 && pendingInvites.length === 0
              ? 'No members yet. Use + Add Member to get started.'
              : 'Select a member to manage their settings.'}
          </p>
        )}

        {/* Admin right panel — name + delete only */}
        {selectedAdmin && !kid && !selectedInvite && (() => {
          const isBusy = deletingEnrolled === selectedAdmin.oid || deletingLocal === selectedAdmin.oid
          return (
            <div className="settings-form">
              <div className="settings-form__header">
                <h3 className="settings-form__title">{selectedAdmin.displayName}</h3>
                <div className="member-menu">
                  <button
                    className="member-menu__trigger"
                    title="More options"
                    disabled={isBusy}
                    onClick={e => openMenu(selectedAdmin.oid, e.currentTarget)}
                  >
                    ⋮
                  </button>
                  {openMenuFor === selectedAdmin.oid && menuPos && (
                    <>
                      <div className="member-menu__backdrop" onClick={closeMenu} />
                      <div className="member-menu__dropdown" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}>
                        <button className="member-menu__item" onClick={() => {
                          closeMenu()
                          if (selectedAdmin.isLocalAccount) { setEditingLocal(selectedAdmin); setEditLocalName(selectedAdmin.displayName); setEditLocalError(null) }
                          else { setEditingEnrolled(selectedAdmin); setEditEnrolledName(selectedAdmin.displayName); setEditEnrolledError(null) }
                        }}>Edit name</button>
                        {selectedAdmin.isLocalAccount && (
                          <button className="member-menu__item" onClick={() => handleOpenLinkAccount(selectedAdmin)}>Link account</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Role: <strong style={{ color: 'var(--text-primary)' }}>Family Admin</strong>
              </div>
              <div className="settings-form__footer">
                <div className="settings-form__footer-actions">
                  <span />
                  <button
                    className="btn btn--danger btn--sm"
                    disabled={isBusy}
                    onClick={() => selectedAdmin.isLocalAccount ? setDeleteLocalFor(selectedAdmin) : setDeleteEnrolledFor(selectedAdmin)}
                  >
                    {isBusy ? 'Deleting…' : 'Delete user'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Unsaved changes confirmation (when switching kids) */}
        {kid && pendingKidId && (
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

        {kid && <div className="settings-form">
          <div className="settings-form__header">
            <h3 className="settings-form__title">{kid.displayName}&apos;s Settings</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {hasUnsaved && <span className="unsaved-badge">Unsaved changes</span>}
              <div className="member-menu">
                <button
                  className="member-menu__trigger"
                  title="More options"
                  onClick={e => openMenu(kid.oid, e.currentTarget)}
                >
                  ⋮
                </button>
                {openMenuFor === kid.oid && menuPos && (() => {
                  const m = members.find(mm => mm.oid === kid.oid)
                  return (
                    <>
                      <div className="member-menu__backdrop" onClick={closeMenu} />
                      <div className="member-menu__dropdown" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}>
                        <button className="member-menu__item" onClick={() => {
                          closeMenu()
                          if (!m) return
                          if (m.isLocalAccount) { setEditingLocal(m); setEditLocalName(m.displayName); setEditLocalError(null) }
                          else { setEditingEnrolled(m); setEditEnrolledName(m.displayName); setEditEnrolledError(null) }
                        }}>Edit name</button>
                        {m?.isLocalAccount && (
                          <button className="member-menu__item" onClick={() => m && handleOpenLinkAccount(m)}>Link account</button>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* Role */}
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Role: <strong style={{ color: 'var(--text-primary)' }}>{kid.isLocalAccount ? 'Local user' : 'User'}</strong>
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

          {/* Save + Delete row */}
          <div className="settings-form__footer">
            {saveError && <p className="sa-form-error" role="alert" style={{ marginBottom: 8 }}>{saveError}</p>}
            <div className="settings-form__footer-actions">
              <button
                className="btn btn--primary"
                onClick={handleSaveClick}
                disabled={!hasUnsaved || isSaving}
              >
                {isSaving ? 'Saving…' : hasUnsaved ? 'Save Changes' : 'Saved ✓'}
              </button>
              <button
                className="btn btn--danger btn--sm"
                onClick={() => {
                  const m = members.find(mm => mm.oid === kid.oid)
                  if (m) m.isLocalAccount ? setDeleteLocalFor(m) : setDeleteEnrolledFor(m)
                }}
                disabled={isSaving || deletingEnrolled === kid.oid || deletingLocal === kid.oid}
              >
                Delete
              </button>
            </div>
          </div>

        </div>}

        {/* ── Pending invite settings panel ─────────────────────────────────── */}
        {selectedInvite && (() => {
          const inviteShowDayTime = editedInviteSettings.allowanceEnabled &&
            (editedInviteSettings.allowanceFrequency === 'Weekly' || editedInviteSettings.allowanceFrequency === 'Bi-weekly')
          const inviteDayIndex = editedInviteSettings.dayOfWeek ?? 0
          return (
            <div className="settings-form">
              <div className="settings-form__header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 className="settings-form__title">
                    {editedInviteName || 'New Member'}&apos;s Invite
                  </h3>
                </div>
                {inviteHasUnsaved && <span className="unsaved-badge">Unsaved</span>}
              </div>
              <p className="form-hint" style={{ marginBottom: 12 }}>
                Settings will apply when this invite is redeemed.
              </p>

              {/* Invite code display */}
              <div className="form-field">
                <label className="form-label">Invite Code</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code style={{ fontFamily: 'monospace', fontSize: '1rem', letterSpacing: '0.1em', flex: 1 }}>{selectedInvite.code}</code>
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(selectedInvite.code)}
                  >
                    Copy
                  </button>
                </div>
                <p className="form-hint" style={{ marginTop: 4 }}>
                  Expires {new Date(selectedInvite.expiresAt).toLocaleDateString()}
                </p>
              </div>

              {/* Name */}
              <div className="form-field">
                <label className="form-label" htmlFor="inv-name">Name</label>
                <input
                  id="inv-name"
                  className="form-input"
                  type="text"
                  placeholder="e.g. Jacob"
                  maxLength={60}
                  value={editedInviteName}
                  onChange={e => { setEditedInviteName(e.target.value); setInviteHasUnsaved(true) }}
                />
              </div>

              {/* Role */}
              <div className="form-field">
                <label className="form-label" htmlFor="inv-role">Role</label>
                <select
                  id="inv-role"
                  className="form-select"
                  value={editedInviteRole}
                  onChange={e => { setEditedInviteRole(e.target.value as 'User' | 'FamilyAdmin'); setInviteHasUnsaved(true) }}
                >
                  <option value="User">User (kid with allowance)</option>
                  <option value="FamilyAdmin">Family Admin (parent/manager)</option>
                </select>
              </div>

              {/* Allowance settings — User role only */}
              {editedInviteRole === 'User' && (
                <>
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
                          checked={editedInviteSettings.allowanceEnabled}
                          onChange={e => updateInviteField('allowanceEnabled', e.target.checked)}
                        />
                        <span className="toggle-switch__track" />
                      </label>
                    </div>
                  </div>

                  {editedInviteSettings.allowanceEnabled && (
                    <div className="allowance-sub-fields">
                      {/* Amount */}
                      <div className="form-field">
                        <label className="form-label" htmlFor="inv-amount">Allowance Amount</label>
                        <div className="amount-input-wrapper amount-input-wrapper--sm">
                          <span className="amount-input-prefix">$</span>
                          <input
                            id="inv-amount"
                            className="amount-input amount-input--sm"
                            type="number"
                            min="0"
                            step="0.50"
                            value={editedInviteSettings.allowanceAmount}
                            onChange={e => updateInviteField('allowanceAmount', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      </div>

                      {/* Frequency */}
                      <div className="form-field">
                        <label className="form-label" htmlFor="inv-freq">Frequency</label>
                        <select
                          id="inv-freq"
                          className="form-select"
                          value={editedInviteSettings.allowanceFrequency}
                          onChange={e => updateInviteField('allowanceFrequency', e.target.value as AllowanceFrequency)}
                        >
                          {FREQUENCY_OPTIONS.map(f => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>

                      {/* Day of week */}
                      {inviteShowDayTime && (
                        <div className="form-field">
                          <label className="form-label" htmlFor="inv-day">Day of the Week</label>
                          <p className="form-hint">Which day the deposit will occur.</p>
                          <select
                            id="inv-day"
                            className="form-select"
                            value={inviteDayIndex}
                            onChange={e => updateInviteField('dayOfWeek', parseInt(e.target.value, 10))}
                          >
                            {DAYS_OF_WEEK.map((d, i) => (
                              <option key={d} value={i}>{d}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Monthly notice */}
                      {editedInviteSettings.allowanceFrequency === 'Monthly' && (
                        <div className="form-field">
                          <div className="monthly-notice">
                            <span className="monthly-notice__icon">📅</span>
                            <p className="monthly-notice__text">
                              Monthly allowances always deposit on the <strong>1st of each month</strong>.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Time + timezone */}
                      <div className="form-field form-field--row">
                        <div className="form-field-sub">
                          <label className="form-label" htmlFor="inv-time">Time of Day</label>
                          <input
                            id="inv-time"
                            className="form-select"
                            type="time"
                            value={editedInviteSettings.timeOfDay ?? '08:00'}
                            onChange={e => updateInviteField('timeOfDay', e.target.value)}
                          />
                        </div>
                        <div className="form-field-sub form-field-sub--grow">
                          <label className="form-label" htmlFor="inv-tz">Timezone</label>
                          <select
                            id="inv-tz"
                            className="form-select form-select--full"
                            value={editedInviteSettings.timezone}
                            onChange={e => updateInviteField('timezone', e.target.value)}
                          >
                            {US_TIMEZONES.map(tz => (
                              <option key={tz.value} value={tz.value}>{tz.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Hourly Wages */}
                  <div className="form-field">
                    <div className="form-toggle-row">
                      <div>
                        <span className="form-label">Hourly Wages</span>
                        <p className="form-hint">Allow recording hours worked for income transactions.</p>
                      </div>
                      <label className="toggle-switch" aria-label="Toggle hourly wages">
                        <input
                          type="checkbox"
                          checked={editedInviteSettings.hourlyWagesEnabled ?? false}
                          onChange={e => updateInviteField('hourlyWagesEnabled', e.target.checked)}
                        />
                        <span className="toggle-switch__track" />
                      </label>
                    </div>
                  </div>

                  {editedInviteSettings.hourlyWagesEnabled && (
                    <div className="allowance-sub-fields">
                      <div className="form-field">
                        <label className="form-label" htmlFor="inv-wage-rate">Hourly Wage Rate</label>
                        <div className="amount-input-wrapper amount-input-wrapper--sm">
                          <span className="amount-input-prefix">$</span>
                          <input
                            id="inv-wage-rate"
                            className="amount-input amount-input--sm"
                            type="number"
                            min="0"
                            step="0.25"
                            value={editedInviteSettings.hourlyWageRate ?? 10}
                            onChange={e => updateInviteField('hourlyWageRate', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <p className="form-hint" style={{ marginTop: 4 }}>per hour</p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Save + Revoke row */}
              <div className="settings-form__footer">
                {inviteSaveError && <p className="sa-form-error" role="alert" style={{ marginBottom: 8 }}>{inviteSaveError}</p>}
                <div className="settings-form__footer-actions">
                  <button
                    className="btn btn--primary"
                    onClick={handleSaveInviteSettings}
                    disabled={!inviteHasUnsaved || inviteSaving}
                  >
                    {inviteSaving ? 'Saving…' : inviteHasUnsaved ? 'Save Changes' : 'Saved ✓'}
                  </button>
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={() => setDeleteInviteFor(selectedInvite)}
                    disabled={inviteSaving || !!deletingInvite}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Bi-weekly start date dialog */}
      {showBiweeklyDialog && kid && (
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

      {/* ── Edit enrolled member name modal ──────────────────────────────── */}
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

      {/* ── Delete enrolled member confirmation ──────────────────────────── */}
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

      {/* ── Edit local member name modal ─────────────────────────────────── */}
      {editingLocal && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-local-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="edit-local-title">Edit Name</p>
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

      {/* ── Delete local member confirmation ─────────────────────────────── */}
      {deleteLocalFor && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Delete Member?</p>
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

      {/* ── Revoke pending invite confirmation ───────────────────────────── */}
      {deleteInviteFor && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="revoke-invite-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="revoke-invite-title">Revoke Invite?</p>
            <div className="sa-dialog__body">
              <p>
                Revoke the invite for <strong>{deleteInviteFor.displayNameHint || 'this member'}</strong>?
                The invite code will no longer work.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setDeleteInviteFor(null)} disabled={!!deletingInvite}>Cancel</button>
              <button className="btn btn--danger" onClick={handleRevokeInviteConfirmed} disabled={!!deletingInvite}>
                {deletingInvite ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link account dialog ─────────────────────────────────────────── */}
      {linkAccountFor && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="link-account-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="link-account-title">Link Account — {linkAccountFor.displayName}</p>
            <div className="sa-dialog__body">
              {linkGenerating && <p className="form-hint">Generating link code…</p>}
              {linkError && !linkCode && <p className="sa-form-error" role="alert">{linkError}</p>}
              {linkCode && (
                <>
                  <p className="form-hint" style={{ marginBottom: 12 }}>
                    Share this code with <strong>{linkAccountFor.displayName}</strong>. When they sign in and enter it, their Microsoft account will be linked to this local account — their existing transactions and settings will carry over.
                  </p>
                  <div className="sa-invite-code-display" style={{ marginBottom: 16 }}>
                    <code className="sa-invite-code-value">{linkCode.code}</code>
                    <button
                      className="btn btn--secondary btn--sm"
                      type="button"
                      onClick={() => navigator.clipboard.writeText(linkCode.code)}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="form-hint" style={{ marginBottom: 16 }}>
                    Expires {new Date(linkCode.expiresAt).toLocaleDateString()} · Single use
                  </p>
                  <form onSubmit={handleLinkSendEmail}>
                    <div className="sa-form-group">
                      <label className="form-label" htmlFor="link-email">Send via email (optional)</label>
                      <input
                        id="link-email"
                        className="form-input"
                        type="email"
                        placeholder="recipient@example.com"
                        maxLength={254}
                        value={linkEmail}
                        onChange={e => setLinkEmail(e.target.value)}
                      />
                    </div>
                    {linkError && <p className="sa-form-error" role="alert" style={{ marginTop: 8 }}>{linkError}</p>}
                    <div className="sa-dialog__actions" style={{ marginTop: 16 }}>
                      <button type="button" className="btn btn--secondary" onClick={() => { setLinkAccountFor(null); setLinkCode(null) }} disabled={linkSendingEmail}>
                        Done
                      </button>
                      <button type="submit" className="btn btn--primary" disabled={linkSendingEmail || !linkEmail.trim()}>
                        {linkSendingEmail ? 'Sending…' : 'Send email'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
            {!linkCode && !linkGenerating && (
              <div className="sa-dialog__actions">
                <button className="btn btn--secondary" onClick={() => { setLinkAccountFor(null); setLinkCode(null) }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}