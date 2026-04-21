import { useState, useEffect, useCallback } from 'react'
import {
  getFamily, updateFamily, deleteFamily,
  createMember, createLocalMember, updateMember, deleteMember, unlinkMember,
  generateInvite, sendInviteEmail, listInvites, revokeInvite,
  purgeTransactions,
  SaApiError,
  type SaFamily, type SaMember, type CreateMemberPayload, type SaInviteCode, type GenerateInvitePayload,
  type PurgeTransactionsResult,
} from './saApi'

interface Props {
  familyId: string
  onBack: () => void
  autoInviteMode?: boolean
}

type MemberFormState = {
  oid: string
  displayName: string
  role: 'User' | 'FamilyAdmin'
}

const EMPTY_FORM: MemberFormState = {
  oid: '',
  displayName: '',
  role: 'User',
}

function buildPayload(form: MemberFormState): CreateMemberPayload {
  return {
    oid:         form.oid.trim(),
    displayName: form.displayName.trim(),
    role:        form.role,
  }
}

export default function FamilyDetail({ familyId, onBack, autoInviteMode }: Props) {
  const [family, setFamily]     = useState<SaFamily | null>(null)
  const [members, setMembers]   = useState<SaMember[]>([])
  const [invites, setInvites]   = useState<SaInviteCode[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // Rename family
  const [editingName, setEditingName]   = useState(false)
  const [nameValue, setNameValue]       = useState('')
  const [savingName, setSavingName]     = useState(false)

  // Member limit editing
  const [editingLimit, setEditingLimit]   = useState(false)
  const [limitValue, setLimitValue]       = useState('')
  const [savingLimit, setSavingLimit]     = useState(false)
  const [limitError, setLimitError]       = useState<string | null>(null)

  // Add / edit member form (OID-based)
  const [showMemberForm, setShowMemberForm] = useState(false)
  const [editingMember, setEditingMember]   = useState<SaMember | null>(null)
  const [form, setForm]                     = useState<MemberFormState>(EMPTY_FORM)
  const [formError, setFormError]           = useState<string | null>(null)
  const [savingMember, setSavingMember]     = useState(false)

  // Delete member
  const [confirmDeleteMember, setConfirmDeleteMember] = useState<SaMember | null>(null)
  const [deletingMember, setDeletingMember]           = useState<string | null>(null)

  // Delete family
  const [confirmDeleteFamily, setConfirmDeleteFamily] = useState(false)
  const [deletingFamily, setDeletingFamily]           = useState(false)

  // Add Member wizard (matches family admin flow)
  const [showAddMemberWizard, setShowAddMemberWizard] = useState(false)
  const [addMemberMode, setAddMemberMode]             = useState<'choose' | 'local' | 'invite'>('choose')
  const [localMemberName, setLocalMemberName]         = useState('')
  const [creatingLocalMember, setCreatingLocalMember] = useState(false)
  const [localMemberError, setLocalMemberError]       = useState<string | null>(null)
  // Invite wizard inside Add Member wizard
  const [wizardInviteRole, setWizardInviteRole]         = useState<'User' | 'FamilyAdmin'>('FamilyAdmin')
  const [wizardInviteNameHint, setWizardInviteNameHint] = useState('')
  const [wizardInviteEmail, setWizardInviteEmail]       = useState('')
  const [wizardGenerating, setWizardGenerating]         = useState(false)
  const [wizardSendingEmail, setWizardSendingEmail]     = useState(false)
  const [wizardInviteError, setWizardInviteError]       = useState<string | null>(null)

  // Newly generated invite code (shown after wizard generates one)
  const [newCode, setNewCode] = useState<SaInviteCode | null>(null)

  // Ellipsis context menu
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const SA_MEMBER_MENU_HEIGHT = 200 // approximate max height of SA member menu items

  function openMenu(oid: string, btn: HTMLButtonElement) {
    if (openMenuFor === oid) { setOpenMenuFor(null); setMenuPos(null); return }
    const r = btn.getBoundingClientRect()
    // Always anchor the dropdown's right edge to the button's right edge so it
    // opens leftward — identical approach to the Transactions tab.
    const right = window.innerWidth - r.right
    const spaceBelow = window.innerHeight - r.bottom - 4
    const top = spaceBelow >= SA_MEMBER_MENU_HEIGHT ? r.bottom + 4 : r.top - SA_MEMBER_MENU_HEIGHT - 4
    setMenuPos({ top, right })
    setOpenMenuFor(oid)
  }

  function closeMenu() {
    setOpenMenuFor(null)
    setMenuPos(null)
  }

  // Unlink member
  const [confirmUnlinkMember, setConfirmUnlinkMember] = useState<SaMember | null>(null)
  const [unlinkingMember, setUnlinkingMember]         = useState<string | null>(null)

  // Link account (for local users)
  const [linkAccountFor, setLinkAccountFor]       = useState<SaMember | null>(null)
  const [linkCode, setLinkCode]                   = useState<SaInviteCode | null>(null)
  const [linkGenerating, setLinkGenerating]       = useState(false)
  const [linkError, setLinkError]                 = useState<string | null>(null)
  const [linkEmail, setLinkEmail]                 = useState('')
  const [linkSendingEmail, setLinkSendingEmail]   = useState(false)

  // Relink account (for already-linked users — unlinks current Entra identity then generates a new link code)
  const [relinkAccountFor, setRelinkAccountFor]       = useState<SaMember | null>(null)
  const [relinkStep, setRelinkStep]                   = useState<'confirm' | 'code'>('confirm')
  const [relinkCode, setRelinkCode]                   = useState<SaInviteCode | null>(null)
  const [relinkProcessing, setRelinkProcessing]       = useState(false)
  const [relinkError, setRelinkError]                 = useState<string | null>(null)
  const [relinkEmail, setRelinkEmail]                 = useState('')
  const [relinkSendingEmail, setRelinkSendingEmail]   = useState(false)

  async function handleOpenLinkAccount(m: SaMember) {
    setLinkAccountFor(m)
    setLinkCode(null)
    setLinkError(null)
    setLinkEmail('')
    setLinkGenerating(true)
    try {
      const created = await generateInvite(familyId, {
        role: m.role as 'User' | 'FamilyAdmin',
        displayNameHint: m.displayName,
        localMemberOid: m.oid,
      })
      setLinkCode(created)
    } catch (err) {
      setLinkError(err instanceof SaApiError ? err.message : 'Failed to generate link code.')
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
      await sendInviteEmail(familyId, linkCode.code, linkEmail.trim())
      setLinkAccountFor(null)
      setLinkCode(null)
    } catch (err) {
      setLinkError(err instanceof SaApiError ? err.message : 'Failed to send email.')
    } finally {
      setLinkSendingEmail(false)
    }
  }

  async function handleConfirmRelink() {
    if (!relinkAccountFor) return
    setRelinkProcessing(true)
    setRelinkError(null)
    try {
      // Unlink the existing Entra identity — member becomes a local account with a new UUID.
      // The old OID is deleted server-side and a new one is created, so we must replace
      // (not update) the entry in the members list using the old OID as the lookup key.
      const oldOid = relinkAccountFor.oid
      const unlinked = await unlinkMember(familyId, oldOid)
      setMembers(prev => prev.map(x => x.oid === oldOid ? unlinked : x))
      // Generate a new link invite tied to the NEW local oid (unlinked.oid), not the old Entra oid
      const code = await generateInvite(familyId, {
        role: relinkAccountFor.role as 'User' | 'FamilyAdmin',
        displayNameHint: relinkAccountFor.displayName,
        localMemberOid: unlinked.oid,
      })
      setRelinkCode(code)
      setRelinkStep('code')
    } catch (err) {
      setRelinkError(err instanceof SaApiError ? err.message : 'Failed to relink account.')
    } finally {
      setRelinkProcessing(false)
    }
  }

  async function handleRelinkSendEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!relinkCode || !relinkEmail.trim()) return
    setRelinkSendingEmail(true)
    setRelinkError(null)
    try {
      await sendInviteEmail(familyId, relinkCode.code, relinkEmail.trim())
      setRelinkAccountFor(null)
      setRelinkCode(null)
    } catch (err) {
      setRelinkError(err instanceof SaApiError ? err.message : 'Failed to send email.')
    } finally {
      setRelinkSendingEmail(false)
    }
  }

  async function handleUnlinkMember(m: SaMember) {
    setUnlinkingMember(m.oid)
    setConfirmUnlinkMember(null)
    try {
      const updated = await unlinkMember(familyId, m.oid)
      setMembers(prev => prev.map(x => x.oid === m.oid ? updated : x))
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to unlink member.')
    } finally {
      setUnlinkingMember(null)
    }
  }

  // Purge Transactions wizard
  type PurgeWizardStep = 'date' | 'confirm'
  const [showPurgeWizard, setShowPurgeWizard]     = useState(false)
  const [purgeWizardStep, setPurgeWizardStep]     = useState<PurgeWizardStep>('date')
  const [purgeKidOid, setPurgeKidOid]             = useState('')
  const [purgeBeforeDate, setPurgeBeforeDate]     = useState('')
  const [purgeSubmitting, setPurgeSubmitting]     = useState(false)
  const [purgeError, setPurgeError]               = useState<string | null>(null)
  const [purgeResult, setPurgeResult]             = useState<PurgeTransactionsResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, codes] = await Promise.all([
        getFamily(familyId),
        listInvites(familyId),
      ])
      setFamily(data.family)
      setMembers(data.members)
      setNameValue(data.family.name)
      setLimitValue(String(data.family.memberLimit))
      // Show only active (unused + non-expired) codes
      setInvites(codes.filter(c => !c.used && !c.expired))
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to load family.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => { load() }, [load])

  // When autoInviteMode is set and the family has loaded, open the invite wizard immediately.
  useEffect(() => {
    if (autoInviteMode && family) {
      setShowAddMemberWizard(true)
      setAddMemberMode('invite')
      setWizardInviteRole('FamilyAdmin')
      setWizardInviteError(null)
      setWizardInviteNameHint('')
      setWizardInviteEmail('')
    }
  }, [autoInviteMode, family])

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!nameValue.trim() || !family) return
    setSavingName(true)
    try {
      const updated = await updateFamily(familyId, nameValue.trim())
      setFamily(updated)
      setEditingName(false)
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to update family name.')
    } finally {
      setSavingName(false)
    }
  }

  async function handleSaveLimit(e: React.FormEvent) {
    e.preventDefault()
    if (!family) return
    setLimitError(null)
    const parsed = parseInt(limitValue, 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      setLimitError('Member limit must be a whole number between 1 and 100.')
      return
    }
    setSavingLimit(true)
    try {
      const updated = await updateFamily(familyId, family.name, parsed)
      setFamily(updated)
      setLimitValue(String(updated.memberLimit))
      setEditingLimit(false)
    } catch (err) {
      setLimitError(err instanceof SaApiError ? err.message : 'Failed to update member limit.')
    } finally {
      setSavingLimit(false)
    }
  }

  function openAddMember() {
    setEditingMember(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowMemberForm(true)
  }

  function openEditMember(m: SaMember) {
    setEditingMember(m)
    setForm({
      oid:         m.oid,
      displayName: m.displayName,
      role:        m.role,
    })
    setFormError(null)
    setShowMemberForm(true)
  }

  function cancelForm() {
    setShowMemberForm(false)
    setEditingMember(null)
    setFormError(null)
  }

  // Invite wizard handlers (used inside Add Member wizard)
  async function handleWizardGenerateCodeOnly(e: React.FormEvent) {
    e.preventDefault()
    setWizardInviteError(null)
    setWizardGenerating(true)
    try {
      const payload: GenerateInvitePayload = {
        role: wizardInviteRole,
      }
      const created = await generateInvite(familyId, payload)
      setNewCode(created)
      setInvites(prev => [created, ...prev])
      setShowAddMemberWizard(false)
      setAddMemberMode('choose')
      setWizardInviteEmail('')
    } catch (err) {
      setWizardInviteError(err instanceof SaApiError ? err.message : 'Failed to generate invite.')
    } finally {
      setWizardGenerating(false)
    }
  }

  async function handleWizardSendWithEmail(e: React.FormEvent) {
    e.preventDefault()
    const emailTrimmed = wizardInviteEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setWizardInviteError('That email address doesn’t look right — please double-check it and try again.')
      return
    }
    setWizardInviteError(null)
    setWizardSendingEmail(true)
    try {
      const payload: GenerateInvitePayload = {
        role: wizardInviteRole,
      }
      const created = await generateInvite(familyId, payload)
      setNewCode(created)
      setInvites(prev => [created, ...prev])
      try {
        await sendInviteEmail(familyId, created.code, wizardInviteEmail.trim())
      } catch {
        // Non-fatal — code was created; show it even if email failed
        setWizardInviteError('Code generated but the email could not be sent. Share the code manually.')
        setShowAddMemberWizard(false)
        setAddMemberMode('choose')
        setWizardInviteNameHint('')
        setWizardInviteEmail('')
        setWizardSendingEmail(false)
        return
      }
      setShowAddMemberWizard(false)
      setAddMemberMode('choose')
      setWizardInviteNameHint('')
      setWizardInviteEmail('')
    } catch (err) {
      setWizardInviteError(err instanceof SaApiError ? err.message : 'Failed to generate invite.')
    } finally {
      setWizardSendingEmail(false)
    }
  }

  // Revoke a pending invite from the pending invites list
  const [revokingCode, setRevokingCode] = useState<string | null>(null)
  const [revokeError, setRevokeError]   = useState<string | null>(null)

  async function handleRevokeInvite(code: string) {
    setRevokingCode(code)
    setRevokeError(null)
    try {
      await revokeInvite(familyId, code)
      setInvites(prev => prev.filter(c => c.code !== code))
      if (newCode?.code === code) setNewCode(null)
    } catch (err) {
      setRevokeError(err instanceof SaApiError ? err.message : 'Failed to revoke invite.')
    } finally {
      setRevokingCode(null)
    }
  }

  // Purge wizard submit
  async function handlePurgeSubmit() {
    setPurgeSubmitting(true)
    setPurgeError(null)
    setPurgeResult(null)
    try {
      const beforeDate = new Date(purgeBeforeDate + 'T00:00:00').toISOString()
      const result = await purgeTransactions(familyId, { kidOid: purgeKidOid, beforeDate })
      setPurgeResult(result)
      // purgeResult is set; wizard shows result panel
    } catch (err) {
      setPurgeError(err instanceof SaApiError ? err.message : 'Purge failed. Please try again.')
    } finally {
      setPurgeSubmitting(false)
    }
  }

  function openPurgeWizard() {
    setPurgeWizardStep('date')
    setPurgeKidOid(members.find(m => m.role === 'User')?.oid ?? '')
    setPurgeBeforeDate('')
    setPurgeError(null)
    setPurgeResult(null)
    setShowPurgeWizard(true)
  }

  async function handleSaveMember(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSavingMember(true)
    try {
      const payload = buildPayload(form)
      if (editingMember) {
        const updated = await updateMember(familyId, editingMember.oid, payload)
        setMembers(prev => prev.map(m => m.oid === updated.oid ? updated : m))
      } else {
        const created = await createMember(familyId, payload)
        setMembers(prev => [...prev, created])
      }
      cancelForm()
    } catch (err) {
      setFormError(err instanceof SaApiError ? err.message : 'Failed to save member.')
    } finally {
      setSavingMember(false)
    }
  }

  async function handleCreateLocalMember(e: React.FormEvent) {
    e.preventDefault()
    setLocalMemberError(null)
    const name = localMemberName.trim()
    if (!name) { setLocalMemberError('Name is required.'); return }
    if (name.length > 60) { setLocalMemberError('Name must be 60 characters or fewer.'); return }
    setCreatingLocalMember(true)
    try {
      const created = await createLocalMember(familyId, name)
      setMembers(prev => [...prev, created])
      setShowAddMemberWizard(false)
      setAddMemberMode('choose')
      setLocalMemberName('')
    } catch (err) {
      setLocalMemberError(err instanceof SaApiError ? err.message : 'Failed to create local member.')
    } finally {
      setCreatingLocalMember(false)
    }
  }

  async function handleDeleteMember(m: SaMember) {
    setDeletingMember(m.oid)
    setConfirmDeleteMember(null)
    try {
      await deleteMember(familyId, m.oid)
      setMembers(prev => prev.filter(x => x.oid !== m.oid))
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to delete member.')
    } finally {
      setDeletingMember(null)
    }
  }

  async function handleDeleteFamily() {
    setDeletingFamily(true)
    try {
      await deleteFamily(familyId)
      onBack()
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to delete family.')
      setConfirmDeleteFamily(false)
    } finally {
      setDeletingFamily(false)
    }
  }

  function setField<K extends keyof MemberFormState>(k: K, v: MemberFormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  return (
    <div className="sa-page">
      {/* Back nav */}
      <div className="sa-breadcrumb">
        <button className="sa-link" onClick={onBack}>← Families</button>
        <span className="sa-breadcrumb__sep">/</span>
        <span>{family?.name ?? familyId}</span>
      </div>

      {loading && <div className="sa-loading"><div className="app-loading__spinner" /></div>}
      {error   && <p className="sa-error-banner" role="alert">{error}</p>}

      {family && !loading && (
        <>
          {/* Family header */}
          <div className="sa-page-header">
            {editingName ? (
              <form className="sa-inline-name-edit" onSubmit={handleSaveName}>
                <input
                  className="sa-form-input sa-form-input--name"
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  autoFocus
                />
                <button className="btn btn--primary btn--sm" type="submit" disabled={savingName}>
                  {savingName ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditingName(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <h2 className="sa-page-title">
                  {family.name}
                  <span className="sa-family-id-badge">{familyId}</span>
                </h2>
                <button className="btn btn--secondary btn--sm" onClick={() => setEditingName(true)}>
                  Rename
                </button>
              </>
            )}
          </div>

          {/* Member limit */}
          <div className="sa-section-meta" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            {editingLimit ? (
              <form onSubmit={handleSaveLimit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label className="sa-form-label" style={{ margin: 0 }} htmlFor="member-limit">Member Limit:</label>
                <input
                  id="member-limit"
                  className="sa-form-input"
                  type="number"
                  min="1"
                  max="100"
                  style={{ width: 72 }}
                  value={limitValue}
                  onChange={e => setLimitValue(e.target.value)}
                  autoFocus
                />
                <button className="btn btn--primary btn--sm" type="submit" disabled={savingLimit}>
                  {savingLimit ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => { setEditingLimit(false); setLimitError(null) }}>
                  Cancel
                </button>
                {limitError && <span className="sa-form-error" style={{ fontSize: '0.8rem' }}>{limitError}</span>}
              </form>
            ) : (
              <>
                <span className="sa-form-label" style={{ margin: 0, fontWeight: 600 }}>
                  Member Limit: {family.memberLimit}
                </span>
                <button className="sa-link btn--sm" style={{ fontSize: '0.82rem' }} onClick={() => setEditingLimit(true)}>
                  Edit
                </button>
              </>
            )}
          </div>

          {/* Members section */}
          <div className="sa-section-header">
            <h3 className="sa-section-title">Members ({members.length} / {family.memberLimit})</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn--secondary btn--sm"
                onClick={openPurgeWizard}
              >
                Purge Transactions
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => { setShowAddMemberWizard(true); setAddMemberMode('choose'); setLocalMemberName(''); setLocalMemberError(null); setWizardInviteError(null); setWizardInviteNameHint(''); setWizardInviteEmail('') }}
              >
                + Add Member
              </button>
            </div>
          </div>

          {members.length === 0 && (
            <div className="sa-empty"><p>No members yet. Add one above.</p></div>
          )}

          {members.length > 0 && (
            <div className="table-wrapper">
              <table className="transactions-table sa-table">
                <thead>
                  <tr>
                    <th>Display Name</th>
                    <th>Role</th>
                    <th>OID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    return (
                      <tr key={m.oid}>
                        <td className="sa-member-name">{m.displayName}</td>
                        <td>
                          <span className={`sa-role-badge sa-role-badge--${m.role === 'FamilyAdmin' ? 'admin' : m.isLocalAccount ? 'local' : 'user'}`}>
                            {m.role === 'FamilyAdmin' ? 'Family Admin' : m.role}{m.isLocalAccount ? ' · Local' : ''}
                          </span>
                        </td>
                        <td><code className="sa-code sa-code--sm">{m.oid}</code></td>
                        <td className="td-actions">
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              className="member-menu__trigger"
                              title="More options"
                              disabled={deletingMember === m.oid || unlinkingMember === m.oid}
                              onClick={e => openMenu(m.oid, e.currentTarget)}
                            >
                              ⋮
                            </button>
                          </div>
                          {openMenuFor === m.oid && menuPos && (
                            <>
                              <div className="member-menu__backdrop" onClick={closeMenu} />
                              <div
                                className="member-menu__dropdown"
                                style={{
                                  position: 'fixed',
                                  top: menuPos.top,
                                  right: menuPos.right,
                                  left: 'auto',
                                }}
                              >
                                <button className="member-menu__item" onClick={() => { closeMenu(); openEditMember(m) }}>Edit</button>
                                {m.isLocalAccount && (
                                  <button className="member-menu__item" onClick={() => { closeMenu(); handleOpenLinkAccount(m) }}>Link account</button>
                                )}
                                {!m.isLocalAccount && (
                                  <button className="member-menu__item" onClick={() => { closeMenu(); setRelinkAccountFor(m); setRelinkStep('confirm'); setRelinkCode(null); setRelinkError(null); setRelinkEmail('') }}>Relink account</button>
                                )}
                                {!m.isLocalAccount && m.role === 'User' && (
                                  <button className="member-menu__item member-menu__item--danger" onClick={() => { closeMenu(); setConfirmUnlinkMember(m) }}>Remove linked account</button>
                                )}
                                <button className="member-menu__item member-menu__item--danger" onClick={() => { closeMenu(); setConfirmDeleteMember(m) }}>Delete member</button>
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Delete Family */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
            <button
              className="btn btn--danger"
              onClick={() => setConfirmDeleteFamily(true)}
              disabled={deletingFamily}
            >
              {deletingFamily ? 'Deleting…' : 'Delete Family'}
            </button>
          </div>
        </>
      )}

      {/* Pending Invites section */}
      {invites.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 className="sa-section-title" style={{ marginBottom: 8 }}>
            Pending Invites ({invites.length})
          </h3>
          {revokeError && <p className="sa-form-error" role="alert" style={{ marginBottom: 8 }}>{revokeError}</p>}
          <div className="table-wrapper">
            <table className="transactions-table sa-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name Hint</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(inv => (
                  <tr key={inv.code}>
                    <td><code className="sa-code sa-code--sm">{inv.code}</code></td>
                    <td>{inv.displayNameHint ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>
                      <span className={`sa-role-badge sa-role-badge--${inv.role === 'FamilyAdmin' ? 'admin' : 'user'}`}>
                        {inv.role === 'FamilyAdmin' ? 'Family Admin' : 'User'}
                      </span>
                    </td>
                    <td>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                    <td className="td-actions">
                      <button
                        className="btn-action btn-action--delete"
                        onClick={() => handleRevokeInvite(inv.code)}
                        disabled={revokingCode === inv.code}
                      >
                        {revokingCode === inv.code ? '…' : 'Revoke'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Member wizard */}
      {showAddMemberWizard && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-add-member-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="sa-add-member-wizard-title">
              {autoInviteMode ? `Add the first member for ${family?.name ?? 'this family'}` : 'Add Member'}
            </p>

            {addMemberMode === 'choose' && (
              <>
                <div className="sa-dialog__body">
                  <div className="add-member-wizard">
                    <button
                      className="add-member-wizard__option"
                      onClick={() => { setAddMemberMode('invite'); setWizardInviteRole('FamilyAdmin'); setWizardInviteNameHint(''); setWizardInviteEmail(''); setWizardInviteError(null) }}
                    >
                      <span className="add-member-wizard__option-title">Invite account</span>
                      <span className="add-member-wizard__option-desc">
                        Generate an invite code. The person can sign in and redeem it to join the family.
                      </span>
                    </button>
                    <button
                      className="add-member-wizard__option"
                      onClick={() => setAddMemberMode('local')}
                    >
                      <span className="add-member-wizard__option-title">Create local account</span>
                      <span className="add-member-wizard__option-desc">
                        Create a member that only admins can manage. They won&apos;t have a sign-in or see their own account.
                      </span>
                    </button>
                  </div>
                </div>
                <div className="sa-dialog__actions">
                  <button className="btn btn--secondary" onClick={() => setShowAddMemberWizard(false)}>Cancel</button>
                </div>
              </>
            )}

            {addMemberMode === 'invite' && (
              <form onSubmit={handleWizardSendWithEmail}>
                <div className="sa-dialog__body">
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="wiz-inv-email">Email address</label>
                    <input
                      id="wiz-inv-email"
                      className="sa-form-input"
                      type="email"
                      placeholder="recipient@example.com"
                      maxLength={254}
                      value={wizardInviteEmail}
                      onChange={e => setWizardInviteEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="wiz-inv-role">Role</label>
                    <select
                      id="wiz-inv-role"
                      className="sa-form-select"
                      value={wizardInviteRole}
                      onChange={e => setWizardInviteRole(e.target.value as 'User' | 'FamilyAdmin')}
                    >
                      <option value="FamilyAdmin">Family Admin (parent/manager)</option>
                      <option value="User">User (kid with allowance)</option>
                    </select>
                  </div>
                  {wizardInviteError && <p className="sa-form-error" role="alert">{wizardInviteError}</p>}
                </div>
                <div className="sa-dialog__actions sa-dialog__actions--invite">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => autoInviteMode ? setShowAddMemberWizard(false) : setAddMemberMode('choose')}
                    disabled={wizardGenerating || wizardSendingEmail}
                  >
                    {autoInviteMode ? 'Cancel' : 'Back'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={handleWizardGenerateCodeOnly}
                    disabled={wizardGenerating || wizardSendingEmail}
                  >
                    {wizardGenerating ? 'Generating…' : 'Generate code only'}
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={wizardGenerating || wizardSendingEmail || !wizardInviteEmail.trim()}
                  >
                    {wizardSendingEmail ? 'Sending…' : 'Send invite'}
                  </button>
                </div>
              </form>
            )}

            {addMemberMode === 'local' && (
              <form onSubmit={handleCreateLocalMember}>
                <div className="sa-dialog__body">
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-local-member-name">Name</label>
                    <input
                      id="sa-local-member-name"
                      className="sa-form-input"
                      type="text"
                      placeholder="e.g. Emma"
                      maxLength={60}
                      value={localMemberName}
                      onChange={e => setLocalMemberName(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  {localMemberError && <p className="sa-form-error" role="alert">{localMemberError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button type="button" className="btn btn--secondary" onClick={() => setAddMemberMode('choose')} disabled={creatingLocalMember}>Back</button>
                  <button type="submit" className="btn btn--primary" disabled={creatingLocalMember || !localMemberName.trim()}>
                    {creatingLocalMember ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit member form */}
      {showMemberForm && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-label={editingMember ? 'Edit Member' : 'Add Member'}>
          <div className="sa-dialog sa-dialog--wide">
            <h3 className="sa-dialog__title">{editingMember ? 'Edit Member' : 'Add Member'}</h3>

            <form onSubmit={handleSaveMember} autoComplete="off">
              <div className="sa-form-group">
                <label className="sa-form-label" htmlFor="m-oid">OID</label>
                <input
                  id="m-oid"
                  className="sa-form-input sa-form-input--mono"
                  type="text"
                  value={form.oid}
                  onChange={e => setField('oid', e.target.value)}
                  placeholder="Entra object ID (e.g. 938a39e3-65cd-41dd-8baf-a5a90f9e6f0b)"
                  required
                />
              </div>
              <div className="sa-form-row">
                <div className="sa-form-group sa-form-group--grow">
                  <label className="sa-form-label" htmlFor="m-name">Display Name</label>
                  <input
                    id="m-name"
                    className="sa-form-input"
                    type="text"
                    value={form.displayName}
                    onChange={e => setField('displayName', e.target.value)}
                    placeholder="e.g. Jacob"
                    required
                  />
                </div>
                <div className="sa-form-group" style={{ minWidth: 160 }}>
                  <label className="sa-form-label" htmlFor="m-role">Role</label>
                  <select
                    id="m-role"
                    className="sa-form-select"
                    value={form.role}
                    onChange={e => setField('role', e.target.value as 'User' | 'FamilyAdmin')}
                  >
                    <option value="FamilyAdmin">Family Admin</option>
                    <option value="User">User</option>
                  </select>
                </div>
              </div>

              {formError && <p className="sa-form-error" role="alert">{formError}</p>}

              <div className="sa-dialog__actions">
                <button className="btn btn--secondary" type="button" onClick={cancelForm}>
                  Cancel
                </button>
                <button className="btn btn--primary" type="submit" disabled={savingMember}>
                  {savingMember ? 'Saving…' : editingMember ? 'Save Changes' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm unlink member */}
      {confirmUnlinkMember && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Remove Linked Account?</p>
            <div className="sa-dialog__body">
              <p>
                This will convert <strong>{confirmUnlinkMember.displayName}</strong> to a local account.
                Their transactions and settings will be preserved. You can re-link them to a different account using the &ldquo;Link account&rdquo; flow.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmUnlinkMember(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => handleUnlinkMember(confirmUnlinkMember)}>Remove linked account</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete member */}
      {confirmDeleteMember && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Delete Member?</p>
            <div className="sa-dialog__body">
              <p>
                Delete <strong>{confirmDeleteMember.displayName}</strong> from this family?
                Their transactions will also be deleted.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmDeleteMember(null)}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={() => handleDeleteMember(confirmDeleteMember)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link account dialog */}
      {linkAccountFor && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-link-account-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="sa-link-account-title">Link Account — {linkAccountFor.displayName}</p>
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
                      <label className="form-label" htmlFor="sa-link-email">Send via email (optional)</label>
                      <input
                        id="sa-link-email"
                        className="sa-form-input"
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

      {showPurgeWizard && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-purge-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="sa-purge-wizard-title">Purge Transactions</p>

            {/* Step 1 — date + optional kid */}
            {purgeWizardStep === 'date' && !purgeResult && (
              <>
                <div className="sa-dialog__body">
                  {members.some(m => m.role === 'User') && (
                    <div className="sa-form-group">
                      <label className="sa-form-label" htmlFor="pw-kid">Child</label>
                      <select
                        id="pw-kid"
                        className="sa-form-select"
                        value={purgeKidOid}
                        onChange={e => setPurgeKidOid(e.target.value)}
                      >
                        <option value="">— All children —</option>
                        {members.filter(m => m.role === 'User').map(m => (
                          <option key={m.oid} value={m.oid}>{m.displayName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="pw-date">
                      Purge transactions older than
                    </label>
                    <input
                      id="pw-date"
                      className="sa-form-input"
                      type="date"
                      value={purgeBeforeDate}
                      onChange={e => setPurgeBeforeDate(e.target.value)}
                      autoFocus
                    />
                    <p className="sa-form-hint" style={{ marginTop: 6 }}>
                      Transactions dated before this date will be permanently deleted. Running balances are unaffected.
                    </p>
                  </div>
                  {purgeError && <p className="sa-form-error" role="alert">{purgeError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button className="btn btn--secondary" onClick={() => setShowPurgeWizard(false)}>Cancel</button>
                  <button
                    className="btn btn--danger"
                    disabled={!purgeBeforeDate}
                    onClick={() => setPurgeWizardStep('confirm')}
                  >
                    Review
                  </button>
                </div>
              </>
            )}

            {/* Step 2 — confirm */}
            {purgeWizardStep === 'confirm' && !purgeResult && (() => {
              const kidName = purgeKidOid ? members.find(m => m.oid === purgeKidOid)?.displayName ?? purgeKidOid : 'all children'
              const cutoff  = new Date(purgeBeforeDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
              return (
                <>
                  <div className="sa-dialog__body">
                    <div className="sa-purge-confirm-warning">
                      <p><strong>⚠️ Are you sure? This action cannot be undone.</strong></p>
                    </div>
                    <p style={{ marginTop: 12 }}>
                      All transactions for <strong>{kidName}</strong> dated before <strong>{cutoff}</strong> will be <strong>permanently deleted</strong>.
                    </p>
                    {purgeError && <p className="sa-form-error" role="alert" style={{ marginTop: 12 }}>{purgeError}</p>}
                  </div>
                  <div className="sa-dialog__actions">
                    <button
                      className="btn btn--secondary"
                      onClick={() => { setPurgeWizardStep('date'); setPurgeError(null) }}
                      disabled={purgeSubmitting}
                    >
                      Back
                    </button>
                    <button
                      className="btn btn--danger"
                      disabled={purgeSubmitting}
                      onClick={handlePurgeSubmit}
                    >
                      {purgeSubmitting ? 'Purging…' : 'Purge'}
                    </button>
                  </div>
                </>
              )
            })()}

            {/* Result */}
            {purgeResult && (
              <>
                <div className="sa-dialog__body">
                  <div className="sa-purge-result">
                    {purgeResult.purgedCount === 0
                      ? <p>✅ No records found older than that date — nothing was deleted.</p>
                      : <p>
                          ✅ Purged <strong>{purgeResult.purgedCount}</strong> record(s).
                          {purgeResult.skippedCount > 0 && ` (${purgeResult.skippedCount} could not be deleted.)`}
                        </p>
                    }
                  </div>
                </div>
                <div className="sa-dialog__actions">
                  <button
                    className="btn btn--primary"
                    onClick={() => { setShowPurgeWizard(false); setPurgeResult(null) }}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Relink account dialog */}
      {relinkAccountFor && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-relink-account-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="sa-relink-account-title">Relink Account — {relinkAccountFor.displayName}</p>

            {relinkStep === 'confirm' && (
              <>
                <div className="sa-dialog__body">
                  <p>
                    This will unlink <strong>{relinkAccountFor.displayName}</strong>'s current Microsoft account and generate a new invite code so they can link to a different Entra External ID account. Their transactions and settings will be preserved.
                  </p>
                  {relinkError && <p className="sa-form-error" role="alert" style={{ marginTop: 8 }}>{relinkError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button className="btn btn--secondary" onClick={() => setRelinkAccountFor(null)} disabled={relinkProcessing}>Cancel</button>
                  <button className="btn btn--primary" onClick={handleConfirmRelink} disabled={relinkProcessing}>
                    {relinkProcessing ? 'Processing…' : 'Continue'}
                  </button>
                </div>
              </>
            )}

            {relinkStep === 'code' && relinkCode && (
              <div className="sa-dialog__body">
                <p className="form-hint" style={{ marginBottom: 12 }}>
                  Share this code with <strong>{relinkAccountFor.displayName}</strong>. When they sign in and enter it, their new Microsoft account will be linked to this account — their existing transactions and settings will carry over.
                </p>
                <div className="sa-invite-code-display" style={{ marginBottom: 16 }}>
                  <code className="sa-invite-code-value">{relinkCode.code}</code>
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(relinkCode.code)}
                  >
                    Copy
                  </button>
                </div>
                <p className="form-hint" style={{ marginBottom: 16 }}>
                  Expires {new Date(relinkCode.expiresAt).toLocaleDateString()} · Single use
                </p>
                <form onSubmit={handleRelinkSendEmail}>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="sa-relink-email">Send via email (optional)</label>
                    <input
                      id="sa-relink-email"
                      className="sa-form-input"
                      type="email"
                      placeholder="recipient@example.com"
                      maxLength={254}
                      value={relinkEmail}
                      onChange={e => setRelinkEmail(e.target.value)}
                    />
                  </div>
                  {relinkError && <p className="sa-form-error" role="alert" style={{ marginTop: 8 }}>{relinkError}</p>}
                  <div className="sa-dialog__actions" style={{ marginTop: 16 }}>
                    <button type="button" className="btn btn--secondary" onClick={() => { setRelinkAccountFor(null); setRelinkCode(null) }} disabled={relinkSendingEmail}>
                      Done
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={relinkSendingEmail || !relinkEmail.trim()}>
                      {relinkSendingEmail ? 'Sending…' : 'Send email'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm delete family */}
      {confirmDeleteFamily && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Delete Family?</p>
            <div className="sa-dialog__body">
              <p>This will permanently delete <strong>{family?.name}</strong> and all{' '}
              <strong>{members.length} member(s)</strong> and all their transactions.</p>
              <p>This cannot be undone.</p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmDeleteFamily(false)} disabled={deletingFamily}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDeleteFamily} disabled={deletingFamily}>
                {deletingFamily ? 'Deleting…' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
