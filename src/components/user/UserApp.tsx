import { useState } from 'react'
import type { KidView } from '../../data/mockData'
import SummaryTab from './SummaryTab'
import TransactionsTab from './TransactionsTab'
import AddTransactionWizard from './AddTransactionWizard'

type TabId = 'summary' | 'transactions'

interface Props {
  currentUserOid: string
  kidViews: KidView[]
  tithingEnabled: boolean
  onDataChange?: () => void | Promise<unknown>
}

export default function UserApp({ currentUserOid, kidViews, tithingEnabled, onDataChange }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('summary')
  const kid = kidViews.find(k => k.oid === currentUserOid)

  if (!kid) {
    return (
      <div className="user-app">
        <div className="app-error">
          <div className="app-error__card">
            <h2>No allowance account</h2>
            <p>Your profile doesn&apos;t have an allowance account set up yet. Ask your family admin.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="user-app">
      <header className="user-header">
        <h1 className="user-header__name">{kid.displayName}&apos;s Account</h1>
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
            allowDelete={false}
            allowEdit={false}
            onDataChange={onDataChange}
          />
        )}
      </main>
    </div>
  )
}
