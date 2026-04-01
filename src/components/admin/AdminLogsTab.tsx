import { useState, useMemo } from 'react'
import type { AuditLogEntry, KidView } from '../../data/mockData'

interface Props {
  logs: AuditLogEntry[]
  kids: KidView[]
  onDataChange: () => void | Promise<unknown>
}

type ChildFilter = string | 'all'
type ActionFilter = 'all' | 'edit' | 'delete' | 'member_delete'
type DateRange = '1d' | '3d' | '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | 'all'

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '1d':  'Last 1 day',
  '3d':  'Last 3 days',
  '1w':  'Last 1 week',
  '2w':  'Last 2 weeks',
  '1m':  'Last 1 month',
  '3m':  'Last 3 months',
  '6m':  'Last 6 months',
  '1y':  'Last 1 year',
  'all': 'All time',
}

function getLogCutoff(range: DateRange): Date | null {
  if (range === 'all') return null
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
  }
  return d
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmt(n: number): string { return `$${n.toFixed(2)}` }

/** Returns the best available label for who performed an action. Never shows a GUID UPN. */
function actorLabel(entry: AuditLogEntry): string {
  return entry.performedByEmail ?? entry.performedByName ?? entry.performedBy
}

function txSummary(
  category: string | undefined,
  amount: number | undefined,
  date: string | undefined,
): string {
  if (!amount || !date) return '—'
  const sign = category !== 'Income' ? '−' : '+'
  return `${sign}${fmt(amount)} on ${formatDate(date)}`
}

// Fields that can differ between before/after in an edit
const DIFFABLE_FIELDS = ['date', 'category', 'amount', 'notes'] as const
type DiffableField = (typeof DIFFABLE_FIELDS)[number]

const FIELD_LABELS: Record<DiffableField, string> = {
  date: 'Date', category: 'Category', amount: 'Amount', notes: 'Notes',
}

function diffFields(
  before: AuditLogEntry['before'] | undefined,
  after: NonNullable<AuditLogEntry['after']>,
): DiffableField[] {
  if (!before) return []
  return DIFFABLE_FIELDS.filter(f => before[f] !== after[f])
}

function formatFieldValue(field: DiffableField, value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (field === 'date') return formatDate(String(value))
  if (field === 'amount') return fmt(Number(value))
  return String(value)
}

