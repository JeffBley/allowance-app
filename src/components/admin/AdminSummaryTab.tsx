import { useState } from 'react'
import type { KidView, Chore } from '../../data/mockData'
import AddTransactionWizard from '../user/AddTransactionWizard'
import AdminChoresSection from './AdminChoresSection'
import KidDetailView from './KidDetailView'

interface Props {
  kids: KidView[]
  choreBasedIncomeEnabled: boolean
  chores: Chore[]
  tithingEnabled: boolean
  onDataChange: () => void | Promise<unknown>
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function formatNextAllowance(iso: string): string {
  const date = new Date(iso)
  if (isNaN(date.getTime())) return '—'
  const monthName = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const dayNum = date.getUTCDate()
  const suffix = dayNum === 1 || dayNum === 21 || dayNum === 31 ? 'st'
               : dayNum === 2 || dayNum === 22 ? 'nd'
               : dayNum === 3 || dayNum === 23 ? 'rd' : 'th'
  return `${monthName} ${dayNum}${suffix}`
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export default function AdminSummaryTab({ kids, choreBasedIncomeEnabled, chores, tithingEnabled, onDataChange }: Props) {
  const [wizardKid, setWizardKid] = useState<KidView | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedKid, setSelectedKid] = useState<KidView | null>(null)

  if (selectedKid) {
    return (
      <KidDetailView
        kid={selectedKid}
        tithingEnabled={tithingEnabled}
        onBack={() => setSelectedKid(null)}
      />
    )
  }

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
                <button
                  className="admin-kid-tile__name admin-kid-tile__name--link"
                  onClick={() => setSelectedKid(kid)}
                  title={`View ${kid.displayName}'s account`}
                >
                  {kid.displayName}
                </button>
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
                {tithingEnabled && (
                  <>
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
                  </>
                )}
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
          tithingEnabled={tithingEnabled}
          onClose={() => { setWizardKid(null); onDataChange() }}
        />
      )}

      {choreBasedIncomeEnabled && (
        <AdminChoresSection
          chores={chores}
          kids={kids}
          tithingEnabled={tithingEnabled}
          onChoresChange={onDataChange}
        />
      )}
    </div>
  )
}
