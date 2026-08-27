import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AppData } from '../types'
import AmountDisplay from '../components/AmountDisplay'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount, formatDate } from '../utils/format'
import { applyNumpadAction, applyPinAction, normalizePin, type NumpadAction } from '../utils/numpad'
import { useCashActions } from '../context/CashContext'
import { useCashSnapshot } from '../hooks/useCashSnapshot'
import { useCashDerivedSnapshot } from '../hooks/useCashDerivedSnapshot'
import { useResetOnTabEnter } from '../hooks/useIsActiveRoute'
import { useOpenTiming } from '../hooks/useOpenTiming'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import type { ExpensePayType, TransferDirection } from '../types'
import {
  getHistoryTypeLabel,
  matchesHistorySearch,
  type HistoryFilter,
  type HistoryItemType,
} from '../utils/historyItems'
import {
  bankClosingLabel,
  bankOpeningLabel,
  summarizeBankActivityForPeriod,
  type BankDateFilter,
} from '../utils/bankActivity'
import {
  cashClosingLabel,
  cashOpeningLabel,
  summarizeCashActivityForPeriod,
  type CashDateFilter,
} from '../utils/cashActivity'
import {
  formatCollectedSalesBreakdown,
  toInputDate,
} from '../utils/salesReport'
import {
  formatReportPresetLabel,
  salesSummaryForPreset,
  type ReportDatePreset,
} from '../utils/reportsHub'
import {
  NO1_BILL_LABEL,
  NO2_BILL_LABEL,
} from '../utils/expenseBillLabels'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
  summarizeNormalExpenses,
} from '../utils/normalExpenseHistory'
import {
  filterPurchaseHistoryItems,
  getTopPurchaseShop,
  summarizePurchases,
} from '../utils/purchaseHistory'
import {
  buildLoanOutflowHistoryItems,
  filterLoanOutflowHistoryItems,
  summarizeLoanOutflows,
} from '../utils/loanLedger'
import {
  summarizePeriodExpenseChannels,
  type ExpensePayChannelFilter,
} from '../utils/expenseTimeline'
import { buildDailyTotalsForPreset } from '../utils/dailyTotals'
import ReportsPanel, { type ReportSection } from '../components/ReportsPanel'
import AnalyzePanel from '../components/AnalyzePanel'
import CustomerDashboard, { type CustomerListFilter } from '../components/CustomerDashboard'
import CreditDashboard, { type CreditListFilter } from '../components/CreditDashboard'
import ChequeDashboard, { type ChequeListFilter } from '../components/ChequeDashboard'
import { buildCreditOverview } from '../utils/customerLedger'
import { buildChequeOverview } from '../utils/chequeLedger'
import {
  buildActiveChequeReminders,
  buildActiveCreditReminders,
  countActiveBillReminders,
} from '../utils/billReminders'
import './Home.css'

const DEFAULT_PIN = '0000'

/** Stable empty dataset — Home skips heavy dashboard work while PIN-locked. */
const LOCKED_DASHBOARD_DATA: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  sales: [],
  expenses: [],
}

type PanelField = 'note' | 'amount'

const BALANCE_DATE_OPTIONS: { id: CashDateFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
]

type HomeDayFilter = 'today' | 'yesterday' | 'date'

const HOME_DAY_OPTIONS: { id: HomeDayFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
]

function homeDayReportPreset(filter: HomeDayFilter): ReportDatePreset {
  return filter === 'date' ? 'date' : filter
}

function homeDaySelectedDate(filter: HomeDayFilter, selectedDate: string): string {
  return filter === 'date' ? selectedDate || toInputDate() : toInputDate()
}

