import { useState } from 'react'
import type { KidView } from '../../data/mockData'
import SummaryTab from '../user/SummaryTab'
import TransactionsTab from '../user/TransactionsTab'

type TabId = 'summary' | 'transactions'

interface Props {
  kid: KidView
  tithingEnabled: boolean
  onBack: () => void
  onDataChange?: () => void | Promise<unknown>
}

export default function KidDetailView({ kid, tithingEnabled, onBack, onDataChange }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('summary')

  return (
    <div className="kid-detail-view">
      <div className="kid-detail-view__back-bar">
        <button
          className="btn btn--secondary btn--sm"
          onClick={onBack}
          aria-label="Back to Kids Overview"
        >
          ← Back to Overview
        </button>
      </div>

      <header className="user-header">
        <h2 className="user-header__name">{kid.displayName}&apos;s Account</h2>
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-nav__btn${activeTab === 'summary' ? ' tab-nav__btn--active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
        <button
          className={`tab-nav__btn${activeTab === 'transactions' ? ' tab-nav__btn--active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          Transactions
        </button>
      </nav>

      <main className="tab-content">
        {activeTab === 'summary' && (
          <SummaryTab kid={kid} tithingEnabled={tithingEnabled} />
        )}
        {activeTab === 'transactions' && (
          <TransactionsTab
            transactions={kid.transactions}
            allowDelete={true}
            allowEdit={true}
            onDataChange={onDataChange}
          />
        )}
      </main>
    </div>
  )
}
