import { useState } from 'react'
import type { KidView, Chore } from '../../data/mockData'
import AddTransactionWizard from '../user/AddTransactionWizard'
import AdminChoresSection from './AdminChoresSection'

interface Props {
  kids: KidView[]
  choreBasedIncomeEnabled: boolean
  chores: Chore[]
  onDataChange: () => void | Promise<unknown>
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatNextAllowance(iso: string): string {
  const [year, month, day] = iso.split('T')[0].split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const monthName = d.toLocaleDateString('en-US', { month: 'long' })
  const dayNum = d.getDate()
  const suffix = dayNum === 1 || dayNum === 21 || dayNum === 31 ? 'st'
               : dayNum === 2 || dayNum === 22 ? 'nd'
               : dayNum === 3 || dayNum === 23 ? 'rd' : 'th'
  return `${monthName} ${dayNum}${suffix}`
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export default function AdminSummaryTab({ kids, choreBasedIncomeEnabled, chores, onDataChange }: Props) {
  const [wizardKid, setWizardKid] = useState<KidView | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await onDataChange()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="admin-summary-tab">
      <div className="admin-summary-tab__header">
        <h2 className="section-title">Kids Overview</h2>
        <button
          className="btn btn--secondary btn--sm"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <div className="admin-kid-tiles">
        {kids.map(kid => (
          <div key={kid.oid} className="admin-kid-tile">
            <div className="admin-kid-tile__avatar">
              {kid.displayName.charAt(0)}
            </div>
            <div className="admin-kid-tile__info">
              <div className="admin-kid-tile__name-row">
                <h3 className="admin-kid-tile__name">{kid.displayName}</h3>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => setWizardKid(kid)}
                >
                  + Add Transaction
                </button>
              </div>
              <div className="admin-kid-tile__stats">
                <div className="admin-kid-stat">
                  <span className="admin-kid-stat__label">Available</span>
                  <span className="admin-kid-stat__value admin-kid-stat__value--main">
                    {formatMoney(kid.balance)}
                  </span>
                </div>
                <div className="admin-kid-stat">
                  <span className="admin-kid-stat__label">Tithing Owed</span>
                  <span className={`admin-kid-stat__value ${kid.tithingOwed > 0 ? 'admin-kid-stat__value--warning' : 'admin-kid-stat__value--success'}`}>
                    {formatMoney(kid.tithingOwed)}
                  </span>
                </div>
                <div className="admin-kid-stat">
                  <span className="admin-kid-stat__label">Last Tithing Paid</span>
                  <span className="admin-kid-stat__value admin-kid-stat__value--muted">
                    {kid.lastTithingPaid ? formatDate(kid.lastTithingPaid) : 'Never'}
                  </span>
                </div>
                {kid.kidSettings?.allowanceEnabled && kid.kidSettings.nextAllowanceDate && (
                  <div className="admin-kid-stat">
                    <span className="admin-kid-stat__label">Next Allowance</span>
                    <span className="admin-kid-stat__value admin-kid-stat__value--muted">
                      ${kid.kidSettings.allowanceAmount.toFixed(2)} on {formatNextAllowance(kid.kidSettings.nextAllowanceDate)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {wizardKid && (
        <AddTransactionWizard
          kid={wizardKid}
          onClose={() => { setWizardKid(null); onDataChange() }}
        />
      )}

      {choreBasedIncomeEnabled && (
        <AdminChoresSection
          chores={chores}
          kids={kids}
          onChoresChange={onDataChange}
        />
      )}
    </div>
  )
}
