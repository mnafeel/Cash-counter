import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { useCash } from '../context/CashContext'
import { useOpenTiming } from '../hooks/useOpenTiming'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import AmountDisplay from '../components/AmountDisplay'
import BillReminderModal from '../components/BillReminderModal'
import NumberKeyboard from '../components/NumberKeyboard'
import type { AppData, LoanPaySource } from '../types'
import { evaluateBillReminderAlert, getReminderAlertSettings } from '../utils/billReminders'
import {
  buildLoanList,
  buildLoanOverview,
  searchLoans,
  summarizeLoanPeopleForSearch,
  type LoanListItem,
} from '../utils/loanLedger'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { formatDate, formatMoney, isoToDateInputValue, parseAmount } from '../utils/format'
import {
  buildLoanStatement,
  defaultLoanStatementFromDate,
  listLoanPeople,
  loanStatementOutstandingLabel,
  printLoanStatement,
  searchLoanPeople,
} from '../utils/loanStatement'
import { useAppPageBack } from '../hooks/useAppPageBack'
import { usePageEscape } from '../hooks/usePageEscape'
import { useIsActiveRoute } from '../hooks/useIsActiveRoute'
import './Loan.css'

type LoanTab = 'pending' | 'settled'
type FormMode = 'give' | 'take' | null
type FormField = 'name' | 'amount'

