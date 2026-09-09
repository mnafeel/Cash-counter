import { memo, startTransition, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AmountDisplay from '../components/AmountDisplay'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount, formatDate } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { useCashActions } from '../context/CashContext'
import { useCashSnapshot } from '../hooks/useCashSnapshot'
import { useCashDerivedSnapshot } from '../hooks/useCashDerivedSnapshot'
import {
  consumePendingReminderNavigation,
  hasReminderNavigationIntent,
  reminderPathToIntent,
  type ReminderOverlayKind,
} from '../utils/reminderNavigation'
import { useOpenTiming } from '../hooks/useOpenTiming'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import type { ExpensePayType, TransferDirection } from '../types'
import {
  getHistoryTypeLabel,
  matchesHistorySearch,
  resolveLoanIdFromHistoryItemId,
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
  filterNormalExpenseHistoryItems,
  summarizeNormalExpenses,
} from '../utils/normalExpenseHistory'
import {
  filterPurchaseHistoryItems,
  getTopPurchaseShop,
  summarizePurchases,
} from '../utils/purchaseHistory'
import {
  filterLoanOutflowHistoryItems,
  summarizeLoanOutflows,
} from '../utils/loanLedger'
import {
  summarizePeriodExpenseChannels,
  type ExpensePayChannelFilter,
} from '../utils/expenseTimeline'
import { buildDailyTotalsForPreset } from '../utils/dailyTotals'
import type { ReportSection } from '../components/ReportsPanel'
import AnalyzePanel from '../components/AnalyzePanel'
import CustomerDashboard, { type CustomerListFilter } from '../components/CustomerDashboard'
import CreditDashboard, { type CreditListFilter } from '../components/CreditDashboard'
import ChequeDashboard, { type ChequeListFilter } from '../components/ChequeDashboard'
import BalanceFlowChart from '../components/BalanceFlowChart'
import { buildBalanceFlowSeries } from '../utils/balanceFlowSeries'
import { buildCreditOverview } from '../utils/customerLedger'
import { buildChequeOverview } from '../utils/chequeLedger'
import {
  buildActiveChequeReminders,
  buildActiveCreditReminders,
  countActiveBillReminders,
} from '../utils/billReminders'
import './Home.css'

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
  const { data, balance, bankBalance } = useCashSnapshot(active)
  const { homeUnlocked } = useCashSnapshot(true)
  const derived = useCashDerivedSnapshot(active)
  const {
    recordExpense,
    recordTransfer,
    removeSale,
    removeExpense,
    removeLoan,
    setCustomerReminder,
    setBillReminder,
    updateReminderAlertSettings,
    renameCustomerProfile,
    applySaleReturn,
    cancelSaleReturn,
  } = useCashActions()
  const workData = data
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
  const [pendingDeleteRecord, setPendingDeleteRecord] = useState<{
    type: HistoryItemType
    id: string
    groupSaleIds?: string[]
    amount: number
    name?: string
    sub: string
    date: string
  } | null>(null)
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
  const [homeDayFilter, setHomeDayFilter] = useState<HomeDayFilter>('today')
  const [homeSelectedDate, setHomeSelectedDate] = useState('')
  const [homeExpenseChannel, setHomeExpenseChannel] = useState<ExpensePayChannelFilter>('all')
  const [openBillsOpen, setOpenBillsOpen] = useState(false)
  const noteInputRef = useRef<HTMLInputElement>(null)
  const wasActiveRef = useRef(active)

  useOpenTiming('Dashboard', active, false)
  const [searchParams, setSearchParams] = useSearchParams()

  const applyReminderOverlay = useCallback((overlay: ReminderOverlayKind, customer?: string) => {
    if (overlay === 'credits') {
      setCreditFilter('credit')
      setCreditInitialName(customer)
      startTransition(() => setShowCredits(true))
      return
    }
    if (overlay === 'cheques') {
      setChequeFilter('cheque')
      setChequeInitialName(customer)
      startTransition(() => setShowCheques(true))
      return
    }
    setCustomerFilter(customer ? 'credit' : 'all')
    setCustomerInitialName(customer)
    startTransition(() => setShowCustomers(true))
  }, [])

  const applyReminderNavigation = useCallback(() => {
    const overlay = searchParams.get('overlay')
    const customer = searchParams.get('customer') || undefined
    if (overlay === 'credits' || overlay === 'cheques' || overlay === 'customers') {
      applyReminderOverlay(overlay, customer)
      const next = new URLSearchParams(searchParams)
      next.delete('overlay')
      next.delete('customer')
      setSearchParams(next, { replace: true })
      consumePendingReminderNavigation()
      return true
    }

    const pending = consumePendingReminderNavigation()
    if (!pending) return false

    const intent = reminderPathToIntent(pending)
    if (intent) {
      applyReminderOverlay(intent.overlay, intent.customer)
      return true
    }

    const pathname = pending.split('?')[0] || '/'
    if (pathname !== '/' && pathname !== '') {
      navigate(pending)
      return true
    }
    return false
  }, [applyReminderOverlay, navigate, searchParams, setSearchParams])

  useEffect(() => {
    if (!active || !homeUnlocked) return
    applyReminderNavigation()
  }, [active, homeUnlocked, applyReminderNavigation])

  const resetHomeUi = useCallback(() => {
    resetDeleteRecordSearch()
    setDeleteRecordFilter('all')
    setPendingDeleteRecord(null)
    setShowDeleteRecords(false)
    resetCashHistorySearch()
    setCashDateFilter('today')
    setCashSelectedDate('')
    setShowCashHistory(false)
    resetBankHistorySearch()
    setBankDateFilter('today')
    setBankSelectedDate('')
    setShowBankHistory(false)
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

  useEffect(() => {
    const entering = !wasActiveRef.current && active
    wasActiveRef.current = active
    if (!entering) return

    const run = () => {
      if (hasReminderNavigationIntent(searchParams)) return
      resetHomeUi()
    }

    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 500 })
      return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 0)
    return () => window.clearTimeout(id)
  }, [active, resetHomeUi, searchParams])

  function openReports(
    preset: ReportDatePreset = 'today',
    section?: ReportSection,
    selectedDate?: string,
  ) {
    const params = new URLSearchParams()
    params.set('preset', preset)
    if (section) {
      params.set('section', section)
      params.set('focus', '1')
    }
    if (selectedDate) params.set('date', selectedDate)
    navigate(`/reports?${params.toString()}`)
  }

  function openHomeDayReports(section?: ReportSection) {
    const preset = homeDayReportPreset(homeDayFilter)
    const selectedDate = homeDaySelectedDate(homeDayFilter, homeSelectedDate)
    openReports(preset, section, homeDayFilter === 'date' ? selectedDate : undefined)
  }

  function openCustomers(filter: CustomerListFilter = 'all', customerName?: string) {
    setCustomerFilter(filter)
    setCustomerInitialName(customerName)
    startTransition(() => setShowCustomers(true))
  }

  function openCredits(filter: CreditListFilter = 'credit', customerName?: string) {
    setCreditFilter(filter)
    setCreditInitialName(customerName)
    startTransition(() => setShowCredits(true))
  }

  function openCheques(filter: ChequeListFilter = 'cheque', customerName?: string) {
    setChequeFilter(filter)
    setChequeInitialName(customerName)
    startTransition(() => setShowCheques(true))
  }

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
    return filterNormalExpenseHistoryItems(
      derived.normalExpenseHistoryItems,
      homeDayPreset,
      homeDayDate,
    )
  }, [derived.normalExpenseHistoryItems, homeDayPreset, homeDayDate])
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
    return filterLoanOutflowHistoryItems(
      derived.loanOutflowHistoryItems,
      homeDayPreset,
      homeDayDate,
    )
  }, [derived.loanOutflowHistoryItems, homeDayPreset, homeDayDate])
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
  const cashOpeningToday = cashPeriod.opening
  const bankOpeningToday = bankPeriod.opening
  const cashClosingPeriod = cashPeriod.closing
  const bankClosingPeriod = bankPeriod.closing

  const accountTodayCash = useMemo(
    () =>
      summarizeCashActivityForPeriod(allCashActivityItems, data, balance, 'today', ''),
    [allCashActivityItems, data, balance],
  )
  const accountTodayBank = useMemo(
    () =>
      summarizeBankActivityForPeriod(allBankActivityItems, data, bankBalance, 'today', ''),
    [allBankActivityItems, data, bankBalance],
  )
  const cashFlowSeries = useMemo(
    () =>
      buildBalanceFlowSeries(
        cashOpeningToday,
        cashActivityItems.map((item) => ({
          date: item.date,
          amount: item.amount,
          direction: item.direction,
        })),
      ),
    [cashOpeningToday, cashActivityItems],
  )
  const bankFlowSeries = useMemo(
    () =>
      buildBalanceFlowSeries(
        bankOpeningToday,
        bankActivityItems.map((item) => ({
          date: item.date,
          amount: item.amount,
          direction: item.direction,
        })),
      ),
    [bankOpeningToday, bankActivityItems],
  )
  const accountFlowSeries = useMemo(() => {
    const opening = accountTodayCash.opening + accountTodayBank.opening
    const items = [...accountTodayCash.items, ...accountTodayBank.items].map((item) => ({
      date: item.date,
      amount: item.amount,
      direction: item.direction,
    }))
    return buildBalanceFlowSeries(opening, items)
  }, [accountTodayCash.items, accountTodayCash.opening, accountTodayBank.items, accountTodayBank.opening])
  const salesFlowSeries = useMemo(() => {
    const total = salesSummary.totalBills
    const steps = 28
    return Array.from({ length: steps }, (_, index) => (total * (index + 1)) / steps)
  }, [salesSummary.totalBills])
  const accountTotalBalance = balance + bankBalance

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

  function requestDeleteRecord(item: {
    type: HistoryItemType
    id: string
    groupSaleIds?: string[]
    amount: number
    name?: string
    sub: string
    date: string
  }) {
    setPendingDeleteRecord(item)
  }

  function cancelDeleteRecord() {
    setPendingDeleteRecord(null)
  }

  function confirmDeleteRecord() {
    if (!pendingDeleteRecord) return
    handleDeleteRecord(
      pendingDeleteRecord.type,
      pendingDeleteRecord.id,
      pendingDeleteRecord.groupSaleIds,
    )
    setPendingDeleteRecord(null)
  }

  function handleDeleteRecord(
    type: HistoryItemType,
    id: string,
    groupSaleIds?: string[],
  ) {
    if (type === 'sale') {
      removeSale(id, groupSaleIds)
      return
    }
    const loanId = resolveLoanIdFromHistoryItemId(id, data.loans ?? [])
    if (type === 'loan' || loanId) {
      removeLoan(loanId ?? id)
      return
    }
    removeExpense(id)
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

  const panelHandlerRef = useRef(handlePanelNumpad)
  panelHandlerRef.current = handlePanelNumpad
  const panelOpen = addTarget !== null || transferDirection !== null

  useRouteNumpadKeyboard(
    '/',
    (action) => {
      if (panelOpen && !panelSaved) panelHandlerRef.current(action)
    },
    panelOpen && !panelSaved,
  )

  const panelTitle = transferDirection
    ? transferDirection === 'cash-to-bank'
      ? 'Cash → Bank Transfer'
      : 'Bank → Cash Transfer'
    : addTarget === 'bank'
      ? 'Add to Bank (not sale)'
      : 'Add to Counter (not sale)'

  const panelAmountLabel = transferDirection ? 'Transfer Amount' : 'Amount to Add'

  const panelSaveLabel = panelSaved
    ? '✓ Saved'
    : transferDirection
      ? 'Transfer'
      : addTarget === 'bank'
        ? 'Add to Bank'
        : 'Add to Counter'

  return (
    <div className="home home--dashboard">
      <section className="home-hero-banner" aria-label="Shalimar Fashions dashboard">
        <div className="home-hero-brand">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            className="home-hero-logo"
            aria-hidden="true"
          />
          <div className="home-hero-copy">
            <h1 className="home-hero-title">Shalimar Fashions</h1>
            <p className="home-hero-sub">Business dashboard · {homePeriodLabel}</p>
          </div>
        </div>
        <button type="button" className="home-hero-reports" onClick={() => openReports('today')}>
          <span aria-hidden="true">📊</span>
          Open reports
        </button>
      </section>

      <section className="home-section home-section--balances" aria-label="Balances">
        <div className="home-balance-hub">
          <div className="home-balance-hub__hero home-balance-hub__hero--account">
            <div className="home-balance-hub__chart" aria-hidden="true">
              <BalanceFlowChart series={accountFlowSeries} tone="account" blend />
            </div>
            <div className="home-balance-hub__hero-body">
              <span className="home-balance-label">Account balance</span>
              <BigAmount label="" value={accountTotalBalance} variant="primary" size="lg" />
              <p className="home-balance-hub__split-meta">
                <span className="home-balance-hub__pill home-balance-hub__pill--cash">
                  Cash {formatMoney(balance)}
                </span>
                <span className="home-balance-hub__pill home-balance-hub__pill--bank">
                  Bank {formatMoney(bankBalance)}
                </span>
              </p>
              <p className="home-balance-hub__net-today">
                Today net{' '}
                {formatMoney(accountTodayCash.summary.net + accountTodayBank.summary.net)}
              </p>
            </div>
          </div>

          <div className="home-balance-hub__lanes">
            <div className="home-balance-hub__lane home-balance-hub__lane--cash">
              <div className="home-balance-hub__chart" aria-hidden="true">
                <BalanceFlowChart series={cashFlowSeries} tone="cash" blend />
              </div>
              <div className="home-balance-hub__lane-body">
                <div className="home-balance-head">
                  <span className="home-balance-label">Cash in drawer</span>
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
                      className={`app-date-chip ${cashDateFilter === opt.id ? 'app-date-chip--active' : ''}`}
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
                <div className="home-balance-day home-balance-day--compact">
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
                </p>
              </div>
            </div>

            <div className="home-balance-hub__lane home-balance-hub__lane--bank">
              <div className="home-balance-hub__chart" aria-hidden="true">
                <BalanceFlowChart series={bankFlowSeries} tone="bank" blend />
              </div>
              <div className="home-balance-hub__lane-body">
                <div className="home-balance-head">
                  <span className="home-balance-label">Bank balance</span>
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
                      className={`app-date-chip ${bankDateFilter === opt.id ? 'app-date-chip--active' : ''}`}
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
                <div className="home-balance-day home-balance-day--compact">
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
                </p>
              </div>
            </div>
          </div>

          <div className="home-balance-hub__transfers home-transfers home-transfers--pair">
            <button
              type="button"
              className="home-transfer-btn home-transfer-btn--3d home-transfer-btn--to-bank"
              onClick={() => openTransfer('cash-to-bank')}
            >
              <span className="home-transfer-btn__icon" aria-hidden="true">💵</span>
              <span className="home-transfer-btn__label">Cash to Bank</span>
              <span className="home-transfer-btn__arrow" aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="home-transfer-btn home-transfer-btn--3d home-transfer-btn--to-cash"
              onClick={() => openTransfer('bank-to-cash')}
            >
              <span className="home-transfer-btn__icon" aria-hidden="true">🏦</span>
              <span className="home-transfer-btn__label">Bank to Cash</span>
              <span className="home-transfer-btn__arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>

      <section className="home-section home-section--metrics" aria-label="Day summary">
        <div className="home-metrics-hub">
          <div className="home-metrics-hub__head">
            <h2 className="home-section-title">Today&apos;s overview · {homePeriodLabel}</h2>
            <div
              className="home-cash-dates home-cash-dates--section"
              role="group"
              aria-label="Day filter"
            >
              {HOME_DAY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`app-date-chip ${homeDayFilter === opt.id ? 'app-date-chip--active' : ''}`}
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
          <div className="home-metrics-hub__grid">
          <button
            type="button"
            className="stat-card stat-card--action stat-card--sales stat-card--visual stat-card--metric"
            onClick={() => openHomeDayReports('sales')}
          >
            <div className="stat-card-bg" aria-hidden="true">
              <BalanceFlowChart series={salesFlowSeries} tone="sales" blend />
            </div>
            <div className="stat-card-body">
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
            <span className="stat-meta stat-meta--compact">
              {salesSummary.billCount} bills
            </span>
            </div>
          </button>
          <div
            role="button"
            tabIndex={0}
            className="stat-card stat-card--action stat-card--expense stat-card--metric"
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
              + Loan given {formatMoney(periodLoanOutflowSummary.givenOriginalTotal)}
              {periodLoanOutflowSummary.borrowRepaidTotal > 0
                ? ` · Settlement ${formatMoney(periodLoanOutflowSummary.borrowRepaidTotal)}`
                : ''}{' '}
              · {periodLoanOutflowSummary.givenCount + periodLoanOutflowSummary.borrowRepaidCount} items
            </span>
          </div>
          <button
            type="button"
            className="stat-card stat-card--action stat-card--purchase stat-card--metric"
            onClick={() => navigate('/purchase')}
          >
            <span className="stat-label">Purchases</span>
            <span className="stat-value stat-value--purchase">
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
            <span className="stat-meta stat-meta--link">Tap to open purchase · History in Reports</span>
          </button>
          <button
            type="button"
            className="stat-card stat-card--action stat-card--net stat-card--metric"
            onClick={() => openHomeDayReports()}
          >
            <span className="stat-label">Net inflow</span>
            <span className="stat-value">{formatMoney(periodDailyTotals.netInflow)}</span>
            <span className="stat-meta stat-meta--breakdown">
              Sales {formatMoney(periodDailyTotals.salesCollected)} · Cash in{' '}
              {formatMoney(periodDailyTotals.notSaleCollectedTotal)}
            </span>
            <span className="stat-meta">
              Total collected {formatMoney(periodDailyTotals.totalCollected)} · Credit+Cheque{' '}
              {formatMoney(periodDailyTotals.creditChequeAddedCombined)}
            </span>
          </button>
          </div>
        </div>
      </section>

      <section className="home-section home-section--collect" aria-label="Collect open bills">
        <button
          type="button"
          className="home-collect-toggle"
          onClick={() => setOpenBillsOpen((open) => !open)}
          aria-expanded={openBillsOpen}
        >
          <span className="home-collect-toggle__title">Open credit &amp; cheques</span>
          <span className="home-collect-toggle__summary">
            Credit {formatMoney(creditOverview.totalPending)} · Cheque{' '}
            {formatMoney(chequeOverview.totalPending)}
          </span>
          <span className="home-collect-toggle__chevron" aria-hidden="true">
            {openBillsOpen ? '▾' : '▸'}
          </span>
        </button>
        {openBillsOpen && (
        <div className="home-collect-panel">
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
        <p className="home-collect-hint">Tap a card to open the credit or cheque dashboard and collect.</p>
        </div>
        )}
      </section>

      <section className="home-section" aria-label="More tools">
        <h2 className="home-section-title">Tools</h2>
        <div className="home-tools-grid">
          <button
            type="button"
            className="home-tool-btn"
            onClick={() => navigate('/history?purchases=1')}
          >
            🛒 Purchase history
          </button>
          <button type="button" className="home-tool-btn" onClick={() => openCustomers('all')}>
            👤 Customers
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
          <button
            type="button"
            className="home-tool-btn home-tool-btn--muted"
            onClick={() => {
              closePanel()
              setDeleteRecordSearch('')
              setDeleteRecordFilter('all')
              setPendingDeleteRecord(null)
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
                  className={`app-date-chip ${cashDateFilter === opt.id ? 'app-date-chip--active' : ''}`}
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
                  className={`app-date-chip ${bankDateFilter === opt.id ? 'app-date-chip--active' : ''}`}
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
                onClick={() => {
                  setPendingDeleteRecord(null)
                  setShowDeleteRecords(false)
                }}
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

            {pendingDeleteRecord ? (
              <div className="home-delete-confirm" role="alertdialog" aria-labelledby="home-delete-confirm-title">
                <p id="home-delete-confirm-title" className="home-delete-confirm-title">
                  Confirm delete
                </p>
                <div className="home-delete-confirm-row">
                  <span>Type</span>
                  <strong>{getHistoryTypeLabel(pendingDeleteRecord.type)}</strong>
                </div>
                <div className="home-delete-confirm-row home-delete-confirm-row--amount">
                  <span>Amount</span>
                  <strong>{formatMoney(pendingDeleteRecord.amount)}</strong>
                </div>
                <p className="home-delete-confirm-meta">
                  {pendingDeleteRecord.name ? `${pendingDeleteRecord.name} · ` : ''}
                  {pendingDeleteRecord.sub} · {formatDate(pendingDeleteRecord.date)}
                </p>
                <p className="home-delete-confirm-note">Balances will be updated after delete.</p>
                <div className="home-delete-confirm-actions">
                  <button type="button" className="btn btn-secondary" onClick={cancelDeleteRecord}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary home-delete-confirm-btn"
                    onClick={confirmDeleteRecord}
                  >
                    Confirm delete
                  </button>
                </div>
              </div>
            ) : null}

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
                      className={`home-delete-btn${pendingDeleteRecord?.id === item.id ? ' home-delete-btn--active' : ''}`}
                      onClick={() =>
                        requestDeleteRecord({
                          type: item.type,
                          id: item.id,
                          groupSaleIds: item.groupSaleIds,
                          amount: item.amount,
                          name: item.name,
                          sub: item.sub,
                          date: item.date,
                        })
                      }
                      aria-label={`Delete ${getHistoryTypeLabel(item.type)} ${formatMoney(item.amount)}`}
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

      {showAnalyze ? (
        <AnalyzePanel
          open
          onClose={() => {
            setShowAnalyze(false)
            navigate('/')
          }}
          data={data}
        />
      ) : null}

      {showCustomers ? (
        <CustomerDashboard
          open
          onClose={() => {
            setShowCustomers(false)
            setCustomerInitialName(undefined)
            navigate('/')
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