interface EditRowProps { entry: AuditLogEntry; childName: string }
function EditRow({ entry, childName }: EditRowProps) {
  const [expanded, setExpanded] = useState(false)
  const after = entry.after ?? {}
  const changedFields = diffFields(entry.before, after)

  return (
    <div className="log-entry log-entry--edit">
      <div className="log-entry__header" onClick={() => setExpanded(e => !e)}>
        <div className="log-entry__left">
          <span className="log-badge log-badge--edit">Edit</span>
          <span className="log-entry__child">{childName}</span>
          <span className="log-entry__summary">
            {txSummary(after.category, after.amount, after.date)}
            {after.notes && <span className="log-entry__notes"> — {after.notes}</span>}
          </span>
        </div>
        <div className="log-entry__right">
          <span className="log-entry__meta">by {actorLabel(entry)}</span>
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
              <tr>
                <td className="log-diff-table__field">Edited at</td>
                <td colSpan={2}>{formatDateTime(entry.timestamp)}</td>
              </tr>
              {changedFields.map(field => (
                <tr key={field}>
                  <td className="log-diff-table__field">{FIELD_LABELS[field]}</td>
                  <td className="log-diff-table__before">
                    {formatFieldValue(field, (entry.before as Record<string, unknown>)[field])}
                  </td>
                  <td className="log-diff-table__after">
                    {formatFieldValue(field, (after as Record<string, unknown>)[field])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface DeleteRowProps { entry: AuditLogEntry; childName: string }
function DeleteRow({ entry, childName }: DeleteRowProps) {
  const [expanded, setExpanded] = useState(false)
  const t = entry.before ?? {}

  return (
    <div className="log-entry log-entry--delete">
      <div className="log-entry__header" onClick={() => setExpanded(e => !e)}>
        <div className="log-entry__left">
          <span className="log-badge log-badge--delete">Delete</span>
          <span className="log-entry__child">{childName}</span>
          <span className="log-entry__summary">
            {txSummary(t.category, t.amount, t.date)}
            {t.notes && <span className="log-entry__notes"> — {t.notes}</span>}
          </span>
        </div>
        <div className="log-entry__right">
          <span className="log-entry__meta">by {actorLabel(entry)}</span>
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
              <tr><td className="log-diff-table__field">Deleted at</td><td>{formatDateTime(entry.timestamp)}</td></tr>
              <tr><td className="log-diff-table__field">Date</td><td>{t.date ? formatDate(t.date) : '—'}</td></tr>
              <tr><td className="log-diff-table__field">Category</td><td>{t.category ?? '—'}</td></tr>
              <tr><td className="log-diff-table__field">Amount</td><td>{t.amount ? fmt(t.amount) : '—'}</td></tr>
              <tr><td className="log-diff-table__field">Notes</td><td>{t.notes || '—'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface MemberDeleteRowProps { entry: AuditLogEntry }
function MemberDeleteRow({ entry }: MemberDeleteRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="log-entry log-entry--delete">
      <div className="log-entry__header" onClick={() => setExpanded(e => !e)}>
        <div className="log-entry__left">
          <span className="log-badge log-badge--delete">Member Deleted</span>
          <span className="log-entry__child">{entry.memberDisplayName ?? entry.memberOid ?? '—'}</span>
        </div>
        <div className="log-entry__right">
          <span className="log-entry__meta">by {actorLabel(entry)}</span>
          <span className="log-entry__timestamp">{formatDateTime(entry.timestamp)}</span>
          <span className={`log-entry__chevron${expanded ? ' log-entry__chevron--open' : ''}`}>›</span>
        </div>
      </div>

      {expanded && (
        <div className="log-entry__detail">
          <table className="log-diff-table">
            <thead>
              <tr><th colSpan={2}>Deleted Member — Last Known State</th></tr>
            </thead>
            <tbody>
              <tr><td className="log-diff-table__field">Deleted at</td><td>{formatDateTime(entry.timestamp)}</td></tr>
              <tr><td className="log-diff-table__field">Name</td><td>{entry.memberDisplayName ?? '—'}</td></tr>
              <tr><td className="log-diff-table__field">Balance</td><td>{entry.lastBalance != null ? fmt(entry.lastBalance) : '—'}</td></tr>
              <tr><td className="log-diff-table__field">Tithing owed</td><td>{entry.lastTithingOwed != null ? fmt(entry.lastTithingOwed) : '—'}</td></tr>
              <tr><td className="log-diff-table__field">Transactions deleted</td><td>{entry.transactionCount ?? 0}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AdminLogsTab({ logs, kids, onDataChange }: Props) {
  const [childFilter, setChildFilter]   = useState<ChildFilter>('all')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [dateRange, setDateRange]       = useState<DateRange>('2w')
  const [search, setSearch]             = useState('')
  const [refreshing, setRefreshing]     = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try { await onDataChange() } finally { setRefreshing(false) }
  }

  const filtered = useMemo(() => {
    const cutoff = getLogCutoff(dateRange)
    const term = search.trim().toLowerCase()
    return logs
      .filter(entry => {
        if (cutoff && new Date(entry.timestamp) < cutoff) return false
        // member_delete entries don't have before.kidOid; skip child filter for them
        if (childFilter !== 'all' && entry.action !== 'member_delete' && entry.before?.kidOid !== childFilter) return false
        if (actionFilter !== 'all' && entry.action !== actionFilter) return false
        if (term) {
          if (entry.action === 'member_delete') {
            const name = entry.memberDisplayName ?? ''
            if (!name.toLowerCase().includes(term)) return false
          } else {
            const notes = entry.action === 'edit'
              ? `${entry.before?.notes ?? ''} ${entry.after?.notes ?? ''}`
              : (entry.before?.notes ?? '')
            const name = kids.find(k => k.oid === entry.before?.kidOid)?.displayName ?? ''
            if (!notes.toLowerCase().includes(term) && !name.toLowerCase().includes(term)) return false
          }
        }
        return true
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [logs, childFilter, actionFilter, dateRange, search, kids])

  return (
    <div className="admin-logs-tab">
      <div className="transactions-tab__toolbar">
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
          <label className="filter-label" htmlFor="log-child">Child</label>
          <select
            id="log-child"
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
            <option value="member_delete">Member deletes</option>
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="log-date-range">Date Range</label>
          <select
            id="log-date-range"
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
          {filtered.map(entry => {
            if (entry.action === 'member_delete') {
              return <MemberDeleteRow key={entry.id} entry={entry} />
            }
            const childName = kids.find(k => k.oid === entry.before?.kidOid)?.displayName ?? 'Unknown'
            return entry.action === 'edit'
              ? <EditRow key={entry.id} entry={entry} childName={childName} />
              : <DeleteRow key={entry.id} entry={entry} childName={childName} />
          })}
        </div>
      )}

      <p className="results-count">{filtered.length} log entr{filtered.length !== 1 ? 'ies' : 'y'}</p>
    </div>
  )
}
