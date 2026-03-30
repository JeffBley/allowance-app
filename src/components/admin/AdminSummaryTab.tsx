import { useState } from 'react'
import type { Kid, KidId } from '../../data/mockData'
import AddTransactionWizard from '../user/AddTransactionWizard'

interface Props {
  kids: Record<KidId, Kid>
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

export default function AdminSummaryTab({ kids }: Props) {
  const kidList = Object.values(kids)
  const [wizardKid, setWizardKid] = useState<Kid | null>(null)

  return (
    <div className="admin-summary-tab">
      <h2 className="section-title">Kids Overview</h2>
      <div className="admin-kid-tiles">
        {kidList.map(kid => (
          <div key={kid.id} className="admin-kid-tile">
            <div className="admin-kid-tile__avatar">
              {kid.name.charAt(0)}
            </div>
            <div className="admin-kid-tile__info">
              <div className="admin-kid-tile__name-row">
                <h3 className="admin-kid-tile__name">{kid.name}</h3>
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
                    {formatDate(kid.lastTithingPaid)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {wizardKid && (
        <AddTransactionWizard
          kid={wizardKid}
          onClose={() => setWizardKid(null)}
        />
      )}
    </div>
  )
}
