import { useState, useEffect, useCallback } from 'react'
import { listFamilies, createFamily, SaApiError, type SaFamily } from './saApi'

interface Props {
  onSelectFamily: (familyId: string, autoInvite?: boolean) => void
}

export default function FamiliesList({ onSelectFamily }: Props) {
  const [families, setFamilies]     = useState<SaFamily[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating]     = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listFamilies()
      setFamilies(data)
    } catch (err) {
      setError(err instanceof SaApiError ? err.message : 'Failed to load families.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const family = await createFamily()
      setShowCreate(false)
      // Navigate directly to the new family with the invite wizard pre-opened
      onSelectFamily(family.familyId, true)
    } catch (err) {
      setCreateError(err instanceof SaApiError ? err.message : 'Failed to create family.')
    } finally {
      setCreating(false)
    }
  }

  const q = searchQuery.trim().toLowerCase()
  const visibleFamilies = q
    ? families.filter(f => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
    : families

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <h2 className="sa-page-title">Families</h2>
        <button className="btn btn--primary btn--sm" onClick={() => setShowCreate(s => !s)}>
          {showCreate ? 'Cancel' : '+ New Family'}
        </button>
      </div>

      {/* Create family form */}
      {showCreate && (
        <form className="sa-inline-form" onSubmit={handleCreate}>
          <h3 className="sa-inline-form__title">Create Family</h3>
          <p className="sa-form-hint" style={{ marginBottom: 10 }}>
            A unique 8-character family ID will be generated. The first family admin to join will be prompted to set the family name.
          </p>
          {createError && <p className="sa-form-error" role="alert">{createError}</p>}
          <div className="sa-form-actions">
            <button className="btn btn--primary" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create Family'}
            </button>
          </div>
        </form>
      )}

      {/* Search bar */}
      {!loading && families.length > 0 && (
        <div className="sa-search-bar">
          <input
            className="sa-form-input"
            type="search"
            placeholder="Search by family name or ID…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search families"
          />
        </div>
      )}

      {/* Error banner */}
      {error && <p className="sa-error-banner" role="alert">{error} <button className="sa-link" onClick={load}>Retry</button></p>}

      {/* Loading */}
      {loading && <div className="sa-loading"><div className="app-loading__spinner" /></div>}

      {/* Empty state */}
      {!loading && families.length === 0 && !error && (
        <div className="sa-empty">
          <p>No families yet. Create one above to get started.</p>
        </div>
      )}

      {/* No search results */}
      {!loading && families.length > 0 && visibleFamilies.length === 0 && (
        <div className="sa-empty">
          <p>No families match &ldquo;{searchQuery.trim()}&rdquo;.</p>
        </div>
      )}

      {/* Families table */}
      {!loading && visibleFamilies.length > 0 && (
        <div className="table-wrapper">
          <table className="transactions-table sa-table">
            <thead>
              <tr>
                <th>Family ID</th>
                <th>Display Name</th>
                <th>Members</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleFamilies.map(f => (
                <tr key={f.id}>
                  <td><code className="sa-code">{f.id}</code></td>
                  <td className="sa-family-name">{f.name}</td>
                  <td>{f.memberCount}</td>
                  <td className="td-date">{new Date(f.createdAt).toLocaleDateString()}</td>
                  <td className="td-actions">
                    <button className="btn-action btn-action--edit" onClick={() => onSelectFamily(f.id)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}

