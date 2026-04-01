import { useState, useEffect, useCallback } from 'react'
import {
  getFamily, updateFamily, deleteFamily,
  createMember, createLocalMember, updateMember, deleteMember,
  listInvites, generateInvite, revokeInvite, sendInviteEmail,
  addTransaction, purgeTransactions,
  SaApiError,
  type SaFamily, type SaMember, type CreateMemberPayload, type SaInviteCode, type GenerateInvitePayload,
  type AddTransactionPayload, type PurgeTransactionsResult,
} from './saApi'

interface Props {
  familyId: string
  onBack: () => void
}

type MemberFormState = Omit<CreateMemberPayload, 'kidSettings'> & {
  allowanceEnabled: boolean
  allowanceAmount: string
  allowanceFrequency: string
  dayOfWeek: string
  timeOfDay: string
  timezone: string
}

const EMPTY_FORM: MemberFormState = {
  oid: '',
  displayName: '',
  role: 'User',
  allowanceEnabled: false,
  allowanceAmount: '5',
  allowanceFrequency: 'Weekly',
  dayOfWeek: '5',
  timeOfDay: '08:00',
  timezone: 'America/Chicago',
}

const DAYS_OF_WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const FREQUENCIES  = ['Weekly','Bi-weekly','Monthly']
const TIMEZONES    = [
  { label: 'Eastern (ET)',  value: 'America/New_York'    },
  { label: 'Central (CT)',  value: 'America/Chicago'     },
  { label: 'Mountain (MT)', value: 'America/Denver'      },
  { label: 'AZ (no DST)',   value: 'America/Phoenix'     },
  { label: 'Pacific (PT)',  value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage'   },
  { label: 'Hawaii (HT)',   value: 'Pacific/Honolulu'    },
]

function buildPayload(form: MemberFormState): CreateMemberPayload {
  const base: CreateMemberPayload = {
    oid:         form.oid.trim(),
    displayName: form.displayName.trim(),
    role:        form.role,
  }
  if (form.role === 'User' && form.allowanceEnabled) {
    base.kidSettings = {
      allowanceEnabled:   true,
      allowanceAmount:    parseFloat(form.allowanceAmount) || 0,
      allowanceFrequency: form.allowanceFrequency,
      dayOfWeek:          parseInt(form.dayOfWeek, 10),
      timeOfDay:          form.timeOfDay,
      timezone:           form.timezone,
    }
  } else if (form.role === 'User') {
    base.kidSettings = {
      allowanceEnabled:   false,
      allowanceAmount:    parseFloat(form.allowanceAmount) || 0,
      allowanceFrequency: form.allowanceFrequency,
      timezone:           form.timezone,
    }
  }
  return base
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

  // Add / edit member form
  const [showMemberForm, setShowMemberForm] = useState(false)
  const [editingMember, setEditingMember]   = useState<SaMember | null>(null)
  const [form, setForm]                     = useState<MemberFormState>(EMPTY_FORM)
  const [formError, setFormError]           = useState<string | null>(null)
  const [savingMember, setSavingMember]     = useState(false)

  // Delete member
  const [confirmDeleteMember, setConfirmDeleteMember] = useState<SaMember | null>(null)
  const [deletingMember, setDeletingMember]           = useState<string | null>(null)

  // Add Member wizard
  const [showAddMemberWizard, setShowAddMemberWizard] = useState(false)
  const [addMemberMode, setAddMemberMode]             = useState<'choose' | 'local' | 'entra'>('choose')
  const [localMemberName, setLocalMemberName]         = useState('')
  const [creatingLocalMember, setCreatingLocalMember] = useState(false)
  const [localMemberError, setLocalMemberError]       = useState<string | null>(null)

  // Invite codes
  const [invites, setInvites]               = useState<SaInviteCode[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteRole, setInviteRole]         = useState<'User' | 'FamilyAdmin'>('FamilyAdmin')
  const [inviteNameHint, setInviteNameHint] = useState('')
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [inviteError, setInviteError]       = useState<string | null>(null)

  // Purge transactions
  const [purgeKidOid, setPurgeKidOid]         = useState<string>('')
  const [purgeBeforeDate, setPurgeBeforeDate] = useState<string>('')
  const [purgeSubmitting, setPurgeSubmitting] = useState(false)
  const [purgeError, setPurgeError]           = useState<string | null>(null)
  const [purgeResult, setPurgeResult]         = useState<PurgeTransactionsResult | null>(null)
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const [newCode, setNewCode]               = useState<SaInviteCode | null>(null)  // just-created code to display
  const [revokingCode, setRevokingCode]     = useState<string | null>(null)
  const [confirmRevokeCode, setConfirmRevokeCode] = useState<SaInviteCode | null>(null)
  const [regeneratingCode, setRegeneratingCode]   = useState<string | null>(null)

  // Email invite
  const [emailInvite, setEmailInvite]   = useState<SaInviteCode | null>(null)
  const [emailAddress, setEmailAddress] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailError, setEmailError]     = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState(false)

  // Add transaction
  const [showAddTxn, setShowAddTxn]           = useState(false)
  const [addTxnKidOid, setAddTxnKidOid]       = useState('')
  const [addTxnCategory, setAddTxnCategory]   = useState<AddTransactionPayload['category']>('Income')
  const [addTxnDate, setAddTxnDate]           = useState(() => new Date().toISOString().split('T')[0])
  const [addTxnAmount, setAddTxnAmount]       = useState('')
  const [addTxnNotes, setAddTxnNotes]         = useState('')
  const [addTxnTithable, setAddTxnTithable]   = useState(true)
  const [addTxnSubmitting, setAddTxnSubmitting] = useState(false)
  const [addTxnError, setAddTxnError]         = useState<string | null>(null)

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

  async function handleGenerateInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setGeneratingInvite(true)
    try {
      const payload: GenerateInvitePayload = {
        role: inviteRole,
        displayNameHint: inviteNameHint.trim() || undefined,
      }
      const created = await generateInvite(familyId, payload)
      setNewCode(created)
      setInvites(prev => [created, ...prev])
      setShowInviteForm(false)
      setInviteNameHint('')
    } catch (err) {
      setInviteError(err instanceof SaApiError ? err.message : 'Failed to generate invite.')
    } finally {
      setGeneratingInvite(false)
    }
  }

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

  function openAddTxn() {
    const firstKid = members.find(m => m.role === 'User')
    setAddTxnKidOid(firstKid?.oid ?? '')
    setAddTxnCategory('Income')
    setAddTxnDate(new Date().toISOString().split('T')[0])
    setAddTxnAmount('')
    setAddTxnNotes('')
    setAddTxnTithable(true)
    setAddTxnError(null)
    setShowAddTxn(true)
  }

  async function handleAddTxn(e: React.FormEvent) {
    e.preventDefault()
    setAddTxnError(null)
    const amount = parseFloat(addTxnAmount)
    if (isNaN(amount) || amount <= 0) {
      setAddTxnError('Amount must be a positive number.')
      return
    }
    if (!addTxnKidOid) {
      setAddTxnError('Please select a child.')
      return
    }
    setAddTxnSubmitting(true)
    try {
      const payload: AddTransactionPayload = {
        kidOid:   addTxnKidOid,
        category: addTxnCategory,
        amount,
        date:     addTxnDate,
        notes:    addTxnNotes.trim(),
        ...(addTxnCategory === 'Income' && { tithable: addTxnTithable }),
      }
      await addTransaction(familyId, payload)
      setShowAddTxn(false)
    } catch (err) {
      setAddTxnError(err instanceof SaApiError ? err.message : 'Failed to add transaction.')
    } finally {
      setAddTxnSubmitting(false)
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
    const ks = m.kidSettings as Record<string, unknown> | undefined
    setEditingMember(m)
    setForm({
      oid:               m.oid,
      displayName:       m.displayName,
      role:              m.role,
      allowanceEnabled:  Boolean(ks?.allowanceEnabled),
      allowanceAmount:   String(ks?.allowanceAmount ?? '5'),
      allowanceFrequency: String(ks?.allowanceFrequency ?? 'Weekly'),
      dayOfWeek:         String(ks?.dayOfWeek ?? '5'),
      timeOfDay:         String(ks?.timeOfDay ?? '08:00'),
      timezone:          String(ks?.timezone ?? 'America/Chicago'),
    })
    setFormError(null)
    setShowMemberForm(true)
  }

  function cancelForm() {
    setShowMemberForm(false)
    setEditingMember(null)
    setFormError(null)
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
              <button className="btn btn--secondary btn--sm" onClick={openAddTxn}
                disabled={!members.some(m => m.role === 'User')}>
                + Add Transaction
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => { setShowAddMemberWizard(true); setAddMemberMode('choose'); setLocalMemberName(''); setLocalMemberError(null) }}
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
                    <th>Allowance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const ks = m.kidSettings as Record<string, unknown> | undefined
                    return (
                      <tr key={m.oid}>
                        <td className="sa-member-name">{m.displayName}</td>
                        <td>
                          <span className={`sa-role-badge sa-role-badge--${m.role === 'FamilyAdmin' ? 'admin' : 'user'}`}>
                            {m.role}
                          </span>
                        </td>
                        <td><code className="sa-code sa-code--sm">{m.oid}</code></td>
                        <td className="td-date">
                          {ks?.allowanceEnabled
                            ? `$${ks.allowanceAmount} / ${ks.allowanceFrequency}`
                            : '—'}
                        </td>
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
                      onClick={() => { setShowAddMemberWizard(false); openAddMember() }}
                    >
                      <span className="add-member-wizard__option-title">Invite account</span>
                      <span className="add-member-wizard__option-desc">
                        Manually add an Entra account by OID — for users who already have an account.
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
                    disabled={!!editingMember}
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

              {form.role === 'User' && (
                <div className="sa-allowance-section">
                  <div className="form-toggle-row">
                    <span className="sa-form-label">Allowance Schedule</span>
                    <label className="toggle-switch" aria-label="Enable allowance schedule">
                      <input
                        type="checkbox"
                        checked={form.allowanceEnabled}
                        onChange={e => setField('allowanceEnabled', e.target.checked)}
                      />
                      <span className="toggle-switch__track" />
                    </label>
                  </div>

                  {form.allowanceEnabled && (
                    <div className="sa-allowance-fields">
                      <div className="sa-form-row">
                        <div className="sa-form-group">
                          <label className="sa-form-label" htmlFor="m-amt">Amount ($)</label>
                          <input
                            id="m-amt"
                            className="sa-form-input"
                            type="number"
                            min="0" step="0.50"
                            value={form.allowanceAmount}
                            onChange={e => setField('allowanceAmount', e.target.value)}
                          />
                        </div>
                        <div className="sa-form-group">
                          <label className="sa-form-label" htmlFor="m-freq">Frequency</label>
                          <select
                            id="m-freq"
                            className="sa-form-select"
                            value={form.allowanceFrequency}
                            onChange={e => setField('allowanceFrequency', e.target.value)}
                          >
                            {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        {form.allowanceFrequency !== 'Monthly' && (
                          <div className="sa-form-group">
                            <label className="sa-form-label" htmlFor="m-day">Day</label>
                            <select
                              id="m-day"
                              className="sa-form-select"
                              value={form.dayOfWeek}
                              onChange={e => setField('dayOfWeek', e.target.value)}
                            >
                              {DAYS_OF_WEEK.map((d, i) => <option key={d} value={i}>{d}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                      <div className="sa-form-row">
                        <div className="sa-form-group">
                          <label className="sa-form-label" htmlFor="m-time">Time</label>
                          <input
                            id="m-time"
                            className="sa-form-input"
                            type="time"
                            value={form.timeOfDay}
                            onChange={e => setField('timeOfDay', e.target.value)}
                          />
                        </div>
                        <div className="sa-form-group sa-form-group--grow">
                          <label className="sa-form-label" htmlFor="m-tz">Timezone</label>
                          <select
                            id="m-tz"
                            className="sa-form-select"
                            value={form.timezone}
                            onChange={e => setField('timezone', e.target.value)}
                          >
                            {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
              onClick={() => { setShowInviteForm(s => !s); setInviteError(null) }}
            >
              {showInviteForm ? 'Cancel' : '+ Generate Invite'}
            </button>
          </div>

          {showInviteForm && (
            <form className="sa-inline-form" onSubmit={handleGenerateInvite}>
              <h3 className="sa-inline-form__title">Generate Invite Code</h3>
              <div className="sa-form-row">
                <div className="sa-form-group">
                  <label className="sa-form-label" htmlFor="inv-role">Role</label>
                  <select
                    id="inv-role"
                    className="sa-form-select"
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as 'User' | 'FamilyAdmin')}
                  >
                    <option value="FamilyAdmin">FamilyAdmin (parent)</option>
                    <option value="User">User (kid)</option>
                  </select>
                </div>
                <div className="sa-form-group sa-form-group--grow">
                  <label className="sa-form-label" htmlFor="inv-hint">Name Hint (optional)</label>
                  <input
                    id="inv-hint"
                    className="sa-form-input"
                    type="text"
                    placeholder="e.g. Jacob"
                    value={inviteNameHint}
                    onChange={e => setInviteNameHint(e.target.value)}
                  />
                </div>
              </div>
              {inviteError && <p className="sa-form-error" role="alert">{inviteError}</p>}
              <div className="sa-form-actions">
                <button className="btn btn--primary" type="submit" disabled={generatingInvite}>
                  {generatingInvite ? 'Generating…' : 'Generate Code'}
                </button>
              </div>
            </form>
          )}

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

      {/* Add Transaction dialog */}
      {showAddTxn && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="sa-add-txn-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="sa-add-txn-title">Add Transaction</p>
            <form onSubmit={handleAddTxn}>
              <div className="sa-dialog__body">
                <div className="sa-form-row">
                  <div className="sa-form-group sa-form-group--grow">
                    <label className="sa-form-label" htmlFor="sa-txn-kid">Child</label>
                    <select
                      id="sa-txn-kid"
                      className="sa-form-select"
                      value={addTxnKidOid}
                      onChange={e => setAddTxnKidOid(e.target.value)}
                      required
                    >
                      {members.filter(m => m.role === 'User').map(m => (
                        <option key={m.oid} value={m.oid}>{m.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-txn-cat">Category</label>
                    <select
                      id="sa-txn-cat"
                      className="sa-form-select"
                      value={addTxnCategory}
                      onChange={e => { setAddTxnCategory(e.target.value as AddTransactionPayload['category']); setAddTxnTithable(true) }}
                    >
                      <option value="Income">Income</option>
                      <option value="Purchase">Purchase</option>
                      <option value="Tithing">Tithing</option>
                    </select>
                  </div>
                </div>
                <div className="sa-form-row">
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-txn-date">Date</label>
                    <input
                      id="sa-txn-date"
                      className="sa-form-input"
                      type="date"
                      value={addTxnDate}
                      onChange={e => setAddTxnDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-txn-amount">Amount ($)</label>
                    <input
                      id="sa-txn-amount"
                      className="sa-form-input"
                      type="number"
                      min="0.01"
                      step="any"
                      placeholder="0.00"
                      value={addTxnAmount}
                      onChange={e => setAddTxnAmount(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="sa-form-group">
                  <label className="sa-form-label" htmlFor="sa-txn-notes">Notes (optional)</label>
                  <input
                    id="sa-txn-notes"
                    className="sa-form-input"
                    type="text"
                    maxLength={500}
                    placeholder="e.g., Chore payment"
                    value={addTxnNotes}
                    onChange={e => setAddTxnNotes(e.target.value)}
                  />
                </div>
                {addTxnCategory === 'Income' && (
                  <div className="sa-form-group">
                    <label className="sa-form-label sa-form-label--checkbox">
                      <input
                        type="checkbox"
                        checked={addTxnTithable}
                        onChange={e => setAddTxnTithable(e.target.checked)}
                      />
                      {' '}Tithable income (adds 10% to Tithing Owed)
                    </label>
                  </div>
                )}
                {addTxnError && <p className="sa-form-error" role="alert">{addTxnError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setShowAddTxn(false)}
                  disabled={addTxnSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={addTxnSubmitting}
                >
                  {addTxnSubmitting ? 'Adding…' : 'Add Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
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

      {/* ── Transaction Maintenance ── */}
      {family && !loading && members.some(m => m.role === 'User') && (
        <>
          <div className="sa-section-header" style={{ marginTop: 8 }}>
            <h3 className="sa-section-title">Transaction Maintenance</h3>
          </div>
          <div className="sa-inline-form">
            <p className="sa-form-hint" style={{ marginBottom: 12 }}>
              Purge old transactions for a kid. Their financial contributions are accumulated
              into a running base so balances remain accurate after records are deleted.
            </p>
            <div className="sa-form-row">
              <div className="sa-form-group">
                <label className="sa-form-label" htmlFor="purge-kid">Child</label>
                <select
                  id="purge-kid"
                  className="sa-form-select"
                  value={purgeKidOid}
                  onChange={e => { setPurgeKidOid(e.target.value); setPurgeResult(null); setPurgeError(null) }}
                >
                  <option value="">— select a child —</option>
                  {members.filter(m => m.role === 'User').map(m => (
                    <option key={m.oid} value={m.oid}>{m.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="sa-form-group">
                <label className="sa-form-label" htmlFor="purge-before">Purge transactions before</label>
                <input
                  id="purge-before"
                  className="sa-form-input"
                  type="date"
                  value={purgeBeforeDate}
                  onChange={e => { setPurgeBeforeDate(e.target.value); setPurgeResult(null); setPurgeError(null) }}
                />
              </div>
            </div>
            {purgeError && <p className="sa-form-error" role="alert">{purgeError}</p>}
            {purgeResult && (
              <div className="sa-purge-result">
                {purgeResult.purgedCount === 0
                  ? <p>No transactions found before that date for this child.</p>
                  : <p>
                      Purged <strong>{purgeResult.purgedCount}</strong> transaction(s).
                      {purgeResult.skippedCount > 0 && ` (${purgeResult.skippedCount} could not be deleted.)`}
                      {' '}Balance delta: <strong>${purgeResult.purgedBalanceDelta.toFixed(2)}</strong>,
                      tithing delta: <strong>${purgeResult.purgedTithingOwedDelta.toFixed(2)}</strong>.
                    </p>
                }
              </div>
            )}
            <div className="sa-form-actions">
              <button
                className="btn btn--danger btn--sm"
                disabled={!purgeKidOid || !purgeBeforeDate || purgeSubmitting}
                onClick={() => { setPurgeError(null); setPurgeResult(null); setShowPurgeConfirm(true) }}
              >
                Purge Transactions
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirm purge */}
      {showPurgeConfirm && (() => {
        const kidName = members.find(m => m.oid === purgeKidOid)?.displayName ?? purgeKidOid
        const cutoff  = new Date(purgeBeforeDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
            <div className="sa-dialog">
              <p className="sa-dialog__title">Purge Transactions?</p>
              <div className="sa-dialog__body">
                <p>
                  This will permanently delete all transactions for <strong>{kidName}</strong>{' '}
                  dated before <strong>{cutoff}</strong>.
                </p>
                <p>
                  Their contributions will be accumulated into a running base so the balance
                  and tithing owed remain correct. This cannot be undone.
                </p>
              </div>
              <div className="sa-dialog__actions">
                <button
                  className="btn btn--secondary"
                  onClick={() => setShowPurgeConfirm(false)}
                  disabled={purgeSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn--danger"
                  disabled={purgeSubmitting}
                  onClick={async () => {
                    setShowPurgeConfirm(false)
                    setPurgeSubmitting(true)
                    setPurgeError(null)
                    setPurgeResult(null)
                    try {
                      const result = await purgeTransactions(familyId, {
                        kidOid: purgeKidOid,
                        beforeDate: new Date(purgeBeforeDate).toISOString(),
                      })
                      setPurgeResult(result)
                    } catch (err) {
                      setPurgeError(err instanceof SaApiError ? err.message : 'Purge failed. Please try again.')
                    } finally {
                      setPurgeSubmitting(false)
                    }
                  }}
                >
                  {purgeSubmitting ? 'Purging…' : 'Purge'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
