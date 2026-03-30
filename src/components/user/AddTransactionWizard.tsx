import { useState } from 'react'
import type { Kid } from '../../data/mockData'

interface Props {
  kid: Kid
  onClose: () => void
}

type Category = 'income' | 'purchase' | 'tithing'

interface WizardState {
  category: Category | null
  amount: string
  shouldBeTithed: boolean | null
  notes: string
}

// Step layout per category:
//   income:   0=category → 1=amount → 2=tithing? → 3=notes → 4=summary
//   purchase: 0=category → 1=amount → 2=notes → 3=summary
//   tithing:  0=category → 1=amount → 2=summary

function getMaxStep(category: Category | null): number {
  if (category === 'income')   return 4
  if (category === 'purchase') return 3
  if (category === 'tithing')  return 2
  return 0
}

function getScreenName(step: number, category: Category | null): string {
  if (step === 0) return 'category'
  if (step === 1) return 'amount'
  if (category === 'income') {
    if (step === 2) return 'tithing-question'
    if (step === 3) return 'notes'
    if (step === 4) return 'summary'
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

function fmt(n: number) { return `$${n.toFixed(2)}` }

const CATEGORY_META: Record<Category, { icon: string; label: string; description: string }> = {
  income:   { icon: '💰', label: 'Income',   description: 'Money you earned or received' },
  purchase: { icon: '🛒', label: 'Purchase', description: 'Money you spent on something' },
  tithing:  { icon: '⛪', label: 'Tithing',  description: 'Pay your tithing' },
}

export default function AddTransactionWizard({ kid, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>({
    category: null,
    amount: '',
    shouldBeTithed: null,
    notes: '',
  })

  const maxStep    = getMaxStep(state.category)
  const screen     = getScreenName(step, state.category)
  const amountNum  = parseFloat(state.amount) || 0
  const titheAmt   = amountNum * 0.1

  const newTithingOwed =
    state.category === 'tithing'
      ? Math.max(0, kid.tithingOwed - amountNum)
      : state.category === 'income' && state.shouldBeTithed
        ? kid.tithingOwed + titheAmt
        : kid.tithingOwed

  const newBalance =
    state.category === 'income'
      ? kid.balance + amountNum
      : kid.balance - amountNum

  function canProceed(): boolean {
    if (step === 0) return state.category !== null
    if (step === 1) return amountNum > 0
    if (step === 2 && state.category === 'income') return state.shouldBeTithed !== null
    return true
  }

  function handleNext() { if (step < maxStep) setStep(s => s + 1) }
  function handleBack() { if (step > 0) setStep(s => s - 1) }

  function handleSubmit() {
    // Prototype only — no API call yet
    onClose()
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
                {(Object.keys(CATEGORY_META) as Category[]).map(cat => (
                  <button
                    key={cat}
                    className={`category-btn${state.category === cat ? ' category-btn--selected' : ''}`}
                    onClick={() => setState(s => ({ ...s, category: cat }))}
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
              {state.category === 'tithing' && amountNum > kid.tithingOwed && amountNum > 0 && (
                <p className="wizard-screen__warning">
                  ⚠ Amount exceeds tithing owed ({fmt(kid.tithingOwed)})
                </p>
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
                <div className="summary-row">
                  <span className="summary-row__label">Money Available (after)</span>
                  <span className="summary-row__value">{fmt(kid.balance - amountNum)}</span>
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
                {state.category === 'income' && (
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
                {state.category === 'income' && state.shouldBeTithed && (
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
            <button className="btn btn--secondary" onClick={handleBack}>
              ← Back
            </button>
          )}
          <div className="wizard-footer__spacer" />
          {step === maxStep ? (
            <button className="btn btn--primary" onClick={handleSubmit}>
              Submit ✓
            </button>
          ) : (
            <button
              className="btn btn--primary"
              onClick={handleNext}
              disabled={!canProceed()}
            >
              Next →
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
