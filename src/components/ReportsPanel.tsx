import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData } from '../types'
import { usePageEscape } from '../hooks/usePageEscape'
import { formatDate, formatMoney } from '../utils/format'
import { formatCollectedSalesBreakdown, toInputDate, isOldCreditChequeClearedRow, type ReportSort, type SaleDateMode, type SalesBillRow } from '../utils/salesReport'
import {
  buildChequeReportItems,
  buildCreditReportItems,
  filterChequeReportItems,
  filterCreditReportItems,
  formatReportPresetLabel,
  isSingleDaySalesPreset,
  salesBillsForPreset,
  salesSameDaySummaryForPreset,
  sameDaySalesCollectedLabel,
  salesSummaryForPreset,
  salesFilterForPreset,
  summarizeChequeItems,
  summarizeCreditItems,
  summarizeNormalExpenses,
  summarizePurchases,
  type ReportDatePreset,
} from '../utils/reportsHub'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
} from '../utils/normalExpenseHistory'
import {
  buildPurchaseHistoryItems,
  filterPurchaseHistoryItems,
  groupPurchasesBySupplier,
  type PurchaseHistoryItem,
} from '../utils/purchaseHistory'
import { NO1_BILL_LABEL, NO2_BILL_LABEL } from '../utils/expenseBillLabels'
import Portal from './Portal'
import { PageBackButton, PageCloseButton, PageCorners } from './PageCorners'
import type { CreditReportItem, ChequeReportItem } from '../utils/reportsHub'
import type { NormalExpenseHistoryItem } from '../utils/normalExpenseHistory'
import { buildCreditOverview } from '../utils/customerLedger'
import {
  buildLoanOutflowHistoryItems,
  buildLoanReportItems,
  filterLoanOutflowHistoryItems,
  filterLoanReportItems,
  summarizeLoanOutflows,
  summarizeLoanReportItems,
  type LoanListItem,
  type LoanOutflowHistoryItem,
} from '../utils/loanLedger'
import {
  buildActiveChequeReminders,
  buildActiveCreditReminders,
  buildChequeBillReminders,
  buildCreditBillReminders,
  getReminderAlertSettings,
} from '../utils/billReminders'
import type { BillReminderItem } from '../utils/billReminders'
import '../pages/Reports.css'

export type ReportSection = 'all' | 'sales' | 'purchase' | 'expense' | 'credit' | 'cheque' | 'loan'

const DATE_PRESETS: { id: ReportDatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
]

const SECTION_TABS: { id: ReportSection; label: string }[] = [
  { id: 'all', label: '📊 All' },
  { id: 'sales', label: '💰 Sales' },
  { id: 'credit', label: '💳 Credit' },
  { id: 'purchase', label: '🛒 Purchase' },
  { id: 'expense', label: '📤 Expense' },
  { id: 'cheque', label: '🧾 Cheque' },
  { id: 'loan', label: '🤝 Loan' },
]

const SALES_DATE_MODE_OPTIONS: { id: SaleDateMode; label: string }[] = [
  { id: 'collected', label: 'Collected' },
  { id: 'created', label: 'Created' },
]

const SORT_OPTIONS: { id: ReportSort; label: string }[] = [
  { id: 'date-desc', label: 'New↓' },
  { id: 'date-asc', label: 'Old↑' },
  { id: 'amount-desc', label: 'High↓' },
  { id: 'amount-asc', label: 'Low↑' },
]

type CreditSort = 'date-desc' | 'date-asc' | 'pending-desc' | 'paid-desc'
type LoanSort = 'date-desc' | 'date-asc'

const LOAN_SORT_OPTIONS: { id: LoanSort; label: string }[] = [
  { id: 'date-desc', label: 'New↓' },
  { id: 'date-asc', label: 'Old↑' },
]

const CREDIT_SORT_OPTIONS: { id: CreditSort; label: string }[] = [
  { id: 'date-desc', label: 'New↓' },
  { id: 'date-asc', label: 'Old↑' },
  { id: 'pending-desc', label: 'Due↓' },
  { id: 'paid-desc', label: 'Paid↓' },
]

type SalesExpandPanel = 'collected' | 'withCredit' | 'sameDay' | 'oldCreditCheque'

function isWithCreditSaleRow(row: SalesBillRow): boolean {
  if (row.hasCreditOrCheque || row.hasCredit || row.hasCheque) return true
  if (row.creditPending > 0 || row.chequePending > 0) return true
  const hay = `${row.payLabel} ${row.detailLabel}`.toLowerCase()
  return hay.includes('credit') || hay.includes('cheque') || hay.includes('💳') || hay.includes('🧾')
}

function isPeriodWithCreditSaleRow(
  row: SalesBillRow,
  dateMode: SaleDateMode,
  fromDate?: string,
  toDate?: string,
): boolean {
  if (!isWithCreditSaleRow(row)) return false
  if (dateMode !== 'collected' || (!fromDate && !toDate)) return true
  const filter = { fromDate, toDate, dateMode: 'collected' as const }
  // Old credit/cheque cleared today → Old Credit & Cheque view, not main with-credit total/list.
  if (isOldCreditChequeClearedRow(row, filter)) return false
  // Pending opened this period, or edited this period without a part payment.
  if (row.creditPending > 0 || row.chequePending > 0) return true
  // Same-day credit/cheque bill collections (opened this period).
  const openedAt = row.chequeDate ?? row.creditDate ?? row.createdDate
  const createdDay = new Date(openedAt)
  const created = new Date(
    createdDay.getFullYear(),
    createdDay.getMonth(),
    createdDay.getDate(),
  ).getTime()
  if (fromDate) {
    const [y, m, d] = fromDate.split('-').map(Number)
    if (created < new Date(y, m - 1, d).getTime()) return false
  }
  if (toDate) {
    const [y, m, d] = toDate.split('-').map(Number)
    if (created > new Date(y, m - 1, d).getTime()) return false
  }
  return row.hasCheque || row.hasCredit
}

function isOldCreditChequeClearedTodayRow(
  row: SalesBillRow,
  dateMode: SaleDateMode,
  fromDate?: string,
  toDate?: string,
): boolean {
  if (dateMode !== 'collected' || (!fromDate && !toDate)) return false
  return isOldCreditChequeClearedRow(row, { fromDate, toDate, dateMode: 'collected' })
}

interface ReportsPanelProps {
  open: boolean
  onClose: () => void
  data: AppData
  initialPreset?: ReportDatePreset
  initialSelectedDate?: string
  initialSection?: ReportSection
  /** When set, only one report section is shown (e.g. Today Sales). */
  focusSection?: boolean
  onOpenCustomer?: (customerName: string) => void
}

