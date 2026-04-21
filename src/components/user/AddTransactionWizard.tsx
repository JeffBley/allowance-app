import { useState } from 'react'
import type { KidView } from '../../data/mockData'
import { useApi } from '../../hooks/useApi'

interface Props {
  kid: KidView
  tithingEnabled?: boolean
  onClose: () => void
}

type Category = 'income' | 'purchase' | 'tithing'

interface WizardState {
  category: Category | null
  amount: string
  hours: string
  shouldBeTithed: boolean | null
  notes: string
  donationAmount: string
}

// Step layout per category (tithingEnabled = true):
//   income:   0=category → 1=amount → 2=tithing? → 3=notes → 4=summary
//   purchase: 0=category → 1=amount → 2=notes → 3=summary
//   tithing:  0=category → 1=amount → 2=summary
//
// When tithingEnabled = false:
//   income:   0=category → 1=amount → 2=notes → 3=summary  (tithing-question skipped)
//   purchase: 0=category → 1=amount → 2=notes → 3=summary
//   tithing category is removed from options entirely

function getMaxStep(category: Category | null, tithingEnabled: boolean): number {
  if (category === 'income')   return tithingEnabled ? 4 : 3
  if (category === 'purchase') return 3
  if (category === 'tithing')  return 2
  return 0
}

function getScreenName(step: number, category: Category | null, tithingEnabled: boolean): string {
  if (step === 0) return 'category'
  if (step === 1) return 'amount'
  if (category === 'income') {
    if (tithingEnabled) {
      if (step === 2) return 'tithing-question'
      if (step === 3) return 'notes'
      if (step === 4) return 'summary'
    } else {
      if (step === 2) return 'notes'
      if (step === 3) return 'summary'
    }
  }
  if (category === 'purchase') {
    if (step === 2) return 'notes'
    if (step === 3) return 'summary'
  }
  if (category === 'tithing') {
    if (step === 2) return 'summary'
  }
  return 'summary'
}