export default function Loan() {
  useOpenTiming('Loan', true, false)
  const routeActive = useIsActiveRoute('/loan')
  const goBack = useAppPageBack('/', { route: '/loan' })
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
  const { value: query, setValue: setQuery, deferredValue: deferredQuery } = useDeferredSearch()
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [personName, setPersonName] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [paySource, setPaySource] = useState<LoanPaySource>('cash')
  const [formError, setFormError] = useState('')
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [settlementSource, setSettlementSource] = useState<LoanPaySource>('cash')
  const [settlementAmountStr, setSettlementAmountStr] = useState('')
  const [reminderLoanId, setReminderLoanId] = useState<string | null>(null)
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null)
  const [formField, setFormField] = useState<FormField>('amount')
  const [statementOpen, setStatementOpen] = useState(false)
  const [statementQuery, setStatementQuery] = useState('')
  const [statementPerson, setStatementPerson] = useState('')
  const [statementFromDate, setStatementFromDate] = useState(() =>
    isoToDateInputValue(new Date().toISOString()),
  )
  const nameInputRef = useRef<HTMLInputElement>(null)

  const overview = useMemo(() => buildLoanOverview(data), [data])
  const loanList = useMemo(() => buildLoanList(data, tab), [data, tab])
  const list = useMemo(() => searchLoans(loanList, deferredQuery), [loanList, deferredQuery])
  const personSearchSummaries = useMemo(
    () => summarizeLoanPeopleForSearch(data, deferredQuery),
    [data, deferredQuery],
  )
  const amount = parseAmount(amountStr)
  const formOpen = formMode !== null
  const loanPeople = useMemo(() => listLoanPeople(data), [data])
  const statementPeople = useMemo(
    () => searchLoanPeople(loanPeople, statementQuery),
    [loanPeople, statementQuery],
  )
  const statement = useMemo(
    () =>
      statementPerson
        ? buildLoanStatement(data, statementPerson, statementFromDate)
        : null,
    [data, statementPerson, statementFromDate],
  )
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
    setStatementOpen(false)
    setFormField('amount')
  }

  function openStatement() {
    resetForm()
    setFormMode(null)
    setSettlingId(null)
    setStatementOpen(true)
    setStatementQuery('')
    setStatementPerson('')
    setStatementFromDate(isoToDateInputValue(new Date().toISOString()))
    setFormError('')
  }

  function selectStatementPerson(name: string) {
    setStatementPerson(name)
    setStatementQuery(name)
    setStatementFromDate(defaultLoanStatementFromDate(data, name))
    setFormError('')
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
  useRouteNumpadKeyboard('/loan', (action) => numpadHandlerRef.current(action), formOpen)

  const submitFormRef = useRef(handleSubmitForm)
  const settleLoanRef = useRef(handleSettle)
  submitFormRef.current = handleSubmitForm
  settleLoanRef.current = handleSettle

  useEffect(() => {
    if (!routeActive) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code !== 'KeyS') return
      if (formMode) {
        e.preventDefault()
        submitFormRef.current()
        return
      }
      if (settlingId) {
        const loan = list.find((entry) => entry.id === settlingId)
        if (!loan) return
        e.preventDefault()
        settleLoanRef.current(loan)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [routeActive, formMode, settlingId, list])

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
      if (!takeLoan({ personName: name, amount, paySource, note: note.trim() || undefined })) {
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
    const amount = parseAmount(settlementAmountStr)
    if (!(amount > 0)) {
      setFormError('Enter settlement amount.')
      return
    }
    if (amount > loan.remainingAmount) {
      setFormError(`Maximum ${formatMoney(loan.remainingAmount)}.`)
      return
    }
    if (loan.kind === 'borrow') {
      if (settlementSource === 'cash' && balance < amount) {
        setFormError('Not enough cash.')
        return
      }
      if (settlementSource === 'bank' && bankBalance < amount) {
        setFormError('Not enough bank balance.')
        return
      }
    }
    if (!settleLoanRecord(loan.id, settlementSource, { amount })) {
      setFormError('Could not settle.')
      return
    }
    setSettlingId(null)
    setSettlementAmountStr('')
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
    if (statementOpen) {
      setStatementOpen(false)
      setStatementQuery('')
      setStatementPerson('')
      setFormError('')
      return
    }
    goBack()
  }, [formMode, settlingId, statementOpen, goBack])

  usePageEscape(handleClose, routeActive)

  return (
    <div className="loan-page page-shell">
      <p className="loan-page-sub">Zero interest · lend and borrow</p>

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
              <p className="loan-page-form-hint">
                {formMode === 'give' ? 'Available' : 'Adds to'} ·{' '}
                {paySource === 'bank' ? '🏦 Bank' : '💵 Cash'}{' '}
                {formatMoney(paySource === 'bank' ? bankBalance : balance)}
              </p>
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
                className="btn btn-danger btn-with-shortcut"
                onClick={handleSubmitForm}
                disabled={!(amount > 0) || !personName.trim()}
              >
                <span className="btn-text">Save {amount > 0 ? formatMoney(amount) : ''}</span>
                <span className="btn-shortcut">Alt+S</span>
              </button>
            </div>
          </section>
        ) : settlingId ? (
          <section className="loan-page-settle">
            <h2>Mark settled</h2>
            <p className="loan-page-form-hint">
              {(() => {
                const loan = list.find((entry) => entry.id === settlingId)
                return loan
                  ? `Balance ${formatMoney(loan.remainingAmount)} · cash or bank for return / collection`
                  : 'Cash or bank for return / collection'
              })()}
            </p>
            <label className="loan-page-field">
              <span>Amount</span>
              <input
                type="text"
                inputMode="decimal"
                value={settlementAmountStr}
                onChange={(e) => {
                  setSettlementAmountStr(e.target.value)
                  setFormError('')
                }}
                placeholder="Settlement amount"
              />
            </label>
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
                className="btn btn-danger btn-with-shortcut"
                onClick={() => {
                  const loan = list.find((entry) => entry.id === settlingId)
                  if (loan) handleSettle(loan)
                }}
              >
                <span className="btn-text">Confirm</span>
                <span className="btn-shortcut">Alt+S</span>
              </button>
            </div>
          </section>
        ) : statementOpen ? (
          <section className="loan-page-statement">
            <div className="loan-page-form-head">
              <h2>Loan statement</h2>
              <p className="loan-page-form-hint">Search a person, pick a start date, then print or save PDF.</p>
            </div>

            <label className="loan-page-name">
              <span className="loan-page-name-label">Person name</span>
              <input
                type="search"
                className="loan-page-name-input"
                value={statementQuery}
                onChange={(e) => {
                  setStatementQuery(e.target.value)
                  if (statementPerson && e.target.value.trim().toLowerCase() !== statementPerson.toLowerCase()) {
                    setStatementPerson('')
                  }
                }}
                placeholder="Search by name"
                autoComplete="off"
                aria-label="Search loan person"
              />
            </label>

            {statementPerson ? (
              <p className="loan-page-statement-selected">
                Selected · <strong>{statementPerson}</strong>
              </p>
            ) : statementPeople.length > 0 ? (
              <ul className="loan-page-statement-people">
                {statementPeople.slice(0, 12).map((person) => (
                  <li key={person.personName}>
                    <button type="button" onClick={() => selectStatementPerson(person.personName)}>
                      <strong>{person.personName}</strong>
                      <small>
                        {person.loanCount} loan{person.loanCount === 1 ? '' : 's'}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="loan-page-empty">
                {statementQuery.trim() ? 'No matching person.' : 'No loan names yet.'}
              </p>
            )}

            <label className="loan-page-field">
              <span>From date</span>
              <input
                type="date"
                value={statementFromDate}
                onChange={(e) => setStatementFromDate(e.target.value)}
              />
            </label>

            {statement ? (
              <>
                <div className="loan-page-statement-totals">
                  <div>
                    <span>Total given</span>
                    <strong>{formatMoney(statement.totalGiven)}</strong>
                  </div>
                  <div>
                    <span>Total received</span>
                    <strong>{formatMoney(statement.totalReceived)}</strong>
                  </div>
                  <div>
                    <span>Outstanding</span>
                    <strong>{formatMoney(statement.closingBalance)}</strong>
                    <small>{loanStatementOutstandingLabel(statement.closingBalance)}</small>
                  </div>
                </div>
                <div className="loan-page-statement-table-wrap">
                  <table className="loan-page-statement-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Details</th>
                        <th>Given</th>
                        <th>Received</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="loan-page-statement-opening">
                        <td colSpan={4}>Opening · {statement.fromDateLabel}</td>
                        <td>{formatMoney(statement.openingBalance)}</td>
                      </tr>
                      {statement.lines.length === 0 ? (
                        <tr>
                          <td colSpan={5}>No transactions from this date.</td>
                        </tr>
                      ) : (
                        statement.lines.map((line) => (
                          <tr key={line.id}>
                            <td>{line.dateLabel}</td>
                            <td>{line.details}</td>
                            <td>{line.given > 0 ? formatMoney(line.given) : '—'}</td>
                            <td>{line.received > 0 ? formatMoney(line.received) : '—'}</td>
                            <td>{formatMoney(line.balanceAfter)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : statementPerson ? (
              <p className="loan-page-empty">No loans found for this person.</p>
            ) : null}

            <div className="loan-page-form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStatementOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!statement}
                onClick={() => {
                  if (statement) printLoanStatement(statement)
                }}
              >
                PDF / Print
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
              <button type="button" className="loan-page-btn loan-page-btn--statement" onClick={openStatement}>
                Statement
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
              {personSearchSummaries.length > 0 ? (
                <div className="loan-page-person-summaries" aria-label="Person loan totals">
                  {personSearchSummaries.map((person) => (
                    <div key={person.personName} className="loan-page-person-summary">
                      <strong className="loan-page-person-summary-name">{person.personName}</strong>
                      <div className="loan-page-person-summary-grid">
                        <div className="loan-page-person-summary-card">
                          <span>To receive</span>
                          <strong>{formatMoney(person.toCollect)}</strong>
                          <small>{person.toCollect > 0 ? 'They owe you' : 'Nothing open'}</small>
                        </div>
                        <div className="loan-page-person-summary-card">
                          <span>To pay</span>
                          <strong>{formatMoney(person.toPay)}</strong>
                          <small>{person.toPay > 0 ? 'You owe them' : 'Nothing open'}</small>
                        </div>
                      </div>
                      <small className="loan-page-person-summary-meta">
                        {person.openCount} open · {person.settledCount} settled
                      </small>
                    </div>
                  ))}
                </div>
              ) : null}
              {list.length === 0 ? (
                <p className="loan-page-empty">
                  {deferredQuery.trim()
                    ? personSearchSummaries.length > 0
                      ? tab === 'pending'
                        ? 'No open loans in this tab for this person.'
                        : 'No settled loans in this tab for this person.'
                      : 'No matching loans.'
                    : tab === 'pending'
                      ? 'No pending loans.'
                      : 'No settled loans.'}
                </p>
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
                        setSettlementAmountStr(String(loan.remainingAmount))
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
          <span className="loan-page-row-amount">
            {loan.remainingAmount <= 0 ? (
              <>
                {formatMoney(loan.paidAmount ?? loan.amount)} / {formatMoney(loan.amount)}
                <small> (Closed)</small>
              </>
            ) : (
              <>
                {formatMoney(loan.remainingAmount)}
                {loan.remainingAmount < loan.amount ? (
                  <small> / {formatMoney(loan.amount)}</small>
                ) : null}
              </>
            )}
          </span>
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
            <strong>
              {loan.remainingAmount <= 0
                ? `${formatMoney(loan.paidAmount ?? loan.amount)} / ${formatMoney(loan.amount)} (Closed)`
                : formatMoney(loan.amount)}
            </strong>
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
      {loan.remainingAmount > 0 ? (
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
