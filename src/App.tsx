import { useState } from 'react'
import UserApp from './components/user/UserApp'
import AdminApp from './components/admin/AdminApp'
import type { KidId } from './data/mockData'

type ViewMode = KidId | 'admin'

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('jacob')

  return (
    <div>
      <div className="role-bar">
        <span className="role-bar__label">Viewing as:</span>
        <select
          className="role-bar__select"
          value={viewMode}
          onChange={e => setViewMode(e.target.value as ViewMode)}
        >
          <option value="jacob">Jacob (Kid)</option>
          <option value="sarah">Sarah (Kid)</option>
          <option value="kaitlyn">Kaitlyn (Kid)</option>
          <option value="admin">Family Admin</option>
        </select>
      </div>

      {viewMode !== 'admin' ? (
        <UserApp kidId={viewMode} />
      ) : (
        <AdminApp />
      )}
    </div>
  )
}
