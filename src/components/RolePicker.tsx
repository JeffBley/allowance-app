// ---------------------------------------------------------------------------
// RolePicker — shown when a user has multiple roles available
//
// This is rendered instead of the main app when the user has the SuperAdmin
// Entra app role AND is also enrolled in a family.  They pick which view to
// enter; their choice is remembered in this component's parent state so they
// can switch views without signing out.
// ---------------------------------------------------------------------------

export type ActiveView = 'family' | 'superadmin'

interface Props {
  displayName: string
  onSelect: (view: ActiveView) => void
}

export default function RolePicker({ displayName, onSelect }: Props) {
  return (
    <div className="role-picker">
      <div className="role-picker__header">
        <h1 className="role-picker__title">Welcome, {displayName}</h1>
        <p className="role-picker__subtitle">You have access to multiple views. Which would you like to open?</p>
      </div>

      <div className="role-picker__cards">
        <button
          className="role-picker__card"
          onClick={() => onSelect('superadmin')}
        >
          <span className="role-picker__card-icon" aria-hidden="true">🛡️</span>
          <span className="role-picker__card-title">Super Admin Console</span>
          <span className="role-picker__card-desc">
            Manage families, members, and application settings
          </span>
        </button>

        <button
          className="role-picker__card"
          onClick={() => onSelect('family')}
        >
          <span className="role-picker__card-icon" aria-hidden="true">🏠</span>
          <span className="role-picker__card-title">Family View</span>
          <span className="role-picker__card-desc">
            View your family's allowances and transactions
          </span>
        </button>
      </div>
    </div>
  )
}
