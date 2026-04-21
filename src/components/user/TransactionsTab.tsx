import { useState, useMemo, useEffect, useRef } from 'react'
import type { Transaction, TransactionCategory } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

interface Props {
  transactions: Transaction[]
  allowDelete: boolean
  allowEdit: boolean
  onDataChange?: () => void | Promise<unknown>
}

type DateRange = '2w' | '1m' | '3m' | '6m' | '1y' | '2y'
type SortOption = 'date-desc' | 'date-asc' | 'amount-asc' | 'amount-desc'

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '2w': 'Last 2 weeks',
  '1m': 'Last 1 month',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '1y': 'Last 1 year',
  '2y': 'Last 2 years',
}

const SORT_LABELS: Record<SortOption, string> = {
  'date-desc': 'Date — newest to oldest',
  'date-asc':  'Date — oldest to newest',
  'amount-asc':  'Amount — least to greatest',
  'amount-desc': 'Amount — greatest to least',
}

function getDateCutoff(range: DateRange): Date {
  const d = new Date()
  switch (range) {
    case '2w': d.setDate(d.getDate() - 14); break
    case '1m': d.setMonth(d.getMonth() - 1); break
    case '3m': d.setMonth(d.getMonth() - 3); break
    case '6m': d.setMonth(d.getMonth() - 6); break
    case '1y': d.setFullYear(d.getFullYear() - 1); break
    case '2y': d.setFullYear(d.getFullYear() - 2); break
  }
  return d
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function formatMoney(amount: number): string {
  return amount < 0 ? `-$${(-amount).toFixed(2)}` : `$${amount.toFixed(2)}`
}

export default function TransactionsTab({ transactions, allowDelete, allowEdit, onDataChange }: Props) {
  const { apiFetch } = useApi()
  const [dateRange, setDateRange] = useState<DateRange>('3m')
  const [search, setSearch]       = useState('')
  const [sortBy, setSortBy]       = useState<SortOption>('date-desc')
  const [refreshing, setRefreshing] = useState(false)

  // ── Edit transaction state ─────────────────────────────────────────────────
  const [editingTxn, setEditingTxn]         = useState<Transaction | null>(null)
  const [editCategory, setEditCategory]     = useState<TransactionCategory>('Income')
  const [editDate, setEditDate]             = useState('')
  const [editAmount, setEditAmount]         = useState('')
  const [editNotes, setEditNotes]           = useState('')
  const [editTithable, setEditTithable]     = useState(true)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError]           = useState<string | null>(null)

  function openEditForm(t: Transaction) {
    setEditingTxn(t)
    setEditCategory(t.category)
    setEditDate(t.date.split('T')[0])
    setEditAmount(String(t.amount))
    setEditNotes(t.notes)
    setEditTithable(t.tithable !== false)
    setEditError(null)
  }

  async function handleEditTransaction(e: React.FormEvent) {
    e.preventDefault()
    if (!editingTxn) return
    setEditError(null)
    const amount = parseFloat(editAmount)
    if (isNaN(amount) || amount <= 0) { setEditError('Amount must be a positive number.'); return }
    setEditSubmitting(true)
    try {
      await apiFetch(`transactions/${encodeURIComponent(editingTxn.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          category: editCategory,
          amount,
          date: editDate,
          notes: editNotes.trim(),
          ...(editCategory === 'Income' && { tithable: editTithable }),
        }),
      })
      if (onDataChange) await onDataChange()
      setEditingTxn(null)
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setEditError(apiErr?.body?.message ?? 'Failed to update transaction.')
    } finally {
      setEditSubmitting(false)
    }
  }

  // ── Delete transaction state ───────────────────────────────────────────────
  const [confirmDeleteTxn, setConfirmDeleteTxn] = useState<Transaction | null>(null)
  const [deleting, setDeleting]                 = useState(false)
  const [deleteError, setDeleteError]           = useState<string | null>(null)

  async function handleDeleteTransaction() {
    if (!confirmDeleteTxn) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`transactions/${encodeURIComponent(confirmDeleteTxn.id)}`, { method: 'DELETE' })
      if (onDataChange) await onDataChange()
      setConfirmDeleteTxn(null)
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setDeleteError(apiErr?.body?.message ?? 'Failed to delete transaction.')
    } finally {
      setDeleting(false)
    }
  }

  // ── Row ellipsis menu ─────────────────────────────────────────────────────
  const TXN_MENU_HEIGHT = 92
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)
  const [menuTxn, setMenuTxn]         = useState<Transaction | null>(null)
  const [menuPos, setMenuPos]         = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenuFor) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    function handleScroll() { closeMenu() }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [openMenuFor])

  function openMenu(t: Transaction, btn: HTMLButtonElement) {
    if (openMenuFor === t.id) { closeMenu(); return }
    const r = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - 4
    const top = spaceBelow >= TXN_MENU_HEIGHT ? r.bottom + 4 : r.top - TXN_MENU_HEIGHT - 4
    setMenuPos({ top, right: window.innerWidth - r.right })
    setOpenMenuFor(t.id)
    setMenuTxn(t)
  }

  function closeMenu() {
    setOpenMenuFor(null)
    setMenuTxn(null)
    setMenuPos(null)
  }

  async function handleRefresh() {
    if (!onDataChange) return
    setRefreshing(true)
    try { await onDataChange() } finally { setRefreshing(false) }
  }

  const filtered = useMemo(() => {
    const cutoff = getDateCutoff(dateRange)
    return transactions
      .filter(t => {
        const txDate = new Date(t.date)
        if (txDate < cutoff) return false
        if (search.trim() && !t.notes.toLowerCase().includes(search.trim().toLowerCase())) return false
        return true
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'date-desc': {
            const p = b.date.localeCompare(a.date)
            return p !== 0 ? p : (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date)
          }
          case 'date-asc': {
            const p = a.date.localeCompare(b.date)
            return p !== 0 ? p : (a.createdAt ?? a.date).localeCompare(b.createdAt ?? b.date)
          }
          case 'amount-asc':  return a.amount - b.amount
          case 'amount-desc': return b.amount - a.amount
          default:            return 0
        }
      })
  }, [transactions, dateRange, search, sortBy])

  const showActions = allowDelete || allowEdit

  return (
    <div className="transactions-tab">
      {onDataChange && (
        <div className="transactions-tab__toolbar">
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? '\u21bb Refreshing…' : '\u21bb Refresh'}
          </button>
        </div>
      )}
      <div className="transactions-tab__filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="date-range">Date Range</label>
          <select
            id="date-range"
            className="filter-select"
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
          >
            {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map(k => (
              <option key={k} value={k}>{DATE_RANGE_LABELS[k]}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="search">Search Notes</label>
          <input
            id="search"
            className="filter-input"
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="sort-by">Sort By</label>
          <select
            id="sort-by"
            className="filter-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
          >
            {(Object.keys(SORT_LABELS) as SortOption[]).map(k => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">No transactions found for the selected filters.</p>
      ) : (
        <div className="table-wrapper">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Balance</th>
                <th>Notes</th>
                {showActions && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
                  <td className="td-date">{formatDate(t.date)}</td>
                  <td>
                    <span className={`type-badge type-badge--${t.category.toLowerCase()}`}>
                      {t.category}
                    </span>
                  </td>
                  <td className={`td-amount td-amount--${t.category === 'Income' ? 'income' : 'withdrawal'}`}>
                    {t.category !== 'Income' ? '−' : '+'}{formatMoney(t.amount)}
                  </td>
                  <td className="td-balance">
                    {t.balanceAfter !== undefined ? formatMoney(t.balanceAfter) : '—'}
                  </td>
                  <td className="td-notes">{t.notes || '—'}</td>
                  {showActions && (
                    <td className="td-actions">
                      <button
                        className="txn-menu-btn"
                        aria-label="Transaction options"
                        aria-expanded={openMenuFor === t.id}
                        onClick={e => openMenu(t, e.currentTarget)}
                      >
                        ⋮
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="results-count">
        Showing {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* ── Row ellipsis menu (floats above overflow:hidden) ─────────────── */}
      {openMenuFor && menuPos && menuTxn && (
        <div ref={menuRef}>
          <div className="chore-menu" role="menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}>
            {allowEdit && (
              <button
                className="chore-menu__item"
                role="menuitem"
                onClick={() => { closeMenu(); openEditForm(menuTxn) }}
              >
                Edit
              </button>
            )}
            {allowDelete && (
              <button
                className="chore-menu__item chore-menu__item--delete"
                role="menuitem"
                onClick={() => { closeMenu(); setConfirmDeleteTxn(menuTxn); setDeleteError(null) }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Transaction dialog ─────────────────────────────────────── */}
      {editingTxn && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-txn-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="edit-txn-title">Edit Transaction</p>
            <form onSubmit={handleEditTransaction}>
              <div className="sa-dialog__body">
                <div className="sa-form-row">
                  <div className="sa-form-group sa-form-group--grow">
                    <label className="form-label" htmlFor="edit-txn-cat">Category</label>
                    <select id="edit-txn-cat" className="form-select" value={editCategory}
                      onChange={e => setEditCategory(e.target.value as TransactionCategory)}>
                      <option value="Income">Income</option>
                      <option value="Purchase">Purchase</option>
                      <option value="Tithing">Tithing</option>
                    </select>
                  </div>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="edit-txn-date">Date</label>
                    <input id="edit-txn-date" className="form-input" type="date"
                      value={editDate} onChange={e => setEditDate(e.target.value)} required />
                  </div>
                </div>
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="edit-txn-amount">Amount ($)</label>
                  <input id="edit-txn-amount" className="form-input" type="number"
                    min="0.01" step="any" placeholder="0.00"
                    value={editAmount} onChange={e => setEditAmount(e.target.value)} required />
                </div>
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="edit-txn-notes">Notes (optional)</label>
                  <input id="edit-txn-notes" className="form-input" type="text" maxLength={500}
                    value={editNotes} onChange={e => setEditNotes(e.target.value)} />
                </div>
                {editCategory === 'Income' && (
                  <div className="sa-form-group">
                    <label className="form-label form-label--checkbox">
                      <input type="checkbox" checked={editTithable}
                        onChange={e => setEditTithable(e.target.checked)} />
                      {' '}Tithable income (adds 10% to Tithing Owed)
                    </label>
                  </div>
                )}
                {editError && <p className="sa-form-error" role="alert">{editError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button type="button" className="btn btn--secondary"
                  onClick={() => setEditingTxn(null)} disabled={editSubmitting}>Cancel</button>
                <button type="submit" className="btn btn--primary" disabled={editSubmitting}>
                  {editSubmitting ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirmation dialog ─────────────────────────────────── */}
      {confirmDeleteTxn && (
        <div className="sa-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="sa-dialog">
            <p className="sa-dialog__title">Delete Transaction?</p>
            <div className="sa-dialog__body">
              <p>
                Delete this {confirmDeleteTxn.category} of <strong>${confirmDeleteTxn.amount.toFixed(2)}</strong>
                {confirmDeleteTxn.notes ? ` (${confirmDeleteTxn.notes})` : ''}? This cannot be undone.
              </p>
              {deleteError && <p className="sa-form-error" role="alert" style={{ marginTop: 8 }}>{deleteError}</p>}
            </div>
            <div className="sa-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmDeleteTxn(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDeleteTransaction} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
