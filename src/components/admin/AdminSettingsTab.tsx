// Prototype placeholder — more settings will be added in future iterations

const MOCK_FAMILY_ID = 'fam_a3f8d2c1-7b4e-4a92-9e0f-1c6d38b52e74'

export default function AdminSettingsTab() {
  return (
    <div className="admin-settings-tab">
      <h2 className="section-title">Settings</h2>

      <div className="settings-card">
        <div className="settings-card__row">
          <div>
            <p className="settings-card__label">Family ID</p>
            <p className="settings-card__hint">
              Share this ID with family members to link their accounts.
            </p>
          </div>
          <div className="family-id-display">
            <code className="family-id-code">{MOCK_FAMILY_ID}</code>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => navigator.clipboard.writeText(MOCK_FAMILY_ID)}
              title="Copy to clipboard"
            >
              Copy
            </button>
          </div>
        </div>
      </div>

      <p className="settings-more-coming">Additional settings will be added here.</p>
    </div>
  )
}