function fmt(n: number) { return n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}` }

const CATEGORY_META: Record<Category, { icon: string; label: string; description: string }> = {
  income:   { icon: '💰', label: 'Income',   description: 'Money you earned or received' },
  purchase: { icon: '🛒', label: 'Purchase', description: 'Money you spent on something' },
  tithing:  { icon: '⛪', label: 'Tithing',  description: 'Pay your tithing' },
}

export default function AddTransactionWizard({ kid, tithingEnabled = true, onClose }: Props) {
  const { apiFetch } = useApi()
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>({
    category: null,
    amount: '',
    hours: '',
    shouldBeTithed: null,
    notes: '',
    donationAmount: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const maxStep    = getMaxStep(state.category, tithingEnabled)
  const screen     = getScreenName(step, state.category, tithingEnabled)
  const hourlyOn    = kid.kidSettings?.hourlyWagesEnabled === true
  const wageRate    = kid.kidSettings?.hourlyWageRate ?? 10
  const hoursNum    = parseFloat(state.hours) || 0
  // If hourly wages active and hours entered, derive amount from hours × rate
  const amountNum   = (hourlyOn && state.category === 'income' && hoursNum > 0)
    ? Math.round(hoursNum * wageRate * 100) / 100
    : parseFloat(state.amount) || 0
  const donationAmountNum = parseFloat(state.donationAmount) || 0
  const titheAmt   = amountNum * 0.1

  const newTithingOwed =
    state.category === 'tithing'
      ? kid.tithingOwed - amountNum
      : state.category === 'income' && tithingEnabled && state.shouldBeTithed
        ? kid.tithingOwed + titheAmt
        : kid.tithingOwed

  const newBalance =
    state.category === 'income'
      ? kid.balance + amountNum
      : state.category === 'tithing'
        ? kid.balance - amountNum - donationAmountNum
        : kid.balance - amountNum

  function canProceed(): boolean {
    if (step === 0) return state.category !== null
    if (step === 1) return amountNum > 0
    if (step === 2 && state.category === 'income' && tithingEnabled) return state.shouldBeTithed !== null
    return true
  }

  function handleNext() { if (step < maxStep) setStep(s => s + 1) }
  function handleBack() { if (step > 0) setStep(s => s - 1) }

  async function handleSubmit() {
    if (!state.category) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const categoryMap = { income: 'Income', purchase: 'Purchase', tithing: 'Tithing' } as const
      await apiFetch('transactions', {
        method: 'POST',
        body: JSON.stringify({
          kidOid:   kid.oid,
          category: categoryMap[state.category],
          amount:   amountNum,
          date:     new Date().toISOString().split('T')[0],
          notes:    state.notes.trim(),
          ...(state.category === 'income' && { tithable: tithingEnabled && state.shouldBeTithed !== false }),
        }),
      })
      // If additional donation was entered on the tithing step, post it as a separate purchase
      if (state.category === 'tithing' && donationAmountNum > 0) {
        await apiFetch('transactions', {
          method: 'POST',
          body: JSON.stringify({
            kidOid:   kid.oid,
            category: 'Purchase',
            amount:   donationAmountNum,
            date:     new Date().toISOString().split('T')[0],
            notes:    'Additional donations (fast offerings, etc.)',
          }),
        })
      }
      onClose()
    } catch (err) {
      const apiErr = err as { body?: { message?: string } }
      setSubmitError(apiErr?.body?.message ?? 'Failed to save transaction. Please try again.')
      setSubmitting(false)
    }
  }

  // Progress indicator dots
  const totalSteps = maxStep + 1
  const progressDots = state.category ? (
    <div className="wizard-progress">
      {Array.from({ length: totalSteps }).map((_, i) => (
        <span
          key={i}
          className={[
            'wizard-progress__dot',
            i === step ? 'wizard-progress__dot--active' : '',
            i < step   ? 'wizard-progress__dot--done'   : '',
          ].join(' ')}
        />
      ))}
    </div>
  ) : null

  return (
    <div
      className="wizard-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="wizard-modal" role="dialog" aria-modal="true" aria-label="Add Transaction">

        {/* Header */}
        <div className="wizard-header">
          <h2 className="wizard-title">Add Transaction</h2>
          <button className="wizard-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {progressDots}

        {/* Body */}
        <div className="wizard-body">

          {/* STEP 0: Category */}
          {screen === 'category' && (
            <div className="wizard-screen">
              <p className="wizard-screen__prompt">What type of transaction?</p>
              <div className="category-options">
                {(Object.keys(CATEGORY_META) as Category[])
                  .filter(cat => tithingEnabled || cat !== 'tithing')
                  .map(cat => (
                  <button
                    key={cat}
                    className={`category-btn${state.category === cat ? ' category-btn--selected' : ''}`}
                    onClick={() => { setState(s => ({ ...s, category: cat })); setStep(1) }}
                  >
                    <span className="category-btn__icon">{CATEGORY_META[cat].icon}</span>
                    <span className="category-btn__label">{CATEGORY_META[cat].label}</span>
                    <span className="category-btn__desc">{CATEGORY_META[cat].description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP: Amount */}
          {screen === 'amount' && (
            <div className="wizard-screen">
              {/* Hourly wages: income with hourlyWagesEnabled shows hours-or-amount */}
              {hourlyOn && state.category === 'income' ? (
                <>
                  <p className="wizard-screen__prompt">How was this income earned?</p>
                  <div className="wizard-wages-block">
                    <p className="wizard-wages-label">Enter the number of hours:</p>
                    <div className="amount-input-wrapper">
                      <input
                        className="amount-input"
                        type="number"
                        min="0.01"
                        step="0.25"
                        placeholder="0"
                        value={state.hours}
                        onChange={e => setState(s => ({ ...s, hours: e.target.value, amount: '' }))}
                        autoFocus={!state.amount}
                      />
                    </div>
                    {hoursNum > 0 && (
                      <p className="wizard-wages-preview">
                        {state.hours} hrs × {fmt(wageRate)}/hr = <strong>{fmt(hoursNum * wageRate)}</strong>
                      </p>
                    )}
                    <div className="wizard-wages-or">OR</div>
                    <p className="wizard-wages-label">Enter the amount:</p>
                    <div className="amount-input-wrapper">
                      <span className="amount-input-prefix">$</span>
                      <input
                        className="amount-input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0.00"
                        value={state.amount}
                        onChange={e => setState(s => ({ ...s, amount: e.target.value, hours: '' }))}
                        autoFocus={!!state.amount}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="wizard-screen__prompt">
                    {state.category === 'tithing' ? 'How much tithing are you paying?' : 'Enter the amount:'}
                  </p>
                  {state.category === 'tithing' && (
                    <p className="wizard-screen__hint">
                      Tithing owed: <strong>{fmt(kid.tithingOwed)}</strong>
                    </p>
                  )}
                  <div className="amount-input-wrapper">
                    <span className="amount-input-prefix">$</span>
                    <input
                      className="amount-input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={state.amount}
                      onChange={e => setState(s => ({ ...s, amount: e.target.value }))}
                      autoFocus
                    />
                  </div>
                  {state.category === 'tithing' && (
                    <>
                      <p className="wizard-wages-label">
                        Additional donations <span className="optional">(fast offerings, etc.)</span>
                      </p>
                      <div className="amount-input-wrapper">
                        <span className="amount-input-prefix">$</span>
                        <input
                          className="amount-input"
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={state.donationAmount}
                          onChange={e => setState(s => ({ ...s, donationAmount: e.target.value }))}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP: Should this be tithed? (income only) */}
          {screen === 'tithing-question' && (
            <div className="wizard-screen">
              <p className="wizard-screen__prompt">Should this income be tithed?</p>
              <p className="wizard-screen__hint">
                10% of {fmt(amountNum)} = <strong>{fmt(titheAmt)}</strong>
              </p>
              <div className="yesno-options">
                <button
                  className={`yesno-btn${state.shouldBeTithed === true ? ' yesno-btn--selected yesno-btn--yes' : ''}`}
                  onClick={() => setState(s => ({ ...s, shouldBeTithed: true }))}
                >
                  Yes
                </button>
                <button
                  className={`yesno-btn${state.shouldBeTithed === false ? ' yesno-btn--selected yesno-btn--no' : ''}`}
                  onClick={() => setState(s => ({ ...s, shouldBeTithed: false }))}
                >
                  No
                </button>
              </div>
              {state.shouldBeTithed === true && (
                <p className="wizard-screen__info">
                  {fmt(titheAmt)} will be added to your tithing owed.
                </p>
              )}
            </div>
          )}

          {/* STEP: Notes */}
          {screen === 'notes' && (
            <div className="wizard-screen">
              <p className="wizard-screen__prompt">
                Add a note <span className="optional">(optional)</span>
              </p>
              <p className="wizard-screen__hint">
                {state.category === 'income'
                  ? 'Where did the money come from? e.g. "mowed lawns", "birthday money"'
                  : 'What did you spend it on?'}
              </p>
              <textarea
                className="notes-input"
                placeholder="Enter notes here..."
                value={state.notes}
                onChange={e => setState(s => ({ ...s, notes: e.target.value }))}
                rows={4}
                autoFocus
              />
            </div>
          )}

          {/* STEP: Summary — Tithing */}
          {screen === 'summary' && state.category === 'tithing' && (
            <div className="wizard-screen">
              <p className="wizard-screen__prompt">Review your tithing payment</p>
              <div className="summary-rows">
                <div className="summary-row">
                  <span className="summary-row__label">Tithing Owed (before)</span>
                  <span className="summary-row__value">{fmt(kid.tithingOwed)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-row__label">Tithing Paying</span>
                  <span className="summary-row__value summary-row__value--withdrawal">−{fmt(amountNum)}</span>
                </div>
                <div className="summary-row summary-row--total">
                  <span className="summary-row__label">Tithing Remaining</span>
                  <span className={`summary-row__value ${newTithingOwed <= 0 ? 'summary-row__value--success' : 'summary-row__value--warning'}`}>
                    {fmt(newTithingOwed)}
                  </span>
                </div>
                {donationAmountNum > 0 && (
                  <div className="summary-row">
                    <span className="summary-row__label">Additional Donation</span>
                    <span className="summary-row__value summary-row__value--withdrawal">−{fmt(donationAmountNum)}</span>
                  </div>
                )}
                <div className="summary-row summary-row--total">
                  <span className="summary-row__label">Money Available (after)</span>
                  <span className="summary-row__value">{fmt(newBalance)}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP: Summary — Income or Purchase */}
          {screen === 'summary' && state.category !== 'tithing' && (
            <div className="wizard-screen">
              <p className="wizard-screen__prompt">Review your transaction</p>
              <div className="summary-rows">
                <div className="summary-row">
                  <span className="summary-row__label">Type</span>
                  <span className="summary-row__value">
                    {state.category === 'income' ? 'Income (Deposit)' : 'Purchase (Withdrawal)'}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-row__label">Amount</span>
                  <span className={`summary-row__value ${state.category === 'income' ? 'summary-row__value--deposit' : 'summary-row__value--withdrawal'}`}>
                    {state.category === 'income' ? '+' : '−'}{fmt(amountNum)}
                  </span>
                </div>
                {state.category === 'income' && tithingEnabled && (
                  <div className="summary-row">
                    <span className="summary-row__label">Tithing Applies</span>
                    <span className="summary-row__value">
                      {state.shouldBeTithed ? `Yes (+${fmt(titheAmt)} owed)` : 'No'}
                    </span>
                  </div>
                )}
                {state.notes.trim() && (
                  <div className="summary-row">
                    <span className="summary-row__label">Notes</span>
                    <span className="summary-row__value summary-row__value--notes">{state.notes}</span>
                  </div>
                )}
                <div className="summary-row summary-row--total">
                  <span className="summary-row__label">Money Available (after)</span>
                  <span className="summary-row__value">{fmt(newBalance)}</span>
                </div>
                {state.category === 'income' && tithingEnabled && state.shouldBeTithed && (
                  <div className="summary-row">
                    <span className="summary-row__label">Tithing Owed (after)</span>
                    <span className="summary-row__value summary-row__value--warning">{fmt(newTithingOwed)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="wizard-footer">
          {step > 0 && (
            <button className="btn btn--secondary" onClick={handleBack} disabled={submitting}>
              ← Back
            </button>
          )}
          <div className="wizard-footer__spacer" />
          {submitError && (
            <p className="sa-form-error" role="alert" style={{ margin: '0 12px 0 0', fontSize: '0.85rem' }}>
              {submitError}
            </p>
          )}
          {step === maxStep && state.category !== null ? (
            <button className="btn btn--primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Saving…' : 'Submit ✓'}
            </button>
          ) : step > 0 ? (
            <button
              className="btn btn--primary"
              onClick={handleNext}
              disabled={!canProceed()}
            >
              Next →
            </button>
          ) : null}
        </div>

      </div>
    </div>
  )
}
