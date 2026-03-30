import { useState, useEffect } from 'react'
import type { Kid, KidId, KidSettings, AllowanceFrequency } from '../../data/mockData'

interface Props {
  kids: Record<KidId, Kid>
  onUnsavedStatusChange: (hasUnsaved: boolean) => void
}

type LocalSettings = KidSettings

const FREQUENCY_OPTIONS: AllowanceFrequency[] = ['Weekly', 'Bi-weekly', 'Monthly']

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const US_TIMEZONES: { label: string; value: string }[] = [
  { label: 'Eastern Time (ET)',          value: 'America/New_York'    },
  { label: 'Central Time (CT)',           value: 'America/Chicago'     },
  { label: 'Mountain Time (MT)',          value: 'America/Denver'      },
  { label: 'Mountain Time – Arizona (no DST)', value: 'America/Phoenix' },
  { label: 'Pacific Time (PT)',           value: 'America/Los_Angeles' },
  { label: 'Alaska Time (AKT)',           value: 'America/Anchorage'   },
  { label: 'Hawaii Time (HT)',            value: 'Pacific/Honolulu'    },
]

// Returns the next upcoming date (from today) that falls on `dayName`.
// If today is that day, returns next week.
function getNextDayOccurrence(dayName: string, offsetWeeks = 0): Date {
  const dayIndex = DAYS_OF_WEEK.indexOf(dayName)
  const today    = new Date()
  const todayDay = today.getDay()
  let daysUntil  = dayIndex - todayDay
  if (daysUntil <= 0) daysUntil += 7
  const result = new Date(today)
  result.setDate(today.getDate() + daysUntil + offsetWeeks * 7)
  return result
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function format12h(time24: string): string {
  const [hStr, mStr] = time24.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12  = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

function settingsEqual(a: LocalSettings, b: LocalSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Whether saving these settings should trigger the bi-weekly start dialog
function needsBiweeklyStartDialog(edited: LocalSettings, saved: LocalSettings): boolean {
  if (edited.allowanceFrequency !== 'Bi-weekly') return false
  // Show if frequency changed to bi-weekly, or if the day of week changed while bi-weekly
  return saved.allowanceFrequency !== 'Bi-weekly' || edited.dayOfWeek !== saved.dayOfWeek
}

const KID_IDS: KidId[] = ['jacob', 'sarah', 'kaitlyn']

export default function AdminFamilyMembersTab({ kids, onUnsavedStatusChange }: Props) {
  const [selectedId, setSelectedId]     = useState<KidId>('jacob')
  const [pendingKidId, setPendingKidId] = useState<KidId | null>(null)

  const [savedPerKid, setSavedPerKid] = useState<Record<KidId, LocalSettings>>({
    jacob:   { ...kids.jacob.settings },
    sarah:   { ...kids.sarah.settings },
    kaitlyn: { ...kids.kaitlyn.settings },
  })

  const [edited, setEdited] = useState<LocalSettings>({ ...kids[selectedId].settings })

  // Bi-weekly start dialog state
  const [showBiweeklyDialog, setShowBiweeklyDialog] = useState(false)

  const hasUnsaved = !settingsEqual(edited, savedPerKid[selectedId])

  useEffect(() => {
    onUnsavedStatusChange(hasUnsaved)
  }, [hasUnsaved, onUnsavedStatusChange])

  function doSelectKid(id: KidId) {
    setSelectedId(id)
    setEdited({ ...savedPerKid[id] })
    setPendingKidId(null)
  }

  function handleKidClick(id: KidId) {
    if (id === selectedId) return
    if (hasUnsaved) {
      setPendingKidId(id)
    } else {
      doSelectKid(id)
    }
  }

  function handleDiscardAndSwitch() {
    if (pendingKidId) doSelectKid(pendingKidId)
  }

  function commitSave() {
    setSavedPerKid(prev => ({ ...prev, [selectedId]: { ...edited } }))
    setShowBiweeklyDialog(false)
  }

  function handleSaveClick() {
    if (needsBiweeklyStartDialog(edited, savedPerKid[selectedId])) {
      setShowBiweeklyDialog(true)
    } else {
      commitSave()
    }
  }

  function updateField<K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) {
    setEdited(prev => ({ ...prev, [key]: value }))
  }

  const kid         = kids[selectedId]
  const showDayTime = edited.allowanceEnabled &&
    (edited.allowanceFrequency === 'Weekly' || edited.allowanceFrequency === 'Bi-weekly')

  // Dates for bi-weekly start dialog
  const nextOccurrence     = getNextDayOccurrence(edited.dayOfWeek, 0)
  const followingOccurrence = getNextDayOccurrence(edited.dayOfWeek, 1)
  const tzLabel = US_TIMEZONES.find(t => t.value === edited.timezone)?.label ?? edited.timezone

  return (
    <div className="family-members-layout">

      {/* Left panel — kid list */}
      <div className="kid-list">
        {KID_IDS.map(id => {
          const k = kids[id]
          const s = savedPerKid[id]
          return (
            <button
              key={id}
              className={`kid-list__item${selectedId === id ? ' kid-list__item--active' : ''}`}
              onClick={() => handleKidClick(id)}
            >
              <span className="kid-list__avatar">{k.name.charAt(0)}</span>
              <span className="kid-list__info">
                <span className="kid-list__name">{k.name}</span>
                <span className="kid-list__sub">
                  {s.allowanceEnabled
                    ? `$${s.allowanceAmount} / ${s.allowanceFrequency}`
                    : 'No allowance'}
                </span>
              </span>
              {selectedId === id && hasUnsaved && (
                <span className="kid-list__unsaved-dot" title="Unsaved changes" />
              )}
            </button>
          )
        })}
      </div>

      {/* Right panel — settings form */}
      <div className="kid-settings-panel">

        {/* Unsaved changes confirmation (when switching kids) */}
        {pendingKidId && (
          <div className="unsaved-inline-banner" role="alert">
            <p className="unsaved-inline-banner__text">
              <strong>Unsaved changes</strong> — switching to {kids[pendingKidId].name} will discard your edits for {kid.name}.
            </p>
            <div className="unsaved-inline-banner__actions">
              <button className="btn btn--secondary btn--sm" onClick={() => setPendingKidId(null)}>
                Keep Editing
              </button>
              <button className="btn btn--danger btn--sm" onClick={handleDiscardAndSwitch}>
                Discard &amp; Switch
              </button>
            </div>
          </div>
        )}

        <div className="settings-form">
          <div className="settings-form__header">
            <h3 className="settings-form__title">{kid.name}'s Settings</h3>
            {hasUnsaved && <span className="unsaved-badge">Unsaved changes</span>}
          </div>

          {/* Automatic Allowance toggle */}
          <div className="form-field">
            <div className="form-toggle-row">
              <div>
                <span className="form-label">Automatic Allowance</span>
                <p className="form-hint">Automatically deposit allowance on a schedule.</p>
              </div>
              <label className="toggle-switch" aria-label="Toggle automatic allowance">
                <input
                  type="checkbox"
                  checked={edited.allowanceEnabled}
                  onChange={e => updateField('allowanceEnabled', e.target.checked)}
                />
                <span className="toggle-switch__track" />
              </label>
            </div>
          </div>

          {/* Allowance sub-fields */}
          {edited.allowanceEnabled && (
            <div className="allowance-sub-fields">

              {/* Amount */}
              <div className="form-field">
                <label className="form-label" htmlFor="allowance-amount">Allowance Amount</label>
                <div className="amount-input-wrapper amount-input-wrapper--sm">
                  <span className="amount-input-prefix">$</span>
                  <input
                    id="allowance-amount"
                    className="amount-input amount-input--sm"
                    type="number"
                    min="0"
                    step="0.50"
                    value={edited.allowanceAmount}
                    onChange={e => updateField('allowanceAmount', parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Frequency */}
              <div className="form-field">
                <label className="form-label" htmlFor="allowance-freq">Frequency</label>
                <select
                  id="allowance-freq"
                  className="form-select"
                  value={edited.allowanceFrequency}
                  onChange={e => updateField('allowanceFrequency', e.target.value as AllowanceFrequency)}
                >
                  {FREQUENCY_OPTIONS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              {/* Day of week — Weekly / Bi-weekly only */}
              {showDayTime && (
                <>
                  <div className="form-field">
                    <label className="form-label" htmlFor="allowance-day">Day of the Week</label>
                    <p className="form-hint">Which day the deposit will occur.</p>
                    <select
                      id="allowance-day"
                      className="form-select"
                      value={edited.dayOfWeek}
                      onChange={e => updateField('dayOfWeek', e.target.value)}
                    >
                      {DAYS_OF_WEEK.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Monthly fixed-date notice */}
              {edited.allowanceFrequency === 'Monthly' && (
                <div className="form-field">
                  <div className="monthly-notice">
                    <span className="monthly-notice__icon">📅</span>
                    <p className="monthly-notice__text">
                      Monthly allowances always deposit on the <strong>1st of each month</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Time + timezone — all frequencies */}
              {edited.allowanceEnabled && (
                  <div className="form-field form-field--row">
                    <div className="form-field-sub">
                      <label className="form-label" htmlFor="allowance-time">Time of Day</label>
                      <input
                        id="allowance-time"
                        className="form-select"
                        type="time"
                        value={edited.timeOfDay}
                        onChange={e => updateField('timeOfDay', e.target.value)}
                      />
                    </div>
                    <div className="form-field-sub form-field-sub--grow">
                      <label className="form-label" htmlFor="allowance-tz">Timezone</label>
                      <select
                        id="allowance-tz"
                        className="form-select form-select--full"
                        value={edited.timezone}
                        onChange={e => updateField('timezone', e.target.value)}
                      >
                        {US_TIMEZONES.map(tz => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
              )}

            </div>
          )}

          {/* Save button */}
          <div className="settings-form__footer">
            <button
              className="btn btn--primary"
              onClick={handleSaveClick}
              disabled={!hasUnsaved}
            >
              {hasUnsaved ? 'Save Changes' : 'Saved ✓'}
            </button>
          </div>
        </div>
      </div>

      {/* Bi-weekly start date dialog */}
      {showBiweeklyDialog && (
        <div className="unsaved-nav-overlay" role="dialog" aria-modal="true" aria-label="Choose first deposit date">
          <div className="biweekly-start-dialog">
            <p className="biweekly-start-dialog__title">When should the first deposit happen?</p>
            <p className="biweekly-start-dialog__body">
              {kid.name}'s allowance is set to deposit every other{' '}
              <strong>{edited.dayOfWeek}</strong> at{' '}
              <strong>{format12h(edited.timeOfDay)}</strong>{' '}
              <strong>({tzLabel})</strong>.
              After the first deposit, it will repeat every two weeks.
            </p>
            <div className="biweekly-start-options">
              <button
                className="biweekly-start-option"
                onClick={commitSave}
              >
                <span className="biweekly-start-option__label">Next occurrence</span>
                <span className="biweekly-start-option__date">{formatDateLong(nextOccurrence)}</span>
              </button>
              <button
                className="biweekly-start-option"
                onClick={commitSave}
              >
                <span className="biweekly-start-option__label">Following week</span>
                <span className="biweekly-start-option__date">{formatDateLong(followingOccurrence)}</span>
              </button>
            </div>
            <button
              className="btn btn--secondary btn--sm biweekly-start-dialog__cancel"
              onClick={() => setShowBiweeklyDialog(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

