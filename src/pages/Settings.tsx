import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import { isFirebaseConfigured } from '../firebase/config'
import { getLastCloudUsername } from '../firebase/cloudUser'
import {
  createCloudAccount,
  getCloudUsername,
  getLocalLastBackupTime,
  getRemoteLastBackupTime,
  isAutoBackupEnabled,
  loginCloud,
  logoutCloud,
  restoreAppData,
  setAutoBackupEnabled,
  subscribeToAuth,
} from '../firebase/backup'
import { backupNow, setBackupStatusListener } from '../firebase/sync'
import type { AppData } from '../types'
import { getApprovedChequeAmount, listApprovedCheques, listPendingCreditSales, saleBillCreatePayType, type BillCreatePayType } from '../storage/database'
import {
  dateTimeInputValuesToIso,
  formatMoney,
  formatDate,
  isoToDateInputValue,
  isoToTimeInputValue,
  parseAmount,
} from '../utils/format'
import { buildHistoryItems, getHistoryPaymentLabel, historyItemSortTime, matchesHistorySearch, type HistoryItem } from '../utils/historyItems'
import { saleCollectedAmount } from '../utils/salePayment'
import { counterBillPath, resolveHistoryItemBillId } from '../utils/counterBillRoute'
import { readBillEditMode, writeBillEditMode } from '../utils/billEditMode'
import { downloadFullHistoryReport, printFullHistoryReportPdf } from '../utils/historyReport'
import { testTallyConnection, type TallyDateScope } from '../tally/localSource'
import { applyNumpadAction, applyPinAction, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import './Settings.css'

type SettingsField = 'openingCash' | 'openingBank' | 'pin' | 'pinConfirm'
type SettingsTab = 'general' | 'tally' | 'cloud'

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'tally', label: 'Tally' },
  { id: 'cloud', label: 'Cloud' },
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

