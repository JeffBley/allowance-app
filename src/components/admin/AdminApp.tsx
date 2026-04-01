import { useState } from 'react'
import type { FamilyData, KidView, Transaction, AuditLogEntry, Chore } from '../../data/mockData'
import AdminSummaryTab from './AdminSummaryTab'
import AdminFamilyMembersTab from './AdminFamilyMembersTab'
import AdminTransactionsTab from './AdminTransactionsTab'
import AdminSettingsTab from './AdminSettingsTab'
import AdminLogsTab from './AdminLogsTab'

type AdminTab = 'summary' | 'family-members' | 'transactions' | 'logs' | 'settings'

const TAB_LABELS: Record<AdminTab, string> = {
  'summary':        'Summary',
  'family-members': 'Family Members',
  'transactions':   'Transactions',
  'logs':           'Logs',
  'settings':       'Settings',
}

interface Props {
  familyData: FamilyData
  kidViews: KidView[]
  allTransactions: Transaction[]
  auditLog: AuditLogEntry[]
  chores: Chore[]
  tithingEnabled: boolean
  onDataChange: () => void
  /** Silently re-fetches /api/family so newly joined members appear in kid list */
  onRefreshFamily: () => void
}

export default function AdminApp({ familyData, kidViews, allTransactions, auditLog, chores, tithingEnabled, onDataChange, onRefreshFamily }: Props) {
  const [activeTab, setActiveTab]               = useState<AdminTab>('summary')
  const [pendingTab, setPendingTab]             = useState<AdminTab | null>(null)
  const [familyTabHasUnsaved, setFamilyTabHasUnsaved] = useState(false)

  function handleTabClick(tab: AdminTab) {
    if (tab === activeTab) return
    if (activeTab === 'family-members' && familyTabHasUnsaved) {
      setPendingTab(tab)
    } else {
      setActiveTab(tab)
      // Re-fetch family data when navigating to Family Members so newly joined
      // members (via invite code) appear without requiring a full page reload.
      if (tab === 'family-members') onRefreshFamily()
    }
  }

  function confirmLeave() {
    if (pendingTab) {
      setActiveTab(pendingTab)
      setPendingTab(null)
      setFamilyTabHasUnsaved(false)
    }
  }

  function cancelLeave() {
    setPendingTab(null)
  }

  return (
    <div className="admin-app">
      <header className="admin-header">
        <h1 className="admin-header__title">Family Admin</h1>
      </header>

      <nav className="tab-nav">
        {(Object.keys(TAB_LABELS) as AdminTab[]).map(tab => (
          <button
            key={tab}
            className={`tab-nav__btn${activeTab === tab ? ' tab-nav__btn--active' : ''}`}
            onClick={() => handleTabClick(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>

      {/* Unsaved changes confirmation (blocks tab navigation) */}
      {pendingTab && (
        <div className="unsaved-nav-overlay" role="alertdialog" aria-modal="true">
          <div className="unsaved-nav-dialog">
            <p className="unsaved-nav-dialog__title">Unsaved Changes</p>
            <p className="unsaved-nav-dialog__body">
              You have unsaved changes in Family Members. If you leave now, those changes will be lost.
            </p>
            <div className="unsaved-nav-dialog__actions">
              <button className="btn btn--secondary" onClick={cancelLeave}>
                Keep Editing
              </button>
              <button className="btn btn--danger" onClick={confirmLeave}>
                Discard &amp; Leave
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="tab-content">
        {activeTab === 'summary' && (
          <AdminSummaryTab
            kids={kidViews}
            choreBasedIncomeEnabled={familyData.choreBasedIncomeEnabled}
            chores={chores}
            tithingEnabled={tithingEnabled}
            onDataChange={onDataChange}
          />
        )}
        {activeTab === 'family-members' && (
          <AdminFamilyMembersTab
            kids={kidViews}
            tithingEnabled={tithingEnabled}
            onUnsavedStatusChange={setFamilyTabHasUnsaved}
            onSettingsSaved={onRefreshFamily}
            onMemberCreated={onRefreshFamily}
            familyId={familyData.familyId}
            memberCount={familyData.members.length}
            memberLimit={familyData.memberLimit}
          />
        )}
        {activeTab === 'transactions' && (
          <AdminTransactionsTab kids={kidViews} allTransactions={allTransactions} onDataChange={onDataChange} />
        )}
        {activeTab === 'logs' && (
          <AdminLogsTab logs={auditLog} kids={kidViews} onDataChange={onDataChange} />
        )}
        {activeTab === 'settings' && (
          <AdminSettingsTab
            familyId={familyData.familyId}
            members={familyData.members}
            memberCount={familyData.members.length}
            memberLimit={familyData.memberLimit}
            choreBasedIncomeEnabled={familyData.choreBasedIncomeEnabled}
            tithingEnabled={tithingEnabled}
            onDataChange={onDataChange}
            onMemberCreated={onRefreshFamily}
          />
        )}
      </main>
    </div>
  )
}

