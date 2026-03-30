import { useState } from 'react'
import type { KidId } from '../../data/mockData'
import { kidsData } from '../../data/mockData'
import SummaryTab from './SummaryTab'
import TransactionsTab from './TransactionsTab'

type TabId = 'summary' | 'transactions'

interface Props {
  kidId: KidId
}

export default function UserApp({ kidId }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('summary')
  const kid = kidsData[kidId]

  return (
    <div className="user-app">
      <header className="user-header">
        <h1 className="user-header__name">{kid.name}'s Account</h1>
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
          <SummaryTab kid={kid} />
        )}
        {activeTab === 'transactions' && (
          <TransactionsTab
            transactions={kid.transactions}
            allowDelete={false}
            allowEdit={false}
          />
        )}
      </main>
    </div>
  )
}
