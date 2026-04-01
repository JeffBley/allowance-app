import { InviteSection } from './AdminFamilyMembersTab'
import { useState } from 'react'
import type { FamilyMember } from '../../data/mockData'

interface Props {
  familyId: string
  members: FamilyMember[]
  memberCount: number
  memberLimit: number
  onDataChange: () => void | Promise<unknown>
  onMemberCreated?: () => void
}

export default function AdminSettingsTab({ familyId, members, memberCount, memberLimit, onDataChange, onMemberCreated }: Props) {
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try { await onDataChange() } finally { setRefreshing(false) }
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
