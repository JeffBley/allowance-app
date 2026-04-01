import { useState, useRef, useEffect } from 'react'
import type { ActiveView } from './RolePicker'

// ---------------------------------------------------------------------------
// RoleSwitcher — a dropdown in the top bar that lets a multi-role user
// switch between "Super Admin Console" and "Family View" without signing out.
//
// Rendered only when the user has both the SuperAdmin app role AND family
// enrollment.  Shown in the account bar (App.tsx) and the SA top bar
// (SuperAdminApp.tsx).
// ---------------------------------------------------------------------------

interface Props {
  currentView: ActiveView
  onSwitch: (view: ActiveView) => void
}

const VIEW_LABELS: Record<ActiveView, string> = {
  superadmin: '🛡️ Super Admin',
  family: '🏠 Family View',
}

export default function RoleSwitcher({ currentView, onSwitch }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const otherView: ActiveView = currentView === 'superadmin' ? 'family' : 'superadmin'

  return (
    <div className="role-switcher" ref={ref}>
      <button
        className="role-switcher__trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Switch view"
      >
        <span>{VIEW_LABELS[currentView]}</span>
        <span className="role-switcher__chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="role-switcher__menu" role="menu">
          <button
            className="role-switcher__item"
            role="menuitem"
            onClick={() => { onSwitch(otherView); setOpen(false) }}
          >
            Switch to {VIEW_LABELS[otherView]}
          </button>
        </div>
      )}
    </div>
  )
}