export default function ReportsPanel({
  open,
  onClose,
  data,
  initialPreset = 'today',
  initialSelectedDate,
  initialSection,
  focusSection = Boolean(initialSection),
  onOpenCustomer,
}: ReportsPanelProps) {
  const [datePreset, setDatePreset] = useState<ReportDatePreset>(initialPreset)
  const [selectedDate, setSelectedDate] = useState(toInputDate())
  const [rangeTo, setRangeTo] = useState(toInputDate())
  const [activeSection, setActiveSection] = useState<ReportSection>(
    focusSection ? (initialSection ?? 'sales') : 'all',
  )
  const [salesSort, setSalesSort] = useState<ReportSort>('date-desc')
  const [salesDateMode, setSalesDateMode] = useState<SaleDateMode>('collected')
  const [creditSort, setCreditSort] = useState<CreditSort>('date-desc')
  const [loanSort, setLoanSort] = useState<LoanSort>('date-desc')
  const [expandedSalesPanel, setExpandedSalesPanel] = useState<SalesExpandPanel | null>('collected')
  const [selectedPurchaseSupplierKey, setSelectedPurchaseSupplierKey] = useState<string | null>(null)
  const [expandedReportKey, setExpandedReportKey] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setDatePreset(initialPreset)
    if (initialSection) setActiveSection(initialSection)
    else if (!focusSection) setActiveSection('all')
    if (initialPreset === 'date' && initialSelectedDate) {
      setSelectedDate(initialSelectedDate)
    } else if (initialPreset === 'date' || initialPreset === 'range') {
      setSelectedDate(toInputDate())
    }
    if ((initialSection ?? 'sales') === 'sales') {
      setExpandedSalesPanel('collected')
    } else {
      setExpandedSalesPanel(null)
    }
  }, [open, initialPreset, initialSection, initialSelectedDate])

  const salesBills = useMemo(
    () =>
      salesBillsForPreset(data, datePreset, selectedDate, salesSort, rangeTo, salesDateMode),
    [data, datePreset, selectedDate, salesSort, rangeTo, salesDateMode],
  )
  const salesTotals = useMemo(
    () =>
      salesSummaryForPreset(data, datePreset, selectedDate, rangeTo, salesDateMode),
    [data, datePreset, selectedDate, rangeTo, salesDateMode],
  )
  const overviewSalesTotals = useMemo(
    () => salesSummaryForPreset(data, datePreset, selectedDate, rangeTo, 'collected'),
    [data, datePreset, selectedDate, rangeTo],
  )
  const overviewSalesBills = useMemo(
    () => salesBillsForPreset(data, datePreset, selectedDate, 'date-desc', rangeTo, 'collected'),
    [data, datePreset, selectedDate, rangeTo],
  )
  const showSameDaySalesBox = isSingleDaySalesPreset(datePreset, selectedDate, rangeTo)
  const sameDaySales = useMemo(
    () =>
      showSameDaySalesBox
        ? salesSameDaySummaryForPreset(data, datePreset, selectedDate, rangeTo)
        : null,
    [data, datePreset, selectedDate, rangeTo, showSameDaySalesBox],
  )
  const sameDaySalesLabel = sameDaySalesCollectedLabel(datePreset, selectedDate, rangeTo)

  const sameDaySalesBills = useMemo(
    () =>
      showSameDaySalesBox
        ? salesBillsForPreset(
            data,
            datePreset,
            selectedDate,
            salesSort,
            rangeTo,
            'collected',
            { sameDayCreatedAndPaid: true },
          )
        : [],
    [data, datePreset, selectedDate, salesSort, rangeTo, showSameDaySalesBox],
  )

  const withCreditSalesBills = useMemo(() => {
    const filter = salesFilterForPreset(datePreset, selectedDate, rangeTo, salesDateMode)
    return salesBills.filter((row) =>
      isPeriodWithCreditSaleRow(row, salesDateMode, filter?.fromDate, filter?.toDate),
    )
  }, [salesBills, datePreset, selectedDate, rangeTo, salesDateMode])

  const oldCreditChequeBills = useMemo(() => {
    const filter = salesFilterForPreset(datePreset, selectedDate, rangeTo, salesDateMode)
    return salesBills.filter((row) =>
      isOldCreditChequeClearedTodayRow(row, salesDateMode, filter?.fromDate, filter?.toDate),
    )
  }, [salesBills, datePreset, selectedDate, rangeTo, salesDateMode])

  const showSalesCollectedAccordion =
    activeSection === 'sales' && salesDateMode === 'collected'

  useEffect(() => {
    if (activeSection === 'sales' && salesDateMode === 'collected') {
      setExpandedSalesPanel('collected')
    } else {
      setExpandedSalesPanel(null)
    }
  }, [datePreset, selectedDate, rangeTo, salesDateMode, activeSection])

  function toggleSalesPanel(panel: SalesExpandPanel) {
    setExpandedSalesPanel((current) => {
      const next = current === panel ? null : panel
      if (next) {
        requestAnimationFrame(() => {
          bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        })
      }
      return next
    })
  }

  const purchaseItems = useMemo(() => {
    const items = buildPurchaseHistoryItems(data)
    return filterPurchaseHistoryItems(items, datePreset, selectedDate, rangeTo)
  }, [data, datePreset, selectedDate, rangeTo])
  const purchaseTotals = useMemo(() => summarizePurchases(purchaseItems), [purchaseItems])
  const purchaseSupplierGroups = useMemo(
    () => groupPurchasesBySupplier(purchaseItems),
    [purchaseItems],
  )
  const selectedPurchaseSupplier = useMemo(() => {
    if (!selectedPurchaseSupplierKey) return null
    return purchaseSupplierGroups.find((group) => group.shopKey === selectedPurchaseSupplierKey) ?? null
  }, [selectedPurchaseSupplierKey, purchaseSupplierGroups])

  const expenseItems = useMemo(() => {
    const items = buildNormalExpenseHistoryItems(data)
    return filterNormalExpenseHistoryItems(items, datePreset, selectedDate, rangeTo)
  }, [data, datePreset, selectedDate, rangeTo])
  const expenseTotals = useMemo(() => summarizeNormalExpenses(expenseItems), [expenseItems])
  const loanOutflowItems = useMemo(() => {
    const items = buildLoanOutflowHistoryItems(data)
    return filterLoanOutflowHistoryItems(items, datePreset, selectedDate, rangeTo)
  }, [data, datePreset, selectedDate, rangeTo])
  const loanOutflowTotals = useMemo(
    () => summarizeLoanOutflows(loanOutflowItems),
    [loanOutflowItems],
  )
  const combinedExpenseTotal =
    expenseTotals.total + purchaseTotals.total + loanOutflowTotals.total

  const creditItems = useMemo(() => {
    const items = buildCreditReportItems(data)
    const filtered = filterCreditReportItems(items, datePreset, selectedDate, rangeTo)
    return [...filtered].sort((a, b) => {
      if (creditSort === 'date-asc') {
        return new Date(a.date).getTime() - new Date(b.date).getTime()
      }
      if (creditSort === 'pending-desc') {
        return b.pendingAmount - a.pendingAmount || new Date(b.date).getTime() - new Date(a.date).getTime()
      }
      if (creditSort === 'paid-desc') {
        return b.paidAmount - a.paidAmount || new Date(b.date).getTime() - new Date(a.date).getTime()
      }
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })
  }, [data, datePreset, selectedDate, rangeTo, creditSort])
  const creditTotals = useMemo(() => summarizeCreditItems(creditItems), [creditItems])

  const chequeItems = useMemo(() => {
    const items = buildChequeReportItems(data)
    return filterChequeReportItems(items, datePreset, selectedDate, rangeTo)
  }, [data, datePreset, selectedDate, rangeTo])
  const chequeTotals = useMemo(() => summarizeChequeItems(chequeItems), [chequeItems])

  const creditChequeOpenTotal = creditTotals.pendingTotal + chequeTotals.pendingTotal
  const showSection = (section: Exclude<ReportSection, 'all'>) =>
    activeSection === section || activeSection === 'all'

  const loanItems = useMemo(() => {
    const items = filterLoanReportItems(
      buildLoanReportItems(data),
      datePreset,
      selectedDate,
      rangeTo,
    )
    return [...items].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return loanSort === 'date-asc' ? ta - tb : tb - ta
    })
  }, [data, datePreset, selectedDate, rangeTo, loanSort])
  const loanTotals = useMemo(() => summarizeLoanReportItems(loanItems), [loanItems])

  const creditOverview = useMemo(() => buildCreditOverview(data), [data])
  const alertSettings = useMemo(() => getReminderAlertSettings(data), [data])
  const activeCreditAlerts = useMemo(() => buildActiveCreditReminders(data), [data])
  const activeChequeAlerts = useMemo(() => buildActiveChequeReminders(data), [data])
  const scheduledCreditReminders = useMemo(() => buildCreditBillReminders(data), [data])
  const scheduledChequeReminders = useMemo(() => buildChequeBillReminders(data), [data])

  const periodLabel = formatReportPresetLabel(datePreset, selectedDate, rangeTo)
  const showAllSections = !focusSection
  const visibleSection = focusSection ? activeSection : activeSection

  const activeAlertCount =
    activeSection === 'credit'
      ? activeCreditAlerts.length
      : activeSection === 'cheque'
        ? activeChequeAlerts.length
        : 0
  const hasCreditAlertsPanel =
    activeSection === 'credit' &&
    (scheduledCreditReminders.length > 0 || creditOverview.customerCount > 0)
  const hasChequeAlertsPanel =
    activeSection === 'cheque' && scheduledChequeReminders.length > 0

  const handleReportsBack = useCallback(() => {
    if (selectedPurchaseSupplierKey) {
      setSelectedPurchaseSupplierKey(null)
      setExpandedReportKey(null)
      bodyRef.current?.scrollTo({ top: 0 })
      return
    }
    onClose()
  }, [selectedPurchaseSupplierKey, onClose])

  usePageEscape(handleReportsBack, open)

  function selectSection(section: ReportSection) {
    setActiveSection(section)
    setSelectedPurchaseSupplierKey(null)
    setExpandedReportKey(null)
    bodyRef.current?.scrollTo({ top: 0 })
  }

  function toggleReportExpand(key: string) {
    setExpandedReportKey((current) => {
      const next = current === key ? null : key
      if (next) {
        requestAnimationFrame(() => {
          bodyRef.current
            ?.querySelector(`[data-report-key="${CSS.escape(next)}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        })
      }
      return next
    })
  }

  if (!open) return null

  function setYesterdayToTodayRange() {
    const today = toInputDate()
    const y = new Date()
    y.setDate(y.getDate() - 1)
    setSelectedDate(toInputDate(y))
    setRangeTo(today)
    setDatePreset('range')
  }

  return (
    <Portal>
    <div className="reports-overlay" role="dialog" aria-modal="true" aria-label="Reports">
      <div className="reports-page reports-panel page-shell">
        <PageCorners
          left={
            <PageBackButton
              onClick={handleReportsBack}
              ariaLabel={selectedPurchaseSupplierKey ? 'Back to suppliers' : 'Back'}
            />
          }
          right={<PageCloseButton onClick={onClose} ariaLabel="Close reports" />}
        />
        <div className="reports-top">
          <header className="reports-head page-head--corners">
            <div className="reports-head-text">
              <h1 className="reports-title">
                {selectedPurchaseSupplier
                  ? selectedPurchaseSupplier.shopName
                  : focusSection
                    ? SECTION_TABS.find((tab) => tab.id === visibleSection)?.label ?? 'Report'
                    : 'Reports'}
              </h1>
              <p className="reports-sub">{periodLabel}</p>
            </div>
          </header>

          <div className="reports-toolbar">
            <div className="reports-date-bar">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`reports-date-chip ${datePreset === preset.id ? 'reports-date-chip--active' : ''}`}
                  onClick={() => setDatePreset(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`reports-date-chip ${datePreset === 'date' ? 'reports-date-chip--active' : ''}`}
                onClick={() => setDatePreset('date')}
              >
                Pick
              </button>
              <button
                type="button"
                className={`reports-date-chip ${datePreset === 'range' ? 'reports-date-chip--active' : ''}`}
                onClick={() => setDatePreset('range')}
              >
                Range
              </button>
              <button type="button" className="reports-date-chip" onClick={setYesterdayToTodayRange}>
                2 Days
              </button>
            </div>

            {datePreset === 'date' ? (
              <label className="reports-date-pick">
                <span>Date</span>
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
              </label>
            ) : null}

            {datePreset === 'range' ? (
              <div className="reports-range-pick">
                <label className="reports-date-pick">
                  <span>From</span>
                  <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
                </label>
                <label className="reports-date-pick">
                  <span>To</span>
                  <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                </label>
              </div>
            ) : null}

            {showAllSections ? (
              <div className="reports-tabs reports-tabs--sections">
                {SECTION_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`reports-tab ${activeSection === tab.id ? 'reports-tab--active' : ''}`}
                    onClick={() => selectSection(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="reports-controls">
            {(activeSection === 'sales' || activeSection === 'credit' || activeSection === 'loan') && (
              <div className="reports-options">
                {activeSection === 'sales' ? (
                  <div className="reports-options-group reports-options-group--inline">
                    <span>Show</span>
                    {SALES_DATE_MODE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`reports-sort-chip ${salesDateMode === opt.id ? 'reports-sort-chip--active' : ''}`}
                        onClick={() => setSalesDateMode(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <span className="reports-options-sep">Sort</span>
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`reports-sort-chip ${salesSort === opt.id ? 'reports-sort-chip--active' : ''}`}
                        onClick={() => setSalesSort(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {activeSection === 'credit' ? (
                  <div className="reports-options-group reports-options-group--inline">
                    <span>Sort</span>
                    {CREDIT_SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`reports-sort-chip ${creditSort === opt.id ? 'reports-sort-chip--active' : ''}`}
                        onClick={() => setCreditSort(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {activeSection === 'loan' ? (
                  <div className="reports-options-group reports-options-group--inline">
                    <span>Sort</span>
                    {LOAN_SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`reports-sort-chip ${loanSort === opt.id ? 'reports-sort-chip--active' : ''}`}
                        onClick={() => setLoanSort(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {activeSection === 'all' ? (
              <div className="reports-summary reports-summary--all reports-summary--overview">
                <div className="reports-summary-card reports-summary-card--orange">
                  <span>Total expense</span>
                  <strong>{formatMoney(combinedExpenseTotal)}</strong>
                  <small>
                    Normal {formatMoney(expenseTotals.total)} · Purchase{' '}
                    {formatMoney(purchaseTotals.total)} · Loan{' '}
                    {formatMoney(loanOutflowTotals.total)}
                  </small>
                </div>
                <div className="reports-summary-card reports-summary-card--green">
                  <span>Total sales</span>
                  <strong>{formatMoney(overviewSalesTotals.totalBills)}</strong>
                  <small>
                    {overviewSalesTotals.billCount} bill{overviewSalesTotals.billCount === 1 ? '' : 's'} collected
                  </small>
                </div>
                <div className="reports-summary-card">
                  <span>Credit + Cheque</span>
                  <strong>{formatMoney(creditChequeOpenTotal)}</strong>
                  <small>
                    Credit {formatMoney(creditTotals.pendingTotal)} · Cheque{' '}
                    {formatMoney(chequeTotals.pendingTotal)}
                  </small>
                </div>
              </div>
            ) : null}

            {showSalesCollectedAccordion ? (
              <SalesCollectedSummaryCards
                expanded={expandedSalesPanel}
                onToggle={toggleSalesPanel}
                salesTotals={salesTotals}
                sameDaySales={sameDaySales}
                sameDaySalesLabel={sameDaySalesLabel}
                showSameDaySalesBox={showSameDaySalesBox}
                oldCreditChequeCount={oldCreditChequeBills.length}
              />
            ) : null}

            {activeSection === 'sales' && salesDateMode === 'created' ? (
              <div className="reports-summary">
                <div className="reports-summary-card reports-summary-card--green">
                  <span>Bills created</span>
                  <strong>{formatMoney(salesTotals.billTotal)}</strong>
                  <small>
                    {salesTotals.billCount} bills · Collected {formatMoney(salesTotals.totalBills)} ·{' '}
                    {formatCollectedSalesBreakdown(
                      salesTotals.cashTotal,
                      salesTotals.bankTotal,
                    )}
                  </small>
                </div>
              </div>
            ) : null}

            {activeSection === 'sales' && salesDateMode === 'created' ? (
              <div className="reports-summary reports-summary--sales-double">
                <div className="reports-summary-card">
                  <span>Cash collected</span>
                  <strong>{formatMoney(salesTotals.cashTotal)}</strong>
                  <small>On bills created in this period</small>
                </div>
                <div className="reports-summary-card">
                  <span>Bank collected</span>
                  <strong>{formatMoney(salesTotals.bankTotal)}</strong>
                  <small>On bills created in this period</small>
                </div>
              </div>
            ) : null}

            {activeSection !== 'sales' && activeSection !== 'all' ? (
              <div className="reports-summary reports-summary--single">
                {activeSection === 'credit' && (
                  <div className="reports-summary-card">
                    <span>Credit open</span>
                    <strong>{formatMoney(creditTotals.pendingTotal)}</strong>
                    <small>
                      Total {formatMoney(creditTotals.total)} · Paid {formatMoney(creditTotals.paidTotal)}
                    </small>
                  </div>
                )}
                {activeSection === 'purchase' && (
                  <div className="reports-summary-card reports-summary-card--orange">
                    <span>Purchase</span>
                    <strong>{formatMoney(purchaseTotals.total)}</strong>
                    <small>{purchaseTotals.count} · GST {formatMoney(purchaseTotals.gstTotal)}</small>
                  </div>
                )}
                {activeSection === 'expense' && (
                  <div className="reports-summary-card reports-summary-card--orange">
                    <span>Expense</span>
                    <strong>{formatMoney(combinedExpenseTotal)}</strong>
                    <small>
                      Normal {formatMoney(expenseTotals.total)} · Purchase{' '}
                      {formatMoney(purchaseTotals.total)} · Loan{' '}
                      {formatMoney(loanOutflowTotals.total)}
                    </small>
                  </div>
                )}
                {activeSection === 'cheque' && (
                  <div className="reports-summary-card">
                    <span>Cheque</span>
                    <strong>{formatMoney(chequeTotals.total)}</strong>
                    <small>
                      Pending {formatMoney(chequeTotals.pendingTotal)} · {chequeTotals.pendingCount} waiting
                    </small>
                  </div>
                )}
                {activeSection === 'loan' && (
                  <div className="reports-summary-card reports-summary-card--loan">
                    <span>Loan</span>
                    <strong>{formatMoney(loanTotals.pendingTotal)}</strong>
                    <small>
                      Given {formatMoney(loanTotals.givenTotal)} · Taken {formatMoney(loanTotals.takenTotal)} ·{' '}
                      {loanTotals.pendingCount} pending
                    </small>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div ref={bodyRef} className="reports-body">
          {activeSection === 'sales' && showSalesCollectedAccordion && expandedSalesPanel ? (
            <SalesCollectedHistoryList
              panel={expandedSalesPanel}
              collectedRows={salesBills}
              withCreditRows={withCreditSalesBills}
              oldCreditChequeRows={oldCreditChequeBills}
              sameDayRows={sameDaySalesBills}
              sameDaySalesLabel={sameDaySalesLabel}
              salesTotals={salesTotals}
            />
          ) : null}

          {showSection('sales') && !showSalesCollectedAccordion && (
            <>
              {activeSection === 'all' ? (
                <div className="reports-section-head">
                  <h2>💰 Sales</h2>
                  <strong>{formatMoney(overviewSalesTotals.totalBills)}</strong>
                </div>
              ) : null}
            <section className="reports-section">
              <p className="reports-list-meta">
                {(activeSection === 'all' ? overviewSalesBills : salesBills).length} sale
                {(activeSection === 'all' ? overviewSalesBills : salesBills).length === 1 ? '' : 's'}
                {activeSection === 'all' || salesDateMode === 'collected'
                  ? ' · by collected date'
                  : ' · by bill date'}
              </p>
              {(activeSection === 'all' ? overviewSalesBills : salesBills).length === 0 ? (
                <p className="reports-empty">No sales for this period.</p>
              ) : (
                <ul className="reports-list">
                  {(activeSection === 'all' ? overviewSalesBills : salesBills).map((row) => (
                    <li key={row.id} className="reports-item">
                      <div className="reports-item-head">
                        <span className="reports-item-title">{row.customerName || 'Sale'}</span>
                        <span className="reports-item-amount">
                          {formatMoney(
                            activeSection === 'all' || salesDateMode === 'collected'
                              ? row.collectedTotal
                              : row.billAmount,
                          )}
                        </span>
                      </div>
                      <div className="reports-item-meta">
                        {activeSection !== 'all' && salesDateMode === 'created' ? (
                          <>
                            Created {row.createdDateLabel} · Bill {formatMoney(row.billAmount)} ·{' '}
                            {formatCollectedSalesBreakdown(row.cashTotal, row.bankTotal)}
                          </>
                        ) : (
                          <>
                            Created {row.createdDateLabel} · Collected {row.dateLabel} · Bill{' '}
                            {formatMoney(row.billAmount)} ·{' '}
                            {formatCollectedSalesBreakdown(row.cashTotal, row.bankTotal)}
                          </>
                        )}
                      </div>
                      <div className="reports-item-meta reports-item-meta--detail">{row.detailLabel}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            </>
          )}

          {showSection('purchase') && (
            <>
              {activeSection === 'all' ? (
                <div className="reports-section-head">
                  <h2>🛒 Purchase</h2>
                  <strong>{formatMoney(purchaseTotals.total)}</strong>
                </div>
              ) : null}
            <section className="reports-section">
              {activeSection === 'all' || !selectedPurchaseSupplier ? (
                <>
                  <p className="reports-list-meta">
                    {purchaseSupplierGroups.length} supplier
                    {purchaseSupplierGroups.length === 1 ? '' : 's'} · {purchaseItems.length} purchase
                    {purchaseItems.length === 1 ? '' : 's'}
                  </p>
                  {purchaseSupplierGroups.length === 0 ? (
                    <p className="reports-empty">No purchases for this period.</p>
                  ) : (
                    <ul className="reports-list">
                      {purchaseSupplierGroups.map((group) => (
                        <li key={group.shopKey} className="reports-item reports-item--tap">
                          <button
                            type="button"
                            className="reports-supplier-btn"
                            onClick={() => {
                              if (activeSection === 'all') {
                                setActiveSection('purchase')
                              }
                              setSelectedPurchaseSupplierKey(group.shopKey)
                              setExpandedReportKey(null)
                              bodyRef.current?.scrollTo({ top: 0 })
                            }}
                          >
                            <div className="reports-item-head">
                              <span className="reports-item-title">{group.shopName}</span>
                              <span className="reports-item-amount">{formatMoney(group.total)}</span>
                            </div>
                            <div className="reports-item-meta">
                              {group.count} purchase{group.count === 1 ? '' : 's'} · {NO1_BILL_LABEL}{' '}
                              {formatMoney(group.gstTotal)} · {NO2_BILL_LABEL} {formatMoney(group.noGstTotal)}
                              {group.creditCount > 0
                                ? ` · Credit ${formatMoney(group.creditTotal)}`
                                : ''}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <div className="reports-supplier-summary">
                    <span>
                      {selectedPurchaseSupplier.count} purchase
                      {selectedPurchaseSupplier.count === 1 ? '' : 's'} · tap a row for full details
                    </span>
                    <strong>{formatMoney(selectedPurchaseSupplier.total)}</strong>
                  </div>
                  <ul className="reports-list">
                    {selectedPurchaseSupplier.items.map((row, index) => (
                      <PurchaseReportRow
                        key={row.id}
                        row={row}
                        index={index + 1}
                        expanded={expandedReportKey === `purchase:${row.id}`}
                        onToggle={() => toggleReportExpand(`purchase:${row.id}`)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>
            </>
          )}

          {showSection('expense') && (
            <>
              {activeSection === 'all' ? (
                <div className="reports-section-head">
                  <h2>📤 Expense</h2>
                  <strong>{formatMoney(combinedExpenseTotal)}</strong>
                </div>
              ) : null}
            <section className="reports-section">
              <p className="reports-list-meta">
                Normal {formatMoney(expenseTotals.total)} · Purchase {formatMoney(purchaseTotals.total)} ·
                Loan {formatMoney(loanOutflowTotals.total)} · tap for details
              </p>
              {expenseItems.length === 0 && loanOutflowItems.length === 0 ? (
                <p className="reports-empty">No expenses for this period.</p>
              ) : (
                <ul className="reports-list">
                  {expenseItems.map((row, index) => (
                    <ExpenseReportRow
                      key={row.id}
                      row={row}
                      index={index + 1}
                      expanded={expandedReportKey === `expense:${row.id}`}
                      onToggle={() => toggleReportExpand(`expense:${row.id}`)}
                    />
                  ))}
                  {loanOutflowItems.map((row, index) => (
                    <LoanOutflowReportRow
                      key={row.id}
                      row={row}
                      index={index + 1}
                      expanded={expandedReportKey === `loan-out:${row.id}`}
                      onToggle={() => toggleReportExpand(`loan-out:${row.id}`)}
                    />
                  ))}
                </ul>
              )}
            </section>
            </>
          )}

          {showSection('credit') && (
            <>
              {activeSection === 'credit' && hasCreditAlertsPanel ? (
                <details className="reports-alerts-details" open={activeAlertCount > 0}>
                  <summary className="reports-alerts-summary">
                    🔔 Credit alerts
                    {activeAlertCount > 0 ? (
                      <span className="reports-alerts-badge">{activeAlertCount} active</span>
                    ) : null}
                  </summary>
                  <div className="reports-alerts-details-body">
                    <ReminderAlertsBlock
                      title="💳 Credit collect alerts"
                      subtitle={`Alert ${alertSettings.creditDaysBefore} days before · every ${alertSettings.alertIntervalDays} day${alertSettings.alertIntervalDays === 1 ? '' : 's'}`}
                      activeItems={activeCreditAlerts}
                      scheduledItems={scheduledCreditReminders}
                    />
                    {creditOverview.customerCount > 0 ? (
                      <section className="reports-credit-notify" aria-label="Customers with open credit">
                        <div className="reports-credit-notify-head">
                          <span className="reports-credit-notify-title">Credit customers</span>
                          <strong>{formatMoney(creditOverview.totalPending)}</strong>
                        </div>
                        <p className="reports-credit-notify-sub">
                          {creditOverview.customerCount} customers · {creditOverview.openBillCount} unpaid bills
                        </p>
                        <ul className="reports-credit-notify-list">
                          {creditOverview.customers.map((customer) => (
                            <li key={customer.name}>
                              <button
                                type="button"
                                className="reports-credit-notify-item"
                                onClick={() => onOpenCustomer?.(customer.name)}
                              >
                                <span className="reports-credit-notify-name">{customer.name}</span>
                                <span className="reports-credit-notify-meta">
                                  {customer.openBillCount} bill{customer.openBillCount === 1 ? '' : 's'} ·{' '}
                                  {customer.lastCreditLabel}
                                </span>
                                <strong className="reports-credit-notify-amount">
                                  {formatMoney(customer.pendingAmount)}
                                </strong>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </div>
                </details>
              ) : null}
              {activeSection === 'all' ? (
                <div className="reports-section-head">
                  <h2>💳 Credit</h2>
                  <strong>{formatMoney(creditTotals.pendingTotal)}</strong>
                </div>
              ) : null}
              <section className="reports-section">
                <p className="reports-list-meta">
                  {creditItems.length} credit record{creditItems.length === 1 ? '' : 's'} · tap for details
                </p>
                {creditItems.length === 0 ? (
                  <p className="reports-empty">No credit records for this period.</p>
                ) : (
                  <ul className="reports-list">
                    {creditItems.map((row) => (
                      <CreditReportRow
                        key={row.id}
                        row={row}
                        expanded={expandedReportKey === `credit:${row.id}`}
                        onToggle={() => toggleReportExpand(`credit:${row.id}`)}
                        onOpenCustomer={onOpenCustomer}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {showSection('cheque') && (
            <>
              {activeSection === 'cheque' && hasChequeAlertsPanel ? (
                <details className="reports-alerts-details" open={activeAlertCount > 0}>
                  <summary className="reports-alerts-summary">
                    🔔 Cheque alerts
                    {activeAlertCount > 0 ? (
                      <span className="reports-alerts-badge">{activeAlertCount} active</span>
                    ) : null}
                  </summary>
                  <div className="reports-alerts-details-body">
                    <ReminderAlertsBlock
                      title="🧾 Cheque collect alerts"
                      subtitle={`Alert ${alertSettings.chequeDaysBefore} days before · every ${alertSettings.alertIntervalDays} day${alertSettings.alertIntervalDays === 1 ? '' : 's'}`}
                      activeItems={activeChequeAlerts}
                      scheduledItems={scheduledChequeReminders}
                    />
                  </div>
                </details>
              ) : null}
              {activeSection === 'all' ? (
                <div className="reports-section-head">
                  <h2>🧾 Cheque</h2>
                  <strong>{formatMoney(chequeTotals.pendingTotal)}</strong>
                </div>
              ) : null}
              <section className="reports-section">
                <p className="reports-list-meta">
                  {chequeItems.length} cheque{chequeItems.length === 1 ? '' : 's'} · tap for full breakdown
                </p>
                {chequeItems.length === 0 ? (
                  <p className="reports-empty">No cheque records for this period.</p>
                ) : (
                  <ul className="reports-list">
                    {chequeItems.map((row) => (
                      <ChequeReportRow
                        key={row.id}
                        row={row}
                        expanded={expandedReportKey === `cheque:${row.id}`}
                        onToggle={() => toggleReportExpand(`cheque:${row.id}`)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {showSection('loan') && (
            <>
              {activeSection === 'all' ? (
                <div className="reports-section-head">
                  <h2>🤝 Loan</h2>
                  <strong>{formatMoney(loanTotals.pendingTotal)}</strong>
                </div>
              ) : null}
            <section className="reports-section">
              <p className="reports-list-meta">
                {loanItems.length} loan{loanItems.length === 1 ? '' : 's'} · tap for full details
              </p>
              {loanItems.length === 0 ? (
                <p className="reports-empty">No loans for this period.</p>
              ) : (
                <ul className="reports-list">
                  {loanItems.map((loan, index) => (
                    <LoanReportRow
                      key={loan.id}
                      loan={loan}
                      index={index + 1}
                      expanded={expandedReportKey === `loan:${loan.id}`}
                      onToggle={() => toggleReportExpand(`loan:${loan.id}`)}
                    />
                  ))}
                </ul>
              )}
            </section>
            </>
          )}
        </div>
      </div>
    </div>
    </Portal>
  )
}

function SalesBillList({
  rows,
  meta,
  emptyMessage,
  inline = false,
}: {
  rows: SalesBillRow[]
  meta: string
  emptyMessage: string
  inline?: boolean
}) {
  return (
    <div className={inline ? 'reports-sales-accordion-panel' : 'reports-section reports-section--sales-expanded'}>
      <p className="reports-list-meta">{meta}</p>
      {rows.length === 0 ? (
        <p className="reports-empty">{emptyMessage}</p>
      ) : (
        <ul className="reports-list">
          {rows.map((row) => (
            <li key={row.id} className="reports-item">
              <div className="reports-item-head">
                <span className="reports-item-title">{row.customerName || 'Sale'}</span>
                <span className="reports-item-amount">{formatMoney(row.collectedTotal)}</span>
              </div>
              <div className="reports-item-meta">
                Created {row.createdDateLabel} · Collected {row.dateLabel} · Bill{' '}
                {formatMoney(row.billAmount)} ·{' '}
                {formatCollectedSalesBreakdown(row.cashTotal, row.bankTotal)}
              </div>
              <div className="reports-item-meta reports-item-meta--detail">{row.detailLabel}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SalesCollectedSummaryCards({
  expanded,
  onToggle,
  salesTotals,
  sameDaySales,
  sameDaySalesLabel,
  showSameDaySalesBox,
  oldCreditChequeCount,
}: {
  expanded: SalesExpandPanel | null
  onToggle: (panel: SalesExpandPanel) => void
  salesTotals: ReturnType<typeof salesSummaryForPreset>
  sameDaySales: ReturnType<typeof salesSameDaySummaryForPreset> | null
  sameDaySalesLabel: string
  showSameDaySalesBox: boolean
  oldCreditChequeCount: number
}) {
  const gridClass =
    showSameDaySalesBox && sameDaySales
      ? 'reports-summary--sales-quad'
      : 'reports-summary--sales-triple'

  return (
    <div className={`reports-summary ${gridClass}`}>
      <button
        type="button"
        className={`reports-summary-card reports-summary-card--green reports-summary-card--compact reports-summary-card--expandable ${
          expanded === 'collected' ? 'reports-summary-card--active' : ''
        }`}
        aria-expanded={expanded === 'collected'}
        onClick={() => onToggle('collected')}
      >
        <span>Sales collected</span>
        <strong>{formatMoney(salesTotals.totalBills)}</strong>
        <small>
          {salesTotals.billCount} bills ·{' '}
          {formatCollectedSalesBreakdown(salesTotals.cashTotal, salesTotals.bankTotal)}
        </small>
        <span className="reports-summary-card-chevron" aria-hidden="true">
          {expanded === 'collected' ? '▾' : '▸'}
        </span>
      </button>

      <button
        type="button"
        className={`reports-summary-card reports-summary-card--compact reports-summary-card--expandable ${
          expanded === 'withCredit' ? 'reports-summary-card--active' : ''
        }`}
        aria-expanded={expanded === 'withCredit'}
        onClick={() => onToggle('withCredit')}
      >
        <span>With credit/cheque sale</span>
        <strong>{formatMoney(salesTotals.withCreditSales)}</strong>
        <small>
          Sales collected {formatMoney(salesTotals.totalBills)} · Credit{' '}
          {formatMoney(salesTotals.creditPending)} · Cheque{' '}
          {formatMoney(salesTotals.chequePending)} · Total{' '}
          {formatMoney(salesTotals.withCreditSales)}
        </small>
        <span className="reports-summary-card-chevron" aria-hidden="true">
          {expanded === 'withCredit' ? '▾' : '▸'}
        </span>
      </button>

      <button
        type="button"
        className={`reports-summary-card reports-summary-card--compact reports-summary-card--expandable ${
          expanded === 'oldCreditCheque' ? 'reports-summary-card--active' : ''
        }`}
        aria-expanded={expanded === 'oldCreditCheque'}
        onClick={() => onToggle('oldCreditCheque')}
      >
        <span>Old Credit &amp; Cheque</span>
        <strong>{formatMoney(salesTotals.oldCreditChequeCollected)}</strong>
        <small>
          {oldCreditChequeCount} cleared today · already in Sales collected
        </small>
        <span className="reports-summary-card-chevron" aria-hidden="true">
          {expanded === 'oldCreditCheque' ? '▾' : '▸'}
        </span>
      </button>

      {showSameDaySalesBox && sameDaySales ? (
        <button
          type="button"
          className={`reports-summary-card reports-summary-card--compact reports-summary-card--today reports-summary-card--expandable ${
            expanded === 'sameDay' ? 'reports-summary-card--active' : ''
          }`}
          aria-expanded={expanded === 'sameDay'}
          onClick={() => onToggle('sameDay')}
        >
          <span>{sameDaySalesLabel}</span>
          <strong>{formatMoney(sameDaySales.totalBills)}</strong>
          <small>
            {sameDaySales.billCount} bills · created &amp; paid same day ·{' '}
            {formatCollectedSalesBreakdown(sameDaySales.cashTotal, sameDaySales.bankTotal)}
          </small>
          <span className="reports-summary-card-chevron" aria-hidden="true">
            {expanded === 'sameDay' ? '▾' : '▸'}
          </span>
        </button>
      ) : null}
    </div>
  )
}

function WithCreditChequeList({
  rows,
  salesTotals,
}: {
  rows: SalesBillRow[]
  salesTotals: ReturnType<typeof salesSummaryForPreset>
}) {
  // Main with-credit list: pending on original open/edit date + same-day opened collections.
  const chequeRows = rows.filter((row) => row.chequePending > 0)
  const creditRows = rows.filter((row) => row.creditPending > 0)
  const collectedRows = rows.filter((row) => {
    if (row.collectedTotal <= 0 || !row.hasCreditOrCheque) return false
    if (row.creditPending > 0 || row.chequePending > 0) return true
    return true // already filtered to same-day opened by isPeriodWithCreditSaleRow
  })

  return (
    <div className="reports-section reports-section--sales-expanded">
      <p className="reports-list-meta">
        Sales collected {formatMoney(salesTotals.totalBills)} · Credit{' '}
        {formatMoney(salesTotals.creditPending)} · Cheque{' '}
        {formatMoney(salesTotals.chequePending)} · Total{' '}
        {formatMoney(salesTotals.withCreditSales)}
      </p>
      <p className="reports-list-meta">
        Sales collected is that day&apos;s total. Credit and cheque are pending opened that day.
        A part payment does not move the remaining balance to today. Old cleared amounts stay in
        Sales collected / Old Credit &amp; Cheque.
      </p>

      {rows.length === 0 ? (
        <p className="reports-empty">No credit or cheque sales for this period.</p>
      ) : (
        <>
          {chequeRows.length > 0 ? (
            <div className="reports-with-credit-block">
              <p className="reports-with-credit-block-title">
                Cheque · {formatMoney(salesTotals.chequePending)}
              </p>
              <ul className="reports-list">
                {chequeRows.map((row) => {
                  const chequeDateLabel = row.chequeDateLabel ?? row.createdDateLabel
                  const updatedLabel = row.updatedDateLabel
                  const openedSameDay =
                    !updatedLabel || updatedLabel === chequeDateLabel
                  return (
                    <li key={`cheque-${row.id}`} className="reports-item">
                      <div className="reports-item-head">
                        <span className="reports-item-title">
                          {row.customerName?.trim() || 'Cheque customer'}
                        </span>
                        <span className="reports-item-amount">
                          {formatMoney(row.chequePending)}
                        </span>
                      </div>
                      <div className="reports-item-meta">
                        🧾 Cheque date {chequeDateLabel}
                        {openedSameDay
                          ? ' · Pending'
                          : ` · Updated ${updatedLabel} · Pending`}
                      </div>
                      <div className="reports-item-meta reports-item-meta--detail">
                        {row.detailLabel}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {creditRows.length > 0 ? (
            <div className="reports-with-credit-block">
              <p className="reports-with-credit-block-title">
                Credit · {formatMoney(salesTotals.creditPending)}
              </p>
              <ul className="reports-list">
                {creditRows.map((row) => {
                  const creditDateLabel = row.creditDateLabel ?? row.createdDateLabel
                  const updatedLabel = row.updatedDateLabel
                  const openedSameDay =
                    !updatedLabel || updatedLabel === creditDateLabel
                  return (
                    <li key={`credit-${row.id}`} className="reports-item">
                      <div className="reports-item-head">
                        <span className="reports-item-title">
                          {row.customerName?.trim() || 'Credit customer'}
                        </span>
                        <span className="reports-item-amount">
                          {formatMoney(row.creditPending)}
                        </span>
                      </div>
                      <div className="reports-item-meta">
                        💳 Credit date {creditDateLabel}
                        {openedSameDay
                          ? ' · Pending'
                          : ` · Updated ${updatedLabel} · Pending`}
                      </div>
                      <div className="reports-item-meta reports-item-meta--detail">
                        {row.detailLabel}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {collectedRows.length > 0 ? (
            <div className="reports-with-credit-block">
              <p className="reports-with-credit-block-title">
                Sales collected (that day&apos;s total includes these) ·{' '}
                {formatMoney(salesTotals.totalBills)}
              </p>
              <ul className="reports-list">
                {collectedRows.map((row) => (
                  <li key={`collected-${row.id}`} className="reports-item">
                    <div className="reports-item-head">
                      <span className="reports-item-title">
                        {row.customerName?.trim() || 'Sale'}
                      </span>
                      <span className="reports-item-amount">
                        {formatMoney(row.collectedTotal)}
                      </span>
                    </div>
                    <div className="reports-item-meta">
                      Created {row.createdDateLabel} · Collected {row.dateLabel} ·{' '}
                      {formatCollectedSalesBreakdown(row.cashTotal, row.bankTotal)}
                      {row.hasCheque ? ' · Cheque' : ''}
                      {row.hasCredit ? ' · Credit' : ''}
                    </div>
                    <div className="reports-item-meta reports-item-meta--detail">
                      {row.detailLabel}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function OldCreditChequeList({
  rows,
  total,
}: {
  rows: SalesBillRow[]
  total: number
}) {
  return (
    <div className="reports-section reports-section--sales-expanded">
      <p className="reports-list-meta">
        Old credit &amp; cheque cleared today · {formatMoney(total)} · already counted in Sales
        collected (that day&apos;s total)
      </p>
      {rows.length === 0 ? (
        <p className="reports-empty">No old credit or cheque cleared in this period.</p>
      ) : (
        <ul className="reports-list">
          {rows.map((row) => (
            <li key={`old-${row.id}`} className="reports-item">
              <div className="reports-item-head">
                <span className="reports-item-title">
                  {row.customerName?.trim() || 'Customer'}
                </span>
                <span className="reports-item-amount">{formatMoney(row.collectedTotal)}</span>
              </div>
              <div className="reports-item-meta">
                {row.hasCheque ? '🧾 Cheque' : row.hasCredit ? '💳 Credit' : 'Sale'} · Opened{' '}
                {row.chequeDateLabel ?? row.creditDateLabel ?? row.createdDateLabel} · Cleared{' '}
                {row.dateLabel} ·{' '}
                {formatCollectedSalesBreakdown(row.cashTotal, row.bankTotal)}
              </div>
              <div className="reports-item-meta reports-item-meta--detail">{row.detailLabel}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SalesCollectedHistoryList({
  panel,
  collectedRows,
  withCreditRows,
  oldCreditChequeRows,
  sameDayRows,
  sameDaySalesLabel,
  salesTotals,
}: {
  panel: SalesExpandPanel
  collectedRows: SalesBillRow[]
  withCreditRows: SalesBillRow[]
  oldCreditChequeRows: SalesBillRow[]
  sameDayRows: SalesBillRow[]
  sameDaySalesLabel: string
  salesTotals: ReturnType<typeof salesSummaryForPreset>
}) {
  if (panel === 'collected') {
    return (
      <SalesBillList
        rows={collectedRows}
        meta={`${collectedRows.length} sale${collectedRows.length === 1 ? '' : 's'} · Sales collected · by collected date`}
        emptyMessage="No collected sales for this period."
      />
    )
  }
  if (panel === 'withCredit') {
    return <WithCreditChequeList rows={withCreditRows} salesTotals={salesTotals} />
  }
  if (panel === 'oldCreditCheque') {
    return (
      <OldCreditChequeList
        rows={oldCreditChequeRows}
        total={salesTotals.oldCreditChequeCollected}
      />
    )
  }
  return (
    <SalesBillList
      rows={sameDayRows}
      meta={`${sameDayRows.length} sale${sameDayRows.length === 1 ? '' : 's'} · ${sameDaySalesLabel} · by collected · same day only`}
      emptyMessage="No same-day collected sales for this date."
    />
  )
}

function ReminderAlertsBlock({
  title,
  subtitle,
  activeItems,
  scheduledItems,
}: {
  title: string
  subtitle: string
  activeItems: BillReminderItem[]
  scheduledItems: BillReminderItem[]
}) {
  if (scheduledItems.length === 0) return null

  const upcomingItems = scheduledItems.filter((item) => !item.isAlertActive)

  return (
    <section className="reports-reminder-notify" aria-label={title}>
      <div className="reports-reminder-notify-head">
        <span className="reports-reminder-notify-title">{title}</span>
        <strong>{activeItems.length}</strong>
      </div>
      <p className="reports-reminder-notify-sub">{subtitle}</p>
      {activeItems.length === 0 ? (
        <p className="reports-reminder-notify-empty">No active alerts right now.</p>
      ) : (
        <ul className="reports-reminder-notify-list">
          {activeItems.map((item) => (
            <li key={item.saleId} className="reports-reminder-notify-item reports-reminder-notify-item--active">
              <div>
                <strong>{item.customerName}</strong>
                <small>
                  {item.alertLabel} · {item.reminderDateLabel}
                </small>
                {item.reminderNote ? <small className="reports-reminder-notify-note">📝 {item.reminderNote}</small> : null}
              </div>
              <span>{formatMoney(item.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {upcomingItems.length > 0 ? (
        <>
          <p className="reports-reminder-notify-scheduled-title">Scheduled</p>
          <ul className="reports-reminder-notify-list reports-reminder-notify-list--scheduled">
            {upcomingItems.map((item) => (
              <li key={item.saleId} className="reports-reminder-notify-item">
                <div>
                  <strong>{item.customerName}</strong>
                  <small>
                    {item.reminderDateLabel} · {item.alertLabel}
                  </small>
                  {item.reminderNote ? <small className="reports-reminder-notify-note">📝 {item.reminderNote}</small> : null}
                </div>
                <span>{formatMoney(item.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function ReportDetailGrid({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="reports-item-detail">
      {rows.map((row) => (
        <div key={row.label} className="reports-item-detail-row">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  )
}

function PurchaseReportRow({
  row,
  index,
  expanded,
  onToggle,
}: {
  row: PurchaseHistoryItem
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''}`}
      data-report-key={`purchase:${row.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">
            Purchase #{index} · {row.billLabel}
            {row.description ? ` · ${row.description}` : ''}
          </span>
          <span className="reports-item-amount">{formatMoney(row.amount)}</span>
        </div>
        <div className="reports-item-meta">
          {formatDate(row.date)} · {row.payLabel}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Supplier', value: row.shopName },
            { label: 'Date', value: formatDate(row.date) },
            { label: NO1_BILL_LABEL, value: formatMoney(row.no1Amount) },
            { label: NO2_BILL_LABEL, value: formatMoney(row.no2Amount) },
            { label: 'Total', value: formatMoney(row.amount) },
            ...(row.paidAmount > 0 && row.paidAmount !== row.amount
              ? [{ label: 'Paid', value: formatMoney(row.paidAmount) }]
              : []),
            { label: 'Payment', value: row.payDetail },
          ]}
        />
      ) : null}
    </li>
  )
}

function ExpenseReportRow({
  row,
  index,
  expanded,
  onToggle,
}: {
  row: NormalExpenseHistoryItem
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''}`}
      data-report-key={`expense:${row.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">
            Expense #{index} · {row.name}
          </span>
          <span className="reports-item-amount">{formatMoney(row.amount)}</span>
        </div>
        <div className="reports-item-meta">
          {formatDate(row.date)} · {row.payLabel}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Name', value: row.name },
            { label: 'Date', value: formatDate(row.date) },
            { label: 'Amount', value: formatMoney(row.amount) },
            { label: 'Payment', value: row.payDetail },
          ]}
        />
      ) : null}
    </li>
  )
}

function LoanOutflowReportRow({
  row,
  index,
  expanded,
  onToggle,
}: {
  row: LoanOutflowHistoryItem
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const kindLabel = row.kind === 'given' ? 'Loan given' : 'Loan returned'
  const payLabel = row.paySource === 'bank' ? '🏦 Bank' : '💵 Cash'
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''}`}
      data-report-key={`loan-out:${row.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">
            Loan #{index} · {row.name}
          </span>
          <span className="reports-item-amount">{formatMoney(row.amount)}</span>
        </div>
        <div className="reports-item-meta">
          {formatDate(row.date)} · {kindLabel} · {payLabel}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Name', value: row.name },
            { label: 'Date', value: formatDate(row.date) },
            { label: 'Amount', value: formatMoney(row.amount) },
            { label: 'Type', value: kindLabel },
            { label: 'Payment', value: payLabel },
            ...(row.note ? [{ label: 'Note', value: row.note }] : []),
          ]}
        />
      ) : null}
    </li>
  )
}

function CreditReportRow({
  row,
  expanded,
  onToggle,
  onOpenCustomer,
}: {
  row: CreditReportItem
  expanded: boolean
  onToggle: () => void
  onOpenCustomer?: (customerName: string) => void
}) {
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''}`}
      data-report-key={`credit:${row.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">{row.name}</span>
          <span className="reports-item-amount">{formatMoney(row.pendingAmount)}</span>
        </div>
        <div className="reports-item-meta">
          {formatDate(row.date)} · {row.kind === 'sale' ? 'Sale credit' : 'Purchase credit'} · {row.status}
        </div>
        <div className="reports-item-meta reports-item-meta--detail">{row.payDetail}</div>
      </button>
      {expanded ? (
        <>
          <ReportDetailGrid
            rows={[
              { label: 'Name', value: row.name },
              { label: 'Type', value: row.kind === 'sale' ? 'Customer credit (sale)' : 'Supplier credit (purchase)' },
              { label: 'Bill total', value: formatMoney(row.totalBill) },
              { label: 'Paid', value: formatMoney(row.paidAmount) },
              { label: 'Open balance', value: formatMoney(row.pendingAmount) },
              { label: 'Status', value: row.status === 'pending' ? 'Open' : 'Settled' },
              { label: 'Date', value: formatDate(row.date) },
              { label: 'Payment detail', value: row.payDetail },
            ]}
          />
          {row.kind === 'sale' && onOpenCustomer ? (
            <button type="button" className="reports-item-action" onClick={() => onOpenCustomer(row.name)}>
              Open customer credit
            </button>
          ) : null}
        </>
      ) : null}
    </li>
  )
}

function ChequeReportRow({
  row,
  expanded,
  onToggle,
}: {
  row: ChequeReportItem
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''}`}
      data-report-key={`cheque:${row.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">{row.name}</span>
          <span className="reports-item-amount">{formatMoney(row.amount)}</span>
        </div>
        <div className="reports-item-meta">
          {formatDate(row.date)} · {row.kind} · {row.approved ? 'Approved → Bank' : 'Pending'}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Name', value: row.name },
            { label: 'Type', value: row.kind },
            { label: 'Amount', value: formatMoney(row.amount) },
            { label: 'Status', value: row.approved ? 'Approved — counted in bank' : 'Pending — not in bank yet' },
            { label: 'Date', value: formatDate(row.date) },
            { label: 'Payment detail', value: row.payDetail },
          ]}
        />
      ) : null}
    </li>
  )
}

function LoanReportRow({
  loan,
  index,
  expanded,
  onToggle,
}: {
  loan: LoanListItem
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`reports-item reports-item--tap reports-item--loan reports-item--loan-${loan.kind} ${expanded ? 'reports-item--expanded' : ''}`}
      data-report-key={`loan:${loan.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">
            Loan #{index} · {loan.personName}
          </span>
          <span className="reports-item-amount">{formatMoney(loan.amount)}</span>
        </div>
        <div className="reports-item-meta">
          {loan.dateLabel} · {loan.kindLabel} · {loan.paySourceLabel} · {loan.statusLabel}
          {loan.settledDateLabel ? ` · Settled ${loan.settledDateLabel}` : ''}
        </div>
        {loan.note ? (
          <div className="reports-item-meta reports-item-meta--detail">{loan.note}</div>
        ) : null}
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Person', value: loan.personName },
            { label: 'Type', value: loan.kind === 'lend' ? 'Given (receivable)' : 'Taken (payable)' },
            { label: 'Amount', value: formatMoney(loan.amount) },
            { label: 'Paid from', value: loan.paySourceLabel },
            { label: 'Status', value: loan.statusLabel },
            { label: 'Date given', value: loan.dateLabel },
            ...(loan.settledDateLabel
              ? [{ label: 'Settled on', value: loan.settledDateLabel }]
              : []),
            ...(loan.settlementPaySource
              ? [{ label: 'Settled via', value: loan.settlementPaySource === 'bank' ? '🏦 Bank' : '💵 Cash' }]
              : []),
            ...(loan.reminderAt ? [{ label: 'Reminder', value: formatDate(loan.reminderAt) }] : []),
            ...(loan.note ? [{ label: 'Note', value: loan.note }] : []),
          ]}
        />
      ) : null}
    </li>
  )
}
