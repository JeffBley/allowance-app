import { InviteSection } from './AdminFamilyMembersTab'
import { useState } from 'react'
import type { FamilyMember } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

interface Props {
  familyId: string
  members: FamilyMember[]
  memberCount: number
  memberLimit: number
  choreBasedIncomeEnabled: boolean
  tithingEnabled: boolean
  onDataChange: () => void | Promise<unknown>
  onMemberCreated?: () => void
}

export default function AdminSettingsTab({ familyId, members, memberCount, memberLimit, choreBasedIncomeEnabled, tithingEnabled, onDataChange, onMemberCreated }: Props) {
  const { apiFetch } = useApi()
  const [refreshing, setRefreshing] = useState(false)
  const [togglingChore, setTogglingChore] = useState(false)
  const [togglingTithing, setTogglingTithing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try { await onDataChange() } finally { setRefreshing(false) }
  }

  async function handleToggleChoreIncome() {
    setTogglingChore(true)
    try {
      await apiFetch('family/settings', {
        method: 'PATCH',
        body: JSON.stringify({ choreBasedIncomeEnabled: !choreBasedIncomeEnabled }),
      })
      await onDataChange()
    } catch (err) {
      console.error('Failed to toggle chore-based income', err)
    } finally {
      setTogglingChore(false)
    }
  }

  async function handleToggleTithing() {
    setTogglingTithing(true)
    try {
      await apiFetch('family/settings', {
        method: 'PATCH',
        body: JSON.stringify({ tithingEnabled: !tithingEnabled }),
      })
      await onDataChange()
    } catch (err) {
      console.error('Failed to toggle tithing', err)
    } finally {
      setTogglingTithing(false)
    }
  }

  return (
    <div className="admin-settings-tab">
      <div className="admin-summary-tab__header">
        <h2 className="section-title">Settings</h2>
        <button
          className="btn btn--secondary btn--sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <InviteSection members={members} memberCount={memberCount} memberLimit={memberLimit} onMemberCreated={onMemberCreated} />

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card__row">
          <div>
            <p className="settings-card__label">Chore-based Income</p>
            <p className="settings-card__hint">Allow admins to define chores and credit kids when they complete them.</p>
          </div>
          <button
            className={`toggle-switch${choreBasedIncomeEnabled ? ' toggle-switch--on' : ''}`}
            onClick={handleToggleChoreIncome}
            disabled={togglingChore}
            aria-pressed={choreBasedIncomeEnabled}
            aria-label="Toggle chore-based income"
          >
            <span className="toggle-switch__thumb" />
          </button>
        </div>

        <div className="settings-card__row" style={{ borderTop: '1px solid var(--border)' }}>
          <div>
            <p className="settings-card__label">Tithing</p>
            <p className="settings-card__hint">Show tithing owed, tithing transaction type, and tithing reminders throughout the app.</p>
          </div>
          <button
            className={`toggle-switch${tithingEnabled ? ' toggle-switch--on' : ''}`}
            onClick={handleToggleTithing}
            disabled={togglingTithing}
            aria-pressed={tithingEnabled}
            aria-label="Toggle tithing"
          >
            <span className="toggle-switch__thumb" />
          </button>
        </div>

        <div className="settings-card__row" style={{ borderTop: '1px solid var(--border)' }}>
          <div>
            <p className="settings-card__label">Family ID</p>
          </div>
          <div className="family-id-display">
            <code className="family-id-code">{familyId}</code>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => navigator.clipboard.writeText(familyId)}
              title="Copy to clipboard"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