function Home({ active }: { active: boolean }) {
  const navigate = useNavigate()
  const { data, balance, bankBalance, homeUnlocked } = useCashSnapshot(active)
  const derived = useCashDerivedSnapshot(active)
  const {
    recordExpense,
    recordTransfer,
    removeSale,
    removeExpense,
    removeLoan,
    unlockHome,
    setCustomerReminder,
    setBillReminder,
    updateReminderAlertSettings,
    renameCustomerProfile,
    applySaleReturn,
    cancelSaleReturn,
  } = useCashActions()
  // Keep real data while tab is hidden (when unlocked) so summaries stay cached on return.
  const workData = !homeUnlocked ? LOCKED_DASHBOARD_DATA : data
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
  const {
    value: deleteRecordSearch,
    setValue: setDeleteRecordSearch,
    deferredValue: deferredDeleteRecordSearch,
    reset: resetDeleteRecordSearch,
  } = useDeferredSearch()
  const [deleteRecordFilter, setDeleteRecordFilter] = useState<HistoryFilter>('all')
  const [showCashHistory, setShowCashHistory] = useState(false)
  const {
    value: cashHistorySearch,
    setValue: setCashHistorySearch,
    deferredValue: deferredCashHistorySearch,
    reset: resetCashHistorySearch,
  } = useDeferredSearch()
  const [cashDateFilter, setCashDateFilter] = useState<CashDateFilter>('today')
  const [cashSelectedDate, setCashSelectedDate] = useState('')
  const [showBankHistory, setShowBankHistory] = useState(false)
  const {
    value: bankHistorySearch,
    setValue: setBankHistorySearch,
    deferredValue: deferredBankHistorySearch,
    reset: resetBankHistorySearch,
  } = useDeferredSearch()
  const [bankDateFilter, setBankDateFilter] = useState<BankDateFilter>('today')
  const [bankSelectedDate, setBankSelectedDate] = useState('')
  const [showReports, setShowReports] = useState(false)
  const [showAnalyze, setShowAnalyze] = useState(false)
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
  const [reportSelectedDate, setReportSelectedDate] = useState('')
  const [reportSection, setReportSection] = useState<ReportSection | undefined>()
  const [homeDayFilter, setHomeDayFilter] = useState<HomeDayFilter>('today')
  const [homeSelectedDate, setHomeSelectedDate] = useState('')
  const [homeExpenseChannel, setHomeExpenseChannel] = useState<ExpensePayChannelFilter>('all')
  const noteInputRef = useRef<HTMLInputElement>(null)

  useOpenTiming('Home', active, false)
  useOpenTiming('Reports', showReports)
  useOpenTiming('Analyze', showAnalyze)
  useOpenTiming('Customers', showCustomers)
  useOpenTiming('Credit Dashboard', showCredits)
  useOpenTiming('Cheque Dashboard', showCheques)
  useOpenTiming('Cash History', showCashHistory)
  useOpenTiming('Bank History', showBankHistory)
  useOpenTiming('Delete Records', showDeleteRecords)

  const resetHomeUi = useCallback(() => {
    resetDeleteRecordSearch()
    setDeleteRecordFilter('all')
    setShowDeleteRecords(false)
    resetCashHistorySearch()
    setCashDateFilter('today')
    setCashSelectedDate('')
    setShowCashHistory(false)
    resetBankHistorySearch()
    setBankDateFilter('today')
    setBankSelectedDate('')
    setShowBankHistory(false)
    setShowReports(false)
    setShowAnalyze(false)
    setShowCustomers(false)
    setShowCredits(false)
    setShowCheques(false)
    setCustomerInitialName(undefined)
    setCreditInitialName(undefined)
    setChequeInitialName(undefined)
  }, [
    resetDeleteRecordSearch,
    resetCashHistorySearch,
    resetBankHistorySearch,
  ])

  useResetOnTabEnter(active, resetHomeUi)

  function openPurchaseHistory() {
    navigate(
      { pathname: '/history', search: '?purchases=1' },
      { state: { showPurchaseHistory: true } },
    )
  }

  function openReports(
    preset: ReportDatePreset = 'today',
    section?: ReportSection,
    selectedDate?: string,
  ) {
    setReportPreset(preset)
    setReportSection(section)
    setReportSelectedDate(selectedDate ?? '')
    setShowReports(true)
  }

  function openHomeDayReports(section?: ReportSection) {
    const preset = homeDayReportPreset(homeDayFilter)
    const selectedDate = homeDaySelectedDate(homeDayFilter, homeSelectedDate)
    openReports(preset, section, homeDayFilter === 'date' ? selectedDate : undefined)
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

  const homeDayPreset = homeDayReportPreset(homeDayFilter)
  const homeDayDate = homeDaySelectedDate(homeDayFilter, homeSelectedDate)
  const homePeriodLabel = useMemo(
    () => formatReportPresetLabel(homeDayPreset, homeDayDate),
    [homeDayPreset, homeDayDate],
  )

  const salesSummary = useMemo(
    () => salesSummaryForPreset(workData, homeDayPreset, homeDayDate),
    [workData, homeDayPreset, homeDayDate],
  )
  const periodDailyTotals = useMemo(
    () => buildDailyTotalsForPreset(workData, homeDayPreset, homeDayDate),
    [workData, homeDayPreset, homeDayDate],
  )
  const periodExpenseItems = useMemo(() => {
    const items = buildNormalExpenseHistoryItems(workData)
    return filterNormalExpenseHistoryItems(items, homeDayPreset, homeDayDate)
  }, [workData, homeDayPreset, homeDayDate])
  const periodExpenseSummary = useMemo(
    () => summarizeNormalExpenses(periodExpenseItems),
    [periodExpenseItems],
  )
  const periodPurchaseItems = useMemo(() => {
    return filterPurchaseHistoryItems(derived.purchaseHistoryItems, homeDayPreset, homeDayDate)
  }, [derived.purchaseHistoryItems, homeDayPreset, homeDayDate])
  const periodPurchaseSummary = useMemo(
    () => summarizePurchases(periodPurchaseItems),
    [periodPurchaseItems],
  )
  /** Cash/bank paid on purchases only — used under Expenses (credit bills stay on Purchases). */
  const periodPurchasePaidSummary = useMemo(
    () => summarizePurchases(periodPurchaseItems, true),
    [periodPurchaseItems],
  )
  const periodLoanOutflowItems = useMemo(() => {
    const items = buildLoanOutflowHistoryItems(workData)
    return filterLoanOutflowHistoryItems(items, homeDayPreset, homeDayDate)
  }, [workData, homeDayPreset, homeDayDate])
  const periodLoanOutflowSummary = useMemo(
    () => summarizeLoanOutflows(periodLoanOutflowItems),
    [periodLoanOutflowItems],
  )
  const periodExpenseChannels = useMemo(
    () =>
      summarizePeriodExpenseChannels(
        workData,
        periodExpenseItems,
        periodPurchaseItems,
        periodLoanOutflowItems,
        homeDayPreset,
        homeDayDate,
      ),
    [workData, periodExpenseItems, periodPurchaseItems, periodLoanOutflowItems, homeDayPreset, homeDayDate],
  )
  const homeExpenseDisplayAmount =
    homeExpenseChannel === 'cash'
      ? periodExpenseChannels.cashWithTransfers
      : homeExpenseChannel === 'bank'
        ? periodExpenseChannels.bankWithTransfers
        : periodExpenseChannels.total
  const periodTopShop = useMemo(
    () => getTopPurchaseShop(periodPurchaseItems),
    [periodPurchaseItems],
  )
  const creditOverview = useMemo(() => buildCreditOverview(workData), [workData])
  const chequeOverview = useMemo(() => buildChequeOverview(workData), [workData])
  const dueReminders = useMemo(() => countActiveBillReminders(workData), [workData])
  const activeCreditAlerts = useMemo(() => buildActiveCreditReminders(workData), [workData])
  const activeChequeAlerts = useMemo(() => buildActiveChequeReminders(workData), [workData])

  const allCashActivityItems = derived.cashActivityItems
  const cashPeriod = useMemo(
    () =>
      summarizeCashActivityForPeriod(
        allCashActivityItems,
        data,
        balance,
        cashDateFilter,
        cashSelectedDate,
      ),
    [allCashActivityItems, data, balance, cashDateFilter, cashSelectedDate],
  )
  const cashActivityItems = cashPeriod.items
  const cashActivitySummary = cashPeriod.summary

  const filteredCashActivityItems = useMemo(() => {
    const q = deferredCashHistorySearch.trim().toLowerCase()
    if (!q) return cashActivityItems
    return cashActivityItems.filter((item) => {
      if (item.label.toLowerCase().includes(q)) return true
      if (item.name?.toLowerCase().includes(q)) return true
      if (String(item.amount).includes(q)) return true
      return false
    })
  }, [cashActivityItems, deferredCashHistorySearch])

  const allBankActivityItems = derived.bankActivityItems
  const bankPeriod = useMemo(
    () =>
      summarizeBankActivityForPeriod(
        allBankActivityItems,
        data,
        bankBalance,
        bankDateFilter,
        bankSelectedDate,
      ),
    [allBankActivityItems, data, bankBalance, bankDateFilter, bankSelectedDate],
  )
  const bankActivityItems = bankPeriod.items
  const bankActivitySummary = bankPeriod.summary

  const filteredBankActivityItems = useMemo(() => {
    const q = deferredBankHistorySearch.trim().toLowerCase()
    if (!q) return bankActivityItems
    return bankActivityItems.filter((item) => {
      if (item.label.toLowerCase().includes(q)) return true
      if (item.name?.toLowerCase().includes(q)) return true
      if (String(item.amount).includes(q)) return true
      return false
    })
  }, [bankActivityItems, deferredBankHistorySearch])

  const cashOpeningToday = cashPeriod.opening
  const bankOpeningToday = bankPeriod.opening
  const cashClosingPeriod = cashPeriod.closing
  const bankClosingPeriod = bankPeriod.closing

  const cashPeriodStart = cashOpeningToday
  const bankPeriodStart = bankOpeningToday
  const cashPeriodClose = cashClosingPeriod
  const bankPeriodClose = bankClosingPeriod

  const deleteRecordBaseItems = useMemo(() => {
    if (!showDeleteRecords) return []
    return derived.historyItems.filter(
      (item) => deleteRecordFilter === 'all' || item.type === deleteRecordFilter,
    )
  }, [derived.historyItems, showDeleteRecords, deleteRecordFilter])

  const recordsForDelete = useMemo(() => {
    return deleteRecordBaseItems
      .filter((item) => matchesHistorySearch(item, deferredDeleteRecordSearch))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [deleteRecordBaseItems, deferredDeleteRecordSearch])

  function handleDeleteRecord(
    type: HistoryItemType,
    id: string,
    groupSaleIds?: string[],
  ) {
    if (!confirm('Delete this record? Balances will be updated.')) return
    if (type === 'sale') removeSale(id, groupSaleIds)
    else if (type === 'loan' || (data.loans ?? []).some((loan) => loan.id === id)) removeLoan(id)
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

  useRouteNumpadKeyboard(
    '/',
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
                {pinStr.length > i ? '•' : ''}
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
      <section className="home-access" aria-label="Quick access">
        <div className="home-access-grid">
          <button
            type="button"
            className="home-access-btn home-access-btn--reports"
            onClick={() => openReports('today')}
          >
            <span className="home-access-icon" aria-hidden="true">
              📊
            </span>
            <span className="home-access-label">Reports</span>
          </button>
          <Link to="/loan" className="home-access-btn home-access-btn--loan">
            <span className="home-access-icon" aria-hidden="true">
              🤝
            </span>
            <span className="home-access-label">Loan</span>
          </Link>
          <Link to="/staff" className="home-access-btn home-access-btn--staff">
            <span className="home-access-icon" aria-hidden="true">
              👥
            </span>
            <span className="home-access-label">Staff</span>
          </Link>
        </div>
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

      <section className="home-section" aria-label="Day summary">
        <div className="home-section-head">
          <h2 className="home-section-title">{homePeriodLabel}</h2>
          <div
            className="home-cash-dates home-cash-dates--section"
            role="group"
            aria-label="Day filter"
          >
            {HOME_DAY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`home-cash-date-chip ${homeDayFilter === opt.id ? 'home-cash-date-chip--active' : ''}`}
                onClick={() => {
                  setHomeDayFilter(opt.id)
                  setHomeSelectedDate('')
                }}
              >
                {opt.label}
              </button>
            ))}
            <input
              type="date"
              className={`home-cash-date-input ${homeDayFilter === 'date' ? 'home-cash-date-input--active' : ''}`}
              value={homeSelectedDate}
              onChange={(e) => {
                setHomeSelectedDate(e.target.value)
                if (e.target.value) setHomeDayFilter('date')
              }}
              aria-label="Pick day for summary"
            />
          </div>
        </div>
        <div className="home-today-grid">
          <button
            type="button"
            className="stat-card stat-card--action stat-card--sales"
            onClick={() => openHomeDayReports('sales')}
          >
            <span className="stat-label">Sales collected</span>
            <span className="stat-value stat-value--green">
              {formatMoney(salesSummary.totalBills)}
            </span>
            <span className="stat-meta stat-meta--breakdown">
              {formatCollectedSalesBreakdown(
                salesSummary.cashTotal,
                salesSummary.bankTotal,
              )}
            </span>
            <span className="stat-meta">
              {salesSummary.billCount} bills · Sales collected{' '}
              {formatMoney(salesSummary.totalBills)} · Credit{' '}
              {formatMoney(salesSummary.creditPending)} · Cheque{' '}
              {formatMoney(salesSummary.chequePending)} · Total{' '}
              {formatMoney(salesSummary.withCreditSales)}
              {salesSummary.oldCreditChequeCollected > 0
                ? ` · Old pending ${formatMoney(salesSummary.oldCreditChequeCollected)}`
                : ''}
            </span>
          </button>
          <div
            role="button"
            tabIndex={0}
            className="stat-card stat-card--action"
            onClick={() => openHomeDayReports('expense')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openHomeDayReports('expense')
              }
            }}
          >
            <span className="stat-label">Expenses</span>
            <span className="stat-value stat-value--orange">
              {formatMoney(homeExpenseDisplayAmount)}
            </span>
            <div
              className="home-expense-channel-toggle"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="group"
              aria-label="Expense payment channel"
            >
              {(
                [
                  { id: 'all' as const, label: 'All' },
                  { id: 'cash' as const, label: '💵 Cash' },
                  { id: 'bank' as const, label: '🏦 Bank' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`home-expense-channel-chip ${homeExpenseChannel === opt.id ? 'home-expense-channel-chip--active' : ''}`}
                  onClick={() => setHomeExpenseChannel(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="stat-meta stat-meta--breakdown">
              {homeExpenseChannel === 'all'
                ? `💵 Cash ${formatMoney(periodExpenseChannels.cash)} · 🏦 Bank ${formatMoney(periodExpenseChannels.bank)}`
                : homeExpenseChannel === 'cash'
                  ? `Cash out · transfers ${formatMoney(periodExpenseChannels.transferCash)} · All ${formatMoney(periodExpenseChannels.total)}`
                  : `Bank out · transfers ${formatMoney(periodExpenseChannels.transferBank)} · All ${formatMoney(periodExpenseChannels.total)}`}
            </span>
            <span className="stat-meta">
              Normal {formatMoney(periodExpenseSummary.total)} · {periodExpenseItems.length} items
            </span>
            <span className="stat-meta stat-meta--breakdown">
              + Purchase {formatMoney(periodPurchasePaidSummary.total)} ·{' '}
              {periodPurchasePaidSummary.count} paid
            </span>
            <span className="stat-meta stat-meta--breakdown">
              + Loan {formatMoney(periodLoanOutflowSummary.total)} ·{' '}
              {periodLoanOutflowSummary.count} items
            </span>
          </div>
          <button
            type="button"
            className="stat-card stat-card--action"
            onClick={() => openHomeDayReports('purchase')}
          >
            <span className="stat-label">Purchases</span>
            <span className="stat-value stat-value--orange">
              {formatMoney(periodPurchaseSummary.total)}
            </span>
            <span className="stat-meta stat-meta--breakdown">
              {NO1_BILL_LABEL} {formatMoney(periodPurchaseSummary.gstTotal)} · {NO2_BILL_LABEL}{' '}
              {formatMoney(periodPurchaseSummary.noGstTotal)}
            </span>
            {periodTopShop ? (
              <span className="stat-meta">Top: {periodTopShop.shopName}</span>
            ) : (
              <span className="stat-meta">{periodPurchaseItems.length} items</span>
            )}
          </button>
          <button
            type="button"
            className="stat-card stat-card--action"
            onClick={() => openHomeDayReports()}
          >
            <span className="stat-label">Net inflow</span>
            <span className="stat-value">{formatMoney(periodDailyTotals.netInflow)}</span>
            <span className="stat-meta stat-meta--breakdown">
              💵 {formatMoney(periodDailyTotals.cashCollected)} · 🏦{' '}
              {formatMoney(periodDailyTotals.bankCollected)}
            </span>
            <span className="stat-meta">
              Credit+Cheque {formatMoney(periodDailyTotals.creditChequeAddedCombined)} · Added{' '}
              {formatMoney(periodDailyTotals.moneyAddedTotal)}
            </span>
          </button>
        </div>
      </section>

      <section className="home-purchases" aria-label="Purchase">
        <div className="home-purchases-head">
          <p className="home-purchases-label">Purchase</p>
          <span className="home-purchases-total">
            {formatMoney(periodPurchaseSummary.total)} · {homePeriodLabel}
          </span>
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
            📋 Purchase History
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
          <button
            type="button"
            className="home-tool-btn"
            onClick={() => openReports('month', 'expense-report')}
          >
            📤 Expense Report
          </button>
          <button
            type="button"
            className="home-tool-btn"
            onClick={() => {
              closePanel()
              setShowAnalyze(true)
            }}
          >
            📊 Analyze
          </button>
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

            <label className="home-cash-search">
              <span>Search payments</span>
              <input
                type="search"
                className="home-cash-search-input"
                value={cashHistorySearch}
                onChange={(e) => setCashHistorySearch(e.target.value)}
                placeholder="Name, label, amount…"
                aria-label="Search cash history"
              />
            </label>

            {filteredCashActivityItems.length === 0 ? (
              <p className="home-delete-empty">
                {cashActivityItems.length === 0
                  ? 'No cash activity for this period.'
                  : 'No payments match your search.'}
              </p>
            ) : (
              <ul className="home-cash-list">
                {filteredCashActivityItems.map((item) => (
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

            <label className="home-cash-search">
              <span>Search payments</span>
              <input
                type="search"
                className="home-cash-search-input"
                value={bankHistorySearch}
                onChange={(e) => setBankHistorySearch(e.target.value)}
                placeholder="Name, label, amount…"
                aria-label="Search bank history"
              />
            </label>

            {filteredBankActivityItems.length === 0 ? (
              <p className="home-delete-empty">
                {bankActivityItems.length === 0
                  ? 'No bank activity for this period.'
                  : 'No payments match your search.'}
              </p>
            ) : (
              <ul className="home-cash-list">
                {filteredBankActivityItems.map((item) => (
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
                  ['loan', 'Loans'],
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

      {showReports ? (
        <ReportsPanel
          open
          onClose={() => setShowReports(false)}
          data={data}
          initialPreset={reportPreset}
          initialSelectedDate={reportSelectedDate}
          initialSection={reportSection}
          focusSection={Boolean(reportSection)}
          onOpenCustomer={openCustomerFromReports}
        />
      ) : null}

      {showAnalyze ? (
        <AnalyzePanel open onClose={() => setShowAnalyze(false)} data={data} />
      ) : null}

      {showCustomers ? (
        <CustomerDashboard
          open
          onClose={() => {
            setShowCustomers(false)
            setCustomerInitialName(undefined)
          }}
          data={data}
          initialFilter={customerFilter}
          initialCustomer={customerInitialName}
          onSetCustomerReminder={setCustomerReminder}
          onRenameCustomer={renameCustomerProfile}
          onSaveAlertSettings={updateReminderAlertSettings}
        />
      ) : null}

      {showCredits ? (
        <CreditDashboard
          open
          onClose={() => {
            setShowCredits(false)
            setCreditInitialName(undefined)
          }}
          data={data}
          initialFilter={creditFilter}
          initialCustomer={creditInitialName}
          onSetCustomerReminder={setCustomerReminder}
          onSetBillReminder={setBillReminder}
          onSaveAlertSettings={updateReminderAlertSettings}
          onApplySaleReturn={applySaleReturn}
          onCancelSaleReturn={cancelSaleReturn}
        />
      ) : null}

      {showCheques ? (
        <ChequeDashboard
          open
          onClose={() => {
            setShowCheques(false)
            setChequeInitialName(undefined)
          }}
          data={data}
          initialFilter={chequeFilter}
          initialCustomer={chequeInitialName}
          onSetCustomerReminder={setCustomerReminder}
          onSetBillReminder={setBillReminder}
          onSaveAlertSettings={updateReminderAlertSettings}
        />
      ) : null}
    </div>
  )
}

export default memo(Home)
