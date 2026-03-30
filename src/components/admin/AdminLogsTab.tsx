import { useState, useMemo } from 'react'
import type { LogEntry, EditLogEntry, DeleteLogEntry, KidId } from '../../data/mockData'
import { auditLog, kidsData } from '../../data/mockData'

type ChildFilter = KidId | 'all'
type ActionFilter = 'all' | 'edit' | 'delete'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmt(n: number): string { return `$${n.toFixed(2)}` }

function txSummary(t: { date: string; type: string; amount: number; notes: string; tithingApplies: boolean | null }): string {
  const sign = t.type === 'withdrawal' ? '−' : '+'
  return `${sign}${fmt(t.amount)} on ${formatDate(t.date)}`
}

// Collect all fields that differ between before/after
function diffFields(before: EditLogEntry['before'], after: EditLogEntry['after']): string[] {
  const fields: string[] = []
  if (before.date         !== after.date)         fields.push('date')
  if (before.type         !== after.type)         fields.push('type')
  if (before.amount       !== after.amount)       fields.push('amount')
  if (before.notes        !== after.notes)        fields.push('notes')
  if (before.tithingApplies !== after.tithingApplies) fields.push('tithingApplies')
  return fields
}

function tithingLabel(v: boolean | null): string {
  if (v === null) return '—'
  return v ? 'Yes' : 'No'
}

interface EditRowProps { entry: EditLogEntry }
function EditRow({ entry }: EditRowProps) {
  const [expanded, setExpanded] = useState(false)
  const changedFields = diffFields(entry.before, entry.after)

  return (
    <div className="log-entry log-entry--edit">
      <div className="log-entry__header" onClick={() => setExpanded(e => !e)}>
        <div className="log-entry__left">
          <span className="log-badge log-badge--edit">Edit</span>
          <span className="log-entry__child">{entry.childName}</span>
          <span className="log-entry__summary">
            {txSummary(entry.after)}
            {entry.after.notes && <span className="log-entry__notes"> — {entry.after.notes}</span>}
          </span>
        </div>
        <div className="log-entry__right">
          <span className="log-entry__meta">by {entry.performedBy}</span>
          <span className="log-entry__timestamp">{formatDateTime(entry.timestamp)}</span>
          <span className={`log-entry__chevron${expanded ? ' log-entry__chevron--open' : ''}`}>›</span>
        </div>
      </div>

      {expanded && (
        <div className="log-entry__detail">
          <table className="log-diff-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {changedFields.map(field => {
                const bVal = field === 'date'
                  ? formatDate(entry.before.date)
                  : field === 'amount'
                  ? fmt(entry.before.amount)
                  : field === 'tithingApplies'
                  ? tithingLabel(entry.before.tithingApplies)
                  : String((entry.before as unknown as Record<string, unknown>)[field] ?? '—')

                const aVal = field === 'date'
                  ? formatDate(entry.after.date)
                  : field === 'amount'
                  ? fmt(entry.after.amount)
                  : field === 'tithingApplies'
                  ? tithingLabel(entry.after.tithingApplies)
                  : String((entry.after as unknown as Record<string, unknown>)[field] ?? '—')

                const label: Record<string, string> = {
                  date: 'Date', type: 'Type', amount: 'Amount',
                  notes: 'Notes', tithingApplies: 'Tithing Applies',
                }

                return (
                  <tr key={field}>
                    <td className="log-diff-table__field">{label[field] ?? field}</td>
                    <td className="log-diff-table__before">{bVal}</td>
                    <td className="log-diff-table__after">{aVal}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface DeleteRowProps { entry: DeleteLogEntry }
function DeleteRow({ entry }: DeleteRowProps) {
  const [expanded, setExpanded] = useState(false)
  const t = entry.transaction

  return (
    <div className="log-entry log-entry--delete">
      <div className="log-entry__header" onClick={() => setExpanded(e => !e)}>
        <div className="log-entry__left">
          <span className="log-badge log-badge--delete">Delete</span>
          <span className="log-entry__child">{entry.childName}</span>
          <span className="log-entry__summary">
            {txSummary(t)}
            {t.notes && <span className="log-entry__notes"> — {t.notes}</span>}
          </span>
        </div>
        <div className="log-entry__right">
          <span className="log-entry__meta">by {entry.performedBy}</span>
          <span className="log-entry__timestamp">{formatDateTime(entry.timestamp)}</span>
          <span className={`log-entry__chevron${expanded ? ' log-entry__chevron--open' : ''}`}>›</span>
        </div>
      </div>

      {expanded && (
        <div className="log-entry__detail">
          <table className="log-diff-table">
            <thead>
              <tr>
                <th colSpan={2}>Deleted Transaction Details</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="log-diff-table__field">Date</td><td>{formatDate(t.date)}</td></tr>
              <tr><td className="log-diff-table__field">Type</td><td style={{ textTransform: 'capitalize' }}>{t.type}</td></tr>
              <tr><td className="log-diff-table__field">Amount</td><td>{fmt(t.amount)}</td></tr>
              <tr><td className="log-diff-table__field">Notes</td><td>{t.notes || '—'}</td></tr>
              <tr><td className="log-diff-table__field">Tithing Applies</td><td>{tithingLabel(t.tithingApplies)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AdminLogsTab() {
  const [childFilter, setChildFilter]   = useState<ChildFilter>('all')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [search, setSearch]             = useState('')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return auditLog
      .filter(entry => {
        if (childFilter !== 'all' && entry.childId !== childFilter) return false
        if (actionFilter !== 'all' && entry.action !== actionFilter) return false
        if (term) {
          const notes = entry.action === 'edit'
            ? `${entry.before.notes} ${entry.after.notes}`
            : entry.transaction.notes
          if (!notes.toLowerCase().includes(term) && !entry.childName.toLowerCase().includes(term)) return false
        }
        return true
      })
      // newest first
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [childFilter, actionFilter, search])

  return (
    <div className="admin-logs-tab">
      <div className="transactions-tab__filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="log-child">Child</label>
          <select
            id="log-child"
            className="filter-select"
            value={childFilter}
            onChange={e => setChildFilter(e.target.value as ChildFilter)}
          >
            <option value="all">All Kids</option>
            {Object.values(kidsData).map(k => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="log-action">Action</label>
          <select
            id="log-action"
            className="filter-select"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value as ActionFilter)}
          >
            <option value="all">All Actions</option>
            <option value="edit">Edits only</option>
            <option value="delete">Deletes only</option>
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="log-search">Search</label>
          <input
            id="log-search"
            className="filter-input"
            type="text"
            placeholder="Search notes or names..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">No log entries match the selected filters.</p>
      ) : (
        <div className="log-list">
          {filtered.map(entry =>
            entry.action === 'edit'
              ? <EditRow key={entry.id} entry={entry as EditLogEntry} />
              : <DeleteRow key={entry.id} entry={entry as DeleteLogEntry} />
          )}
        </div>
      )}

      <p className="results-count">{filtered.length} log entr{filtered.length !== 1 ? 'ies' : 'y'}</p>
    </div>
  )
}
