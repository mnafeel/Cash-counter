import { useMemo, useRef, useState, useCallback } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import BillReminderModal from '../components/BillReminderModal'
import NumberKeyboard from '../components/NumberKeyboard'
import type { AppData, LoanPaySource } from '../types'
import { evaluateBillReminderAlert, getReminderAlertSettings } from '../utils/billReminders'
import {
  buildLoanList,
  buildLoanOverview,
  searchLoans,
  type LoanListItem,
} from '../utils/loanLedger'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { formatDate, formatMoney, parseAmount } from '../utils/format'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import { useAppPageBack } from '../hooks/useAppPageBack'
import { usePageEscape } from '../hooks/usePageEscape'
import './Loan.css'

type LoanTab = 'pending' | 'settled'
type FormMode = 'give' | 'take' | null
type FormField = 'name' | 'amount'

export default function Loan() {
  const goBack = useAppPageBack()
  const {
    data,
    balance,
    bankBalance,
    giveLoan,
    takeLoan,
    settleLoanRecord,
    setLoanReminder,
    updateReminderAlertSettings,
  } = useCash()

  const [tab, setTab] = useState<LoanTab>('pending')
  const [query, setQuery] = useState('')
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [personName, setPersonName] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [paySource, setPaySource] = useState<LoanPaySource>('cash')
  const [formError, setFormError] = useState('')
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [settlementSource, setSettlementSource] = useState<LoanPaySource>('cash')
  const [reminderLoanId, setReminderLoanId] = useState<string | null>(null)
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null)
  const [formField, setFormField] = useState<FormField>('amount')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const overview = useMemo(() => buildLoanOverview(data), [data])
  const list = useMemo(() => searchLoans(buildLoanList(data, tab), query), [data, tab, query])
  const amount = parseAmount(amountStr)
  const formOpen = formMode !== null
  const reminderLoan = useMemo(
    () => (data.loans ?? []).find((loan) => loan.id === reminderLoanId),
    [data.loans, reminderLoanId],
  )
  const alertSettings = useMemo(() => getReminderAlertSettings(data), [data])

  function resetForm() {
    setPersonName('')
    setAmountStr('')
    setNote('')
    setPaySource('cash')
    setFormError('')
  }

  function openForm(mode: FormMode) {
    resetForm()
    setFormMode(mode)
    setSettlingId(null)
    setFormField('amount')
  }

  function handleFormNumpad(action: NumpadAction) {
    if (action === 'enter') {
      setFormField((field) => {
        if (field === 'name') {
          nameInputRef.current?.blur()
          return 'amount'
        }
        nameInputRef.current?.focus()
        return 'name'
      })
      return
    }
    if (formField === 'amount') {
      setAmountStr((prev) => applyNumpadAction(prev, action))
      setFormError('')
    }
  }

  const numpadHandlerRef = useRef(handleFormNumpad)
  numpadHandlerRef.current = handleFormNumpad
  useNumpadKeyboard((action) => numpadHandlerRef.current(action), formOpen)

  function handleSubmitForm() {
    const amount = parseAmount(amountStr)
    const name = personName.trim()
    if (!name) {
      setFormError('Enter name.')
      return
    }
    if (!(amount > 0)) {
      setFormError('Enter amount.')
      return
    }

    if (formMode === 'give') {
      if (paySource === 'cash' && balance < amount) {
        setFormError('Not enough cash.')
        return
      }
      if (paySource === 'bank' && bankBalance < amount) {
        setFormError('Not enough bank balance.')
        return
      }
      if (!giveLoan({ personName: name, amount, paySource, note: note.trim() || undefined })) {
        setFormError('Could not save.')
        return
      }
    } else if (formMode === 'take') {
      if (!takeLoan({ personName: name, amount, note: note.trim() || undefined })) {
        setFormError('Could not save.')
        return
      }
    } else {
      return
    }

    resetForm()
    setFormMode(null)
  }

  function handleSettle(loan: LoanListItem) {
    if (loan.kind === 'borrow') {
      if (settlementSource === 'cash' && balance < loan.amount) {
        setFormError('Not enough cash.')
        return
      }
      if (settlementSource === 'bank' && bankBalance < loan.amount) {
        setFormError('Not enough bank balance.')
        return
      }
    }
    if (!settleLoanRecord(loan.id, settlementSource)) {
      setFormError('Could not settle.')
      return
    }
    setSettlingId(null)
    setFormError('')
  }

  const handleClose = useCallback(() => {
    if (formMode) {
      resetForm()
      setFormMode(null)
      return
    }
    if (settlingId) {
      setSettlingId(null)
      setFormError('')
      return
    }
    goBack()
  }, [formMode, settlingId, goBack])

  usePageEscape(handleClose)

  return (
    <div className="loan-page page-shell">
      <PageCorners
        left={
          <PageBackButton
            onClick={handleClose}
            ariaLabel={formMode || settlingId ? 'Go back' : 'Back'}
          />
        }
      />

      <header className="loan-page-head page-head--corners">
        <div className="loan-page-head-text">
          <h1>Loan</h1>
          <p>Zero interest · lend and borrow</p>
        </div>
      </header>

      <div className="loan-page-summary">
        <div className="loan-page-summary-card">
          <span>To collect</span>
          <strong>{formatMoney(overview.receivableTotal)}</strong>
          <small>{overview.receivableCount} given</small>
        </div>
        <div className="loan-page-summary-card">
          <span>To return</span>
          <strong>{formatMoney(overview.payableTotal)}</strong>
          <small>{overview.payableCount} taken</small>
        </div>
      </div>

      <div className="loan-page-body">
        {formMode ? (
          <section className="loan-page-form">
            <div className="loan-page-form-head">
              <h2>{formMode === 'give' ? 'Give loan' : 'Take loan'}</h2>
              {formMode === 'give' ? (
                <p className="loan-page-form-hint">
                  Available · {paySource === 'bank' ? '🏦 Bank' : '💵 Cash'}{' '}
                  {formatMoney(paySource === 'bank' ? bankBalance : balance)}
                </p>
              ) : (
                <p className="loan-page-form-hint">Adds to cash in drawer</p>
              )}
            </div>

            <div className="loan-page-top">
              <label className="loan-page-name">
                <span className="loan-page-name-label">Person name</span>
                <input
                  ref={nameInputRef}
                  type="text"
                  className={`loan-page-name-input ${formField === 'name' ? 'loan-page-name-input--active' : ''}`}
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  onFocus={() => setFormField('name')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      setFormField('amount')
                    }
                  }}
                  placeholder="Required"
                  autoComplete="off"
                />
              </label>

              <AmountDisplay
                label="Loan amount"
                value={amountStr}
                active={formField === 'amount'}
                onSelect={() => setFormField('amount')}
                compact
              />
            </div>

            {formMode === 'give' ? (
              <div className="loan-page-chips">
                <button
                  type="button"
                  className={paySource === 'cash' ? 'active' : ''}
                  onClick={() => setPaySource('cash')}
                >
                  💵 Cash
                </button>
                <button
                  type="button"
                  className={paySource === 'bank' ? 'active' : ''}
                  onClick={() => setPaySource('bank')}
                >
                  🏦 Bank
                </button>
              </div>
            ) : null}

            <label className="loan-page-note">
              <span className="loan-page-note-label">Note</span>
              <input
                type="text"
                className="loan-page-note-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
              />
            </label>

            {formError ? <p className="loan-page-error">{formError}</p> : null}

            <div className="loan-page-keyboard">
              <NumberKeyboard onPress={handleFormNumpad} />
            </div>

            <div className="loan-page-form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setFormMode(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleSubmitForm}
                disabled={!(amount > 0) || !personName.trim()}
              >
                Save {amount > 0 ? formatMoney(amount) : ''}
              </button>
            </div>
          </section>
        ) : settlingId ? (
          <section className="loan-page-settle">
            <h2>Mark settled</h2>
            <p className="loan-page-form-hint">Cash or bank for return / collection</p>
            <div className="loan-page-chips">
              <button
                type="button"
                className={settlementSource === 'cash' ? 'active' : ''}
                onClick={() => setSettlementSource('cash')}
              >
                💵 Cash
              </button>
              <button
                type="button"
                className={settlementSource === 'bank' ? 'active' : ''}
                onClick={() => setSettlementSource('bank')}
              >
                🏦 Bank
              </button>
            </div>
            {formError ? <p className="loan-page-error">{formError}</p> : null}
            <div className="loan-page-form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setSettlingId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const loan = list.find((entry) => entry.id === settlingId)
                  if (loan) handleSettle(loan)
                }}
              >
                Confirm
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="loan-page-actions">
              <button type="button" className="loan-page-btn loan-page-btn--give" onClick={() => openForm('give')}>
                Give loan
              </button>
              <button type="button" className="loan-page-btn loan-page-btn--take" onClick={() => openForm('take')}>
                Take loan
              </button>
            </div>

            <div className="loan-page-toolbar">
              <div className="loan-page-tabs">
                <button type="button" className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
                  Pending
                </button>
                <button type="button" className={tab === 'settled' ? 'active' : ''} onClick={() => setTab('settled')}>
                  Settled ({overview.settledCount})
                </button>
              </div>
              <input
                type="search"
                className="loan-page-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or amount"
                aria-label="Search loans"
              />
            </div>

            <div className="loan-page-list">
              {list.length === 0 ? (
                <p className="loan-page-empty">{tab === 'pending' ? 'No pending loans.' : 'No settled loans.'}</p>
              ) : (
                <ul>
                  {list.map((loan) => (
                    <LoanRow
                      key={loan.id}
                      loan={loan}
                      data={data}
                      expanded={expandedLoanId === loan.id}
                      onToggle={() =>
                        setExpandedLoanId((current) => (current === loan.id ? null : loan.id))
                      }
                      onSettle={() => {
                        setFormError('')
                        setSettlementSource('cash')
                        setSettlingId(loan.id)
                        setExpandedLoanId(null)
                      }}
                      onSetReminder={() => setReminderLoanId(loan.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {reminderLoan ? (
        <BillReminderModal
          open
          onClose={() => setReminderLoanId(null)}
          title={`Reminder · ${reminderLoan.personName}`}
          subtitle={`${reminderLoan.kind === 'lend' ? 'Collect' : 'Return'} ${formatMoney(reminderLoan.amount)}`}
          billKind="loan"
          reminderAt={reminderLoan.reminderAt}
          reminderNote={reminderLoan.reminderNote}
          reminderUrgent={reminderLoan.reminderUrgent}
          alertSettings={alertSettings}
          onSave={(reminderAt, settings, reminderNote, loanExtras) => {
            setLoanReminder(reminderLoan.id, reminderAt, reminderNote, loanExtras?.reminderUrgent ?? false)
            updateReminderAlertSettings(settings)
            setReminderLoanId(null)
          }}
          onClear={() => {
            setLoanReminder(reminderLoan.id, null, null, false)
            setReminderLoanId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function LoanRow({
  loan,
  data,
  expanded,
  onToggle,
  onSettle,
  onSetReminder,
}: {
  loan: LoanListItem
  data: AppData
  expanded: boolean
  onToggle: () => void
  onSettle: () => void
  onSetReminder: () => void
}) {
  const alertInfo = loan.reminderAt
    ? evaluateBillReminderAlert(loan.reminderAt, 'loan', getReminderAlertSettings(data))
    : null

  return (
    <li className={`loan-page-row loan-page-row--${loan.kind} ${expanded ? 'loan-page-row--expanded' : ''}`}>
      <button type="button" className="loan-page-row-toggle" onClick={onToggle}>
        <div className="loan-page-row-main">
          <div className="loan-page-row-copy">
            <strong>{loan.personName}</strong>
            <small>
              {loan.kindLabel} · {loan.dateLabel}
              {loan.reminderUrgent ? ' · ⚡ Urgent' : ''}
              {loan.note ? ` · ${loan.note}` : ''}
              {alertInfo?.isAlertActive
                ? ` · 🔔 ${alertInfo.alertLabel}`
                : loan.reminderAt
                  ? ` · 🔔 ${formatDate(loan.reminderAt)}`
                  : ''}
            </small>
          </div>
          <span className="loan-page-row-amount">{formatMoney(loan.amount)}</span>
        </div>
      </button>
      {expanded ? (
        <div className="loan-page-row-detail">
          <div className="loan-page-row-detail-row">
            <span>Person</span>
            <strong>{loan.personName}</strong>
          </div>
          <div className="loan-page-row-detail-row">
            <span>Type</span>
            <strong>{loan.kind === 'lend' ? 'Given (receivable)' : 'Taken (payable)'}</strong>
          </div>
          <div className="loan-page-row-detail-row">
            <span>Amount</span>
            <strong>{formatMoney(loan.amount)}</strong>
          </div>
          <div className="loan-page-row-detail-row">
            <span>Paid from</span>
            <strong>{loan.paySourceLabel}</strong>
          </div>
          <div className="loan-page-row-detail-row">
            <span>Status</span>
            <strong>{loan.statusLabel}</strong>
          </div>
          {loan.settledDateLabel ? (
            <div className="loan-page-row-detail-row">
              <span>Settled on</span>
              <strong>{loan.settledDateLabel}</strong>
            </div>
          ) : null}
          {loan.reminderAt ? (
            <div className="loan-page-row-detail-row">
              <span>Reminder</span>
              <strong>{formatDate(loan.reminderAt)}</strong>
            </div>
          ) : null}
          {loan.note ? (
            <div className="loan-page-row-detail-row">
              <span>Note</span>
              <strong>{loan.note}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      {loan.status === 'pending' ? (
        <div className="loan-page-row-actions">
          <button type="button" onClick={onSetReminder}>
            Reminder
          </button>
          <button type="button" className="settle" onClick={onSettle}>
            Settled
          </button>
        </div>
      ) : null}
    </li>
  )
}
