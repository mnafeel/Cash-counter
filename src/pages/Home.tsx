import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount, formatDate } from '../utils/format'
import { applyNumpadAction, applyPinAction, normalizePin, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import type { ExpensePayType, TransferDirection } from '../types'
import {
  buildHistoryItems,
  getHistoryTypeLabel,
  matchesHistorySearch,
  type HistoryFilter,
  type HistoryItemType,
} from '../utils/historyItems'
import {
  buildBankActivityItems,
  bankClosingLabel,
  bankOpeningLabel,
  getBankClosingBalance,
  getBankOpeningBalance,
  matchesBankDateFilter,
  summarizeBankActivity,
  type BankDateFilter,
} from '../utils/bankActivity'
import {
  buildCashActivityItems,
  cashClosingLabel,
  cashOpeningLabel,
  getCashClosingBalance,
  getCashOpeningBalance,
  matchesCashDateFilter,
  summarizeCashActivity,
  type CashDateFilter,
} from '../utils/cashActivity'
import {
  formatSalesBreakdown,
  getTodaySalesSummary,
} from '../utils/salesReport'
import {
  isPurchaseExpense,
  NO1_BILL_LABEL,
  NO2_BILL_LABEL,
} from '../utils/expenseBillLabels'
import {
  buildPurchaseHistoryItems,
  getTopPurchaseShop,
  summarizePurchases,
} from '../utils/purchaseHistory'
import ReportsPanel, { type ReportSection } from '../components/ReportsPanel'
import CustomerDashboard, { type CustomerListFilter } from '../components/CustomerDashboard'
import CreditDashboard, { type CreditListFilter } from '../components/CreditDashboard'
import ChequeDashboard, { type ChequeListFilter } from '../components/ChequeDashboard'
import { buildCreditOverview } from '../utils/customerLedger'
import { buildChequeOverview } from '../utils/chequeLedger'
import { getTodayDailyTotals } from '../utils/dailyTotals'
import {
  buildActiveChequeReminders,
  buildActiveCreditReminders,
  countActiveBillReminders,
} from '../utils/billReminders'
import type { ReportDatePreset } from '../utils/reportsHub'
import './Home.css'

const DEFAULT_PIN = '0000'

type PanelField = 'note' | 'amount'

const BALANCE_DATE_OPTIONS: { id: CashDateFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
]

export default function Home() {
  const navigate = useNavigate()
  const { balance, bankBalance, data, recordExpense, recordTransfer, removeSale, removeExpense, homeUnlocked, unlockHome, setCustomerReminder, updateReminderAlertSettings } =
    useCash()
  const [pinStr, setPinStr] = useState('')
  const [pinError, setPinError] = useState(false)
  const [addTarget, setAddTarget] = useState<ExpensePayType | null>(null)
  const [transferDirection, setTransferDirection] = useState<TransferDirection | null>(null)
  const [panelNote, setPanelNote] = useState('')
  const [panelAmountStr, setPanelAmountStr] = useState('')
  const [panelField, setPanelField] = useState<PanelField>('note')
  const [panelSaved, setPanelSaved] = useState(false)
  const [panelError, setPanelError] = useState('')
  const [showDeleteRecords, setShowDeleteRecords] = useState(false)
  const [deleteRecordSearch, setDeleteRecordSearch] = useState('')
  const [deleteRecordFilter, setDeleteRecordFilter] = useState<HistoryFilter>('all')
  const [showCashHistory, setShowCashHistory] = useState(false)
  const [cashDateFilter, setCashDateFilter] = useState<CashDateFilter>('today')
  const [cashSelectedDate, setCashSelectedDate] = useState('')
  const [showBankHistory, setShowBankHistory] = useState(false)
  const [bankDateFilter, setBankDateFilter] = useState<BankDateFilter>('today')
  const [bankSelectedDate, setBankSelectedDate] = useState('')
  const [showReports, setShowReports] = useState(false)
  const [showCustomers, setShowCustomers] = useState(false)
  const [showCredits, setShowCredits] = useState(false)
  const [showCheques, setShowCheques] = useState(false)
  const [customerFilter, setCustomerFilter] = useState<CustomerListFilter>('all')
  const [creditFilter, setCreditFilter] = useState<CreditListFilter>('credit')
  const [chequeFilter, setChequeFilter] = useState<ChequeListFilter>('cheque')
  const [customerInitialName, setCustomerInitialName] = useState<string | undefined>()
  const [creditInitialName, setCreditInitialName] = useState<string | undefined>()
  const [chequeInitialName, setChequeInitialName] = useState<string | undefined>()
  const [reportPreset, setReportPreset] = useState<ReportDatePreset>('today')
  const [reportSection, setReportSection] = useState<ReportSection | undefined>()
  const noteInputRef = useRef<HTMLInputElement>(null)

  function openPurchaseHistory() {
    navigate('/history', { state: { showPurchaseHistory: true } })
  }

  function openReports(preset: ReportDatePreset = 'today', section?: ReportSection) {
    setReportPreset(preset)
    setReportSection(section)
    setShowReports(true)
  }

  function openCustomers(filter: CustomerListFilter = 'all', customerName?: string) {
    setCustomerFilter(filter)
    setCustomerInitialName(customerName)
    setShowCustomers(true)
  }

  function openCredits(filter: CreditListFilter = 'credit', customerName?: string) {
    setCreditFilter(filter)
    setCreditInitialName(customerName)
    setShowCredits(true)
  }

  function openCheques(filter: ChequeListFilter = 'cheque', customerName?: string) {
    setChequeFilter(filter)
    setChequeInitialName(customerName)
    setShowCheques(true)
  }

  function openCustomerFromReports(customerName: string) {
    setShowReports(false)
    openCredits('credit', customerName)
  }

  const homePin = normalizePin(data.homePin, DEFAULT_PIN)
  const panelAmount = parseAmount(panelAmountStr)
  const panelNoteValid = panelNote.trim().length > 0
  const panelAmountValid = panelAmount > 0

  const transferSourceBalance =
    transferDirection === 'cash-to-bank'
      ? balance
      : transferDirection === 'bank-to-cash'
        ? bankBalance
        : 0

  const hasEnoughForTransfer =
    !transferDirection || !panelAmountValid || panelAmount <= transferSourceBalance

  const panelValid =
    panelNoteValid &&
    panelAmountValid &&
    (transferDirection ? hasEnoughForTransfer : true)

  useEffect(() => {
    if (addTarget || transferDirection) noteInputRef.current?.focus()
  }, [addTarget, transferDirection])

  const today = new Date().toDateString()
  const todaySalesSummary = useMemo(() => getTodaySalesSummary(data), [data])
  const creditOverview = useMemo(() => buildCreditOverview(data), [data])
  const chequeOverview = useMemo(() => buildChequeOverview(data), [data])
  const todayDailyTotals = useMemo(() => getTodayDailyTotals(data), [data])
  const dueReminders = useMemo(() => countActiveBillReminders(data), [data])
  const activeCreditAlerts = useMemo(() => buildActiveCreditReminders(data), [data])
  const activeChequeAlerts = useMemo(() => buildActiveChequeReminders(data), [data])
  const todayRegularExpenses = data.expenses.filter(
    (e) =>
      new Date(e.createdAt).toDateString() === today &&
      e.kind === 'expense' &&
      !isPurchaseExpense(e),
  )
  const todayRegularExpensesTotal = todayRegularExpenses.reduce((sum, e) => sum + e.amount, 0)
  const todayPurchases = data.expenses.filter(
    (e) => new Date(e.createdAt).toDateString() === today && isPurchaseExpense(e),
  )
  const todayPurchaseItems = useMemo(
    () =>
      buildPurchaseHistoryItems(data).filter(
        (item) => new Date(item.date).toDateString() === today,
      ),
    [data, today],
  )
  const todayPurchaseSummary = useMemo(
    () => summarizePurchases(todayPurchaseItems),
    [todayPurchaseItems],
  )
  const todayTopShop = useMemo(() => getTopPurchaseShop(todayPurchaseItems), [todayPurchaseItems])

  const cashActivityItems = useMemo(() => {
    return buildCashActivityItems(data).filter((item) =>
      matchesCashDateFilter(item.date, cashDateFilter, cashSelectedDate),
    )
  }, [data, cashDateFilter, cashSelectedDate])

  const cashActivitySummary = useMemo(
    () => summarizeCashActivity(cashActivityItems),
    [cashActivityItems],
  )

  const bankActivityItems = useMemo(() => {
    return buildBankActivityItems(data).filter((item) =>
      matchesBankDateFilter(item.date, bankDateFilter, bankSelectedDate),
    )
  }, [data, bankDateFilter, bankSelectedDate])

  const bankActivitySummary = useMemo(
    () => summarizeBankActivity(bankActivityItems),
    [bankActivityItems],
  )

  const cashOpeningToday = useMemo(
    () => getCashOpeningBalance(data, balance, cashDateFilter, cashSelectedDate),
    [data, balance, cashDateFilter, cashSelectedDate],
  )
  const bankOpeningToday = useMemo(
    () => getBankOpeningBalance(data, bankBalance, bankDateFilter, bankSelectedDate),
    [data, bankBalance, bankDateFilter, bankSelectedDate],
  )

  const cashClosingPeriod = useMemo(
    () => getCashClosingBalance(data, balance, cashDateFilter, cashSelectedDate),
    [data, balance, cashDateFilter, cashSelectedDate],
  )
  const bankClosingPeriod = useMemo(
    () => getBankClosingBalance(data, bankBalance, bankDateFilter, bankSelectedDate),
    [data, bankBalance, bankDateFilter, bankSelectedDate],
  )

  const cashPeriodStart = cashOpeningToday
  const bankPeriodStart = bankOpeningToday
  const cashPeriodClose = cashClosingPeriod
  const bankPeriodClose = bankClosingPeriod

  const recordsForDelete = useMemo(() => {
    return buildHistoryItems(data)
      .filter((item) => deleteRecordFilter === 'all' || item.type === deleteRecordFilter)
      .filter((item) => matchesHistorySearch(item, deleteRecordSearch))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [data, deleteRecordFilter, deleteRecordSearch])

  function handleDeleteRecord(
    type: HistoryItemType,
    id: string,
    groupSaleIds?: string[],
  ) {
    if (!confirm('Delete this record? Balances will be updated.')) return
    if (type === 'sale') removeSale(id, groupSaleIds)
    else removeExpense(id)
  }

  function tryUnlock(nextPin: string) {
    if (normalizePin(nextPin, '') === homePin) {
      unlockHome()
      setPinStr('')
      setPinError(false)
      return
    }
    setPinError(true)
    setPinStr('')
  }

  function handlePinNumpad(action: NumpadAction) {
    if (action === 'enter') {
      if (pinStr.length === 4) tryUnlock(pinStr)
      return
    }
    if (action === 'clear') {
      setPinStr('')
      setPinError(false)
      return
    }

    const next = applyPinAction(pinStr, action)
    setPinStr(next)
    setPinError(false)
    if (next.length === 4) tryUnlock(next)
  }

  function resetPanel() {
    setPanelNote('')
    setPanelAmountStr('')
    setPanelField('note')
    setPanelSaved(false)
    setPanelError('')
  }

  function openAdd(target: ExpensePayType) {
    setTransferDirection(null)
    setAddTarget(target)
    resetPanel()
  }

  function openTransfer(direction: TransferDirection) {
    setAddTarget(null)
    setTransferDirection(direction)
    resetPanel()
  }

  function closePanel() {
    setAddTarget(null)
    setTransferDirection(null)
    resetPanel()
  }

  function handlePanelSave() {
    if (!panelValid || panelSaved) return

    if (transferDirection) {
      if (!hasEnoughForTransfer) {
        setPanelError(
          transferDirection === 'cash-to-bank'
            ? 'Not enough cash in drawer.'
            : 'Not enough bank balance.',
        )
        return
      }
      recordTransfer({
        amount: panelAmount,
        name: panelNote.trim(),
        direction: transferDirection,
      })
    } else if (addTarget) {
      recordExpense({
        amount: panelAmount,
        name: panelNote.trim(),
        payType: addTarget,
        kind: 'add',
      })
    } else {
      return
    }

    setPanelSaved(true)
    setTimeout(closePanel, 700)
  }

  function handlePanelNumpad(action: NumpadAction) {
    if (action === 'enter') {
      setPanelField((f) => (f === 'note' ? 'amount' : 'note'))
      return
    }
    if (panelField === 'amount') {
      setPanelAmountStr((prev) => applyNumpadAction(prev, action))
      setPanelError('')
    }
  }

  const pinHandlerRef = useRef(handlePinNumpad)
  pinHandlerRef.current = handlePinNumpad
  const panelHandlerRef = useRef(handlePanelNumpad)
  panelHandlerRef.current = handlePanelNumpad
  const panelOpen = addTarget !== null || transferDirection !== null

  useNumpadKeyboard(
    (action) => {
      if (!homeUnlocked) pinHandlerRef.current(action)
      else if (panelOpen && !panelSaved) panelHandlerRef.current(action)
    },
    !homeUnlocked || (panelOpen && !panelSaved),
  )

  const panelTitle = transferDirection
    ? transferDirection === 'cash-to-bank'
      ? 'Cash → Bank Transfer'
      : 'Bank → Cash Transfer'
    : addTarget === 'bank'
      ? 'Add to Bank'
      : 'Add to Counter'

  const panelAmountLabel = transferDirection ? 'Transfer Amount' : 'Amount to Add'

  const panelSaveLabel = panelSaved
    ? '✓ Saved'
    : transferDirection
      ? 'Transfer'
      : addTarget === 'bank'
        ? 'Add to Bank'
        : 'Add to Counter'

  if (!homeUnlocked) {
    return (
      <div className="home home--locked">
        <section className="home-pin">
          <p className="home-pin-label">Enter 4-digit PIN</p>
          <div className={`home-pin-digits ${pinError ? 'home-pin-digits--error' : ''}`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`home-pin-digit ${pinStr.length > i ? 'home-pin-digit--filled' : ''}`}
              >
                {pinStr[i] ?? ''}
              </span>
            ))}
          </div>
          {pinError && <p className="home-pin-error">Wrong PIN. Try again.</p>}
          <div
            className="home-pin-keyboard"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <NumberKeyboard onPress={handlePinNumpad} showEnter={false} variant="pin" />
          </div>
          <p className="home-pin-hint">Tap numbers on screen · Default PIN: 0000</p>
        </section>
      </div>
    )
  }

  return (
    <div className="home">
      <section className="home-launch" aria-label="Quick launch">
        <Link to="/counter" className="home-launch-btn home-launch-btn--primary">
          <span className="home-launch-icon" aria-hidden="true">
            💵
          </span>
          <span className="home-launch-copy">
            <strong>Cash Counter</strong>
            <small>Bill amount · pay · change</small>
          </span>
          <span className="home-launch-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <button type="button" className="home-launch-btn" onClick={() => openReports('today')}>
          📊 Reports
        </button>
      </section>

      <section className="home-section home-section--balances" aria-label="Balances">
        <h2 className="home-section-title">Balances</h2>
        <div className="home-balances">
        <div className="home-balance-row">
          <div className="home-balance-card">
            <div className="home-balance-head">
              <p className="home-hero-label">💵 Cash in Drawer</p>
              <div className="home-balance-actions">
                <button
                  type="button"
                  className="home-cash-history-btn"
                  onClick={() => setShowCashHistory(true)}
                >
                  History
                </button>
                <button type="button" className="home-add-btn" onClick={() => openAdd('cash')}>
                  + Add
                </button>
              </div>
            </div>
            <BigAmount label="" value={balance} variant="primary" size="lg" />
            <div className="home-cash-dates">
              {BALANCE_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`home-cash-date-chip ${cashDateFilter === opt.id ? 'home-cash-date-chip--active' : ''}`}
                  onClick={() => {
                    setCashDateFilter(opt.id)
                    setCashSelectedDate('')
                  }}
                >
                  {opt.label}
                </button>
              ))}
              <input
                type="date"
                className={`home-cash-date-input ${cashDateFilter === 'date' ? 'home-cash-date-input--active' : ''}`}
                value={cashSelectedDate}
                onChange={(e) => {
                  setCashSelectedDate(e.target.value)
                  if (e.target.value) setCashDateFilter('date')
                }}
                aria-label="Pick date for cash history"
              />
            </div>
            <div className="home-balance-day">
              <p className="home-balance-last">
                {cashOpeningLabel(cashDateFilter)}{' '}
                <strong>{formatMoney(cashOpeningToday)}</strong>
              </p>
              <p className="home-balance-last home-balance-last--close">
                {cashClosingLabel(cashDateFilter)}{' '}
                <strong>{formatMoney(cashClosingPeriod)}</strong>
              </p>
            </div>
            <p className="home-cash-period-summary">
              <span>In {formatMoney(cashActivitySummary.cashIn)}</span>
              <span>Out {formatMoney(cashActivitySummary.cashOut)}</span>
              <span>Net {formatMoney(cashActivitySummary.net)}</span>
              <span>{cashActivitySummary.count} items</span>
            </p>
          </div>
          <div className="home-balance-card home-balance-card--bank">
            <div className="home-balance-head">
              <p className="home-hero-label">🏦 Bank Balance</p>
              <div className="home-balance-actions">
                <button
                  type="button"
                  className="home-cash-history-btn"
                  onClick={() => setShowBankHistory(true)}
                >
                  History
                </button>
                <button type="button" className="home-add-btn" onClick={() => openAdd('bank')}>
                  + Add
                </button>
              </div>
            </div>
            <BigAmount label="" value={bankBalance} variant="primary" size="lg" />
            <div className="home-cash-dates">
              {BALANCE_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`home-cash-date-chip ${bankDateFilter === opt.id ? 'home-cash-date-chip--active' : ''}`}
                  onClick={() => {
                    setBankDateFilter(opt.id)
                    setBankSelectedDate('')
                  }}
                >
                  {opt.label}
                </button>
              ))}
              <input
                type="date"
                className={`home-cash-date-input ${bankDateFilter === 'date' ? 'home-cash-date-input--active' : ''}`}
                value={bankSelectedDate}
                onChange={(e) => {
                  setBankSelectedDate(e.target.value)
                  if (e.target.value) setBankDateFilter('date')
                }}
                aria-label="Pick date for bank history"
              />
            </div>
            <div className="home-balance-day">
              <p className="home-balance-last">
                {bankOpeningLabel(bankDateFilter)}{' '}
                <strong>{formatMoney(bankOpeningToday)}</strong>
              </p>
              <p className="home-balance-last home-balance-last--close">
                {bankClosingLabel(bankDateFilter)}{' '}
                <strong>{formatMoney(bankClosingPeriod)}</strong>
              </p>
            </div>
            <p className="home-cash-period-summary">
              <span>In {formatMoney(bankActivitySummary.bankIn)}</span>
              <span>Out {formatMoney(bankActivitySummary.bankOut)}</span>
              <span>Net {formatMoney(bankActivitySummary.net)}</span>
              <span>{bankActivitySummary.count} items</span>
            </p>
          </div>
        </div>

        <div className="home-transfers home-transfers--pair">
          <button
            type="button"
            className="home-transfer-btn"
            onClick={() => openTransfer('cash-to-bank')}
          >
            💵 → 🏦 Cash to Bank
          </button>
          <button
            type="button"
            className="home-transfer-btn"
            onClick={() => openTransfer('bank-to-cash')}
          >
            🏦 → 💵 Bank to Cash
          </button>
        </div>
        </div>
      </section>

      <section className="home-section" aria-label="Today">
        <h2 className="home-section-title">Today</h2>
        <div className="home-today-grid">
          <button
            type="button"
            className="stat-card stat-card--action"
            onClick={() => openReports('today', 'sales')}
          >
            <span className="stat-label">Sales collected</span>
            <span className="stat-value stat-value--green">
              {formatMoney(todaySalesSummary.totalBills)}
            </span>
            <span className="stat-meta stat-meta--breakdown">
              {formatSalesBreakdown(
                todaySalesSummary.cashTotal,
                todaySalesSummary.bankTotal,
                todaySalesSummary.creditPending,
                todaySalesSummary.chequeTotal + todaySalesSummary.chequePending,
              )}
            </span>
            <span className="stat-meta">
              {todaySalesSummary.billCount} bills · With credit{' '}
              {formatMoney(todaySalesSummary.withCreditSales)}
            </span>
          </button>
          <button
            type="button"
            className="stat-card stat-card--action"
            onClick={() => navigate('/expenses')}
          >
            <span className="stat-label">Expenses</span>
            <span className="stat-value stat-value--orange">
              {formatMoney(todayRegularExpensesTotal)}
            </span>
            <span className="stat-meta">{todayRegularExpenses.length} items today</span>
          </button>
          <button
            type="button"
            className="stat-card stat-card--action"
            onClick={() => openReports('today', 'purchase')}
          >
            <span className="stat-label">Purchases</span>
            <span className="stat-value stat-value--orange">
              {formatMoney(todayPurchaseSummary.total)}
            </span>
            <span className="stat-meta stat-meta--breakdown">
              {NO1_BILL_LABEL} {formatMoney(todayPurchaseSummary.gstTotal)} · {NO2_BILL_LABEL}{' '}
              {formatMoney(todayPurchaseSummary.noGstTotal)}
            </span>
            {todayTopShop ? (
              <span className="stat-meta">Top: {todayTopShop.shopName}</span>
            ) : (
              <span className="stat-meta">{todayPurchases.length} items today</span>
            )}
          </button>
          <button
            type="button"
            className="stat-card stat-card--action"
            onClick={() => openReports('today')}
          >
            <span className="stat-label">Net inflow</span>
            <span className="stat-value">{formatMoney(todayDailyTotals.netInflow)}</span>
            <span className="stat-meta stat-meta--breakdown">
              💵 {formatMoney(todayDailyTotals.cashCollected)} · 🏦{' '}
              {formatMoney(todayDailyTotals.bankCollected)} · 🧾{' '}
              {formatMoney(todayDailyTotals.chequeCollected)}
            </span>
            <span className="stat-meta">
              Credit+Cheque {formatMoney(todayDailyTotals.creditChequeAddedCombined)} · Added{' '}
              {formatMoney(todayDailyTotals.moneyAddedTotal)}
            </span>
          </button>
        </div>
      </section>

      <section className="home-purchases" aria-label="Purchase">
        <div className="home-purchases-head">
          <p className="home-purchases-label">Purchase</p>
          <span className="home-purchases-total">{formatMoney(todayPurchaseSummary.total)} today</span>
        </div>
        <div className="home-purchases-row">
          <button
            type="button"
            className="home-purchase-btn home-purchase-btn--open"
            onClick={() => navigate('/purchase')}
          >
            🛒 Open Purchase
          </button>
          <button
            type="button"
            className="home-purchase-btn home-purchase-btn--history"
            onClick={openPurchaseHistory}
          >
            📋 History · time order
          </button>
        </div>
      </section>

      <section className="home-section" aria-label="Collect open bills">
        <h2 className="home-section-title">Collect · open bills</h2>
        <div className="home-collect-grid">
          <button
            type="button"
            className="stat-card stat-card--action stat-card--credit"
            onClick={() => openCredits('credit')}
          >
            <span className="stat-label">Credit open</span>
            <span className="stat-value stat-value--credit">
              {formatMoney(creditOverview.totalPending)}
            </span>
            <span className="stat-meta">
              {creditOverview.customerCount} customers · {creditOverview.openBillCount} bills
              {dueReminders > 0
                ? ` · ${activeCreditAlerts.length} alert${activeCreditAlerts.length === 1 ? '' : 's'}`
                : ''}
            </span>
          </button>
          <button
            type="button"
            className="stat-card stat-card--action stat-card--cheque"
            onClick={() => openCheques('cheque')}
          >
            <span className="stat-label">Cheque open</span>
            <span className="stat-value stat-value--cheque">
              {formatMoney(chequeOverview.totalPending)}
            </span>
            <span className="stat-meta">
              {chequeOverview.customerCount} customers · {chequeOverview.openBillCount} bills
              {activeChequeAlerts.length > 0
                ? ` · ${activeChequeAlerts.length} alert${activeChequeAlerts.length === 1 ? '' : 's'}`
                : ''}
            </span>
          </button>
        </div>
        <div className="home-collect-actions">
          <button type="button" className="home-tool-btn home-tool-btn--credit" onClick={() => openCredits('credit')}>
            💳 Credit Dashboard
          </button>
          <button type="button" className="home-tool-btn home-tool-btn--cheque" onClick={() => openCheques('cheque')}>
            🧾 Cheque Dashboard
          </button>
        </div>
      </section>

      <section className="home-section" aria-label="More tools">
        <h2 className="home-section-title">More</h2>
        <div className="home-tools-grid">
          <button type="button" className="home-tool-btn" onClick={() => openCustomers('all')}>
            👤 Customers
          </button>
          <Link to="/history" className="home-tool-btn home-tool-btn--link">
            🕘 History
          </Link>
          <Link to="/expenses" className="home-tool-btn home-tool-btn--link">
            📤 Expenses
          </Link>
          <Link to="/settings" className="home-tool-btn home-tool-btn--link">
            ⚙️ Settings
          </Link>
          <button
            type="button"
            className="home-tool-btn home-tool-btn--muted"
            onClick={() => {
              closePanel()
              setDeleteRecordSearch('')
              setDeleteRecordFilter('all')
              setShowDeleteRecords(true)
            }}
          >
            🗑 Delete record
          </button>
        </div>
      </section>

      {showCashHistory && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel home-cash-panel">
            <div className="home-add-panel-head">
              <h3>Cash in Drawer · History</h3>
              <button
                type="button"
                className="home-add-close"
                onClick={() => setShowCashHistory(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="home-cash-dates home-cash-dates--panel">
              {BALANCE_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`home-cash-date-chip ${cashDateFilter === opt.id ? 'home-cash-date-chip--active' : ''}`}
                  onClick={() => {
                    setCashDateFilter(opt.id)
                    setCashSelectedDate('')
                  }}
                >
                  {opt.label}
                </button>
              ))}
              <input
                type="date"
                className={`home-cash-date-input ${cashDateFilter === 'date' ? 'home-cash-date-input--active' : ''}`}
                value={cashSelectedDate}
                onChange={(e) => {
                  setCashSelectedDate(e.target.value)
                  if (e.target.value) setCashDateFilter('date')
                }}
                aria-label="Pick date for cash history"
              />
            </div>

            <div className="home-cash-panel-summary">
              <span>
                {cashOpeningLabel(cashDateFilter)} {formatMoney(cashPeriodStart)}
              </span>
              <span>
                {cashClosingLabel(cashDateFilter)} {formatMoney(cashPeriodClose)}
              </span>
              <span>In {formatMoney(cashActivitySummary.cashIn)}</span>
              <span>Out {formatMoney(cashActivitySummary.cashOut)}</span>
              <span>Net {formatMoney(cashActivitySummary.net)}</span>
            </div>

            {cashActivityItems.length === 0 ? (
              <p className="home-delete-empty">No cash activity for this period.</p>
            ) : (
              <ul className="home-cash-list">
                {cashActivityItems.map((item) => (
                  <li key={item.id} className="home-cash-item">
                    <div className="home-cash-item-info">
                      <div className="home-cash-item-top">
                        <span className="home-cash-item-label">{item.label}</span>
                        <span
                          className={`home-cash-item-amount ${item.direction === 'in' ? 'home-cash-item-amount--in' : 'home-cash-item-amount--out'}`}
                        >
                          {item.direction === 'in' ? '+' : '-'}
                          {formatMoney(item.amount)}
                        </span>
                      </div>
                      <span className="home-cash-item-meta">
                        {item.name ? `${item.name} · ` : ''}
                        {formatDate(item.date)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showBankHistory && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel home-cash-panel">
            <div className="home-add-panel-head">
              <h3>Bank Balance · History</h3>
              <button
                type="button"
                className="home-add-close"
                onClick={() => setShowBankHistory(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="home-cash-dates home-cash-dates--panel">
              {BALANCE_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`home-cash-date-chip ${bankDateFilter === opt.id ? 'home-cash-date-chip--active' : ''}`}
                  onClick={() => {
                    setBankDateFilter(opt.id)
                    setBankSelectedDate('')
                  }}
                >
                  {opt.label}
                </button>
              ))}
              <input
                type="date"
                className={`home-cash-date-input ${bankDateFilter === 'date' ? 'home-cash-date-input--active' : ''}`}
                value={bankSelectedDate}
                onChange={(e) => {
                  setBankSelectedDate(e.target.value)
                  if (e.target.value) setBankDateFilter('date')
                }}
                aria-label="Pick date for bank history"
              />
            </div>

            <div className="home-cash-panel-summary">
              <span>
                {bankOpeningLabel(bankDateFilter)} {formatMoney(bankPeriodStart)}
              </span>
              <span>
                {bankClosingLabel(bankDateFilter)} {formatMoney(bankPeriodClose)}
              </span>
              <span>In {formatMoney(bankActivitySummary.bankIn)}</span>
              <span>Out {formatMoney(bankActivitySummary.bankOut)}</span>
              <span>Net {formatMoney(bankActivitySummary.net)}</span>
            </div>

            {bankActivityItems.length === 0 ? (
              <p className="home-delete-empty">No bank activity for this period.</p>
            ) : (
              <ul className="home-cash-list">
                {bankActivityItems.map((item) => (
                  <li key={item.id} className="home-cash-item">
                    <div className="home-cash-item-info">
                      <div className="home-cash-item-top">
                        <span className="home-cash-item-label">{item.label}</span>
                        <span
                          className={`home-cash-item-amount ${item.direction === 'in' ? 'home-cash-item-amount--in' : 'home-cash-item-amount--out'}`}
                        >
                          {item.direction === 'in' ? '+' : '-'}
                          {formatMoney(item.amount)}
                        </span>
                      </div>
                      <span className="home-cash-item-meta">
                        {item.name ? `${item.name} · ` : ''}
                        {formatDate(item.date)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showDeleteRecords && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel home-delete-panel">
            <div className="home-add-panel-head">
              <h3>Delete History</h3>
              <button
                type="button"
                className="home-add-close"
                onClick={() => setShowDeleteRecords(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <input
              type="search"
              className="home-delete-search"
              value={deleteRecordSearch}
              onChange={(e) => setDeleteRecordSearch(e.target.value)}
              placeholder="Search bills, expenses, notes, amount…"
              autoComplete="off"
            />

            <div className="home-delete-filters">
              {(
                [
                  ['all', 'All'],
                  ['sale', 'Bills'],
                  ['expense', 'Expenses'],
                  ['purchase', 'Purchases'],
                  ['deposit', 'Added'],
                  ['transfer', 'Transfer'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`home-delete-chip ${deleteRecordFilter === id ? 'home-delete-chip--active' : ''}`}
                  onClick={() => setDeleteRecordFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {recordsForDelete.length === 0 ? (
              <p className="home-delete-empty">No records found.</p>
            ) : (
              <ul className="home-delete-list">
                {recordsForDelete.map((item) => (
                  <li key={item.id} className="home-delete-item">
                    <div className="home-delete-info">
                      <div className="home-delete-top">
                        <span className="home-delete-type">{getHistoryTypeLabel(item.type)}</span>
                        <span className="home-delete-amount">{formatMoney(item.amount)}</span>
                      </div>
                      <span className="home-delete-meta">
                        {item.name ? `${item.name} · ` : ''}
                        {item.sub} · {formatDate(item.date)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="home-delete-btn"
                      onClick={() => handleDeleteRecord(item.type, item.id, item.groupSaleIds)}
                      aria-label="Delete record"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel">
            <div className="home-add-panel-head">
              <h3>{panelTitle}</h3>
              <button type="button" className="home-add-close" onClick={closePanel} aria-label="Close">
                ✕
              </button>
            </div>

            {transferDirection && (
              <p className="home-panel-available">
                Available: {formatMoney(transferSourceBalance)}
              </p>
            )}

            <label className="home-add-note">
              <span className="home-add-note-label">Note</span>
              <input
                ref={noteInputRef}
                type="text"
                className={`home-add-note-input ${panelField === 'note' ? 'home-add-note-input--active' : ''}`}
                value={panelNote}
                onChange={(e) => setPanelNote(e.target.value)}
                onFocus={() => setPanelField('note')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    setPanelField('amount')
                  }
                }}
                placeholder={
                  transferDirection
                    ? 'Required — e.g. Deposit to bank, Withdraw cash'
                    : 'Required — e.g. Opening cash, Bank deposit'
                }
                autoComplete="off"
              />
            </label>

            <AmountDisplay
              label={panelAmountLabel}
              value={panelAmountStr}
              active={panelField === 'amount'}
              onSelect={() => setPanelField('amount')}
              compact
            />

            {panelError && <p className="home-panel-error">{panelError}</p>}

            <div className="home-add-keyboard">
              <NumberKeyboard onPress={handlePanelNumpad} />
            </div>

            <div className="home-add-actions">
              <button type="button" className="btn btn-secondary" onClick={closePanel}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${transferDirection ? 'btn-primary' : 'btn-success'} ${panelSaved ? 'btn-saved' : ''}`}
                onClick={handlePanelSave}
                disabled={!panelValid || panelSaved}
              >
                {panelSaveLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <ReportsPanel
        open={showReports}
        onClose={() => setShowReports(false)}
        data={data}
        initialPreset={reportPreset}
        initialSection={reportSection}
        focusSection={Boolean(reportSection)}
        onOpenCustomer={openCustomerFromReports}
      />

      <CustomerDashboard
        open={showCustomers}
        onClose={() => {
          setShowCustomers(false)
          setCustomerInitialName(undefined)
        }}
        data={data}
        initialFilter={customerFilter}
        initialCustomer={customerInitialName}
        onSetCustomerReminder={setCustomerReminder}
        onSaveAlertSettings={updateReminderAlertSettings}
      />

      <CreditDashboard
        open={showCredits}
        onClose={() => {
          setShowCredits(false)
          setCreditInitialName(undefined)
        }}
        data={data}
        initialFilter={creditFilter}
        initialCustomer={creditInitialName}
        onSetCustomerReminder={setCustomerReminder}
        onSaveAlertSettings={updateReminderAlertSettings}
      />

      <ChequeDashboard
        open={showCheques}
        onClose={() => {
          setShowCheques(false)
          setChequeInitialName(undefined)
        }}
        data={data}
        initialFilter={chequeFilter}
        initialCustomer={chequeInitialName}
        onSetCustomerReminder={setCustomerReminder}
        onSaveAlertSettings={updateReminderAlertSettings}
      />
    </div>
  )
}
