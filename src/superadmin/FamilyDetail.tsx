import { useState, useEffect, useCallback } from 'react'
import {
  getFamily, updateFamily, deleteFamily,
  createMember, createLocalMember, updateMember, deleteMember,
  listInvites, generateInvite, revokeInvite, sendInviteEmail,
  purgeTransactions, purgeAuditLog,
  SaApiError,
  type SaFamily, type SaMember, type CreateMemberPayload, type SaInviteCode, type GenerateInvitePayload,
  type PurgeTransactionsResult, type PurgeAuditLogResult,
} from './saApi'

interface Props {
  familyId: string
  onBack: () => void
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

export default function FamilyDetail({ familyId, onBack }: Props) {
  const [family, setFamily]     = useState<SaFamily | null>(null)
  const [members, setMembers]   = useState<SaMember[]>([])
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

  // Invite codes
  const [invites, setInvites]               = useState<SaInviteCode[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [newCode, setNewCode]               = useState<SaInviteCode | null>(null)
  const [revokingCode, setRevokingCode]     = useState<string | null>(null)
  const [confirmRevokeCode, setConfirmRevokeCode] = useState<SaInviteCode | null>(null)
  const [regeneratingCode, setRegeneratingCode]   = useState<string | null>(null)

  // Email invite (on existing codes)
  const [emailInvite, setEmailInvite]   = useState<SaInviteCode | null>(null)
  const [emailAddress, setEmailAddress] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailError, setEmailError]     = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState(false)

  // Purge Data wizard
  type PurgeType = 'transactions' | 'audit-log'
  type PurgeWizardStep = 'type' | 'date' | 'confirm'
  const [showPurgeWizard, setShowPurgeWizard]     = useState(false)
  const [purgeWizardStep, setPurgeWizardStep]     = useState<PurgeWizardStep>('type')
  const [purgeType, setPurgeType]                 = useState<PurgeType | null>(null)
  const [purgeKidOid, setPurgeKidOid]             = useState('')
  const [purgeBeforeDate, setPurgeBeforeDate]     = useState('')
  const [purgeSubmitting, setPurgeSubmitting]     = useState(false)
  const [purgeError, setPurgeError]               = useState<string | null>(null)
  const [purgeResult, setPurgeResult]             = useState<PurgeTransactionsResult | PurgeAuditLogResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getFamily(familyId)
      setFamily(data.family)
      setMembers(data.members)
      setNameValue(data.family.name)
      setLimitValue(String(data.family.memberLimit))
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to load family.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true)
    try {
      const data = await listInvites(familyId)
      setInvites(data)
    } catch { /* non-fatal — invites section shows error inline */ }
    finally { setInvitesLoading(false) }
  }, [familyId])

  useEffect(() => { load(); loadInvites() }, [load, loadInvites])

  async function handleRevokeInvite(invite: SaInviteCode) {
    setRevokingCode(invite.code)
    setConfirmRevokeCode(null)
    try {
      await revokeInvite(familyId, invite.code)
      setInvites(prev => prev.filter(c => c.code !== invite.code))
      if (newCode?.code === invite.code) setNewCode(null)
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to revoke invite.')
    } finally {
      setRevokingCode(null)
    }
  }

  async function handleRegenerateInvite(invite: SaInviteCode) {
    setRegeneratingCode(invite.code)
    try {
      const payload: GenerateInvitePayload = {
        role: invite.role,
        displayNameHint: invite.displayNameHint ?? undefined,
      }
      const created = await generateInvite(familyId, payload)
      setNewCode(created)
      setInvites(prev => [created, ...prev])
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to generate invite.')
    } finally {
      setRegeneratingCode(null)
    }
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!emailInvite) return
    setEmailError(null)
    setSendingEmail(true)
    try {
      await sendInviteEmail(familyId, emailInvite.code, emailAddress.trim())
      setEmailSuccess(true)
    } catch (err) {
      setEmailError(err instanceof SaApiError ? err.message : 'Failed to send email.')
    } finally {
      setSendingEmail(false)
    }
  }

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
        displayNameHint: wizardInviteNameHint.trim() || undefined,
      }
      const created = await generateInvite(familyId, payload)
      setNewCode(created)
      setInvites(prev => [created, ...prev])
      setShowAddMemberWizard(false)
      setAddMemberMode('choose')
      setWizardInviteNameHint('')
      setWizardInviteEmail('')
    } catch (err) {
      setWizardInviteError(err instanceof SaApiError ? err.message : 'Failed to generate invite.')
    } finally {
      setWizardGenerating(false)
    }
  }

  async function handleWizardSendWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setWizardInviteError(null)
    setWizardSendingEmail(true)
    try {
      const payload: GenerateInvitePayload = {
        role: wizardInviteRole,
        displayNameHint: wizardInviteNameHint.trim() || undefined,
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

  // Purge wizard submit
  async function handlePurgeSubmit() {
    if (!purgeType) return
    setPurgeSubmitting(true)
    setPurgeError(null)
    setPurgeResult(null)
    try {
      const beforeDate = new Date(purgeBeforeDate + 'T00:00:00').toISOString()
      if (purgeType === 'transactions') {
        const result = await purgeTransactions(familyId, { kidOid: purgeKidOid, beforeDate })
        setPurgeResult(result)
      } else {
        const result = await purgeAuditLog(familyId, beforeDate)
        setPurgeResult(result)
      }
      // purgeResult is set; wizard shows result panel
    } catch (err) {
      setPurgeError(err instanceof SaApiError ? err.message : 'Purge failed. Please try again.')
    } finally {
      setPurgeSubmitting(false)
    }
  }

  function openPurgeWizard() {
    setPurgeWizardStep('type')
    setPurgeType(null)
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
                Purge Data
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
                            {m.role}{m.isLocalAccount ? ' · Local' : ''}
                          </span>
                        </td>
                        <td><code className="sa-code sa-code--sm">{m.oid}</code></td>
                        <td className="td-actions">
                          <button className="btn-action btn-action--edit" onClick={() => openEditMember(m)}>
                            Edit
                          </button>
                          <button
                            className="btn-action btn-action--delete"
                            onClick={() => setConfirmDeleteMember(m)}
                            disabled={deletingMember === m.oid}
                          >
                            {deletingMember === m.oid ? '…' : 'Remove'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Add Member wizard */}
      {showAddMemberWizard && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-add-member-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="sa-add-member-wizard-title">Add Member</p>

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
                    <label className="sa-form-label" htmlFor="wiz-inv-hint">Name (optional)</label>
                    <input
                      id="wiz-inv-hint"
                      className="sa-form-input"
                      type="text"
                      placeholder="e.g. Jacob"
                      maxLength={60}
                      value={wizardInviteNameHint}
                      onChange={e => setWizardInviteNameHint(e.target.value)}
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
                      <option value="FamilyAdmin">FamilyAdmin (parent/manager)</option>
                      <option value="User">User (kid with allowance)</option>
                    </select>
                  </div>
                  {wizardInviteError && <p className="sa-form-error" role="alert">{wizardInviteError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setAddMemberMode('choose')}
                    disabled={wizardGenerating || wizardSendingEmail}
                  >
                    Back
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
              <div className="sa-form-row">
                <div className="sa-form-group">
                  <label className="sa-form-label" htmlFor="m-oid">OID</label>
                  <input
                    id="m-oid"
                    className="sa-form-input"
                    type="text"
                    value={form.oid}
                    onChange={e => setField('oid', e.target.value)}
                    placeholder="Entra object ID (GUID)"
                    required
                  />
                </div>
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
              </div>

              <div className="sa-form-group">
                <label className="sa-form-label" htmlFor="m-role">Role</label>
                <select
                  id="m-role"
                  className="sa-form-select"
                  value={form.role}
                  onChange={e => setField('role', e.target.value as 'User' | 'FamilyAdmin')}
                >
                  <option value="FamilyAdmin">FamilyAdmin (parent/manager)</option>
                  <option value="User">User (kid with allowance)</option>
                </select>
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

      {/* ── Invite Codes section ── */}
      {family && !loading && (
        <>
          <div className="sa-section-header" style={{ marginTop: 8 }}>
            <h3 className="sa-section-title">Invite Codes</h3>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => { setShowAddMemberWizard(true); setAddMemberMode('invite'); setWizardInviteRole('FamilyAdmin'); setWizardInviteNameHint(''); setWizardInviteEmail(''); setWizardInviteError(null) }}
            >
              + Generate Invite
            </button>
          </div>

          {/* Newly generated code — prominent display for copying */}
          {newCode && (
            <div className="sa-invite-new-code">
              <p className="sa-invite-new-code__label">
                ✅ New invite code generated — share this with {newCode.displayNameHint ?? 'the recipient'}:
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
              <button
                className="sa-link"
                type="button"
                style={{ fontSize: '0.8rem' }}
                onClick={() => setNewCode(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {invitesLoading && (
            <div className="sa-loading"><div className="app-loading__spinner" /></div>
          )}

          {!invitesLoading && invites.length === 0 && (
            <div className="sa-empty" style={{ padding: '20px 0' }}>
              <p>No invite codes. Generate one above.</p>
            </div>
          )}

          {invites.length > 0 && (
            <div className="table-wrapper">
              <table className="transactions-table sa-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Role</th>
                    <th>Name Hint</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map(inv => (
                    <tr key={inv.code}>
                      <td><code className="sa-code">{inv.code}</code></td>
                      <td>
                        <span className={`sa-role-badge sa-role-badge--${inv.role === 'FamilyAdmin' ? 'admin' : 'user'}`}>
                          {inv.role}
                        </span>
                      </td>
                      <td>{inv.displayNameHint ?? '—'}</td>
                      <td className="td-date">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                      <td>
                        {inv.used
                          ? <span className="sa-invite-status sa-invite-status--used">Activated</span>
                          : inv.expired
                            ? <span className="sa-invite-status sa-invite-status--expired">Expired</span>
                            : <span className="sa-invite-status sa-invite-status--active">Pending</span>
                        }
                      </td>
                      <td className="td-actions">
                        {!inv.used && !inv.expired && (
                          <>
                            <button
                              className="btn-action btn-action--edit"
                              onClick={() => { setEmailInvite(inv); setEmailAddress(''); setEmailError(null); setEmailSuccess(false) }}
                              disabled={revokingCode === inv.code}
                              style={{ marginRight: 4 }}
                            >
                              Send Email
                            </button>
                            <button
                              className="btn-action btn-action--delete"
                              onClick={() => setConfirmRevokeCode(inv)}
                              disabled={revokingCode === inv.code}
                            >
                              {revokingCode === inv.code ? '…' : 'Revoke'}
                            </button>
                          </>
                        )}
                        {inv.expired && (
                          <button
                            className="btn-action btn-action--edit"
                            onClick={() => handleRegenerateInvite(inv)}
                            disabled={regeneratingCode === inv.code}
                          >
                            {regeneratingCode === inv.code ? '…' : 'Generate New Code'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Send invite email */}
      {emailInvite && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-email-inv-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="sa-email-inv-title">Send Invite Email</p>
            {emailSuccess ? (
              <div className="sa-dialog__body">
                <p>✅ Invite email sent to <strong>{emailAddress}</strong>.</p>
              </div>
            ) : (
              <form onSubmit={handleSendEmail}>
                <div className="sa-dialog__body">
                  <p style={{ marginBottom: 12 }}>
                    Send the invite code for{' '}
                    <strong>{emailInvite.displayNameHint ?? 'this recipient'}</strong> to an email address.
                  </p>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="sa-email-addr">Email Address</label>
                    <input
                      id="sa-email-addr"
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
                  <button type="button" className="btn btn--secondary"
                    onClick={() => setEmailInvite(null)} disabled={sendingEmail}>Cancel</button>
                  <button type="submit" className="btn btn--primary"
                    disabled={sendingEmail || !emailAddress.trim()}>
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

      {/* Confirm revoke invite */}
      {confirmRevokeCode && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Revoke Invite Code?</p>
            <div className="sa-dialog__body">
              <p>
                Revoke code <code>{confirmRevokeCode.code}</code>? The recipient will no longer
                be able to use it to join.
              </p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmRevokeCode(null)}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={() => handleRevokeInvite(confirmRevokeCode)}>
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete member */}
      {confirmDeleteMember && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Remove Member?</p>
            <p className="sa-dialog__body">
              Remove <strong>{confirmDeleteMember.displayName}</strong> from this family?
              Their transactions and audit log entries will remain.
            </p>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmDeleteMember(null)}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={() => handleDeleteMember(confirmDeleteMember)}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purge Data wizard */}
      {showPurgeWizard && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-purge-wizard-title">
          <div className="sa-dialog sa-dialog--wide">
            <p className="sa-dialog__title" id="sa-purge-wizard-title">Purge Data</p>

            {/* Step 1 — choose type */}
            {purgeWizardStep === 'type' && (
              <>
                <div className="sa-dialog__body">
                  <p style={{ marginBottom: 12, color: 'var(--color-text-muted, #666)' }}>
                    What would you like to purge?
                  </p>
                  <div className="add-member-wizard">
                    <button
                      className={`add-member-wizard__option${purgeType === 'transactions' ? ' add-member-wizard__option--selected' : ''}`}
                      onClick={() => setPurgeType('transactions')}
                    >
                      <span className="add-member-wizard__option-title">Transactions</span>
                      <span className="add-member-wizard__option-desc">
                        Permanently remove old transaction records for a child. Running balances
                        are preserved via accumulated base values.
                      </span>
                    </button>
                    <button
                      className={`add-member-wizard__option${purgeType === 'audit-log' ? ' add-member-wizard__option--selected' : ''}`}
                      onClick={() => setPurgeType('audit-log')}
                    >
                      <span className="add-member-wizard__option-title">Audit Log</span>
                      <span className="add-member-wizard__option-desc">
                        Permanently remove admin action log entries for this family older than
                        a chosen date.
                      </span>
                    </button>
                  </div>
                </div>
                <div className="sa-dialog__actions">
                  <button className="btn btn--secondary" onClick={() => setShowPurgeWizard(false)}>Cancel</button>
                  <button
                    className="btn btn--primary"
                    disabled={purgeType === null}
                    onClick={() => { setPurgeBeforeDate(''); setPurgeKidOid(members.find(m => m.role === 'User')?.oid ?? ''); setPurgeWizardStep('date') }}
                  >
                    Next
                  </button>
                </div>
              </>
            )}

            {/* Step 2 — date (and optional kid for transactions) */}
            {purgeWizardStep === 'date' && !purgeResult && (
              <>
                <div className="sa-dialog__body">
                  {purgeType === 'transactions' && members.some(m => m.role === 'User') && (
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
                      Purge {purgeType === 'transactions' ? 'transactions' : 'log entries'} older than
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
                      {purgeType === 'transactions'
                        ? 'Transactions dated before this date will be permanently deleted. Running balances are unaffected.'
                        : 'Audit log entries with a timestamp before this date will be permanently deleted.'
                      }
                    </p>
                  </div>
                  {purgeError && <p className="sa-form-error" role="alert">{purgeError}</p>}
                </div>
                <div className="sa-dialog__actions">
                  <button className="btn btn--secondary" onClick={() => { setPurgeWizardStep('type'); setPurgeError(null) }}>Back</button>
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

            {/* Step 3 — confirm */}
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
                      {purgeType === 'transactions'
                        ? <>All transactions for <strong>{kidName}</strong> dated before <strong>{cutoff}</strong> will be <strong>permanently deleted</strong>.</>
                        : <>All audit log entries before <strong>{cutoff}</strong> will be <strong>permanently deleted</strong>.</>
                      }
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
    </div>
  )
}