export default function Settings() {
  const {
    data,
    balance,
    bankBalance,
    updateOpeningBalance,
    updateOpeningBankBalance,
    updateHomePin,
    replaceAllData,
    resetAllData,
    recordSale,
    getTallyApiUrl,
    getTallyDateScope,
    saveTallyApiUrl,
    saveTallyDateScope,
    syncTallyBills,
    cancelApprovedCheque,
    cancelSaleCredit,
    updateSaleBill,
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
  const [backupStatus, setBackupStatus] = useState('')
  const [backupError, setBackupError] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(getLocalLastBackupTime())

  const [tallyUrl, setTallyUrl] = useState(() => getTallyApiUrl() || 'http://localhost:9999')
  const [tallyScope, setTallyScope] = useState<TallyDateScope>(() => getTallyDateScope())
  const [tallyStatus, setTallyStatus] = useState('')
  const [tallyError, setTallyError] = useState(false)
  const [tallyBusy, setTallyBusy] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [chequeCancelStatus, setChequeCancelStatus] = useState('')
  const [creditCancelStatus, setCreditCancelStatus] = useState('')
  const [historyReportStatus, setHistoryReportStatus] = useState('')
  const [billEditSearch, setBillEditSearch] = useState('')
  const [billEditFilter, setBillEditFilter] = useState<BillEditFilter>('all')
  const [billEditOpen, setBillEditOpen] = useState(false)
  const [billEditMode, setBillEditMode] = useState(() => readBillEditMode())
  const [editingBillDateId, setEditingBillDateId] = useState<string | null>(null)
  const [editBillDate, setEditBillDate] = useState('')
  const [editBillTime, setEditBillTime] = useState('')
  const [billEditStatus, setBillEditStatus] = useState('')

  const approvedCheques = useMemo(() => listApprovedCheques(data), [data.sales])
  const pendingCreditSales = useMemo(() => listPendingCreditSales(data), [data.sales])
  const historyRecordCount = useMemo(() => buildHistoryItems(data).length, [data])
  const billEditItems = useMemo(() => {
    return buildHistoryItems(data)
      .filter((item) => item.type === 'sale')
      .filter((item) => {
        if (billEditFilter === 'all') return true
        const pending = billIsPending(item, data.sales)
        return billEditFilter === 'pending' ? pending : !pending
      })
      .filter((item) => matchesHistorySearch(item, billEditSearch))
      .sort((a, b) => historyItemSortTime(b) - historyItemSortTime(a))
  }, [data, billEditFilter, billEditSearch])

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
        const remote = await getRemoteLastBackupTime().catch(() => null)
        if (remote) setLastBackup(remote)
      }
    })
  }, [firebaseBuilt])

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
  useNumpadKeyboard((action) => numpadHandlerRef.current(action))

  function historyReportMeta() {
    return {
      exportedAt: new Date().toISOString(),
      openingCash: data.openingBalance,
      openingBank: data.openingBankBalance ?? 0,
      currentCash: balance,
      currentBank: bankBalance,
    }
  }

  function handleDownloadHistoryReport() {
    downloadFullHistoryReport(data, historyReportMeta())
    setHistoryReportStatus(`CSV downloaded · ${historyRecordCount} records`)
    setTimeout(() => setHistoryReportStatus(''), 4000)
  }

  function handlePrintHistoryReportPdf() {
    printFullHistoryReportPdf(data, historyReportMeta())
    setHistoryReportStatus(`PDF ready · ${historyRecordCount} records · choose Save as PDF`)
    setTimeout(() => setHistoryReportStatus(''), 5000)
  }

  function handleCancelApprovedCheque(id: string) {
    cancelApprovedCheque(id)
    setChequeCancelStatus('Cheque approval cancelled — moved back to pending.')
    setTimeout(() => setChequeCancelStatus(''), 2400)
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
    return `${snapshot.sales.length} bills · ${snapshot.expenses.length} records · cash ${formatMoney(snapshot.openingBalance)} · bank ${formatMoney(snapshot.openingBankBalance ?? 0)}`
  }

  function applyCloudDataToForm(snapshot: AppData) {
    replaceAllData(snapshot)
    setOpeningStr(String(snapshot.openingBalance))
    setOpeningBankStr(String(snapshot.openingBankBalance ?? 0))
  }

  async function loadCloudDataAfterAuth(isNewAccount: boolean) {
    const restored = await restoreAppData()
    if (restored) {
      applyCloudDataToForm(restored)
      const remote = await getRemoteLastBackupTime().catch(() => null)
      if (remote) setLastBackup(remote)
      setBackupStatus(`Opened · full data loaded · ${cloudDataSummary(restored)}`)
      return
    }
    if (isNewAccount) {
      const at = await backupNow(data)
      setLastBackup(at)
      setBackupStatus(`Username created · ${cloudDataSummary(data)} saved to cloud`)
      return
    }
    setBackupStatus('No cloud data yet for this username.')
    setBackupError(true)
  }

  async function handleCloudCreate() {
    setBackupBusy(true)
    setBackupError(false)
    try {
      if (cloudUser) {
        await logoutCloud()
        resetAllData()
        setOpeningStr('0')
        setOpeningBankStr('0')
        setCloudUser(null)
      }
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
      if (cloudUser) {
        await logoutCloud()
        resetAllData()
        setOpeningStr('0')
        setOpeningBankStr('0')
        setCloudUser(null)
      }
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
      const at = await backupNow(data)
      setLastBackup(at)
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Backup failed')
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
      setOpeningStr('0')
      setOpeningBankStr('0')
      setCloudUser(null)
      setCloudPassword('')
      setLastBackup(null)
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
    recordSale({
      billAmount: amount,
      paidAmount: 0,
      changeAmount: 0,
      payType: 'credit',
      pendingPayType: 'credit',
      status: 'pending',
      customerName: name || undefined,
    })
    setManualName('')
    setManualAmount('')
    setTallyStatus(`Added pending bill${name ? ` · ${name}` : ''} · ${formatMoney(amount)}`)
    setTallyError(false)
  }

  return (
    <div className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
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

      <div className={`settings-body ${tab === 'general' ? 'settings-body--general' : ''}`}>
        {tab === 'general' && (
          <div className="settings-general">
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
                <h3>Pending credit bills</h3>
                <p>
                  Cancel removes open credit. Unpaid bills are deleted; partial payments are kept as
                  collected.
                </p>
              </div>
              {pendingCreditSales.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No open credit bills.</p>
              ) : (
                <ul className="settings-cheque-cancel-list">
                  {pendingCreditSales.map((sale) => {
                    const collected = saleCollectedAmount(sale)
                    const total = sale.originalBillAmount ?? sale.billAmount + collected
                    const when = sale.updatedAt ?? sale.createdAt
                    const relatedSaleIds = sale.parentSplitId
                      ? [sale.parentSplitId, sale.id]
                      : [sale.id]
                    return (
                      <li key={sale.id} className="settings-cheque-cancel-item">
                        <div className="settings-cheque-cancel-meta">
                          <strong>{sale.customerName?.trim() || '—'}</strong>
                          <span>
                            {collected > 0
                              ? `Paid ${formatMoney(collected)} · Credit ${formatMoney(sale.billAmount)}`
                              : formatMoney(sale.billAmount)}
                          </span>
                          <span className="settings-cheque-cancel-sub">
                            Bill {formatMoney(total)} · {formatDate(when)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary settings-cheque-cancel-btn"
                          onClick={() => handleCancelSaleCredit(sale.id, relatedSaleIds)}
                        >
                          Cancel
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {creditCancelStatus ? (
                <p className="settings-cheque-cancel-status">{creditCancelStatus}</p>
              ) : null}
            </section>

            <section className="settings-cheque-cancel">
              <div className="settings-cheque-cancel-head">
                <h3>Approved cheques</h3>
                <p>Cancel moves cheque back to pending and removes it from bank balance.</p>
              </div>
              {approvedCheques.length === 0 ? (
                <p className="settings-cheque-cancel-empty">No approved cheques.</p>
              ) : (
                <ul className="settings-cheque-cancel-list">
                  {approvedCheques.map((sale) => {
                    const amount = getApprovedChequeAmount(sale)
                    const when = sale.updatedAt ?? sale.createdAt
                    const label =
                      sale.payType === 'split'
                        ? 'Split · cheque → bank'
                        : sale.pendingPayType === 'credit'
                          ? 'Credit bill · cheque → bank'
                          : 'Cheque → bank'
                    return (
                      <li key={sale.id} className="settings-cheque-cancel-item">
                        <div className="settings-cheque-cancel-meta">
                          <strong>{sale.customerName?.trim() || '—'}</strong>
                          <span>{formatMoney(amount)}</span>
                          <span className="settings-cheque-cancel-sub">
                            {label} · {formatDate(when)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary settings-cheque-cancel-btn"
                          onClick={() => handleCancelApprovedCheque(sale.id)}
                        >
                          Cancel
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {chequeCancelStatus ? (
                <p className="settings-cheque-cancel-status">{chequeCancelStatus}</p>
              ) : null}
            </section>

            {pinError && <p className="settings-pin-error">{pinError}</p>}
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
        )}

        {tab === 'tally' && (
          <div className="settings-scroll">
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

        {tab === 'cloud' && (
          <div className="settings-scroll">
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
                  <span>{data.sales.length} bills</span>
                  <span>{data.expenses.length} records</span>
                  <span>Cash {formatMoney(balance)}</span>
                  <span>Bank {formatMoney(bankBalance)}</span>
                </div>
                <label className="settings-backup-toggle">
                  <input type="checkbox" checked={autoBackup} onChange={toggleAutoBackup} />
                  Auto backup on every change
                </label>
                {lastBackup && (
                  <p className="settings-backup-meta">
                    Last cloud save: {new Date(lastBackup).toLocaleString()}
                  </p>
                )}
                <div className="settings-backup-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={backupBusy || !firebaseBuilt}
                    onClick={() => void handleBackupNow()}
                  >
                    Save to cloud
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
                  Open
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
              <ul className="settings-bill-edit-list settings-bill-edit-list--panel">
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
