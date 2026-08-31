import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { useCash } from '../context/CashContext'
import { useOpenTiming } from '../hooks/useOpenTiming'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import { isFirebaseConfigured } from '../firebase/config'
import { getLastCloudUsername } from '../firebase/cloudUser'
import {
  createCloudAccount,
  clearLocalLastBackupTime,
  cloudBackupTotals,
  fetchRemoteAppData,
  getCloudUsername,
  isAutoBackupEnabled,
  isAutoPullFromCloudEnabled,
  isMainBillingDevice,
  loginCloud,
  logoutCloud,
  remoteIsAheadOfLocal,
  setAutoBackupEnabled,
  setAutoPullFromCloudEnabled,
  setMainBillingDevice,
  subscribeToAuth,
} from '../firebase/backup'
import {
  backupNow,
  refreshCloudRemoteSummary,
  restoreFullCloudData,
  setBackupStatusListener,
  setCloudLoginRestoreActive,
  setCloudRemoteSummaryListener,
  waitForCloudRestoreIdle,
  type CloudRemoteSummary,
} from '../firebase/sync'
import type { AppData } from '../types'
import { getApprovedChequeAmount, getCurrentBalance, getBankBalance, isLocalDataEmpty, listApprovedChequeEntries, listCreditCollectionEntries, listPaidCreditSales, listPendingChequeSales, listPendingCreditSales, loadData, saleBillCreatePayType, type BillCreatePayType } from '../storage/database'
import { clearAllLocalBackupSnapshots } from '../storage/localBackup'
import {
  dateInputValueToIso,
  dateTimeInputValuesToIso,
  formatMoney,
  formatDate,
  isoToDateInputValue,
  isoToTimeInputValue,
  parseAmount,
} from '../utils/format'
import { buildHistoryItems, getHistoryPaymentLabel, historyItemSortTime, matchesHistorySearch, type HistoryItem } from '../utils/historyItems'
import { getSaleCustomerName } from '../utils/saleCustomerName'
import { saleCollectedAmount } from '../utils/salePayment'
import { counterBillPath, resolveHistoryItemBillId } from '../utils/counterBillRoute'
import { readBillEditMode, writeBillEditMode } from '../utils/billEditMode'
import { downloadFullHistoryReport, printFullHistoryReportPdf } from '../utils/historyReport'
import {
  downloadCombinedDailyReportSpreadsheet,
  downloadDailyReportSpreadsheet,
  downloadDailySummaryReportSpreadsheet,
  getDailyReportCounts,
  printCombinedDailyReportPdf,
  printDailyReportPdf,
  printDailySummaryReportPdf,
  type DailyReportKind,
} from '../utils/dailyReport'
import { toInputDate } from '../utils/salesReport'
import {
  downloadExpenseAndNo1PurchaseSpreadsheet,
  filterNo1PurchaseItems,
} from '../utils/expenseRangeExport'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
} from '../utils/normalExpenseHistory'
import { buildPurchaseHistoryItems, filterPurchaseHistoryItems } from '../utils/purchaseHistory'
import {
  downloadDataBackup,
  formatBackupSummary,
  readBackupFile,
} from '../utils/dataBackup'
import {
  listLocalBackupSnapshots,
  loadLocalBackupSnapshot,
  type LocalBackupSnapshotMeta,
} from '../storage/localBackup'
import {
  chooseFolderDailyBackupDir,
  clearFolderDailyBackupDir,
  formatFolderBackupTimeLabel,
  getFolderDailyBackupSettings,
  isFolderBackupSupported,
  runFolderDailyBackupNow,
  setFolderDailyBackupEnabled,
  setFolderDailyBackupTime,
  type FolderDailyBackupSettings,
} from '../storage/folderBackup'
import { testTallyConnection, type TallyDateScope } from '../tally/localSource'
import {
  getPineLabsBaseUrl,
  getPineLabsSettings,
  setPineLabsSettings,
  type PineLabsEnvironment,
  type PineLabsSettings,
} from '../pinelabs/config'
import { pineLabsEnvironmentLabel, testPineLabsConnection } from '../pinelabs/pinelabsApi'
import BillReminderControl from '../components/BillReminderControl'
import { applyNumpadAction, applyPinAction, type NumpadAction } from '../utils/numpad'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import { useAppPageBack } from '../hooks/useAppPageBack'
import './Settings.css'

const WebsiteApiSettings = lazy(() => import('../components/WebsiteApiSettings'))

type SettingsField = 'openingCash' | 'openingBank' | 'pin' | 'pinConfirm'
type SettingsTab = 'general' | 'tally' | 'pinelabs' | 'cloud' | 'website'

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'tally', label: 'Tally' },
  { id: 'pinelabs', label: 'Pine Labs' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'website', label: 'Website API' },
]

type BillEditFilter = 'all' | 'pending' | 'paid'

const BILL_EDIT_FILTER_OPTIONS: { id: BillEditFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'paid', label: 'Paid' },
]

function billIsPending(item: HistoryItem, sales: AppData['sales']): boolean {
  if (item.receiptLines?.some((line) => line.status === 'pending')) return true
  const sale = sales.find((s) => s.id === item.id)
  return sale?.status === 'pending'
}

const BILL_CREATE_TYPE_OPTIONS: { value: BillCreatePayType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'credit', label: 'Credit' },
  { value: 'cheque', label: 'Cheque' },
]

function billIsPendingCredit(sales: AppData['sales'], id: string): boolean {
  const sale = sales.find((s) => s.id === id)
  return (
    sale?.status === 'pending' &&
    (sale.pendingPayType === 'credit' || sale.payType === 'credit')
  )
}

function billIsPendingBalance(sales: AppData['sales'], id: string): boolean {
  const sale = sales.find((s) => s.id === id)
  if (!sale || sale.status !== 'pending') return false
  return (
    sale.payType === 'credit' ||
    sale.payType === 'cheque' ||
    sale.pendingPayType === 'credit' ||
    sale.pendingPayType === 'cheque'
  )
}

