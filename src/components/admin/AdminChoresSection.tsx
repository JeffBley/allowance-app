import { useState, useRef, useEffect } from 'react'
import type { Chore, KidView } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

interface Props {
  chores: Chore[]
  kids: KidView[]
  onChoresChange: () => void | Promise<unknown>
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Add / Edit Chore Modal
// ---------------------------------------------------------------------------
interface ChoreModalProps {
  initial?: Chore
  onSave: (name: string, amount: number) => Promise<void>
  onClose: () => void
}

function ChoreModal({ initial, onSave, onClose }: ChoreModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    const amt = parseFloat(amount)
    if (!trimmed) { setError('Chore name is required.'); return }
    if (trimmed.length > 100) { setError('Name must be 100 characters or fewer.'); return }
    if (isNaN(amt) || amt <= 0) { setError('Amount must be a positive number.'); return }
    if (amt > 10000) { setError('Amount must be $10,000 or less.'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed, Math.round(amt * 100) / 100)
    } catch (err) {
      const body = (err as { body?: { message?: string } })?.body
      setError(body?.message ?? 'Failed to save chore.')
      setSaving(false)
    }
  }

  return (
    <div className="sa-dialog-overlay" onClick={onClose}>
      <div className="sa-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="sa-dialog__title">{initial ? 'Edit Chore' : 'Add Chore'}</h3>
        <form onSubmit={handleSubmit} className="chore-form">
          <label className="chore-form__label">
            Chore name
            <input
              ref={nameRef}
              className="chore-form__input"
              type="text"
              value={name}
              maxLength={100}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Mow the lawn"
            />
          </label>
          <label className="chore-form__label">
            Amount ($)
            <input
              className="chore-form__input"
              type="number"
              value={amount}
              min="0.01"
              max="10000"
              step="0.01"
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          {error && <p className="chore-form__error">{error}</p>}
          <div className="sa-dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving || !name.trim() || !amount}>
              {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Add Chore')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Complete Chore Modal
// ---------------------------------------------------------------------------
interface CompleteModalProps {
  chore: Chore
  kids: KidView[]
  onClose: () => void
  onComplete: () => void
}

function CompleteChoreModal({ chore, kids, onClose, onComplete }: CompleteModalProps) {
  const { apiFetch } = useApi()
  const [kidOid, setKidOid] = useState(kids[0]?.oid ?? '')
  const [tithable, setTithable] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!kidOid) { setError('Please select a child.'); return }
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch('transactions', {
        method: 'POST',
        body: JSON.stringify({
          kidOid,
          category: 'Income',
          amount: chore.amount,
          notes: `Chore: ${chore.name}`,
          date: today,
          tithable,
        }),
      })
      onComplete()
    } catch (err) {
      const body = (err as { body?: { message?: string } })?.body
      setError(body?.message ?? 'Failed to complete chore.')
      setSubmitting(false)
    }
  }

