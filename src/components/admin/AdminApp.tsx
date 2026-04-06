import { useState, useRef, useEffect } from 'react'
import type { FamilyData, KidView, Transaction, Chore, FamilyInviteCode } from '../../data/mockData'
import AdminSummaryTab from './AdminSummaryTab'
import AdminFamilyMembersTab from './AdminFamilyMembersTab'
import AdminTransactionsTab from './AdminTransactionsTab'
import AdminSettingsTab from './AdminSettingsTab'

type AdminTab = 'summary' | 'family-members' | 'transactions' | 'settings'

const TAB_LABELS: Record<AdminTab, string> = {
  'summary':        'Summary',
  'family-members': 'Family Members',
  'transactions':   'Transactions',
  'settings':       'Settings',
}

interface Props {
  familyData: FamilyData
  kidViews: KidView[]
  allTransactions: Transaction[]
  chores: Chore[]
  tithingEnabled: boolean
  onDataChange: () => void
  /** Silently re-fetches /api/family so newly joined members appear in kid list */
  onRefreshFamily: () => void
  /** Silently re-fetches /api/invites */
  onRefreshInvites: () => void
  pendingInvites: FamilyInviteCode[]
}

export default function AdminApp({ familyData, kidViews, allTransactions, chores, tithingEnabled, onDataChange, onRefreshFamily, onRefreshInvites, pendingInvites }: Props) {
  const [activeTab, setActiveTab]               = useState<AdminTab>('summary')
  const [pendingTab, setPendingTab]             = useState<AdminTab | null>(null)
  const [familyTabHasUnsaved, setFamilyTabHasUnsaved] = useState(false)

  // ── Tab scroll-overflow indicator ──────────────────────────────────────────
  const tabNavRef = useRef<HTMLElement | null>(null)
  const [showScrollRight, setShowScrollRight] = useState(false)
  const [showScrollLeft, setShowScrollLeft]   = useState(false)

  useEffect(() => {
    const el = tabNavRef.current
    if (!el) return
    function check() {
      if (!el) return
      setShowScrollLeft(el.scrollLeft > 2)
      setShowScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [])

  function handleTabClick(tab: AdminTab) {
    if (tab === activeTab) return
    if (activeTab === 'family-members' && familyTabHasUnsaved) {
      setPendingTab(tab)
    } else {
      setActiveTab(tab)
      // Re-fetch family data when navigating to Family Members so newly joined
      // members (via invite code) appear without requiring a full page reload.
      if (tab === 'family-members') { onRefreshFamily(); onRefreshInvites() }
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
        <h1 className="admin-header__title">{familyData.familyName ?? 'Family Admin'}</h1>
      </header>

      <div className="tab-nav-wrap">
        {showScrollLeft  && <div className="tab-nav-wrap__hint tab-nav-wrap__hint--left"  aria-hidden="true">‹</div>}
        <nav className="tab-nav" ref={tabNavRef}>
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
        {showScrollRight && <div className="tab-nav-wrap__hint tab-nav-wrap__hint--right" aria-hidden="true">›</div>}
      </div>

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
            members={familyData.members}
            pendingInvites={pendingInvites}
            tithingEnabled={tithingEnabled}
            onUnsavedStatusChange={setFamilyTabHasUnsaved}
            onSettingsSaved={onRefreshFamily}
            onMemberCreated={onRefreshFamily}
            onRefreshInvites={onRefreshInvites}
            familyId={familyData.familyId}
            memberCount={familyData.members.length}
            memberLimit={familyData.memberLimit}
          />
        )}
        {activeTab === 'transactions' && (
          <AdminTransactionsTab kids={kidViews} allTransactions={allTransactions} onDataChange={onDataChange} />
        )}
        {activeTab === 'settings' && (
          <AdminSettingsTab
            familyId={familyData.familyId}
            familyName={familyData.familyName}
            choreBasedIncomeEnabled={familyData.choreBasedIncomeEnabled}
            tithingEnabled={tithingEnabled}
            onDataChange={onDataChange}
          />
        )}
      </main>
    </div>
  )
}