const TALLY_SCOPE_OPTIONS: { id: TallyDateScope; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const PINELABS_ENV_OPTIONS: { id: PineLabsEnvironment; label: string }[] = [
  { id: 'uat', label: 'UAT' },
  { id: 'production', label: 'Production' },
]

const PINELABS_PAYMENT_MODE_OPTIONS: { id: string; label: string }[] = [
  { id: '0', label: 'All terminal modes' },
  { id: '1', label: 'Card' },
  { id: '10', label: 'UPI sale' },
  { id: '8', label: 'PhonePe' },
]

const DAILY_REPORT_DOWNLOAD_GROUPS: {
  kind: DailyReportKind
  label: string
  countKey: keyof ReturnType<typeof getDailyReportCounts>
}[] = [
  { kind: 'cash', label: 'Cash', countKey: 'cash' },
  { kind: 'bank', label: 'Bank', countKey: 'bank' },
  { kind: 'expense', label: 'Expense', countKey: 'expense' },
]

export default function Settings() {
  useOpenTiming('Settings', true, false)
  const goBack = useAppPageBack('/', { route: '/settings' })
  const {
    data,
    balance,
    bankBalance,
    updateOpeningBalance,
    updateOpeningBankBalance,
    updateHomePin,
    replaceAllData,
    hydrateData,
    resetAllData,
    addManualTallyPendingBill,
    getTallyApiUrl,
    getTallyDateScope,
    saveTallyApiUrl,
    saveTallyDateScope,
    syncTallyBills,
    cancelApprovedCheque,
    updateApprovedChequeDate,
    cancelCreditCollection,
    updateCreditCollectionDate,
    cancelSaleCredit,
    cancelSaleCheque,
    cancelSaleChequeAsUnpaid,
    cancelSaleCreditAsUnpaid,
    setBillReminder,
    updateReminderAlertSettings,
    updateSaleBill,
    restoreTrashRecord,
    purgeTrashRecord,
    emptyTrash,
  } = useCash()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [openingStr, setOpeningStr] = useState(String(data.openingBalance))
  const [openingBankStr, setOpeningBankStr] = useState(String(data.openingBankBalance ?? 0))
  const [pinStr, setPinStr] = useState('')
  const [pinConfirmStr, setPinConfirmStr] = useState('')
  const [activeField, setActiveField] = useState<SettingsField>('openingCash')
  const [saved, setSaved] = useState(false)
  const [pinError, setPinError] = useState('')

  const [cloudUsername, setCloudUsername] = useState(() => getLastCloudUsername() ?? '')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudUser, setCloudUser] = useState<User | null>(null)
  const [autoBackup, setAutoBackup] = useState(isAutoBackupEnabled())
  const [autoPull, setAutoPull] = useState(isAutoPullFromCloudEnabled())
  const [mainBillingDevice, setMainBillingDeviceState] = useState(isMainBillingDevice())
  const [backupStatus, setBackupStatus] = useState('')
  const [backupError, setBackupError] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [cloudRemoteSummary, setCloudRemoteSummary] = useState<CloudRemoteSummary | null>(null)

  const [tallyUrl, setTallyUrl] = useState(() => getTallyApiUrl() || 'http://localhost:9999')
  const [tallyScope, setTallyScope] = useState<TallyDateScope>(() => getTallyDateScope())
  const [tallyStatus, setTallyStatus] = useState('')
  const [tallyError, setTallyError] = useState(false)
  const [tallyBusy, setTallyBusy] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [pineLabs, setPineLabs] = useState<PineLabsSettings>(() => getPineLabsSettings())
  const [pineLabsStatus, setPineLabsStatus] = useState('')
  const [pineLabsError, setPineLabsError] = useState(false)
  const [pineLabsBusy, setPineLabsBusy] = useState(false)
  const [chequeCancelStatus, setChequeCancelStatus] = useState('')
  const [chequeDateDrafts, setChequeDateDrafts] = useState<Record<string, string>>({})
  const [creditDateDrafts, setCreditDateDrafts] = useState<Record<string, string>>({})
  const [creditCollectionStatus, setCreditCollectionStatus] = useState('')
  const [pendingChequeCancelStatus, setPendingChequeCancelStatus] = useState('')
  const [creditCancelStatus, setCreditCancelStatus] = useState('')
  const [historyReportStatus, setHistoryReportStatus] = useState('')
  const [dailyReportDate, setDailyReportDate] = useState(() => toInputDate())
  const [dailyReportStatus, setDailyReportStatus] = useState('')
  const [expenseExportFrom, setExpenseExportFrom] = useState(() => toInputDate())
  const [expenseExportTo, setExpenseExportTo] = useState(() => toInputDate())
  const [expenseExportStatus, setExpenseExportStatus] = useState('')
  const [dataBackupStatus, setDataBackupStatus] = useState('')
  const [localSnapshots, setLocalSnapshots] = useState<LocalBackupSnapshotMeta[]>([])
  const [folderBackup, setFolderBackup] = useState<FolderDailyBackupSettings>(() =>
    getFolderDailyBackupSettings(),
  )
  const [folderBackupBusy, setFolderBackupBusy] = useState(false)
  const folderBackupSupported = isFolderBackupSupported()
  const backupFileInputRef = useRef<HTMLInputElement>(null)
  const {
    value: billEditSearch,
    setValue: setBillEditSearch,
    deferredValue: deferredBillEditSearch,
  } = useDeferredSearch()
  const {
    value: creditAdminSearch,
    setValue: setCreditAdminSearch,
    deferredValue: deferredCreditAdminSearch,
  } = useDeferredSearch()
  const [trashStatus, setTrashStatus] = useState('')
  const [billEditFilter, setBillEditFilter] = useState<BillEditFilter>('all')
  const [billEditOpen, setBillEditOpen] = useState(false)
  const [billEditMode, setBillEditMode] = useState(() => readBillEditMode())
  const [editingBillDateId, setEditingBillDateId] = useState<string | null>(null)
  const [editBillDate, setEditBillDate] = useState('')
  const [editBillTime, setEditBillTime] = useState('')
  const [billEditStatus, setBillEditStatus] = useState('')

  const generalScrollRef = useRef<HTMLDivElement>(null)
  const tallyScrollRef = useRef<HTMLDivElement>(null)
  const pinelabsScrollRef = useRef<HTMLDivElement>(null)
  const cloudScrollRef = useRef<HTMLDivElement>(null)
  const websiteScrollRef = useRef<HTMLDivElement>(null)
  const billEditListRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const scrollEl =
      tab === 'general'
        ? generalScrollRef.current
        : tab === 'tally'
          ? tallyScrollRef.current
          : tab === 'pinelabs'
            ? pinelabsScrollRef.current
            : tab === 'website'
              ? websiteScrollRef.current
              : cloudScrollRef.current
    scrollEl?.scrollTo(0, 0)
  }, [tab])

  useEffect(() => {
    billEditListRef.current?.scrollTo(0, 0)
  }, [billEditFilter, billEditSearch, billEditOpen])

  const refreshLocalSnapshots = useCallback(async () => {
    try {
      setLocalSnapshots(await listLocalBackupSnapshots())
    } catch {
      setLocalSnapshots([])
    }
  }, [])

  useEffect(() => {
    if (tab !== 'general') return
    void refreshLocalSnapshots()
  }, [tab, data, refreshLocalSnapshots])

  const refreshCloudRemoteSummaryState = useCallback(async () => {
    await refreshCloudRemoteSummary()
  }, [])

  useEffect(() => {
    if (!cloudUser) {
      setCloudRemoteSummary(null)
      return
    }
    setCloudRemoteSummaryListener((summary) => {
      setCloudRemoteSummary(summary)
    })
    void refreshCloudRemoteSummaryState()
    return () => setCloudRemoteSummaryListener(null)
  }, [cloudUser, refreshCloudRemoteSummaryState])

  const approvedCheques = useMemo(() => listApprovedChequeEntries(data), [data])
  const approvedChequesByCustomer = useMemo(() => {
    const groups: Array<{ name: string; entries: typeof approvedCheques }> = []
    const indexByName = new Map<string, number>()
    for (const entry of approvedCheques) {
      const name = entry.customerName?.trim() || '—'
      const existing = indexByName.get(name.toLowerCase())
      if (existing == null) {
        indexByName.set(name.toLowerCase(), groups.length)
        groups.push({ name, entries: [entry] })
      } else {
        groups[existing].entries.push(entry)
      }
    }
    return groups
  }, [approvedCheques])
  const pendingCreditSales = useMemo(() => listPendingCreditSales(data), [data.sales])
  const creditCollectionEntries = useMemo(() => listCreditCollectionEntries(data), [data])
  const paidCreditSales = useMemo(() => listPaidCreditSales(data), [data.sales])
  const pendingChequeSales = useMemo(() => listPendingChequeSales(data), [data.sales])

  const creditSearch = deferredCreditAdminSearch.trim().toLowerCase()
  const filteredApprovedChequesByCustomer = useMemo(() => {
    if (!creditSearch) return approvedChequesByCustomer
    return approvedChequesByCustomer
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          (entry.customerName ?? '').toLowerCase().includes(creditSearch),
        ),
      }))
      .filter((group) => group.entries.length > 0)
  }, [approvedChequesByCustomer, creditSearch])
  const filteredPendingCreditSales = useMemo(() => {
    if (!creditSearch) return pendingCreditSales
    return pendingCreditSales.filter((sale) =>
      (getSaleCustomerName(sale, data.sales) ?? '').toLowerCase().includes(creditSearch),
    )
  }, [pendingCreditSales, creditSearch, data.sales])
  const filteredCreditCollectionEntries = useMemo(() => {
    if (!creditSearch) return creditCollectionEntries
    return creditCollectionEntries.filter((entry) =>
      (entry.customerName ?? '').toLowerCase().includes(creditSearch),
    )
  }, [creditCollectionEntries, creditSearch])
  const filteredCreditCollectionsByCustomer = useMemo(() => {
    const groups: Array<{ name: string; entries: typeof creditCollectionEntries }> = []
    const indexByName = new Map<string, number>()
    for (const entry of filteredCreditCollectionEntries) {
      const name = entry.customerName?.trim() || '—'
      const existing = indexByName.get(name.toLowerCase())
      if (existing == null) {
        indexByName.set(name.toLowerCase(), groups.length)
        groups.push({ name, entries: [entry] })
      } else {
        groups[existing]?.entries.push(entry)
      }
    }
    return groups
  }, [filteredCreditCollectionEntries])
  const filteredPaidCreditSales = useMemo(() => {
    if (!creditSearch) return paidCreditSales
    return paidCreditSales.filter((sale) =>
      (getSaleCustomerName(sale, data.sales) ?? '').toLowerCase().includes(creditSearch),
    )
  }, [paidCreditSales, creditSearch, data.sales])
  const filteredPendingChequeSales = useMemo(() => {
    if (!creditSearch) return pendingChequeSales
    return pendingChequeSales.filter((sale) =>
      (getSaleCustomerName(sale, data.sales) ?? '').toLowerCase().includes(creditSearch),
    )
  }, [pendingChequeSales, creditSearch, data.sales])
  const trashItems = useMemo(
    () =>
      [...(data.trash ?? [])].sort(
        (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(),
      ),
    [data.trash],
  )
  const historyRecordCount =
    data.sales.length + data.expenses.length + (data.loans?.length ?? 0)
  const dailyReportCounts = useMemo(
    () => getDailyReportCounts({ data, selectedDate: dailyReportDate }),
    [data, dailyReportDate],
  )
  const todayInputDate = toInputDate()
  const yesterdayInputDate = useMemo(() => {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    return toInputDate(y)
  }, [])
  const dailyReportTotalCount =
    dailyReportCounts.cash + dailyReportCounts.bank + dailyReportCounts.expense
  const expenseExportItems = useMemo(
    () =>
      filterNormalExpenseHistoryItems(
        buildNormalExpenseHistoryItems(data),
        'range',
        expenseExportFrom,
        expenseExportTo,
      ),
    [data, expenseExportFrom, expenseExportTo],
  )
  const expenseExportPurchaseItems = useMemo(
    () =>
      filterPurchaseHistoryItems(
        buildPurchaseHistoryItems(data),
        'range',
        expenseExportFrom,
        expenseExportTo,
      ),
    [data, expenseExportFrom, expenseExportTo],
  )
  const expenseExportNo1Count = useMemo(
    () => filterNo1PurchaseItems(expenseExportPurchaseItems).length,
    [expenseExportPurchaseItems],
  )
  const billEditSaleItems = useMemo(() => {
    return buildHistoryItems(data)
      .filter((item) => item.type === 'sale')
      .filter((item) => {
        if (billEditFilter === 'all') return true
        const pending = billIsPending(item, data.sales)
        return billEditFilter === 'pending' ? pending : !pending
      })
  }, [data, billEditFilter])

  const billEditItems = useMemo(() => {
    return billEditSaleItems
      .filter((item) => matchesHistorySearch(item, deferredBillEditSearch))
      .sort((a, b) => historyItemSortTime(b) - historyItemSortTime(a))
  }, [billEditSaleItems, deferredBillEditSearch])

  const billEditCount = useMemo(
    () => buildHistoryItems(data).filter((item) => item.type === 'sale').length,
    [data],
  )

  const firebaseBuilt = isFirebaseConfigured()
  const opening = parseAmount(openingStr)
  const openingBank = parseAmount(openingBankStr)

  useEffect(() => {
    setOpeningStr(String(data.openingBalance))
    setOpeningBankStr(String(data.openingBankBalance ?? 0))
  }, [data.openingBalance, data.openingBankBalance])

  useEffect(() => {
    const editBillId = searchParams.get('editBill')
    if (!editBillId) return
    setSearchParams({}, { replace: true })
    navigate(counterBillPath(editBillId))
  }, [searchParams, setSearchParams, navigate])

  useEffect(() => {
    if (!billEditOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setBillEditOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [billEditOpen])

  useEffect(() => {
    function onBillEditModeChange(event: Event) {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') setBillEditMode(detail)
    }
    window.addEventListener('bill-edit-mode', onBillEditModeChange)
    return () => window.removeEventListener('bill-edit-mode', onBillEditModeChange)
  }, [])

  useEffect(() => {
    if (!firebaseBuilt) return
    return subscribeToAuth(async (user) => {
      setCloudUser(user)
      if (user) {
        setCloudUsername(getCloudUsername(user))
        void refreshCloudRemoteSummaryState()
      } else {
        setCloudRemoteSummary(null)
      }
    })
  }, [firebaseBuilt, refreshCloudRemoteSummaryState])

  useEffect(() => {
    setBackupStatusListener((message, isError) => {
      setBackupStatus(message)
      setBackupError(Boolean(isError))
    })
    return () => setBackupStatusListener(null)
  }, [])

  function activeValue(): string {
    if (activeField === 'openingCash') return openingStr
    if (activeField === 'openingBank') return openingBankStr
    if (activeField === 'pin') return pinStr
    return pinConfirmStr
  }

  function setActiveValue(next: string) {
    if (activeField === 'openingCash') setOpeningStr(next)
    else if (activeField === 'openingBank') setOpeningBankStr(next)
    else if (activeField === 'pin') setPinStr(next)
    else setPinConfirmStr(next)
  }

  function handleNumpad(action: NumpadAction) {
    if (tab !== 'general' || action === 'enter') return
    const isPinField = activeField === 'pin' || activeField === 'pinConfirm'
    const prev = activeValue()
    const next = isPinField ? applyPinAction(prev, action) : applyNumpadAction(prev, action)
    if (isPinField && next.length > 4) return
    setActiveValue(next)
    setPinError('')
  }

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  useRouteNumpadKeyboard('/settings', (action) => numpadHandlerRef.current(action))

  function historyReportMeta() {
    return {
      exportedAt: new Date().toISOString(),
      openingCash: data.openingBalance,
      openingBank: data.openingBankBalance ?? 0,
      currentCash: balance,
      currentBank: bankBalance,
    }
  }

  function handleDownloadExpenseRangeSpreadsheet() {
    if (!expenseExportFrom || !expenseExportTo) {
      setExpenseExportStatus('Pick from and to dates')
      return
    }
    const from = expenseExportFrom <= expenseExportTo ? expenseExportFrom : expenseExportTo
    const to = expenseExportFrom <= expenseExportTo ? expenseExportTo : expenseExportFrom
    const periodLabel =
      from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`
    downloadExpenseAndNo1PurchaseSpreadsheet(
      expenseExportItems,
      expenseExportPurchaseItems,
      periodLabel,
      `cash-counter-expenses-${from}_to_${to}`,
    )
    setExpenseExportStatus(
      `Excel file downloaded · ${expenseExportItems.length} expenses · ${expenseExportNo1Count} No 1 purchases`,
    )
  }

  function handleDownloadHistoryReport() {
    downloadFullHistoryReport(data, historyReportMeta())
    setHistoryReportStatus(`CSV downloaded · ${historyRecordCount} records`)
    setTimeout(() => setHistoryReportStatus(''), 4000)
  }

  function handleDownloadDataBackup() {
    const payload = downloadDataBackup(data)
    setDataBackupStatus(`Backup downloaded · ${formatBackupSummary(payload.data)}`)
    setTimeout(() => setDataBackupStatus(''), 5000)
  }

  function refreshFolderBackupSettings() {
    setFolderBackup(getFolderDailyBackupSettings())
  }

  async function handleChooseBackupFolder() {
    setFolderBackupBusy(true)
    try {
      const next = await chooseFolderDailyBackupDir()
      setFolderBackup(next)
      setDataBackupStatus(`Backup folder set · ${next.folderName}`)
      setTimeout(() => setDataBackupStatus(''), 5000)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setDataBackupStatus(err instanceof Error ? err.message : 'Could not choose folder')
      setTimeout(() => setDataBackupStatus(''), 6000)
    } finally {
      setFolderBackupBusy(false)
    }
  }

  function handleFolderBackupTimeChange(value: string) {
    setFolderBackup(setFolderDailyBackupTime(value))
  }

  function handleFolderBackupToggle(enabled: boolean) {
    if (enabled && !folderBackup.folderName) {
      setDataBackupStatus('Choose a backup folder first.')
      setTimeout(() => setDataBackupStatus(''), 4000)
      return
    }
    setFolderBackup(setFolderDailyBackupEnabled(enabled))
  }

  async function handleClearBackupFolder() {
    if (!confirm('Clear the daily backup folder setting?')) return
    setFolderBackup(await clearFolderDailyBackupDir())
    setDataBackupStatus('Backup folder cleared')
    setTimeout(() => setDataBackupStatus(''), 4000)
  }

  async function handleBackupNowToFolder() {
    if (!folderBackup.folderName) {
      setDataBackupStatus('Choose a backup folder first.')
      setTimeout(() => setDataBackupStatus(''), 4000)
      return
    }
    setFolderBackupBusy(true)
    try {
      const result = await runFolderDailyBackupNow(data, { force: true })
      setFolderBackup(result.settings)
      setDataBackupStatus(
        `Saved to folder · ${result.filename} · ${formatBackupSummary(data)}`,
      )
      setTimeout(() => setDataBackupStatus(''), 6000)
    } catch (err) {
      refreshFolderBackupSettings()
      setDataBackupStatus(err instanceof Error ? err.message : 'Folder backup failed')
      setTimeout(() => setDataBackupStatus(''), 6000)
    } finally {
      setFolderBackupBusy(false)
    }
  }

  function handlePickBackupFile() {
    backupFileInputRef.current?.click()
  }

  async function handleRestoreBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const restored = await readBackupFile(file)
      const summary = formatBackupSummary(restored)
      const ok = window.confirm(
        `Restore backup from ${file.name}?\n\n${summary}\n\nThis replaces all data on this device.`,
      )
      if (!ok) return
      replaceAllData(restored)
      setOpeningStr(String(restored.openingBalance))
      setOpeningBankStr(String(restored.openingBankBalance ?? 0))
      setDataBackupStatus(`Restored from file · ${summary}`)
      void refreshLocalSnapshots()
      setTimeout(() => setDataBackupStatus(''), 5000)
    } catch (err) {
      setDataBackupStatus(err instanceof Error ? err.message : 'Restore failed')
      setTimeout(() => setDataBackupStatus(''), 5000)
    }
  }

  async function handleRestoreLocalSnapshot(id: string) {
    try {
      const restored = await loadLocalBackupSnapshot(id)
      if (!restored) {
        setDataBackupStatus('Local snapshot not found')
        setTimeout(() => setDataBackupStatus(''), 4000)
        return
      }
      const summary = formatBackupSummary(restored)
      const snapshot = localSnapshots.find((item) => item.id === id)
      const ok = window.confirm(
        `Restore device backup from ${snapshot ? new Date(snapshot.savedAt).toLocaleString() : 'snapshot'}?\n\n${summary}\n\nThis replaces all data on this device.`,
      )
      if (!ok) return
      replaceAllData(restored)
      setOpeningStr(String(restored.openingBalance))
      setOpeningBankStr(String(restored.openingBankBalance ?? 0))
      setDataBackupStatus(`Restored device backup · ${summary}`)
      void refreshLocalSnapshots()
      setTimeout(() => setDataBackupStatus(''), 5000)
    } catch (err) {
      setDataBackupStatus(err instanceof Error ? err.message : 'Restore failed')
      setTimeout(() => setDataBackupStatus(''), 5000)
    }
  }

  function handlePrintHistoryReportPdf() {
    printFullHistoryReportPdf(data, historyReportMeta())
    setHistoryReportStatus(`PDF ready · ${historyRecordCount} records · choose Save as PDF`)
    setTimeout(() => setHistoryReportStatus(''), 5000)
  }

  function dailyReportInput() {
    return {
      data,
      selectedDate: dailyReportDate,
      currentCash: balance,
      currentBank: bankBalance,
    }
  }

  function handlePrintCombinedDailyStatement() {
    if (!dailyReportDate) {
      setDailyReportStatus('Pick a date first')
      setTimeout(() => setDailyReportStatus(''), 4000)
      return
    }
    printCombinedDailyReportPdf(dailyReportInput())
    setDailyReportStatus(
      `Daily statement PDF ready · ${dailyReportTotalCount} items · cash → bank → expense · choose Save as PDF`,
    )
    setTimeout(() => setDailyReportStatus(''), 6000)
  }

  function handleDownloadCombinedDailyStatement() {
    if (!dailyReportDate) {
      setDailyReportStatus('Pick a date first')
      setTimeout(() => setDailyReportStatus(''), 4000)
      return
    }
    downloadCombinedDailyReportSpreadsheet(dailyReportInput())
    setDailyReportStatus(`Daily statement sheet downloaded · ${dailyReportTotalCount} items`)
    setTimeout(() => setDailyReportStatus(''), 5000)
  }

  function handlePrintDailyReport(kind: DailyReportKind) {
    if (!dailyReportDate) {
      setDailyReportStatus('Pick a date first')
      setTimeout(() => setDailyReportStatus(''), 4000)
      return
    }
    printDailyReportPdf(dailyReportInput(), kind)
    const count = dailyReportCounts[kind]
    setDailyReportStatus(
      `${kind.charAt(0).toUpperCase()}${kind.slice(1)} PDF ready · ${count} items · choose Save as PDF`,
    )
    setTimeout(() => setDailyReportStatus(''), 5000)
  }

  function handleDownloadDailyReportSpreadsheet(kind: DailyReportKind) {
    if (!dailyReportDate) {
      setDailyReportStatus('Pick a date first')
      setTimeout(() => setDailyReportStatus(''), 4000)
      return
    }
    downloadDailyReportSpreadsheet(dailyReportInput(), kind)
    const count = dailyReportCounts[kind]
    setDailyReportStatus(
      `${kind.charAt(0).toUpperCase()}${kind.slice(1)} sheet downloaded · ${count} items`,
    )
    setTimeout(() => setDailyReportStatus(''), 5000)
  }

  function handlePrintDailySummaryReport() {
    if (!dailyReportDate) {
      setDailyReportStatus('Pick a date first')
      setTimeout(() => setDailyReportStatus(''), 4000)
      return
    }
    printDailySummaryReportPdf(dailyReportInput())
    setDailyReportStatus('Summary PDF ready · choose Save as PDF')
    setTimeout(() => setDailyReportStatus(''), 5000)
  }

  function handleDownloadDailySummaryReportSpreadsheet() {
    if (!dailyReportDate) {
      setDailyReportStatus('Pick a date first')
      setTimeout(() => setDailyReportStatus(''), 4000)
      return
    }
    downloadDailySummaryReportSpreadsheet(dailyReportInput())
    setDailyReportStatus('Summary sheet downloaded')
    setTimeout(() => setDailyReportStatus(''), 5000)
  }

  function handleCancelApprovedCheque(saleId: string, eventIndex: number | null) {
    const ok = cancelApprovedCheque(saleId, eventIndex)
    setChequeCancelStatus(
      ok
        ? 'Cheque cancelled — removed from bank; open balance updated in History.'
        : 'Could not cancel this cheque. Refresh and try again.',
    )
    setTimeout(() => setChequeCancelStatus(''), 4000)
  }

  function handleUpdateApprovedChequeDate(
    entry: {
      id: string
      saleId: string
      eventIndex: number | null
      at: string
    },
    applyToAll = false,
  ) {
    const dateValue = chequeDateDrafts[entry.id] ?? isoToDateInputValue(entry.at)
    const atIso = dateInputValueToIso(dateValue, entry.at)
    if (!dateValue || !atIso) {
      setChequeCancelStatus('Pick a valid cheque date.')
      setTimeout(() => setChequeCancelStatus(''), 4000)
      return
    }
    const ok = updateApprovedChequeDate(entry.saleId, entry.eventIndex, atIso, {
      applyToAll,
    })
    setChequeCancelStatus(
      ok
        ? applyToAll
          ? 'All cheque dates on this bill updated — sales & History use the new day.'
          : 'Cheque date updated — this amount now counts in that day’s sales & History.'
        : 'Date unchanged. Pick a different day and try again.',
    )
    setChequeDateDrafts((prev) => {
      const next = { ...prev }
      // Clear drafts for every row on this bill when applying to all.
      if (applyToAll) {
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${entry.saleId}:`) || key === entry.saleId) delete next[key]
        }
      } else {
        delete next[entry.id]
      }
      return next
    })
    setTimeout(() => setChequeCancelStatus(''), 5000)
  }

  function handleCancelCreditCollection(saleId: string, eventIndex: number | null) {
    const ok = cancelCreditCollection(saleId, eventIndex)
    setCreditCollectionStatus(
      ok
        ? 'Collection cancelled — amount returned to credit. Collect again from Credit.'
        : 'Could not cancel this collection. Refresh and try again.',
    )
    setTimeout(() => setCreditCollectionStatus(''), 4000)
  }

  function handleUpdateCreditCollectionDate(
    entry: {
      id: string
      saleId: string
      eventIndex: number | null
      at: string
    },
    applyToAll = false,
  ) {
    const dateValue = creditDateDrafts[entry.id] ?? isoToDateInputValue(entry.at)
    const atIso = dateInputValueToIso(dateValue, entry.at)
    if (!dateValue || !atIso) {
      setCreditCollectionStatus('Pick a valid collection date.')
      setTimeout(() => setCreditCollectionStatus(''), 4000)
      return
    }
    const ok = updateCreditCollectionDate(entry.saleId, entry.eventIndex, atIso, {
      applyToAll,
    })
    setCreditCollectionStatus(
      ok
        ? applyToAll
          ? 'All collection dates on this bill updated — sales & History use the new day.'
          : 'Collection date updated — this amount now counts in that day’s sales & History.'
        : 'Date unchanged. Pick a different day and try again.',
    )
    setCreditDateDrafts((prev) => {
      const next = { ...prev }
      if (applyToAll) {
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${entry.saleId}:`) || key === entry.saleId) delete next[key]
        }
      } else {
        delete next[entry.id]
      }
      return next
    })
    setTimeout(() => setCreditCollectionStatus(''), 5000)
  }

  function handleCancelSaleCredit(id: string, relatedSaleIds?: string[]) {
    const sale = data.sales.find((s) => s.id === id)
    const hadPayment = sale ? saleCollectedAmount(sale) > 0 : false
    cancelSaleCredit(id, relatedSaleIds)
    if (editingBillDateId === id) cancelBillDateEdit()
    setCreditCancelStatus(
      hadPayment
        ? 'Credit cancelled — partial payment kept as collected.'
        : 'Credit bill removed — balance cleared.',
    )
    setTimeout(() => setCreditCancelStatus(''), 4000)
  }

  function handleCancelSaleCreditAsUnpaid(id: string, relatedSaleIds?: string[]) {
    const sale = data.sales.find((s) => s.id === id)
    const billName = sale ? getSaleCustomerName(sale, data.sales) : ''
    const total =
      sale?.originalBillAmount ??
      (sale ? sale.billAmount + saleCollectedAmount(sale) : 0)
    const okConfirm = window.confirm(
      `Cancel ${billName || 'this credit bill'} as unpaid?\n\nBill ${formatMoney(total)} will be removed. All credit collections leave cash/bank — same as if nothing was paid.`,
    )
    if (!okConfirm) return
    const ok = cancelSaleCreditAsUnpaid(id, relatedSaleIds)
    if (editingBillDateId === id) cancelBillDateEdit()
    setCreditCancelStatus(
      ok
        ? 'Credit bill cancelled as unpaid — removed from cash/bank and History.'
        : 'Could not cancel this credit bill.',
    )
    setTimeout(() => setCreditCancelStatus(''), 4000)
  }

  function handleCancelSaleCheque(id: string, relatedSaleIds?: string[]) {
    const sale = data.sales.find((s) => s.id === id)
    const hadPayment = sale ? saleCollectedAmount(sale) > 0 : false
    cancelSaleCheque(id, relatedSaleIds)
    if (editingBillDateId === id) cancelBillDateEdit()
    setPendingChequeCancelStatus(
      hadPayment
        ? 'Open cheque moved to credit — collected amount kept in bank.'
        : 'Unpaid cheque bill removed.',
    )
    setTimeout(() => setPendingChequeCancelStatus(''), 4000)
  }

  function handleCancelSaleChequeAsUnpaid(id: string, relatedSaleIds?: string[]) {
    const sale = data.sales.find((s) => s.id === id)
    const billName = sale ? getSaleCustomerName(sale, data.sales) : ''
    const total =
      sale?.originalBillAmount ??
      (sale ? sale.billAmount + saleCollectedAmount(sale) : 0)
    const okConfirm = window.confirm(
      `Cancel ${billName || 'this cheque'} as unpaid?\n\nBill ${formatMoney(total)} will be removed. All approved cheque amounts leave bank — same as if nothing was paid.`,
    )
    if (!okConfirm) return
    const ok = cancelSaleChequeAsUnpaid(id, relatedSaleIds)
    if (editingBillDateId === id) cancelBillDateEdit()
    setPendingChequeCancelStatus(
      ok
        ? 'Cheque bill cancelled as unpaid — removed from bank and History.'
        : 'Could not cancel this cheque bill.',
    )
    setChequeCancelStatus(
      ok
        ? 'Cheque bill cancelled as unpaid — removed from bank and History.'
        : 'Could not cancel this cheque bill.',
    )
    setTimeout(() => {
      setPendingChequeCancelStatus('')
      setChequeCancelStatus('')
    }, 4000)
  }

  function toggleBillEditMode() {
    const next = !billEditMode
    setBillEditMode(next)
    writeBillEditMode(next)
    if (!next) cancelBillDateEdit()
  }

  function openBillInCounter(item: HistoryItem) {
    const billId = resolveHistoryItemBillId(item)
    if (!billId) return
    setBillEditOpen(false)
    navigate(counterBillPath(billId))
  }

  function startBillDateEdit(item: HistoryItem) {
    const sale = data.sales.find((s) => s.id === item.id)
    const billCreatedIso = item.billCreatedAt ?? sale?.createdAt ?? item.date
    setEditingBillDateId(item.id)
    setEditBillDate(isoToDateInputValue(billCreatedIso))
    setEditBillTime(isoToTimeInputValue(billCreatedIso))
  }

  function cancelBillDateEdit() {
    setEditingBillDateId(null)
    setEditBillDate('')
    setEditBillTime('')
  }

  function saveBillDateEdit(item: HistoryItem) {
    const sale = data.sales.find((s) => s.id === item.id)
    const fallbackIso = sale?.createdAt ?? item.billCreatedAt ?? item.date
    const createdAt = dateTimeInputValuesToIso(editBillDate, editBillTime, fallbackIso)

    if (!editBillDate || !createdAt) {
      setBillEditStatus('Enter a valid bill date and time.')
      setTimeout(() => setBillEditStatus(''), 3000)
      return
    }

    updateSaleBill(item.id, { createdAt }, item.groupSaleIds)
    cancelBillDateEdit()
    setBillEditStatus(
      `Bill date updated · ${item.name?.trim() || '—'} · ${formatDate(createdAt)}`,
    )
    setTimeout(() => setBillEditStatus(''), 4000)
  }

  function handleSave() {
    setPinError('')
    if (pinStr || pinConfirmStr) {
      if (pinStr.length !== 4 || pinConfirmStr.length !== 4) {
        setPinError('PIN must be exactly 4 digits.')
        return
      }
      if (pinStr !== pinConfirmStr) {
        setPinError('PINs do not match.')
        return
      }
      updateHomePin(pinStr)
    }
    updateOpeningBalance(opening)
    updateOpeningBankBalance(openingBank)
    setSaved(true)
    setPinStr('')
    setPinConfirmStr('')
    setTimeout(() => setSaved(false), 1200)
  }

  function cloudDataSummary(snapshot: AppData): string {
    const loansPart =
      (snapshot.loans?.length ?? 0) > 0 ? ` · ${snapshot.loans!.length} loans` : ''
    return `${snapshot.sales.length} bills · ${snapshot.expenses.length} records${loansPart} · cash ${formatMoney(snapshot.openingBalance)} · bank ${formatMoney(snapshot.openingBankBalance ?? 0)}`
  }

  async function prepareLocalForCloudAuth() {
    if (cloudUser) {
      await logoutCloud()
      setCloudUser(null)
    }
    resetAllData()
    clearLocalLastBackupTime()
    await clearAllLocalBackupSnapshots()
    setOpeningStr('0')
    setOpeningBankStr('0')
  }

  async function loadCloudDataAfterAuth(isNewAccount: boolean) {
    setCloudLoginRestoreActive(true)
    try {
      await waitForCloudRestoreIdle()
      let restored = loadData()
      if (isLocalDataEmpty(restored) && !isNewAccount) {
        const fromCloud = await restoreFullCloudData()
        if (fromCloud) restored = fromCloud
      }
      if (!isLocalDataEmpty(restored)) {
        hydrateData(restored)
        if (!isMainBillingDevice()) {
          setAutoPullFromCloudEnabled(true)
          setAutoPull(true)
        }
        setOpeningStr(String(restored.openingBalance))
        setOpeningBankStr(String(restored.openingBankBalance ?? 0))
        setBackupStatus(`Imported · cloud loaded into database · ${cloudDataSummary(restored)}`)
        setBackupError(false)
        return
      }
      if (isNewAccount) {
        setMainBillingDevice(true)
        setAutoBackupEnabled(true)
        setMainBillingDeviceState(true)
        setAutoBackup(true)
        const fresh = loadData()
        hydrateData(fresh)
        await backupNow({ force: true })
        setBackupStatus(`Username created · ${cloudDataSummary(fresh)} saved to cloud`)
        setBackupError(false)
        return
      }
      setBackupStatus('No cloud data yet for this username.')
      setBackupError(true)
    } finally {
      setCloudLoginRestoreActive(false)
    }
  }

  async function handleCloudCreate() {
    setBackupBusy(true)
    setBackupError(false)
    try {
      await prepareLocalForCloudAuth()
      setCloudLoginRestoreActive(true)
      await createCloudAccount(cloudUsername, cloudPassword)
      setCloudPassword('')
      await loadCloudDataAfterAuth(true)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Create failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleCloudOpen() {
    setBackupBusy(true)
    setBackupError(false)
    try {
      await prepareLocalForCloudAuth()
      setCloudLoginRestoreActive(true)
      await loginCloud(cloudUsername, cloudPassword)
      setCloudPassword('')
      await loadCloudDataAfterAuth(false)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Open failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleBackupNow() {
    if (!cloudUser) return
    setBackupBusy(true)
    setBackupError(false)
    try {
      const local = loadData()
      const localTotals = cloudBackupTotals(local)
      const remote = await fetchRemoteAppData()
      if (remote && remoteIsAheadOfLocal(local, remote.data)) {
        const remoteTotals = cloudBackupTotals(remote.data)
        const ok = window.confirm(
          `Cloud already has different data.\n\nCloud: ${remoteTotals.bills} bills · cash ${formatMoney(remoteTotals.cash)}\nThis device: ${localTotals.bills} bills · cash ${formatMoney(localTotals.cash)}\n\nSave anyway? This replaces cloud with this device.`,
        )
        if (!ok) return
      }
      await backupNow({ force: true })
      await refreshCloudRemoteSummaryState()
      setBackupStatus(
        `Saved to cloud · ${localTotals.bills} bills · cash ${formatMoney(localTotals.cash)} verified`,
      )
      setBackupError(false)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Backup failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleLoadFromCloud() {
    if (!cloudUser) return
    setBackupBusy(true)
    setBackupError(false)
    try {
      const remote = await fetchRemoteAppData()
      if (!remote) {
        setBackupStatus('No cloud backup found for this username.')
        setBackupError(true)
        return
      }

      const localBills = data.sales.length
      const localRecords = data.expenses.length
      const cloudBills = remote.data.sales.length
      const cloudRecords = remote.data.expenses.length
      const sameCounts = localBills === cloudBills && localRecords === cloudRecords

      if (
        !sameCounts &&
        !window.confirm(
          `Load from cloud?\n\nThis device: ${localBills} bills · ${localRecords} records\nCloud: ${cloudBills} bills · ${cloudRecords} records\n\nThis replaces all data on this device with the cloud backup.`,
        )
      ) {
        return
      }

      const restored = await restoreFullCloudData()
      if (!restored) {
        setBackupStatus('Could not load cloud data.')
        setBackupError(true)
        return
      }

      replaceAllData(restored)
      setOpeningStr(String(restored.openingBalance))
      setOpeningBankStr(String(restored.openingBankBalance ?? 0))
      await refreshCloudRemoteSummaryState()
      setBackupStatus(`Loaded from cloud · ${cloudDataSummary(restored)}`)
      setBackupError(false)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Load from cloud failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleCloudLogout() {
    const ok = window.confirm(
      'Logout? All local data on this device will be removed. Your cloud backup stays safe. Open username again to load full data.',
    )
    if (!ok) return
    setBackupBusy(true)
    try {
      await logoutCloud()
      resetAllData()
      clearLocalLastBackupTime()
      await clearAllLocalBackupSnapshots()
      setOpeningStr('0')
      setOpeningBankStr('0')
      setCloudUser(null)
      setCloudPassword('')
      setCloudRemoteSummary(null)
      setBackupStatus('Logged out — local data removed')
      setBackupError(false)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Logout failed')
      setBackupError(true)
    } finally {
      setBackupBusy(false)
    }
  }

  function toggleAutoBackup() {
    const next = !autoBackup
    setAutoBackup(next)
    setAutoBackupEnabled(next)
  }

  function toggleAutoPull() {
    const next = !autoPull
    setAutoPull(next)
    setAutoPullFromCloudEnabled(next)
  }

  function toggleMainBillingDevice() {
    const next = !mainBillingDevice
    setMainBillingDeviceState(next)
    setMainBillingDevice(next)
    if (next) {
      setAutoBackup(true)
      setAutoBackupEnabled(true)
      if (cloudUser) {
        void backupNow({ force: true })
          .then(() => refreshCloudRemoteSummaryState())
          .catch((err) => {
            setBackupStatus(err instanceof Error ? err.message : 'Backup failed')
            setBackupError(true)
          })
      }
    } else {
      setAutoBackup(false)
    }
  }

  function updatePineLabsField<K extends keyof PineLabsSettings>(key: K, value: PineLabsSettings[K]) {
    setPineLabs((prev) => ({ ...prev, [key]: value }))
  }

  async function handlePineLabsTest() {
    setPineLabsBusy(true)
    setPineLabsError(false)
    try {
      const result = await testPineLabsConnection(pineLabs)
      setPineLabsStatus(result.message)
      setPineLabsError(!result.connected)
    } finally {
      setPineLabsBusy(false)
    }
  }

  function handlePineLabsSave() {
    setPineLabsSettings(pineLabs)
    setPineLabsStatus(
      pineLabs.enabled
        ? `Saved · ${pineLabsEnvironmentLabel(pineLabs.environment)} · ready for card/UPI on terminal`
        : 'Saved · Pine Labs disabled',
    )
    setPineLabsError(false)
  }

  async function handleTallyTest() {
    setTallyBusy(true)
    setTallyError(false)
    try {
      const result = await testTallyConnection(tallyUrl, tallyScope)
      if (!result.connected) {
        setTallyStatus(result.error ?? 'Cannot connect to Tally API.')
        setTallyError(true)
        return
      }
      if (result.error) {
        setTallyStatus(`Connected · ${result.error}`)
        setTallyError(true)
        return
      }
      setTallyStatus(`Connected · ${result.billCount} bill(s) found in Tally`)
      setTallyError(false)
    } finally {
      setTallyBusy(false)
    }
  }

  async function handleTallySaveSync() {
    setTallyBusy(true)
    setTallyError(false)
    try {
      saveTallyApiUrl(tallyUrl)
      saveTallyDateScope(tallyScope)
      const result = await syncTallyBills()
      if (!result.connected) {
        setTallyStatus('Saved but cannot connect. Check Tally F12 HTTP server is ON.')
        setTallyError(true)
        return
      }
      setTallyStatus(
        `Saved · ${result.billCount} from Tally · ${result.imported} new in Pending Bills`,
      )
      setTallyError(false)
    } finally {
      setTallyBusy(false)
    }
  }

  function handleManualPending() {
    const amount = parseAmount(manualAmount)
    const name = manualName.trim()
    if (!(amount > 0)) {
      setTallyStatus('Enter a valid bill amount.')
      setTallyError(true)
      return
    }
    addManualTallyPendingBill(name, amount)
    setManualName('')
    setManualAmount('')
    setTallyStatus(`Added pending bill${name ? ` · ${name}` : ''} · ${formatMoney(amount)}`)
    setTallyError(false)
  }

  return (
    <div className="settings-page page-shell">
      <PageCorners left={<PageBackButton onClick={goBack} ariaLabel="Back" />} />
      <div className="settings-tabs page-head--corners" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`settings-tab ${tab === item.id ? 'settings-tab--active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="settings-body">
        {tab === 'general' && (
          <div className="settings-general">
            <div className="settings-scroll" ref={generalScrollRef}>
            <div className="settings-header">
              <h2>General</h2>
              <p>Opening balances & home PIN</p>
            </div>
            <div className="settings-fields">
              <AmountDisplay
                label="Opening Cash"
                value={openingStr}
                active={activeField === 'openingCash'}
                onSelect={() => setActiveField('openingCash')}
                compact
              />
              <AmountDisplay
                label="Opening Bank"
                value={openingBankStr}
                active={activeField === 'openingBank'}
                onSelect={() => setActiveField('openingBank')}
                compact
              />
              <AmountDisplay
                label="New Home PIN"
                value={pinStr ? '•'.repeat(pinStr.length) : ''}
                active={activeField === 'pin'}
                onSelect={() => setActiveField('pin')}
                compact
              />
              <AmountDisplay
                label="Confirm PIN"
                value={pinConfirmStr ? '•'.repeat(pinConfirmStr.length) : ''}
                active={activeField === 'pinConfirm'}
                onSelect={() => setActiveField('pinConfirm')}
                compact
              />
            </div>
            <div className="settings-info">
              <div className="settings-row">
                <span>Current cash</span>
                <span className="settings-highlight">{formatMoney(balance)}</span>
              </div>
              <div className="settings-row">
                <span>Current bank</span>
                <span className="settings-highlight">{formatMoney(bankBalance)}</span>
              </div>
            </div>

            <section className="settings-history-report settings-daily-report">
              <div className="settings-daily-report-compact-head">
                <h3>Daily reports</h3>
                <div className="settings-daily-report-dates">
                  <button
                    type="button"
                    className={`settings-daily-report-date-chip ${dailyReportDate === todayInputDate ? 'settings-daily-report-date-chip--active' : ''}`}
                    onClick={() => setDailyReportDate(todayInputDate)}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={`settings-daily-report-date-chip ${dailyReportDate === yesterdayInputDate ? 'settings-daily-report-date-chip--active' : ''}`}
                    onClick={() => setDailyReportDate(yesterdayInputDate)}
                  >
                    Yesterday
                  </button>
                  <input
                    type="date"
                    className="settings-daily-report-date-input"
                    value={dailyReportDate}
                    onChange={(e) => setDailyReportDate(e.target.value)}
                    aria-label="Pick date for daily report"
                  />
                </div>
              </div>
              {dailyReportStatus ? (
                <p className="settings-history-report-status">{dailyReportStatus}</p>
              ) : null}
              <div className="settings-daily-report-grid">
                <div className="settings-daily-report-tile settings-daily-report-tile--full">
                  <span className="settings-daily-report-tile-label">
                    Full ({dailyReportTotalCount})
                  </span>
                  <div className="settings-daily-report-tile-btns">
                    <button
                      type="button"
                      className="btn btn-primary settings-history-report-btn"
                      onClick={handlePrintCombinedDailyStatement}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary settings-history-report-btn"
                      onClick={handleDownloadCombinedDailyStatement}
                    >
                      Sheet
                    </button>
                  </div>
                </div>
                {DAILY_REPORT_DOWNLOAD_GROUPS.map((group) => (
                  <div key={group.kind} className="settings-daily-report-tile">
                    <span className="settings-daily-report-tile-label">
                      {group.label} ({dailyReportCounts[group.countKey]})
                    </span>
                    <div className="settings-daily-report-tile-btns">
                      <button
                        type="button"
                        className="btn btn-secondary settings-history-report-btn"
                        onClick={() => handlePrintDailyReport(group.kind)}
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary settings-history-report-btn"
                        onClick={() => handleDownloadDailyReportSpreadsheet(group.kind)}
                      >
                        Sheet
                      </button>
                    </div>
                  </div>
                ))}
                <div className="settings-daily-report-tile settings-daily-report-tile--summary">
                  <span className="settings-daily-report-tile-label">Summary</span>
                  <div className="settings-daily-report-tile-btns">
                    <button
                      type="button"
                      className="btn btn-primary settings-history-report-btn"
                      onClick={handlePrintDailySummaryReport}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary settings-history-report-btn"
                      onClick={handleDownloadDailySummaryReportSpreadsheet}
                    >
                      Sheet
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-history-report settings-expense-export">
              <div className="settings-history-report-head">
                <h3>Expense download</h3>
                <p>
                  Excel file: Sheet 1 = normal expenses + No 1 purchases by time. Also separate
                  sheets for normal only ({expenseExportItems.length}) and No 1 only (
                  {expenseExportNo1Count}).
                </p>
              </div>
              <div className="settings-expense-export-dates">
                <label className="settings-expense-export-date">
                  <span>From</span>
                  <input
                    type="date"
                    value={expenseExportFrom}
                    onChange={(e) => setExpenseExportFrom(e.target.value)}
                    aria-label="Expense export from date"
                  />
                </label>
                <label className="settings-expense-export-date">
                  <span>To</span>
                  <input
                    type="date"
                    value={expenseExportTo}
                    onChange={(e) => setExpenseExportTo(e.target.value)}
                    aria-label="Expense export to date"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary settings-history-report-btn"
                  onClick={() => {
                    setExpenseExportFrom(todayInputDate)
                    setExpenseExportTo(todayInputDate)
                  }}
                >
                  Today
                </button>
              </div>
              <div className="settings-history-report-actions">
                <button
                  type="button"
                  className="btn btn-primary settings-history-report-btn"
                  onClick={handleDownloadExpenseRangeSpreadsheet}
                >
                  Download Excel
                </button>
              </div>
              {expenseExportStatus ? (
                <p className="settings-history-report-status">{expenseExportStatus}</p>
              ) : null}
            </section>

            <section className="settings-history-report">
              <div className="settings-history-report-head">
                <h3>Full history report</h3>
                <p>
                  Download all bills, expenses, deposits, and transfers ({historyRecordCount}{' '}
                  records) as CSV or PDF.
                </p>
              </div>
              <div className="settings-history-report-actions">
                <button
                  type="button"
                  className="btn btn-secondary settings-history-report-btn"
                  onClick={handleDownloadHistoryReport}
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  className="btn btn-secondary settings-history-report-btn"
                  onClick={handlePrintHistoryReportPdf}
                >
                  Download PDF
                </button>
              </div>
              {historyReportStatus ? (
                <p className="settings-history-report-status">{historyReportStatus}</p>
              ) : null}
            </section>

            <section className="settings-history-report settings-data-backup">
              <div className="settings-history-report-head">
                <h3>Data backup</h3>
                <p>
                  All bills, expenses, pending credit/cheque, suppliers, and settings. Auto-saved on
                  this device ({localSnapshots.length} snapshots). Download a JSON file anytime or
                  restore from file / device backup.
                </p>
              </div>
              <div className="settings-history-report-actions">
                <button
                  type="button"
                  className="btn btn-primary settings-history-report-btn"
                  onClick={handleDownloadDataBackup}
                >
                  Download backup
                </button>
                <button
                  type="button"
                  className="btn btn-secondary settings-history-report-btn"
                  onClick={handlePickBackupFile}
                >
                  Restore from file
                </button>
                <input
                  ref={backupFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) => void handleRestoreBackupFile(event)}
                />
              </div>

              <div className="settings-folder-backup">
                <h4 className="settings-folder-backup-title">Daily folder backup</h4>
                <p className="settings-backup-meta">
                  Choose a folder and time. Once a day at that time, all data is saved as a JSON file
                  in the folder. Keep this site open (or reopen after that time) on Chrome / Edge.
                </p>
                {!folderBackupSupported ? (
                  <p className="settings-backup-meta settings-backup-meta--warn">
                    Folder pick is not available in this browser. Use Chrome or Edge on computer /
                    tablet.
                  </p>
                ) : null}
                <label className="settings-backup-field">
                  <span>Daily backup time</span>
                  <input
                    type="time"
                    value={folderBackup.time}
                    onChange={(event) => handleFolderBackupTimeChange(event.target.value)}
                    disabled={!folderBackupSupported}
                  />
                </label>
                <label className="settings-backup-toggle">
                  <input
                    type="checkbox"
                    checked={folderBackup.enabled}
                    onChange={(event) => handleFolderBackupToggle(event.target.checked)}
                    disabled={!folderBackupSupported}
                  />
                  Enable daily backup at {formatFolderBackupTimeLabel(folderBackup.time)}
                </label>
                <div className="settings-history-report-actions">
                  <button
                    type="button"
                    className="btn btn-secondary settings-history-report-btn"
                    onClick={() => void handleChooseBackupFolder()}
                    disabled={!folderBackupSupported || folderBackupBusy}
                  >
                    {folderBackup.folderName ? 'Change folder' : 'Choose folder'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary settings-history-report-btn"
                    onClick={() => void handleBackupNowToFolder()}
                    disabled={!folderBackupSupported || folderBackupBusy || !folderBackup.folderName}
                  >
                    Backup now to folder
                  </button>
                  {folderBackup.folderName ? (
                    <button
                      type="button"
                      className="btn btn-ghost settings-history-report-btn"
                      onClick={() => void handleClearBackupFolder()}
                      disabled={folderBackupBusy}
                    >
                      Clear folder
                    </button>
                  ) : null}
                </div>
                <p className="settings-backup-meta">
                  Folder:{' '}
                  {folderBackup.folderName ? (
                    <strong>{folderBackup.folderName}</strong>
                  ) : (
                    'not set'
                  )}
                  {folderBackup.lastBackupAt
                    ? ` · Last saved ${new Date(folderBackup.lastBackupAt).toLocaleString()}`
                    : ''}
                </p>
                {folderBackup.lastError ? (
                  <p className="settings-backup-meta settings-backup-meta--warn">
                    {folderBackup.lastError}
                  </p>
                ) : null}
              </div>

              {localSnapshots.length > 0 ? (
                <ul className="settings-data-backup-list">
                  {localSnapshots.slice(0, 8).map((snapshot) => (
                    <li key={snapshot.id} className="settings-data-backup-item">
                      <div className="settings-data-backup-item-meta">
                        <span>{new Date(snapshot.savedAt).toLocaleString()}</span>
                        <span>
                          {snapshot.salesCount} bills · {snapshot.expensesCount} records ·{' '}
                          {snapshot.pendingCount} pending
                          {(snapshot.loansCount ?? 0) > 0
                            ? ` · ${snapshot.loansCount} loans`
                            : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost settings-data-backup-restore-btn"
                        onClick={() => void handleRestoreLocalSnapshot(snapshot.id)}
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="settings-backup-meta">
                  Device snapshots appear here after you save bills or expenses.
                </p>
              )}
              {dataBackupStatus ? (
                <p className="settings-history-report-status">{dataBackupStatus}</p>
              ) : null}
            </section>

            <section className="settings-bill-edit-launch">
              <div className="settings-bill-edit-head">
                <h3>Edit bills</h3>
                <p>
                  Turn on edit mode for date and bill changes. Open bills on Cash Counter for amount,
                  paid, and payment type.
                </p>
              </div>
              <label className="settings-bill-edit-toggle">
                <span className="settings-bill-edit-toggle-label">Bill edit mode</span>
                <span className="settings-bill-edit-toggle-switch">
                  <input
                    type="checkbox"
                    checked={billEditMode}
                    onChange={toggleBillEditMode}
                    aria-label="Bill edit mode"
                  />
                  <span className="settings-bill-edit-toggle-track" aria-hidden="true" />
                </span>
              </label>
              <button
                type="button"
                className="btn btn-primary settings-bill-edit-open-btn"
                onClick={() => setBillEditOpen(true)}
              >
                Open bill list ({billEditCount})
              </button>
              {billEditStatus && !billEditOpen ? (
                <p className="settings-bill-edit-status">{billEditStatus}</p>
              ) : null}
            </section>

            <section className="settings-cheque-cancel settings-credit-cancel">
              <div className="settings-cheque-cancel-head">
                <h3>Credit & cheque admin</h3>
                <p>Search customers below, then manage pending credit, collections, cheques, and reminders.</p>
              </div>
              <input
                type="search"
                className="settings-credit-admin-search"
                value={creditAdminSearch}
                onChange={(e) => setCreditAdminSearch(e.target.value)}
                placeholder="Search customer name…"
                autoComplete="off"
              />
            </section>

            <section className="settings-cheque-cancel settings-credit-cancel">
              <div className="settings-cheque-cancel-head">
                <h3>Pending credit bills</h3>
                <p>
                  <strong>Cancel</strong> clears open credit and keeps partial payments as collected.
                  <strong> Cancel all · unpaid</strong> removes the whole bill (like nothing was paid)
                  — collected amounts leave cash/bank. To cancel 1st / 2nd cash, bank, or cheque
                  collections, use <strong>Credit collections</strong> below.
                </p>
              </div>
              {filteredPendingCreditSales.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No open credit bills.</p>
              ) : (
                <ul className="settings-cheque-cancel-list">
                  {filteredPendingCreditSales.map((sale) => {
                    const collected = saleCollectedAmount(sale)
                    const chequeInBank = getApprovedChequeAmount(sale)
                    const paidExCheque = Math.max(0, collected - chequeInBank)
                    const total = sale.originalBillAmount ?? sale.billAmount + collected
                    const when = sale.updatedAt ?? sale.createdAt
                    const relatedSaleIds = sale.parentSplitId
                      ? [sale.parentSplitId, sale.id]
                      : [sale.id]
                    const billName = getSaleCustomerName(sale, data.sales)
                    return (
                      <li key={sale.id} className="settings-cheque-cancel-item settings-cheque-cancel-item--stack">
                        <div className="settings-cheque-cancel-meta">
                          <strong>{billName || '—'}</strong>
                          <span className="settings-cheque-cancel-amount">
                            Bill {formatMoney(total)}
                            {collected > 0 ? ` − Paid ${formatMoney(collected)}` : ''}
                            {` = Open ${formatMoney(sale.billAmount)}`}
                          </span>
                          {chequeInBank > 0 || paidExCheque > 0 ? (
                            <span className="settings-cheque-cancel-sub">
                              {chequeInBank > 0
                                ? `In bank (cheque) ${formatMoney(chequeInBank)}`
                                : null}
                              {chequeInBank > 0 && paidExCheque > 0 ? ' · ' : null}
                              {paidExCheque > 0 ? `Other paid ${formatMoney(paidExCheque)}` : null}
                            </span>
                          ) : null}
                          <span className="settings-cheque-cancel-sub">
                            {formatDate(when)}
                          </span>
                        </div>
                        <BillReminderControl
                          saleId={sale.id}
                          reminderAt={sale.reminderAt}
                          reminderNote={sale.reminderNote}
                          billKind="credit"
                          billLabel={billName || 'Credit bill'}
                          data={data}
                          onSet={setBillReminder}
                          onSaveAlertSettings={updateReminderAlertSettings}
                          perBill
                          compact
                        />
                        <div className="settings-cheque-cancel-btns">
                          <button
                            type="button"
                            className="btn btn-secondary settings-cheque-cancel-btn"
                            onClick={() => handleCancelSaleCredit(sale.id, relatedSaleIds)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                            onClick={() =>
                              handleCancelSaleCreditAsUnpaid(sale.id, relatedSaleIds)
                            }
                          >
                            Cancel all · unpaid
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {creditCancelStatus ? (
                <p className="settings-cheque-cancel-status">{creditCancelStatus}</p>
              ) : null}
            </section>

            <section className="settings-cheque-cancel settings-credit-collections">
              <div className="settings-cheque-cancel-head">
                <h3>Credit collections</h3>
                <p>
                  Each cash, bank, or cheque taken against a credit bill is its own slice (1st / 2nd /
                  3rd). Change the sales date so History and that day’s totals move with it.{' '}
                  <strong>Cancel → credit</strong> returns only that slice to open credit so you can
                  collect it again.
                </p>
              </div>
              {filteredCreditCollectionEntries.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No credit collections yet.</p>
              ) : (
                <div className="settings-cheque-cancel-groups">
                  {filteredCreditCollectionsByCustomer.map((group) => (
                    <div key={group.name} className="settings-cheque-cancel-group">
                      <h4 className="settings-cheque-cancel-group-title">{group.name}</h4>
                      <ul className="settings-cheque-cancel-list">
                        {group.entries.map((entry, entryIndex) => {
                          const dateDraft =
                            creditDateDrafts[entry.id] ?? isoToDateInputValue(entry.at)
                          const isFirstOfBill =
                            group.entries.findIndex((e) => e.saleId === entry.saleId) ===
                            entryIndex
                          return (
                            <li
                              key={entry.id}
                              className="settings-cheque-cancel-item settings-cheque-cancel-item--stack"
                            >
                              <div className="settings-cheque-cancel-meta">
                                <span className="settings-cheque-cancel-amount">
                                  {entry.partLabel} · {formatMoney(entry.amount)}
                                </span>
                                {entry.openBalance > 0 ? (
                                  <span className="settings-cheque-cancel-sub">
                                    Bill {formatMoney(entry.billTotal)} − Collected{' '}
                                    {formatMoney(
                                      Math.max(0, entry.billTotal - entry.openBalance),
                                    )}{' '}
                                    = Open credit {formatMoney(entry.openBalance)}
                                  </span>
                                ) : (
                                  <span className="settings-cheque-cancel-sub">
                                    Bill {formatMoney(entry.billTotal)} · Fully collected
                                  </span>
                                )}
                                <span className="settings-cheque-cancel-sub">
                                  {entry.label} · {formatDate(entry.at)}
                                </span>
                              </div>
                              <div className="settings-cheque-cancel-actions">
                                <label className="settings-cheque-date-field">
                                  <span>Sales date</span>
                                  <input
                                    type="date"
                                    value={dateDraft}
                                    onChange={(e) =>
                                      setCreditDateDrafts((prev) => ({
                                        ...prev,
                                        [entry.id]: e.target.value,
                                      }))
                                    }
                                    aria-label={`Sales date for ${entry.partLabel} · ${group.name}`}
                                  />
                                </label>
                                <div className="settings-cheque-cancel-btns">
                                  <button
                                    type="button"
                                    className="btn btn-secondary settings-cheque-cancel-btn"
                                    onClick={() => handleUpdateCreditCollectionDate(entry, false)}
                                  >
                                    Save date
                                  </button>
                                  {isFirstOfBill ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary settings-cheque-cancel-btn"
                                      onClick={() => handleUpdateCreditCollectionDate(entry, true)}
                                    >
                                      Update all dates
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                                    onClick={() =>
                                      handleCancelCreditCollection(entry.saleId, entry.eventIndex)
                                    }
                                  >
                                    Cancel → credit
                                  </button>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {creditCollectionStatus ? (
                <p className="settings-cheque-cancel-status">{creditCollectionStatus}</p>
              ) : null}
            </section>

            <section className="settings-cheque-cancel settings-paid-credit">
              <div className="settings-cheque-cancel-head">
                <h3>Paid credit bills</h3>
                <p>
                  Fully collected credit bills. <strong>Cancel all · unpaid</strong> removes the
                  whole bill as if nothing was paid — collections leave cash/bank.
                </p>
              </div>
              {filteredPaidCreditSales.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No paid credit bills.</p>
              ) : (
                <ul className="settings-cheque-cancel-list">
                  {filteredPaidCreditSales.map((sale) => {
                    const collected = saleCollectedAmount(sale)
                    const total = sale.originalBillAmount ?? sale.billAmount
                    const when = sale.updatedAt ?? sale.createdAt
                    const relatedSaleIds = sale.parentSplitId
                      ? [sale.parentSplitId, sale.id]
                      : [sale.id]
                    const billName = getSaleCustomerName(sale, data.sales)
                    return (
                      <li key={sale.id} className="settings-cheque-cancel-item settings-cheque-cancel-item--stack">
                        <div className="settings-cheque-cancel-meta">
                          <strong>{billName || '—'}</strong>
                          <span className="settings-cheque-cancel-amount">
                            Bill {formatMoney(total)} · Paid {formatMoney(collected)}
                          </span>
                          <span className="settings-cheque-cancel-sub">{formatDate(when)}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                          onClick={() =>
                            handleCancelSaleCreditAsUnpaid(sale.id, relatedSaleIds)
                          }
                        >
                          Cancel all · unpaid
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="settings-cheque-cancel settings-pending-cheque">
              <div className="settings-cheque-cancel-head">
                <h3>Pending cheque bills</h3>
                <p>
                  <strong>To credit</strong> keeps money already in bank and moves only the open
                  balance to credit. <strong>Cancel all · unpaid</strong> removes the whole bill
                  (like nothing was paid) — approved amounts leave bank.
                </p>
              </div>
              {filteredPendingChequeSales.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No open cheque bills.</p>
              ) : (
                <ul className="settings-cheque-cancel-list">
                  {filteredPendingChequeSales.map((sale) => {
                    const collected = saleCollectedAmount(sale)
                    const chequeInBank = getApprovedChequeAmount(sale)
                    const paidExCheque = Math.max(0, collected - chequeInBank)
                    const total = sale.originalBillAmount ?? sale.billAmount + collected
                    const when = sale.updatedAt ?? sale.createdAt
                    const relatedSaleIds = sale.parentSplitId
                      ? [sale.parentSplitId, sale.id]
                      : [sale.id]
                    const billName = getSaleCustomerName(sale, data.sales)
                    return (
                      <li key={sale.id} className="settings-cheque-cancel-item settings-cheque-cancel-item--stack">
                        <div className="settings-cheque-cancel-meta">
                          <strong>{billName || '—'}</strong>
                          <span className="settings-cheque-cancel-amount">
                            Bill {formatMoney(total)}
                            {collected > 0 ? ` − In bank ${formatMoney(collected)}` : ''}
                            {` = Open ${formatMoney(sale.billAmount)}`}
                          </span>
                          {chequeInBank > 0 || paidExCheque > 0 ? (
                            <span className="settings-cheque-cancel-sub">
                              {chequeInBank > 0
                                ? `Approved cheque ${formatMoney(chequeInBank)}`
                                : null}
                              {chequeInBank > 0 && paidExCheque > 0 ? ' · ' : null}
                              {paidExCheque > 0 ? `Other paid ${formatMoney(paidExCheque)}` : null}
                            </span>
                          ) : null}
                          <span className="settings-cheque-cancel-sub">
                            {formatDate(when)}
                          </span>
                        </div>
                        <BillReminderControl
                          saleId={sale.id}
                          reminderAt={sale.reminderAt}
                          reminderNote={sale.reminderNote}
                          billKind="cheque"
                          billLabel={billName || 'Cheque bill'}
                          data={data}
                          onSet={setBillReminder}
                          onSaveAlertSettings={updateReminderAlertSettings}
                          perBill
                          compact
                        />
                        <div className="settings-cheque-cancel-btns">
                          {collected > 0 ? (
                            <button
                              type="button"
                              className="btn btn-secondary settings-cheque-cancel-btn"
                              onClick={() => handleCancelSaleCheque(sale.id, relatedSaleIds)}
                            >
                              To credit
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                            onClick={() =>
                              handleCancelSaleChequeAsUnpaid(sale.id, relatedSaleIds)
                            }
                          >
                            Cancel all · unpaid
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {pendingChequeCancelStatus ? (
                <p className="settings-cheque-cancel-status">{pendingChequeCancelStatus}</p>
              ) : null}
            </section>

            <section className="settings-cheque-cancel">
              <div className="settings-cheque-cancel-head">
                <h3>Approved cheques</h3>
                <p>
                  Each partial approval is its own cheque (1st / 2nd / 3rd). Change the sales date so
                  History and that day’s sales move with it. <strong>Save date</strong> updates one
                  cheque; <strong>Update all dates</strong> applies the same day to every cheque on
                  that bill. Cancel cheque removes only that slice. <strong>Cancel all · unpaid</strong>{' '}
                  removes the whole bill as if nothing was paid.
                </p>
              </div>
              {approvedCheques.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No approved cheques.</p>
              ) : filteredApprovedChequesByCustomer.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No approved cheques match your search.</p>
              ) : (
                <div className="settings-cheque-cancel-groups">
                  {filteredApprovedChequesByCustomer.map((group) => (
                    <div key={group.name} className="settings-cheque-cancel-group">
                      <h4 className="settings-cheque-cancel-group-title">{group.name}</h4>
                      <ul className="settings-cheque-cancel-list">
                        {group.entries.map((entry, entryIndex) => {
                          const dateDraft =
                            chequeDateDrafts[entry.id] ?? isoToDateInputValue(entry.at)
                          const isFirstOfBill =
                            group.entries.findIndex((e) => e.saleId === entry.saleId) ===
                            entryIndex
                          return (
                            <li
                              key={entry.id}
                              className="settings-cheque-cancel-item settings-cheque-cancel-item--stack"
                            >
                              <div className="settings-cheque-cancel-meta">
                                <span className="settings-cheque-cancel-amount">
                                  {entry.partLabel ? `${entry.partLabel} · ` : ''}
                                  Cheque {formatMoney(entry.amount)}
                                </span>
                                {entry.openBalance > 0 ? (
                                  <span className="settings-cheque-cancel-sub">
                                    Bill {formatMoney(entry.billTotal)} − In bank{' '}
                                    {formatMoney(
                                      Math.max(0, entry.billTotal - entry.openBalance),
                                    )}{' '}
                                    = Open {formatMoney(entry.openBalance)}
                                  </span>
                                ) : (
                                  <span className="settings-cheque-cancel-sub">
                                    Bill {formatMoney(entry.billTotal)} · Fully cleared
                                  </span>
                                )}
                                <span className="settings-cheque-cancel-sub">
                                  {entry.label} · {formatDate(entry.at)}
                                </span>
                              </div>
                              <div className="settings-cheque-cancel-actions">
                                <label className="settings-cheque-date-field">
                                  <span>Sales date</span>
                                  <input
                                    type="date"
                                    value={dateDraft}
                                    onChange={(e) =>
                                      setChequeDateDrafts((prev) => ({
                                        ...prev,
                                        [entry.id]: e.target.value,
                                      }))
                                    }
                                    aria-label={`Sales date for ${entry.partLabel || 'cheque'} · ${group.name}`}
                                  />
                                </label>
                                <div className="settings-cheque-cancel-btns">
                                  <button
                                    type="button"
                                    className="btn btn-secondary settings-cheque-cancel-btn"
                                    onClick={() => handleUpdateApprovedChequeDate(entry, false)}
                                  >
                                    Save date
                                  </button>
                                  {isFirstOfBill ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary settings-cheque-cancel-btn"
                                      onClick={() => handleUpdateApprovedChequeDate(entry, true)}
                                    >
                                      Update all dates
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                                    onClick={() =>
                                      handleCancelApprovedCheque(entry.saleId, entry.eventIndex)
                                    }
                                  >
                                    Cancel cheque
                                  </button>
                                  {isFirstOfBill ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                                      onClick={() =>
                                        handleCancelSaleChequeAsUnpaid(entry.saleId, [
                                          entry.saleId,
                                        ])
                                      }
                                    >
                                      Cancel all · unpaid
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {chequeCancelStatus ? (
                <p className="settings-cheque-cancel-status">{chequeCancelStatus}</p>
              ) : null}
            </section>

            <section className="settings-cheque-cancel settings-trash-bin">
              <div className="settings-cheque-cancel-head">
                <h3>Recycle bin</h3>
                <p>
                  Deleted bills, expenses, and loans are kept here. Restore if deleted by mistake, or
                  delete forever.
                </p>
              </div>
              {trashItems.length === 0 ? (
                <p className="settings-cheque-cancel-empty">Recycle bin is empty.</p>
              ) : (
                <>
                  <div className="settings-trash-actions">
                    <button
                      type="button"
                      className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                      onClick={() => {
                        if (!window.confirm(`Empty recycle bin (${trashItems.length} items)?`)) return
                        emptyTrash()
                        setTrashStatus('Recycle bin emptied.')
                      }}
                    >
                      Empty bin
                    </button>
                  </div>
                  <ul className="settings-cheque-cancel-list">
                    {trashItems.map((row) => (
                      <li key={`${row.kind}-${row.id}`} className="settings-cheque-cancel-item settings-cheque-cancel-item--stack">
                        <div className="settings-cheque-cancel-meta">
                          <strong>{row.label}</strong>
                          <span className="settings-cheque-cancel-amount">
                            {row.kind === 'sale' ? 'Bill' : row.kind === 'expense' ? 'Expense' : 'Loan'}{' '}
                            · {formatMoney(row.amount)}
                          </span>
                          <span className="settings-cheque-cancel-sub">
                            Deleted {formatDate(row.deletedAt)}
                          </span>
                        </div>
                        <div className="settings-cheque-cancel-btns">
                          <button
                            type="button"
                            className="btn btn-secondary settings-cheque-cancel-btn"
                            onClick={() => {
                              restoreTrashRecord(row.kind, row.id)
                              setTrashStatus(`Restored ${row.label}.`)
                            }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary settings-cheque-cancel-btn settings-cheque-cancel-btn--danger"
                            onClick={() => {
                              if (!window.confirm(`Delete ${row.label} forever?`)) return
                              purgeTrashRecord(row.kind, row.id)
                              setTrashStatus(`Removed ${row.label} from recycle bin.`)
                            }}
                          >
                            Delete forever
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {trashStatus ? <p className="settings-cheque-cancel-status">{trashStatus}</p> : null}
            </section>
            </div>

            {pinError && <p className="settings-pin-error">{pinError}</p>}
            <div className="settings-general-footer">
            <div className="settings-keyboard-wrap">
              <NumberKeyboard onPress={handleNumpad} showEnter={false} />
            </div>
            <button
              type="button"
              className={`btn btn-primary settings-save-btn ${saved ? 'btn-saved' : ''}`}
              onClick={handleSave}
            >
              {saved ? '✓ Saved!' : 'Save Settings'}
            </button>
            <p className="settings-note">PIN default 0000. Leave PIN empty to keep current.</p>
            </div>
          </div>
        )}

        {tab === 'tally' && (
          <div className="settings-scroll" ref={tallyScrollRef}>
            <section className="settings-panel settings-tally">
              <div className="settings-header">
                <h2>Tally Prime</h2>
                <p>Direct API — party name &amp; bill amount → Pending Bills</p>
              </div>

              <label className="settings-backup-field">
                <span>Tally API URL</span>
                <input
                  type="url"
                  value={tallyUrl}
                  onChange={(e) => setTallyUrl(e.target.value)}
                  placeholder="http://localhost:9999"
                  autoCapitalize="none"
                />
              </label>
              <p className="settings-backup-meta">
                Tally Prime → <strong>F12</strong> → enable HTTP server (port <strong>9000</strong> or{' '}
                <strong>9999</strong>). Example: <code>http://192.168.1.99:9999</code>
              </p>

              <span className="settings-backup-form-label">Bills from Tally</span>
              <div className="settings-tally-scopes" role="group" aria-label="Tally date range">
                {TALLY_SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`settings-tally-scope ${tallyScope === opt.id ? 'settings-tally-scope--active' : ''}`}
                    onClick={() => setTallyScope(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="settings-backup-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={tallyBusy || !tallyUrl.trim()}
                  onClick={() => void handleTallyTest()}
                >
                  Test connection
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={tallyBusy || !tallyUrl.trim()}
                  onClick={() => void handleTallySaveSync()}
                >
                  Save &amp; sync now
                </button>
              </div>

              <div className="settings-tally-manual">
                <span className="settings-backup-form-label">Manual pending (if API fails)</span>
                <label className="settings-backup-field">
                  <span>Customer / party name</span>
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Name from Tally bill"
                  />
                </label>
                <label className="settings-backup-field">
                  <span>Bill amount</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    placeholder="Amount"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!manualAmount.trim()}
                  onClick={handleManualPending}
                >
                  Add to Pending
                </button>
              </div>

              {tallyStatus && (
                <p className={`settings-backup-status ${tallyError ? 'settings-backup-status--error' : ''}`}>
                  {tallyStatus}
                </p>
              )}
            </section>
          </div>
        )}

        {tab === 'pinelabs' && (
          <div className="settings-scroll" ref={pinelabsScrollRef}>
            <section className="settings-panel settings-pinelabs">
              <div className="settings-header">
                <h2>Pine Labs</h2>
                <p>Cloud POS — send bill to Plutus terminal for card / UPI payment</p>
              </div>

              <label className="settings-backup-toggle">
                <input
                  type="checkbox"
                  checked={pineLabs.enabled}
                  onChange={(e) => updatePineLabsField('enabled', e.target.checked)}
                />
                <span>Enable Pine Labs payments</span>
              </label>

              <span className="settings-backup-form-label">Environment</span>
              <div className="settings-tally-scopes" role="group" aria-label="Pine Labs environment">
                {PINELABS_ENV_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`settings-tally-scope ${pineLabs.environment === opt.id ? 'settings-tally-scope--active' : ''}`}
                    onClick={() => updatePineLabsField('environment', opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="settings-backup-meta">
                API host: <code>{getPineLabsBaseUrl(pineLabs.environment)}</code>
              </p>

              <label className="settings-backup-field">
                <span>Merchant ID</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pineLabs.merchantId}
                  onChange={(e) => updatePineLabsField('merchantId', e.target.value)}
                  placeholder="From Pine Labs onboarding"
                  autoCapitalize="none"
                />
              </label>
              <label className="settings-backup-field">
                <span>Security token</span>
                <input
                  type="password"
                  value={pineLabs.securityToken}
                  onChange={(e) => updatePineLabsField('securityToken', e.target.value)}
                  placeholder="Token from Pine Labs"
                  autoCapitalize="none"
                  autoComplete="off"
                />
              </label>
              <label className="settings-backup-field">
                <span>Store ID</span>
                <input
                  type="text"
                  value={pineLabs.storeId}
                  onChange={(e) => updatePineLabsField('storeId', e.target.value)}
                  placeholder="e.g. 61607"
                  autoCapitalize="none"
                />
              </label>
              <label className="settings-backup-field">
                <span>Merchant store POS code (optional)</span>
                <input
                  type="text"
                  value={pineLabs.merchantStorePosCode}
                  onChange={(e) => updatePineLabsField('merchantStorePosCode', e.target.value)}
                  placeholder="5-char store + 3-digit POS, e.g. MP123015"
                  autoCapitalize="none"
                />
              </label>
              <p className="settings-backup-meta">
                Use <strong>Store ID</strong> or <strong>Merchant store POS code</strong> — whichever Pine Labs
                gave you.
              </p>

              <label className="settings-backup-field">
                <span>Client ID / IMEI (optional)</span>
                <input
                  type="text"
                  value={pineLabs.clientId}
                  onChange={(e) => updatePineLabsField('clientId', e.target.value)}
                  placeholder="Device IMEI registered with Pine Labs"
                  autoCapitalize="none"
                />
              </label>
              <label className="settings-backup-field">
                <span>Cashier ID (optional)</span>
                <input
                  type="text"
                  value={pineLabs.userId}
                  onChange={(e) => updatePineLabsField('userId', e.target.value)}
                  placeholder="Shown on terminal receipt"
                />
              </label>

              <span className="settings-backup-form-label">Default payment mode on terminal</span>
              <div className="settings-tally-scopes" role="group" aria-label="Pine Labs payment mode">
                {PINELABS_PAYMENT_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`settings-tally-scope ${pineLabs.allowedPaymentMode === opt.id ? 'settings-tally-scope--active' : ''}`}
                    onClick={() => updatePineLabsField('allowedPaymentMode', opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <p className="settings-backup-meta">
                Credentials come from Pine Labs after merchant onboarding. After saving, use{' '}
                <strong>Test connection</strong> while running the app locally (<code>npm run dev</code> or{' '}
                <code>npm run preview</code>). Enter the PTRID on the Plutus terminal to collect payment.
              </p>

              <div className="settings-backup-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pineLabsBusy}
                  onClick={() => void handlePineLabsTest()}
                >
                  Test connection
                </button>
                <button type="button" className="btn btn-primary" disabled={pineLabsBusy} onClick={handlePineLabsSave}>
                  Save settings
                </button>
              </div>

              {pineLabsStatus && (
                <p className={`settings-backup-status ${pineLabsError ? 'settings-backup-status--error' : ''}`}>
                  {pineLabsStatus}
                </p>
              )}
            </section>
          </div>
        )}

        {tab === 'cloud' && (
          <div className="settings-scroll" ref={cloudScrollRef}>
          <section className="settings-panel">
            <div className="settings-header">
              <h2>Cloud Username</h2>
              <p>Create or open — same username loads same data</p>
            </div>
            <p className="settings-backup-meta">Firebase · cash-counter-84178</p>
            {cloudUser && (
              <div className="settings-backup-open">
                <p className="settings-backup-signed-in">Open · {getCloudUsername(cloudUser)}</p>
                <div className="settings-backup-summary">
                  <span>This device: {data.sales.length} bills</span>
                  <span>{data.expenses.length} records</span>
                  <span>Cash {formatMoney(getCurrentBalance(data))}</span>
                  <span>Bank {formatMoney(getBankBalance(data))}</span>
                </div>
                {cloudRemoteSummary ? (
                  <div className="settings-backup-summary settings-backup-summary--cloud">
                    <span>Cloud backup: {cloudRemoteSummary.bills} bills</span>
                    <span>{cloudRemoteSummary.records} records</span>
                    <span>Cash {formatMoney(cloudRemoteSummary.cash)}</span>
                    <span>Bank {formatMoney(cloudRemoteSummary.bank)}</span>
                    <span className="settings-backup-summary-time">
                      Last saved {new Date(cloudRemoteSummary.backupAt).toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <p className="settings-backup-meta">Loading cloud backup info…</p>
                )}
                {cloudRemoteSummary &&
                  mainBillingDevice &&
                  (cloudRemoteSummary.bills !== data.sales.length ||
                    cloudRemoteSummary.records !== data.expenses.length ||
                    cloudRemoteSummary.cash !== getCurrentBalance(data) ||
                    cloudRemoteSummary.bank !== getBankBalance(data)) && (
                    <p className="settings-backup-meta settings-backup-meta--warn">
                      This device differs from cloud — tap Save to cloud on this main device.
                    </p>
                  )}
                {cloudRemoteSummary &&
                  !mainBillingDevice &&
                  (cloudRemoteSummary.bills !== data.sales.length ||
                    cloudRemoteSummary.records !== data.expenses.length ||
                    cloudRemoteSummary.cash !== getCurrentBalance(data) ||
                    cloudRemoteSummary.bank !== getBankBalance(data)) && (
                    <p className="settings-backup-meta settings-backup-meta--warn">
                      This device differs from cloud — tap Load from cloud to match{' '}
                      {formatMoney(cloudRemoteSummary.cash)} cash.
                    </p>
                  )}
                <label className="settings-backup-toggle">
                  <input
                    type="checkbox"
                    checked={mainBillingDevice}
                    onChange={toggleMainBillingDevice}
                  />
                  Main billing device (only this device saves to cloud)
                </label>
                {!mainBillingDevice && (
                  <p className="settings-backup-meta">
                    View-only device — sign in with your username and full cloud data loads
                    automatically. Do not turn on Main billing device here.
                  </p>
                )}
                <label className="settings-backup-toggle">
                  <input
                    type="checkbox"
                    checked={autoBackup}
                    disabled={!mainBillingDevice}
                    onChange={toggleAutoBackup}
                  />
                  Auto backup all data on every change
                </label>
                <label className="settings-backup-toggle">
                  <input type="checkbox" checked={autoPull} onChange={toggleAutoPull} />
                  Auto load from cloud
                </label>
                {!mainBillingDevice ? (
                  <p className="settings-backup-meta">
                    This device is not main billing — cloud data loads automatically when you sign
                    in and when cloud updates.
                  </p>
                ) : !autoPull ? (
                  <p className="settings-backup-meta">
                    Main device: data loads from local storage for speed. Cloud is backed up
                    automatically; auto load off keeps local cash stable until you tap Load from
                    cloud.
                  </p>
                ) : (
                  <p className="settings-backup-meta">
                    Main device will also pull newer cloud data automatically.
                  </p>
                )}
                <div className="settings-backup-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={backupBusy || !firebaseBuilt || !mainBillingDevice}
                    onClick={() => void handleBackupNow()}
                  >
                    Save to cloud
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={backupBusy || !firebaseBuilt}
                    onClick={() => void handleLoadFromCloud()}
                  >
                    Load from cloud
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={backupBusy}
                    onClick={() => void handleCloudLogout()}
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
            <div className="settings-backup-form">
              <label className="settings-backup-field">
                <span>Cloud Username</span>
                <input
                  type="text"
                  value={cloudUsername}
                  onChange={(e) => setCloudUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="e.g. shalimar"
                  autoCapitalize="none"
                />
              </label>
              <label className="settings-backup-field">
                <span>Cloud Password</span>
                <input
                  type="password"
                  value={cloudPassword}
                  onChange={(e) => setCloudPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Min 6 characters"
                />
              </label>
              <div className="settings-backup-actions settings-backup-actions--create">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={backupBusy || !cloudUsername.trim() || cloudPassword.length < 6}
                  onClick={() => void handleCloudCreate()}
                >
                  Create username
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={backupBusy || !cloudUsername.trim() || cloudPassword.length < 6}
                  onClick={() => void handleCloudOpen()}
                >
                  Import
                </button>
              </div>
            </div>
            {backupStatus && (
              <p className={`settings-backup-status ${backupError ? 'settings-backup-status--error' : ''}`}>
                {backupStatus}
              </p>
            )}
          </section>
          </div>
        )}

        {tab === 'website' && (
          <div ref={websiteScrollRef}>
            <Suspense fallback={<p className="settings-backup-meta">Loading Website API…</p>}>
              <WebsiteApiSettings data={data} cloudLoggedIn={Boolean(cloudUser)} />
            </Suspense>
          </div>
        )}
      </div>

      {billEditOpen ? (
        <div
          className="settings-bill-edit-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Edit bills"
          onClick={() => setBillEditOpen(false)}
        >
          <div className="settings-bill-edit-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-bill-edit-panel-head">
              <div>
                <h3>Open bills</h3>
                <p>
                  {billEditMode
                    ? 'Edit mode on · tap Edit date or Open bill'
                    : 'Edit mode off · turn on in Settings to edit date'}
                </p>
              </div>
              <label className="settings-bill-edit-toggle settings-bill-edit-toggle--compact">
                <span className="settings-bill-edit-toggle-label">Edit</span>
                <span className="settings-bill-edit-toggle-switch">
                  <input
                    type="checkbox"
                    checked={billEditMode}
                    onChange={toggleBillEditMode}
                    aria-label="Bill edit mode"
                  />
                  <span className="settings-bill-edit-toggle-track" aria-hidden="true" />
                </span>
              </label>
              <button
                type="button"
                className="settings-bill-edit-close"
                onClick={() => setBillEditOpen(false)}
                aria-label="Close bill list"
              >
                ✕
              </button>
            </div>

            <div className="settings-bill-edit-toolbar">
              <input
                type="search"
                className="settings-bill-edit-search"
                value={billEditSearch}
                onChange={(e) => setBillEditSearch(e.target.value)}
                placeholder="Search customer, amount, date…"
                autoComplete="off"
              />
              <div className="settings-bill-edit-filters" role="group" aria-label="Bill status">
                {BILL_EDIT_FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`settings-bill-edit-filter ${billEditFilter === opt.id ? 'settings-bill-edit-filter--active' : ''}`}
                    onClick={() => setBillEditFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {billEditItems.length === 0 ? (
              <p className="settings-bill-edit-empty">No bills match your search.</p>
            ) : (
              <ul
                className="settings-bill-edit-list settings-bill-edit-list--panel"
                ref={billEditListRef}
              >
                {billEditItems.map((item) => {
                  const isEditingDate = editingBillDateId === item.id
                  const pending = billIsPending(item, data.sales)
                  const isCredit = billIsPendingCredit(data.sales, item.id)
                  const isBalance = billIsPendingBalance(data.sales, item.id)
                  const sale = data.sales.find((s) => s.id === item.id)
                  const collected = sale ? saleCollectedAmount(sale) : 0
                  const total = sale?.originalBillAmount ?? item.originalBillAmount ?? item.amount
                  const createType = sale ? saleBillCreatePayType(sale) : item.paymentMode ?? 'cash'
                  const createTypeLabel =
                    BILL_CREATE_TYPE_OPTIONS.find((opt) => opt.value === createType)?.label ??
                    getHistoryPaymentLabel(
                      createType === 'cash' ||
                        createType === 'bank' ||
                        createType === 'credit' ||
                        createType === 'cheque'
                        ? createType
                        : 'pending',
                    )
                  const billCreatedIso = item.billCreatedAt ?? sale?.createdAt ?? item.date
                  const statusLabel = pending ? 'Pending' : 'Paid'

                  return (
                    <li key={item.id} className="settings-bill-edit-item">
                      {isEditingDate ? (
                        <form
                          className="settings-bill-edit-form"
                          onSubmit={(e) => {
                            e.preventDefault()
                            saveBillDateEdit(item)
                          }}
                        >
                          <label className="settings-bill-edit-field">
                            <span>Bill date</span>
                            <div className="settings-bill-edit-datetime">
                              <input
                                type="date"
                                value={editBillDate}
                                onChange={(e) => setEditBillDate(e.target.value)}
                              />
                              <input
                                type="time"
                                value={editBillTime}
                                onChange={(e) => setEditBillTime(e.target.value)}
                              />
                            </div>
                          </label>
                          <p className="settings-bill-edit-note">
                            Updates when this bill appears in History and Today Sales. Split bills
                            update the whole group.
                          </p>
                          <div className="settings-bill-edit-form-actions">
                            <button type="submit" className="btn btn-primary settings-bill-edit-save">
                              Save date
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary settings-bill-edit-cancel"
                              onClick={cancelBillDateEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                      <div className="settings-bill-edit-meta">
                        <strong>{item.name?.trim() || '—'}</strong>
                        <span className="settings-bill-edit-sub">
                          {createTypeLabel} · {statusLabel} · Created {formatDate(billCreatedIso)}
                        </span>
                      </div>
                      <div className="settings-bill-edit-amount-box">
                        <span className="settings-bill-edit-amount-label">
                          {isBalance && collected > 0 ? 'Open balance' : 'Bill amount'}
                        </span>
                        <strong>
                          {isBalance && collected > 0
                            ? `${formatMoney(collected)} paid · ${formatMoney(sale?.billAmount ?? item.amount)} open`
                            : formatMoney(total)}
                        </strong>
                        {isBalance ? (
                          <span className="settings-bill-edit-sub">Total {formatMoney(total)}</span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-primary settings-bill-edit-btn"
                          onClick={() => openBillInCounter(item)}
                        >
                          Open bill
                        </button>
                        {billEditMode ? (
                          <button
                            type="button"
                            className="btn btn-secondary settings-bill-edit-btn"
                            onClick={() => startBillDateEdit(item)}
                          >
                            Edit date
                          </button>
                        ) : null}
                        {billEditMode && isCredit ? (
                          <button
                            type="button"
                            className="btn btn-secondary settings-bill-edit-btn"
                            onClick={() => handleCancelSaleCredit(item.id, item.groupSaleIds)}
                          >
                            Cancel credit
                          </button>
                        ) : null}
                      </div>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {billEditStatus && billEditOpen ? (
              <p className="settings-bill-edit-status">{billEditStatus}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
