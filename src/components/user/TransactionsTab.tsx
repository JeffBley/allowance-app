import { useState, useMemo } from 'react'
import type { Transaction } from '../../data/mockData'

interface Props {
  transactions: Transaction[]
  allowDelete: boolean
  allowEdit: boolean
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
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export default function TransactionsTab({ transactions, allowDelete, allowEdit }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>('3m')
  const [search, setSearch]       = useState('')
  const [sortBy, setSortBy]       = useState<SortOption>('date-desc')

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
          case 'date-desc':   return b.date.localeCompare(a.date)
          case 'date-asc':    return a.date.localeCompare(b.date)
          case 'amount-asc':  return a.amount - b.amount
          case 'amount-desc': return b.amount - a.amount
          default:            return 0
        }
      })
  }, [transactions, dateRange, search, sortBy])

  const showActions = allowDelete || allowEdit

  return (
    <div className="transactions-tab">
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
                <th>Type</th>
                <th>Amount</th>
                <th>Notes</th>
                <th className="col-tithing">Tithing Applies</th>
                {showActions && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
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
                  {showActions && (
                    <td className="td-actions">
                      {allowEdit   && <button className="btn-action btn-action--edit">Edit</button>}
                      {allowDelete && <button className="btn-action btn-action--delete">Delete</button>}
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
    </div>
  )
}
