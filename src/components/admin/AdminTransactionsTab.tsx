import { useState, useMemo } from 'react'
import type { Kid, KidId, Transaction } from '../../data/mockData'

interface Props {
  kids: Record<KidId, Kid>
}

interface AdminTransaction extends Transaction {
  childId: KidId
  childName: string
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
  'date-desc':   'Date — newest to oldest',
  'date-asc':    'Date — oldest to newest',
  'amount-asc':  'Amount — least to greatest',
  'amount-desc': 'Amount — greatest to least',
}

function getDateCutoff(range: DateRange): Date {
  const d = new Date()
  switch (range) {
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

export default function AdminTransactionsTab({ kids }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>('3m')
  const [search, setSearch]       = useState('')
  const [sortBy, setSortBy]       = useState<SortOption>('date-desc')
  const [childFilter, setChildFilter] = useState<KidId | 'all'>('all')

  // Flatten all kids' transactions into one enriched list
  const allTransactions: AdminTransaction[] = useMemo(() => {
    return Object.values(kids).flatMap(kid =>
      kid.transactions.map(t => ({
        ...t,
        childId:   kid.id,
        childName: kid.name,
      }))
    )
  }, [kids])

  const filtered = useMemo(() => {
    const cutoff = getDateCutoff(dateRange)
    return allTransactions
      .filter(t => {
        const txDate = new Date(t.date)
        if (txDate < cutoff) return false
        if (childFilter !== 'all' && t.childId !== childFilter) return false
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

  return (
    <div className="transactions-tab">
      <div className="transactions-tab__toolbar">
        {/* Admin add transaction — placeholder for future wizard */}
        <button className="btn btn--primary" disabled title="Coming soon">
          + Add Transaction
        </button>
      </div>

      <div className="transactions-tab__filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="admin-child-filter">Child</label>
          <select
            id="admin-child-filter"
            className="filter-select"
            value={childFilter}
            onChange={e => setChildFilter(e.target.value as KidId | 'all')}
          >
            <option value="all">All Kids</option>
            {Object.values(kids).map(k => (
              <option key={k.id} value={k.id}>{k.name}</option>
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
                <th>Type</th>
                <th>Amount</th>
                <th>Notes</th>
                <th className="col-tithing">Tithing Applies</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={`${t.childId}-${t.id}`}>
                  <td>
                    <span className="child-name-badge">{t.childName}</span>
                  </td>
                  <td className="td-date">{formatDate(t.date)}</td>
                  <td>
                    <span className={`type-badge type-badge--${t.type}`}>
                      {t.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                    </span>
                  </td>
                  <td className={`td-amount td-amount--${t.type}`}>
                    {t.type === 'withdrawal' ? '−' : '+'}{formatMoney(t.amount)}
                  </td>
                  <td className="td-notes">{t.notes || '—'}</td>
                  <td className="td-center col-tithing">
                    {t.tithingApplies === null ? '—' : t.tithingApplies ? 'Yes' : 'No'}
                  </td>
                  <td className="td-actions">
                    <button className="btn-action btn-action--edit">Edit</button>
                    <button className="btn-action btn-action--delete">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="results-count">
        Showing {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        {childFilter !== 'all' ? ` for ${kids[childFilter].name}` : ' across all kids'}
      </p>
    </div>
  )
}
