import { useState, useMemo, useEffect } from 'react'
import type { KidView, Transaction, TransactionCategory } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

const PAGE_SIZE = 50

interface Props {
  kids: KidView[]
  allTransactions: Transaction[]
  onDataChange: () => void | Promise<unknown>
}

interface AdminTransaction extends Transaction {
  childOid: string
  childName: string
}

type DateRange = '1d' | '3d' | '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | '2y'
type SortOption = 'date-desc' | 'date-asc' | 'amount-asc' | 'amount-desc'

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '1d': 'Last 1 day',
  '3d': 'Last 3 days',
  '1w': 'Last 1 week',
  '2w': 'Last 2 weeks',
  '1m': 'Last 1 month',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '1y': 'Last 1 year',
  '2y': 'Last 2 years',
}

const SORT_LABELS: Record<SortOption, string> = {
  'date-desc':   'Date — newest to oldest',
  'date-asc':    'Date — oldest to newest',
  'amount-asc':  'Amount — least to greatest',
  'amount-desc': 'Amount — greatest to least',
}

function getDateCutoff(range: DateRange): Date {
  const d = new Date()
  switch (range) {
    case '1d': d.setDate(d.getDate() - 1);        break
    case '3d': d.setDate(d.getDate() - 3);        break
    case '1w': d.setDate(d.getDate() - 7);        break
    case '2w': d.setDate(d.getDate() - 14);       break
    case '1m': d.setMonth(d.getMonth() - 1);      break
    case '3m': d.setMonth(d.getMonth() - 3);      break
    case '6m': d.setMonth(d.getMonth() - 6);      break
    case '1y': d.setFullYear(d.getFullYear() - 1); break
    case '2y': d.setFullYear(d.getFullYear() - 2); break
  }
  return d
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

export default function AdminTransactionsTab({ kids, allTransactions, onDataChange }: Props) {
  const { apiFetch } = useApi()
  const [dateRange, setDateRange] = useState<DateRange>('2w')
  const [search, setSearch]       = useState('')
  const [sortBy, setSortBy]       = useState<SortOption>('date-desc')
  const [childFilter, setChildFilter] = useState<string | 'all'>('all')
  const [page, setPage]           = useState(1)

  // ── Edit transaction state ─────────────────────────────────────────────────
  const [editingTxn, setEditingTxn]         = useState<AdminTransaction | null>(null)
  const [editCategory, setEditCategory]     = useState<TransactionCategory>('Income')
  const [editDate, setEditDate]             = useState('')
  const [editAmount, setEditAmount]         = useState('')
  const [editNotes, setEditNotes]           = useState('')
  const [editTithable, setEditTithable]     = useState(true)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError]           = useState<string | null>(null)

  function openEditForm(t: AdminTransaction) {
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
      onDataChange()
      setEditingTxn(null)
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setEditError(apiErr?.body?.message ?? 'Failed to update transaction.')
    } finally {
      setEditSubmitting(false)
    }
  }

  // ── Delete transaction state ───────────────────────────────────────────────
  const [confirmDeleteTxn, setConfirmDeleteTxn] = useState<AdminTransaction | null>(null)
  const [deleting, setDeleting]                 = useState(false)
  const [deleteError, setDeleteError]           = useState<string | null>(null)

  async function handleDeleteTransaction() {
    if (!confirmDeleteTxn) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`transactions/${encodeURIComponent(confirmDeleteTxn.id)}`, { method: 'DELETE' })
      onDataChange()
      setConfirmDeleteTxn(null)
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setDeleteError(apiErr?.body?.message ?? 'Failed to delete transaction.')
    } finally {
      setDeleting(false)
    }
  }

  // ── Add transaction form state ─────────────────────────────────────────────
  const [showAddForm, setShowAddForm]     = useState(false)
  const [addKidOid, setAddKidOid]         = useState<string>(() => kids[0]?.oid ?? '')
  const [addCategory, setAddCategory]     = useState<TransactionCategory>('Income')
  const [addDate, setAddDate]             = useState<string>(() => new Date().toISOString().split('T')[0])
  const [addAmount, setAddAmount]         = useState<string>('')
  const [addHours, setAddHours]           = useState<string>('')
  const [addNotes, setAddNotes]           = useState<string>('')
  const [addTithable, setAddTithable]     = useState(true)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError]           = useState<string | null>(null)

  function openAddForm() {
    setAddKidOid(kids[0]?.oid ?? '')
    setAddCategory('Income')
    setAddDate(new Date().toISOString().split('T')[0])
    setAddAmount('')
    setAddHours('')
    setAddNotes('')
    setAddTithable(true)
    setAddError(null)
    setShowAddForm(true)
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    const addKidData     = kids.find(k => k.oid === addKidOid)
    const kidWagesOn     = addKidData?.kidSettings?.hourlyWagesEnabled === true && addCategory === 'Income'
    const kidWageRate    = addKidData?.kidSettings?.hourlyWageRate ?? 10
    const hoursNum       = parseFloat(addHours) || 0
    const amount         = kidWagesOn && hoursNum > 0
      ? Math.round(hoursNum * kidWageRate * 100) / 100
      : parseFloat(addAmount)
    if (isNaN(amount) || amount <= 0) {
      setAddError('Amount must be a positive number.')
      return
    }
    setAddSubmitting(true)
    try {
      await apiFetch('transactions', {
        method: 'POST',
        body: JSON.stringify({
          kidOid:   addKidOid,
          category: addCategory,
          amount,
          date:     addDate,
          notes:    addNotes.trim(),
          ...(addCategory === 'Income' && { tithable: addTithable }),
        }),
      })
      onDataChange()
      setShowAddForm(false)
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setAddError(apiErr?.body?.message ?? 'Failed to add transaction. Please try again.')
    } finally {
      setAddSubmitting(false)
    }
  }

  // Enrich flat transactions with child display name
  const enrichedTransactions: AdminTransaction[] = useMemo(() => {
    return allTransactions
      .filter(t => t.kidOid)
      .map(t => ({
        ...t,
        childOid:  t.kidOid!,
        childName: kids.find(k => k.oid === t.kidOid)?.displayName ?? 'Unknown',
      }))
  }, [allTransactions, kids])

  const filtered = useMemo(() => {
    const cutoff = getDateCutoff(dateRange)
    return enrichedTransactions
      .filter(t => {
        const txDate = new Date(t.date)
        if (txDate < cutoff) return false
        if (childFilter !== 'all' && t.childOid !== childFilter) return false
        if (search.trim() && !t.notes.toLowerCase().includes(search.trim().toLowerCase())) return false
        return true
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'date-desc':   return b.date.localeCompare(a.date)
          case 'date-asc':    return a.date.localeCompare(b.date)
          case 'amount-asc':  return a.amount - b.amount
          case 'amount-desc': return b.amount - a.amount
          default:            return 0
        }
      })
  }, [allTransactions, dateRange, search, sortBy, childFilter])

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1) }, [dateRange, search, sortBy, childFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const [refreshing, setRefreshing] = useState(false)
  async function handleRefresh() {
    setRefreshing(true)
    try { await onDataChange() } finally { setRefreshing(false) }
  }

  return (
    <div className="transactions-tab">
      <div className="transactions-tab__toolbar">
        <button
          className="btn btn--primary"
          onClick={openAddForm}
          disabled={kids.length === 0}
          title={kids.length === 0 ? 'No kids enrolled yet' : undefined}
        >
          + Add Transaction
        </button>
        <button
          className="btn btn--secondary"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div className="transactions-tab__filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="admin-child-filter">Child</label>
          <select
            id="admin-child-filter"
            className="filter-select"
            value={childFilter}
            onChange={e => setChildFilter(e.target.value)}
          >
            <option value="all">All Kids</option>
            {kids.map(k => (
              <option key={k.oid} value={k.oid}>{k.displayName}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="admin-date-range">Date Range</label>
          <select
            id="admin-date-range"
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
          <label className="filter-label" htmlFor="admin-search">Search Notes</label>
          <input
            id="admin-search"
            className="filter-input"
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="admin-sort">Sort By</label>
          <select
            id="admin-sort"
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
                <th>Child</th>
                <th>Date</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(t => (
                <tr key={`${t.childOid}-${t.id}`}>
                  <td>
                    <span className="child-name-badge">{t.childName}</span>
                  </td>
                  <td className="td-date">{formatDate(t.date)}</td>
                  <td>
                    <span className={`type-badge type-badge--${t.category.toLowerCase()}`}>
                      {t.category}
                    </span>
                  </td>
                  <td className={`td-amount td-amount--${t.category === 'Income' ? 'income' : 'withdrawal'}`}>
                    {t.category !== 'Income' ? '−' : '+'}{formatMoney(t.amount)}
                  </td>
                  <td className="td-notes">{t.notes || '—'}</td>
                  <td className="td-actions">
                    <button className="btn-action btn-action--edit" onClick={() => openEditForm(t)}>Edit</button>
                    <button className="btn-action btn-action--delete" onClick={() => { setConfirmDeleteTxn(t); setDeleteError(null) }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="transactions-pagination">
        <p className="results-count">
          {filtered.length === 0
            ? 'No transactions'
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}${childFilter !== 'all' ? ` for ${kids.find(k => k.oid === childFilter)?.displayName ?? ''}` : ''}`
          }
        </p>
        {totalPages > 1 && (
          <div className="pagination-controls">
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
            >
              ← Prev
            </button>
            <span className="pagination-info">Page {page} of {totalPages}</span>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page === totalPages}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Add Transaction dialog ─────────────────────────────────────────── */}
      {showAddForm && (
        <div className="sa-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="add-txn-title">
          <div className="sa-dialog">
            <p className="sa-dialog__title" id="add-txn-title">Add Transaction</p>
            <form onSubmit={handleAddTransaction}>
              <div className="sa-dialog__body">
                <div className="sa-form-row">
                  <div className="sa-form-group sa-form-group--grow">
                    <label className="form-label" htmlFor="add-txn-kid">Child</label>
                    <select
                      id="add-txn-kid"
                      className="form-select"
                      value={addKidOid}
                      onChange={e => setAddKidOid(e.target.value)}
                      required
                    >
                      {kids.map(k => (
                        <option key={k.oid} value={k.oid}>{k.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="add-txn-cat">Category</label>
                    <select
                      id="add-txn-cat"
                      className="form-select"
                      value={addCategory}
                      onChange={e => setAddCategory(e.target.value as TransactionCategory)}
                    >
                      <option value="Income">Income</option>
                      <option value="Purchase">Purchase</option>
                      <option value="Tithing">Tithing</option>
                    </select>
                  </div>
                </div>
                <div className="sa-form-row">
                  <div className="sa-form-group">
                    <label className="form-label" htmlFor="add-txn-date">Date</label>
                    <input
                      id="add-txn-date"
                      className="form-input"
                      type="date"
                      value={addDate}
                      onChange={e => setAddDate(e.target.value)}
                      required
                    />
                  </div>
                  {!(addCategory === 'Income' && kids.find(k => k.oid === addKidOid)?.kidSettings?.hourlyWagesEnabled) && (
                    <div className="sa-form-group">
                      <label className="form-label" htmlFor="add-txn-amount">Amount ($)</label>
                      <input
                        id="add-txn-amount"
                        className="form-input"
                        type="number"
                        min="0.01"
                        step="any"
                        placeholder="0.00"
                        value={addAmount}
                        onChange={e => setAddAmount(e.target.value)}
                        required
                      />
                    </div>
                  )}
                </div>
                {addCategory === 'Income' && kids.find(k => k.oid === addKidOid)?.kidSettings?.hourlyWagesEnabled && (() => {
                  const wageRate = kids.find(k => k.oid === addKidOid)?.kidSettings?.hourlyWageRate ?? 10
                  const hoursNum = parseFloat(addHours) || 0
                  const amtNum   = parseFloat(addAmount) || 0
                  return (
                    <div className="add-txn-wages-block">
                      <div className="sa-form-group">
                        <label className="form-label" htmlFor="add-txn-hours">Enter the number of hours:</label>
                        <input
                          id="add-txn-hours"
                          className="form-input"
                          type="number"
                          min="0.01"
                          step="0.25"
                          placeholder="0"
                          value={addHours}
                          onChange={e => { setAddHours(e.target.value); setAddAmount('') }}
                        />
                      </div>
                      <div className="add-txn-or-divider">OR</div>
                      <div className="sa-form-group">
                        <label className="form-label" htmlFor="add-txn-amount">Enter the amount:</label>
                        <input
                          id="add-txn-amount"
                          className="form-input"
                          type="number"
                          min="0.01"
                          step="any"
                          placeholder="0.00"
                          value={addAmount}
                          onChange={e => { setAddAmount(e.target.value); setAddHours('') }}
                        />
                      </div>
                      {hoursNum > 0 && (
                        <p className="add-txn-wage-preview">
                          {addHours} hrs × ${wageRate.toFixed(2)}/hr = <strong>${(hoursNum * wageRate).toFixed(2)}</strong>
                        </p>
                      )}
                      {hoursNum === 0 && amtNum === 0 && (
                        <p className="add-txn-wage-hint">Enter hours or a dollar amount above.</p>
                      )}
                    </div>
                  )
                })()}
                <div className="sa-form-group">
                  <label className="form-label" htmlFor="add-txn-notes">Notes (optional)</label>
                  <input
                    id="add-txn-notes"
                    className="form-input"
                    type="text"
                    maxLength={500}
                    placeholder="e.g., Weekly allowance"
                    value={addNotes}
                    onChange={e => setAddNotes(e.target.value)}
                  />
                </div>
                {addCategory === 'Income' && (
                  <div className="sa-form-group">
                    <label className="form-label form-label--checkbox">
                      <input
                        type="checkbox"
                        checked={addTithable}
                        onChange={e => setAddTithable(e.target.checked)}
                      />
                      {' '}Tithable income (adds 10% to Tithing Owed)
                    </label>
                  </div>
                )}
                {addError && <p className="sa-form-error" role="alert">{addError}</p>}
              </div>
              <div className="sa-dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setShowAddForm(false)}
                  disabled={addSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={addSubmitting}
                >
                  {addSubmitting ? 'Adding…' : 'Add Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Transaction dialog ────────────────────────────────────────── */}
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

      {/* ── Delete confirmation dialog ─────────────────────────────────────── */}
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