  return (
    <div className="sa-dialog-overlay" onClick={onClose}>
      <div className="sa-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="sa-dialog__title">Complete Chore: {chore.name}</h3>
        <p className="chore-complete__subtitle">
          Credits {fmt(chore.amount)} as income to the selected child.
        </p>
        <form onSubmit={handleSubmit} className="chore-form">
          <label className="chore-form__label">
            Who completed the chore?
            <select
              className="chore-form__input"
              value={kidOid}
              onChange={e => setKidOid(e.target.value)}
            >
              {kids.map(k => (
                <option key={k.oid} value={k.oid}>{k.displayName}</option>
              ))}
            </select>
          </label>
          <label className="chore-form__checkbox-row">
            <input
              type="checkbox"
              checked={tithable}
              onChange={e => setTithable(e.target.checked)}
            />
            Count toward tithing (10% owed)
          </label>
          {error && <p className="chore-form__error">{error}</p>}
          <div className="sa-dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting || !kidOid}>
              {submitting ? 'Completing…' : 'Complete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chore row with ellipsis menu
// ---------------------------------------------------------------------------
interface ChoreRowProps {
  chore: Chore
  onComplete: () => void
  onEdit: () => void
  onDelete: () => void
}

function ChoreRow({ chore, onComplete, onEdit, onDelete }: ChoreRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  function handleOpenMenu() {
    if (menuOpen) { setMenuOpen(false); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setMenuOpen(true)
  }

  return (
    <div className="chore-row">
      <span className="chore-row__name">{chore.name}</span>
      <span className="chore-row__amount">{fmt(chore.amount)}</span>
      <div className="chore-row__menu-wrap" ref={menuRef}>
        <button
          ref={btnRef}
          className="chore-row__menu-btn"
          onClick={handleOpenMenu}
          aria-label="Chore options"
          aria-expanded={menuOpen}
        >
          •••
        </button>
        {menuOpen && menuPos && (
          <div
            className="chore-menu"
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}
          >
            <button
              className="chore-menu__item chore-menu__item--complete"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onComplete() }}
            >
              ✓ Complete
            </button>
            <button
              className="chore-menu__item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onEdit() }}
            >
              Edit
            </button>
            <button
              className="chore-menu__item chore-menu__item--delete"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onDelete() }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdminChoresSection — main export
// ---------------------------------------------------------------------------
export default function AdminChoresSection({ chores, kids, onChoresChange }: Props) {
  const { apiFetch } = useApi()

  type Modal =
    | { type: 'add' }
    | { type: 'edit'; chore: Chore }
    | { type: 'complete'; chore: Chore }
    | { type: 'delete'; chore: Chore }

  const [modal, setModal] = useState<Modal | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleSaveChore(name: string, amount: number) {
    if (modal?.type === 'edit') {
      await apiFetch(`chores/${modal.chore.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, amount }),
      })
    } else {
      await apiFetch('chores', {
        method: 'POST',
        body: JSON.stringify({ name, amount }),
      })
    }
    setModal(null)
    await onChoresChange()
  }

  async function handleDelete() {
    if (modal?.type !== 'delete') return
    setDeleting(true)
    try {
      await apiFetch(`chores/${modal.chore.id}`, { method: 'DELETE' })
      setModal(null)
      await onChoresChange()
    } catch (err) {
      console.error('Failed to delete chore', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="chore-section" aria-label="Chores">
      <div className="chore-section__header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>Chores</h2>
        <button className="btn btn--primary btn--sm" onClick={() => setModal({ type: 'add' })}>
          + Add Chore
        </button>
      </div>

      {chores.length === 0 ? (
        <p className="chore-section__empty">No chores yet. Click &ldquo;Add Chore&rdquo; to get started.</p>
      ) : (
        <div className="chore-list">
          {chores.map(chore => (
            <ChoreRow
              key={chore.id}
              chore={chore}
              onComplete={() => setModal({ type: 'complete', chore })}
              onEdit={() => setModal({ type: 'edit', chore })}
              onDelete={() => setModal({ type: 'delete', chore })}
            />
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <ChoreModal
          initial={modal.type === 'edit' ? modal.chore : undefined}
          onSave={handleSaveChore}
          onClose={() => setModal(null)}
        />
      )}

      {/* Complete modal */}
      {modal?.type === 'complete' && kids.length > 0 && (
        <CompleteChoreModal
          chore={modal.chore}
          kids={kids}
          onClose={() => setModal(null)}
          onComplete={async () => { setModal(null); await onChoresChange() }}
        />
      )}

      {/* Delete confirmation */}
      {modal?.type === 'delete' && (
        <div className="sa-dialog-overlay" onClick={() => setModal(null)}>
          <div className="sa-dialog" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <h3 className="sa-dialog__title">Delete Chore?</h3>
            <div className="sa-dialog__body">
              <p>Are you sure you want to delete &ldquo;<strong>{modal.chore.name}</strong>&rdquo;?</p>
              <p>This cannot be undone. Previously completed transactions are not affected.</p>
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setModal(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
