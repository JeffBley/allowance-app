import type { Kid } from '../../data/mockData'

interface Props {
  kid: Kid
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export default function SummaryTab({ kid }: Props) {
  return (
    <div className="summary-tab">
      <div className="summary-cards">
        <div className="summary-card summary-card--accent">
          <span className="summary-card__label">Money Available</span>
          <span className="summary-card__value summary-card__value--main">
            {formatMoney(kid.balance)}
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-card__label">Tithing Owed</span>
          <span className={`summary-card__value ${kid.tithingOwed > 0 ? 'summary-card__value--warning' : 'summary-card__value--success'}`}>
            {formatMoney(kid.tithingOwed)}
          </span>
          <span className="summary-card__sub">
            Last paid: {formatDate(kid.lastTithingPaid)}
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-card__label">Allowance</span>
          <span className="summary-card__value">
            {formatMoney(kid.allowanceAmount)}<span className="summary-card__freq"> / {kid.allowanceFrequency}</span>
          </span>
          <span className="summary-card__sub">
            Next: {formatDate(kid.nextAllowanceDate)}
          </span>
        </div>
      </div>
    </div>
  )
}
