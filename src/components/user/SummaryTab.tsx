import type { KidView } from '../../data/mockData'

interface Props {
  kid: KidView
  tithingEnabled: boolean
}

function formatDate(iso: string): string {
  // nextAllowanceDate is a full ISO 8601 datetime (e.g. "2026-04-04T08:00:00.000Z").
  // Pass it directly to Date rather than splitting on '-', which breaks on the time part.
  const date = new Date(iso)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function formatMoney(amount: number): string {
  return amount < 0 ? `-$${(-amount).toFixed(2)}` : `$${amount.toFixed(2)}`
}

export default function SummaryTab({ kid, tithingEnabled }: Props) {
  return (
    <div className="summary-tab">
      <div className="summary-cards">
        <div className="summary-card summary-card--accent">
          <span className="summary-card__label">Money Available</span>
          <span className="summary-card__value summary-card__value--main">
            {formatMoney(kid.balance)}
          </span>
        </div>

        {tithingEnabled && (
          <div className="summary-card">
            <span className="summary-card__label">Tithing Owed</span>
            <span className={`summary-card__value ${kid.tithingOwed > 0 ? 'summary-card__value--warning' : 'summary-card__value--success'}`}>
              {formatMoney(kid.tithingOwed)}
            </span>
            <span className="summary-card__sub">
              Last paid: {kid.lastTithingPaid ? formatDate(kid.lastTithingPaid) : 'Never'}
            </span>
          </div>
        )}

        <div className="summary-card">
          <span className="summary-card__label">Allowance</span>
          <span className="summary-card__value">
            {formatMoney(kid.kidSettings?.allowanceAmount ?? 0)}<span className="summary-card__freq"> / {kid.kidSettings?.allowanceFrequency ?? '—'}</span>
          </span>
          <span className="summary-card__sub">
            {kid.kidSettings?.nextAllowanceDate ? `Next: ${formatDate(kid.kidSettings.nextAllowanceDate)}` : 'Not scheduled'}
          </span>
        </div>
      </div>
    </div>
  )
}
