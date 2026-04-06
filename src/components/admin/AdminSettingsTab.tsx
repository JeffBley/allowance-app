import { useState } from 'react'
import { useApi } from '../../hooks/useApi'

interface Props {
  familyId: string
  familyName?: string | null
  choreBasedIncomeEnabled: boolean
  tithingEnabled: boolean
  onDataChange: () => void | Promise<unknown>
}

export default function AdminSettingsTab({ familyId, familyName, choreBasedIncomeEnabled, tithingEnabled, onDataChange }: Props) {
  const { apiFetch } = useApi()
  const [refreshing, setRefreshing]         = useState(false)
  const [togglingChore, setTogglingChore]   = useState(false)
  const [togglingTithing, setTogglingTithing] = useState(false)
  const [editingName, setEditingName]       = useState(false)
  const [nameInput, setNameInput]           = useState('')
  const [savingName, setSavingName]         = useState(false)
  const [nameError, setNameError]           = useState<string | null>(null)

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

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed) { setNameError('Please enter a family name.'); return }
    setNameError(null)
    setSavingName(true)
    try {
      await apiFetch('family/settings', {
        method: 'PATCH',
        body: JSON.stringify({ familyName: trimmed }),
      })
      setEditingName(false)
      await onDataChange()
    } catch {
      setNameError('Failed to save. Please try again.')
    } finally {
      setSavingName(false)
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
          {editingName ? (
            <form onSubmit={handleSaveName} style={{ width: '100%' }}>
              <p className="settings-card__label" style={{ marginBottom: 8 }}>Family Name</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="sa-form-input"
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  placeholder="The Smith Family"
                  maxLength={60}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className="btn btn--primary btn--sm" type="submit" disabled={savingName || !nameInput.trim()}>
                  {savingName ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => { setEditingName(false); setNameError(null) }}>
                  Cancel
                </button>
              </div>
              {nameError && <p className="sa-form-error" role="alert" style={{ marginTop: 6 }}>{nameError}</p>}
            </form>
          ) : (
            <>
              <div>
                <p className="settings-card__label">Family Name</p>
                {familyName && <p className="settings-card__hint">{familyName}</p>}
              </div>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => { setNameInput(familyName ?? ''); setNameError(null); setEditingName(true) }}
              >
                Edit family name
              </button>
            </>
          )}
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

