import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData } from '../types'
import { usePageEscape } from '../hooks/usePageEscape'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { formatDate, formatMoney, formatTime } from '../utils/format'
import {
  buildSalesBillList,
  formatCollectedSalesBreakdown,
  summarizeSalesBillRows,
  toInputDate,
  isOldCreditChequeClearedRow,
  type ReportSort,
  type SaleDateMode,
  type SalesBillRow,
  type SalesBillSummary,
} from '../utils/salesReport'
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
  summarizePurchases,
  type ReportDatePreset,
} from '../utils/reportsHub'
import {
  analyzeExpenseNameGroup,
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
  filterNormalExpensesByPayChannel,
  groupNormalExpensesByName,
  type NormalExpenseHistoryItem,
} from '../utils/normalExpenseHistory'
import {
  buildExpenseTimelineEntriesFromData,
  buildTransferExpenseTimelineEntries,
  expenseTimelineKindLabel,
  expenseGrossTotal,
  expenseHasLoanActivity,
  expenseLoanCombinedTotal,
  expenseTotalAfterLoanSettlement,
  filterExpenseTimelineByPayChannel,
  summarizeExpenseTimeline,
  type ExpensePayChannelFilter,
  type ExpenseTimelineEntry,
  type ExpenseTimelineSort,
  type ExpenseTimelineSummary,
} from '../utils/expenseTimeline'
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
import { buildCreditOverview } from '../utils/customerLedger'
import { buildChequeOverview } from '../utils/chequeLedger'
import { printChequeDuesReport, printCreditDuesReport } from '../utils/duesReport'
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
import {
  buildNotSaleInflowItems,
  notSaleInflowKindLabel,
  summarizeNotSaleInflow,
  type NotSaleInflowItem,
} from '../utils/notSaleInflow'
import { collectAppDataMonthDates, currentMonthKey, defaultMonthPickerKey, listMonthPickerOptions } from '../utils/monthPicker'
import '../pages/Reports.css'

export type ReportSection =
  | 'all'
  | 'sales'
  | 'purchase'
  | 'expense'
  | 'expense-report'
  | 'not-sale'
  | 'credit'
  | 'cheque'
  | 'loan'

const EMPTY_SALES_BILLS: SalesBillRow[] = []
const EMPTY_SALES_TOTALS: SalesBillSummary = {
  billCount: 0,
  totalBills: 0,
  billTotal: 0,
  withCreditSales: 0,
  withCreditCollected: 0,
  oldCreditChequeCollected: 0,
  cashTotal: 0,
  bankTotal: 0,
  chequeTotal: 0,
  creditPending: 0,
  chequePending: 0,
}

const DATE_PRESETS: { id: ReportDatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'all', label: 'All' },
]

/** Main report tabs next to Sales — chronological Expense only (not Expense Report). */
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
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey)
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
  const [selectedExpenseNameKey, setSelectedExpenseNameKey] = useState<string | null>(null)
  const [expensePayChannel, setExpensePayChannel] = useState<ExpensePayChannelFilter>('all')
  const [expenseTimelineSort, setExpenseTimelineSort] = useState<ExpenseTimelineSort>('time-desc')
  const {
    value: expenseNameSearch,
    setValue: setExpenseNameSearch,
    deferredValue: deferredExpenseNameSearch,
  } = useDeferredSearch()
  const [expandedReportKey, setExpandedReportKey] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    if (initialPreset === 'monthPick' || initialPreset === 'month') {
      setDatePreset('monthPick')
      setSelectedMonth(
        initialSelectedDate && initialSelectedDate.length === 7
          ? initialSelectedDate
          : currentMonthKey(),
      )
    } else {
      setDatePreset(initialPreset)
    }
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
  }, [open, initialPreset, initialSection, initialSelectedDate, focusSection])

  const filterDateArg = datePreset === 'monthPick' ? selectedMonth : selectedDate

  const monthOptions = useMemo(() => listMonthPickerOptions(collectAppDataMonthDates(data)), [data])

  useEffect(() => {
    if (monthOptions.length === 0) return
    setSelectedMonth((prev) => defaultMonthPickerKey(monthOptions, prev))
  }, [monthOptions])

  const isOverview = activeSection === 'all'
  const needsSales = isOverview || activeSection === 'sales'
  const needsOverviewSales = needsSales || activeSection === 'not-sale'
  const needsExpense =
    isOverview || activeSection === 'expense' || activeSection === 'expense-report'
  const needsPurchase = isOverview || activeSection === 'purchase'
  const needsCredit = isOverview || activeSection === 'credit'
  const needsCheque = isOverview || activeSection === 'cheque'
  const needsLoan = isOverview || activeSection === 'loan'
  const needsNotSale = isOverview || activeSection === 'not-sale'

  const salesFilter = useMemo(
    () =>
      needsSales
        ? salesFilterForPreset(datePreset, filterDateArg, rangeTo, salesDateMode)
        : undefined,
    [needsSales, datePreset, filterDateArg, rangeTo, salesDateMode],
  )
  const salesBills = useMemo(
    () => (needsSales ? buildSalesBillList(data, salesSort, salesFilter) : EMPTY_SALES_BILLS),
    [data, salesFilter, salesSort, needsSales],
  )
  const salesTotals = useMemo(
    () => (needsSales ? summarizeSalesBillRows(salesBills, salesFilter) : EMPTY_SALES_TOTALS),
    [salesBills, salesFilter, needsSales],
  )
  const overviewSalesFilter = useMemo(
    () =>
      needsOverviewSales
        ? salesFilterForPreset(datePreset, filterDateArg, rangeTo, 'collected')
        : undefined,
    [needsOverviewSales, datePreset, filterDateArg, rangeTo],
  )
  const overviewSalesBills = useMemo(
    () =>
      needsOverviewSales
        ? buildSalesBillList(data, 'date-desc', overviewSalesFilter)
        : EMPTY_SALES_BILLS,
    [data, overviewSalesFilter, needsOverviewSales],
  )
  const overviewSalesTotals = useMemo(
    () =>
      needsOverviewSales
        ? summarizeSalesBillRows(overviewSalesBills, overviewSalesFilter)
        : EMPTY_SALES_TOTALS,
    [overviewSalesBills, overviewSalesFilter, needsOverviewSales],
  )
  const showSameDaySalesBox = isSingleDaySalesPreset(datePreset, filterDateArg, rangeTo)
  const sameDaySales = useMemo(
    () =>
      needsSales && showSameDaySalesBox
        ? salesSameDaySummaryForPreset(data, datePreset, filterDateArg, rangeTo)
        : null,
    [data, datePreset, filterDateArg, rangeTo, showSameDaySalesBox, needsSales],
  )
  const sameDaySalesLabel = sameDaySalesCollectedLabel(datePreset, filterDateArg, rangeTo)

  const sameDaySalesBills = useMemo(
    () =>
      needsSales && showSameDaySalesBox
        ? salesBillsForPreset(
            data,
            datePreset,
            filterDateArg,
            salesSort,
            rangeTo,
            'collected',
            { sameDayCreatedAndPaid: true },
          )
        : [],
    [data, datePreset, filterDateArg, salesSort, rangeTo, showSameDaySalesBox, needsSales],
  )

  const withCreditSalesBills = useMemo(() => {
    const filter = salesFilterForPreset(datePreset, filterDateArg, rangeTo, salesDateMode)
    return salesBills.filter((row) =>
      isPeriodWithCreditSaleRow(row, salesDateMode, filter?.fromDate, filter?.toDate),
    )
  }, [salesBills, datePreset, filterDateArg, rangeTo, salesDateMode])

  const oldCreditChequeBills = useMemo(() => {
    const filter = salesFilterForPreset(datePreset, filterDateArg, rangeTo, salesDateMode)
    return salesBills.filter((row) =>
      isOldCreditChequeClearedTodayRow(row, salesDateMode, filter?.fromDate, filter?.toDate),
    )
  }, [salesBills, datePreset, filterDateArg, rangeTo, salesDateMode])

  const showSalesCollectedAccordion =
    activeSection === 'sales' && salesDateMode === 'collected'

  useEffect(() => {
    if (activeSection === 'sales' && salesDateMode === 'collected') {
      setExpandedSalesPanel('collected')
    } else {
      setExpandedSalesPanel(null)
    }
  }, [datePreset, filterDateArg, rangeTo, salesDateMode, activeSection])

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
    if (!needsPurchase && !needsExpense) return []
    const items = buildPurchaseHistoryItems(data)
    return filterPurchaseHistoryItems(items, datePreset, filterDateArg, rangeTo)
  }, [data, datePreset, filterDateArg, rangeTo, needsPurchase, needsExpense])
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
    if (!needsExpense) return []
    const items = buildNormalExpenseHistoryItems(data)
    return filterNormalExpenseHistoryItems(items, datePreset, filterDateArg, rangeTo)
  }, [data, datePreset, filterDateArg, rangeTo, needsExpense])
  const channelExpenseItems = useMemo(
    () => filterNormalExpensesByPayChannel(expenseItems, expensePayChannel),
    [expenseItems, expensePayChannel],
  )
  const expenseTotals = useMemo(
    () =>
      channelExpenseItems.reduce(
        (acc, item) => {
          acc.total += item.amount
          acc.count += 1
          return acc
        },
        { total: 0, count: 0 },
      ),
    [channelExpenseItems],
  )
  const expenseNameGroups = useMemo(
    () => groupNormalExpensesByName(channelExpenseItems),
    [channelExpenseItems],
  )
  const filteredExpenseNameGroups = useMemo(() => {
    const q = deferredExpenseNameSearch.trim().toLowerCase()
    if (!q) return expenseNameGroups
    return expenseNameGroups.filter((group) => group.name.toLowerCase().includes(q))
  }, [expenseNameGroups, deferredExpenseNameSearch])
  const selectedExpenseNameGroup = useMemo(() => {
    if (!selectedExpenseNameKey) return null
    return expenseNameGroups.find((group) => group.nameKey === selectedExpenseNameKey) ?? null
  }, [selectedExpenseNameKey, expenseNameGroups])
  const selectedExpenseAnalysis = useMemo(() => {
    if (!selectedExpenseNameGroup) return null
    return analyzeExpenseNameGroup(selectedExpenseNameGroup, expenseTotals.total)
  }, [selectedExpenseNameGroup, expenseTotals.total])
  const allLoanOutflowItems = useMemo(
    () => (needsExpense || needsLoan ? buildLoanOutflowHistoryItems(data) : []),
    [data, needsExpense, needsLoan],
  )
  const loanOutflowItems = useMemo(() => {
    if (!needsExpense) return []
    const dated = filterLoanOutflowHistoryItems(
      allLoanOutflowItems,
      datePreset,
      filterDateArg,
      rangeTo,
    )
    if (expensePayChannel === 'all') return dated
    return dated.filter((item) =>
      expensePayChannel === 'cash' ? item.paySource !== 'bank' : item.paySource === 'bank',
    )
  }, [allLoanOutflowItems, datePreset, filterDateArg, rangeTo, expensePayChannel, needsExpense])
  const loanOutflowTotals = useMemo(
    () => summarizeLoanOutflows(loanOutflowItems),
    [loanOutflowItems],
  )
  const expenseTimeline = useMemo(() => {
    if (!needsExpense) return []
    const allLoans = filterLoanOutflowHistoryItems(
      allLoanOutflowItems,
      datePreset,
      filterDateArg,
      rangeTo,
    )
    return buildExpenseTimelineEntriesFromData(
      data,
      expenseItems,
      purchaseItems,
      expenseTimelineSort,
      allLoans,
      datePreset,
      filterDateArg,
      rangeTo,
    )
  }, [
    data,
    expenseItems,
    purchaseItems,
    allLoanOutflowItems,
    datePreset,
    filterDateArg,
    rangeTo,
    expenseTimelineSort,
    needsExpense,
  ])
  const expenseTimelineSummary = useMemo(
    () => summarizeExpenseTimeline(expenseTimeline),
    [expenseTimeline],
  )
  const combinedExpenseTotal = expenseGrossTotal(expenseTimelineSummary)
  const analyzedExpenseTotal =
    expenseTotals.total + loanOutflowTotals.givenOriginalTotal + loanOutflowTotals.borrowRepaidTotal
  const analyzedExpenseAfterLoan =
    expenseTotals.total + loanOutflowTotals.givenUnsettledTotal

  const filteredExpenseTimeline = useMemo(() => {
    const q = deferredExpenseNameSearch.trim().toLowerCase()
    const searched = !q
      ? expenseTimeline
      : expenseTimeline.filter((entry) => {
          if (entry.title.toLowerCase().includes(q)) return true
          if (entry.detail.toLowerCase().includes(q)) return true
          if (entry.payLabel.toLowerCase().includes(q)) return true
          if (String(entry.amount).includes(q)) return true
          return false
        })
    const channelFiltered = filterExpenseTimelineByPayChannel(searched, expensePayChannel)
    if (expensePayChannel !== 'cash' && expensePayChannel !== 'bank') return channelFiltered

    const transfers = buildTransferExpenseTimelineEntries(
      data,
      expensePayChannel,
      datePreset,
      filterDateArg,
      rangeTo,
      expenseTimelineSort,
    )
    const transferSearched = !q
      ? transfers
      : transfers.filter((entry) => {
          if (entry.title.toLowerCase().includes(q)) return true
          if (entry.detail.toLowerCase().includes(q)) return true
          if (entry.payLabel.toLowerCase().includes(q)) return true
          if (String(entry.amount).includes(q)) return true
          return false
        })
    const merged = [...channelFiltered, ...transferSearched]
    merged.sort((a, b) =>
      expenseTimelineSort === 'time-desc'
        ? b.sortTime - a.sortTime || b.amount - a.amount
        : a.sortTime - b.sortTime || a.amount - b.amount,
    )
    return merged
  }, [
    expenseTimeline,
    deferredExpenseNameSearch,
    expensePayChannel,
    data,
    datePreset,
    filterDateArg,
    rangeTo,
    expenseTimelineSort,
  ])
  const filteredExpenseTimelineSummary = useMemo(
    () => summarizeExpenseTimeline(filteredExpenseTimeline),
    [filteredExpenseTimeline],
  )

  const creditItems = useMemo(() => {
    if (!needsCredit) return []
    const items = buildCreditReportItems(data)
    const filtered = filterCreditReportItems(items, datePreset, filterDateArg, rangeTo)
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
  }, [data, datePreset, filterDateArg, rangeTo, creditSort, needsCredit])
  const creditTotals = useMemo(() => summarizeCreditItems(creditItems), [creditItems])

  const chequeItems = useMemo(() => {
    if (!needsCheque) return []
    const items = buildChequeReportItems(data)
    return filterChequeReportItems(items, datePreset, filterDateArg, rangeTo)
  }, [data, datePreset, filterDateArg, rangeTo, needsCheque])
  const chequeTotals = useMemo(() => summarizeChequeItems(chequeItems), [chequeItems])

  const creditChequeOpenTotal = creditTotals.pendingTotal + chequeTotals.pendingTotal
  const showSection = (section: Exclude<ReportSection, 'all'>) => {
    if (section === 'expense-report') return activeSection === 'expense-report'
    if (section === 'expense') return activeSection === 'expense' || activeSection === 'all'
    if (section === 'not-sale') return activeSection === 'not-sale' || activeSection === 'all'
    return activeSection === section || activeSection === 'all'
  }

  const loanItems = useMemo(() => {
    if (!needsLoan) return []
    const items = filterLoanReportItems(
      buildLoanReportItems(data),
      datePreset,
      filterDateArg,
      rangeTo,
    )
    return [...items].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return loanSort === 'date-asc' ? ta - tb : tb - ta
    })
  }, [data, datePreset, filterDateArg, rangeTo, loanSort, needsLoan])
  const loanTotals = useMemo(() => summarizeLoanReportItems(loanItems), [loanItems])

  const notSaleInflowItems = useMemo(
    () =>
      needsNotSale ? buildNotSaleInflowItems(data, datePreset, filterDateArg, rangeTo) : [],
    [data, datePreset, filterDateArg, rangeTo, needsNotSale],
  )
  const notSaleInflowTotals = useMemo(
    () => summarizeNotSaleInflow(notSaleInflowItems),
    [notSaleInflowItems],
  )
  const overviewSalesChannelTotals = useMemo(() => {
    let cash = 0
    let bank = 0
    for (const row of overviewSalesBills) {
      cash += row.cashTotal
      bank += row.bankTotal + row.chequeTotal
    }
    return { cash, bank }
  }, [overviewSalesBills])
  const totalCollectedWithNotSale =
    overviewSalesTotals.totalBills + notSaleInflowTotals.total

  const creditOverview = useMemo(() => buildCreditOverview(data), [data])
  const chequeOverview = useMemo(() => buildChequeOverview(data), [data])
  const alertSettings = useMemo(() => getReminderAlertSettings(data), [data])
  const activeCreditAlerts = useMemo(() => buildActiveCreditReminders(data), [data])
  const activeChequeAlerts = useMemo(() => buildActiveChequeReminders(data), [data])
  const scheduledCreditReminders = useMemo(() => buildCreditBillReminders(data), [data])
  const scheduledChequeReminders = useMemo(() => buildChequeBillReminders(data), [data])

  const periodLabel = formatReportPresetLabel(datePreset, filterDateArg, rangeTo)
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
    if (selectedExpenseNameKey) {
      setSelectedExpenseNameKey(null)
      setExpandedReportKey(null)
      bodyRef.current?.scrollTo({ top: 0 })
      return
    }
    if (selectedPurchaseSupplierKey) {
      setSelectedPurchaseSupplierKey(null)
      setExpandedReportKey(null)
      bodyRef.current?.scrollTo({ top: 0 })
      return
    }
    if (!focusSection && activeSection !== 'all') {
      setActiveSection('all')
      setExpandedReportKey(null)
      bodyRef.current?.scrollTo({ top: 0 })
      return
    }
    onClose()
  }, [selectedExpenseNameKey, selectedPurchaseSupplierKey, activeSection, focusSection, onClose])

  usePageEscape(handleReportsBack, open)

  function selectSection(section: ReportSection) {
    setActiveSection(section)
    setSelectedPurchaseSupplierKey(null)
    setSelectedExpenseNameKey(null)
    setExpenseNameSearch('')
    setExpensePayChannel('all')
    setExpenseTimelineSort('time-desc')
    setExpandedReportKey(null)
    if (section === 'sales') {
      setExpandedSalesPanel('collected')
    } else {
      setExpandedSalesPanel(null)
    }
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

  return (
    <Portal>
    <div className="reports-overlay" role="dialog" aria-modal="true" aria-label="Reports">
      <div className="reports-page reports-panel page-shell">
        <PageCorners
          left={
            <PageBackButton
              onClick={handleReportsBack}
              ariaLabel={
                selectedExpenseNameKey
                  ? 'Back to expense names'
                  : selectedPurchaseSupplierKey
                    ? 'Back to suppliers'
                    : !focusSection && activeSection !== 'all'
                      ? 'Back to all reports'
                      : 'Back'
              }
            />
          }
          right={<PageCloseButton onClick={onClose} ariaLabel="Close reports" />}
        />
        <div className="reports-top">
          <header className="reports-head page-head--corners">
            <div className="reports-head-text">
              <h1 className="reports-title">
                {selectedExpenseNameGroup
                  ? selectedExpenseNameGroup.name
                  : selectedPurchaseSupplier
                    ? selectedPurchaseSupplier.shopName
                    : focusSection
                      ? activeSection === 'expense-report'
                        ? '📤 Expense Report'
                        : activeSection === 'not-sale'
                          ? '📥 Not sale · cash in'
                          : SECTION_TABS.find((tab) => tab.id === visibleSection)?.label ?? 'Report'
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
              <label
                className={`reports-date-pick reports-date-pick--month ${datePreset === 'monthPick' ? 'reports-date-pick--active' : ''}`}
              >
                <span>Month</span>
                <select
                  className="reports-month-select"
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value)
                    setDatePreset('monthPick')
                  }}
                  disabled={monthOptions.length === 0}
                  aria-label="Pick month for report"
                >
                  {monthOptions.length === 0 ? (
                    <option value="">No data yet</option>
                  ) : (
                    monthOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))
                  )}
                </select>
              </label>
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
              <div className="reports-summary reports-summary--all reports-summary--overview reports-summary--overview-wide">
                <button
                  type="button"
                  className="reports-summary-card reports-summary-card--green reports-summary-card--expandable"
                  onClick={() => selectSection('sales')}
                >
                  <span>Total sales</span>
                  <strong>{formatMoney(overviewSalesTotals.totalBills)}</strong>
                  <small>
                    {overviewSalesTotals.billCount} bill{overviewSalesTotals.billCount === 1 ? '' : 's'} collected
                    <br />
                    💵 {formatMoney(overviewSalesChannelTotals.cash)} · 🏦{' '}
                    {formatMoney(overviewSalesChannelTotals.bank)}
                  </small>
                  <span className="reports-summary-card-chevron" aria-hidden="true">
                    ▸
                  </span>
                </button>
                <button
                  type="button"
                  className="reports-summary-card reports-summary-card--orange reports-summary-card--expandable"
                  onClick={() => selectSection('expense')}
                >
                  <span>Total expense</span>
                  {expenseHasLoanActivity(expenseTimelineSummary) ? (
                    <ExpenseAfterLoanSummary
                      grossTotal={combinedExpenseTotal}
                      afterTotal={expenseTotalAfterLoanSettlement(expenseTimelineSummary)}
                      variant="card"
                    />
                  ) : (
                    <strong>{formatMoney(combinedExpenseTotal)}</strong>
                  )}
                  <small>
                    Normal {formatMoney(expenseTimelineSummary.expenseTotal)} · Purchase{' '}
                    {formatMoney(expenseTimelineSummary.purchaseTotal)}
                    {expenseTimelineSummary.loanGivenOriginalTotal > 0 ? (
                      <>
                        {' '}
                        · Loan given {formatMoney(expenseTimelineSummary.loanGivenOriginalTotal)}
                      </>
                    ) : expenseTimelineSummary.loanTotal > 0 ? (
                      <> · Loan {formatMoney(expenseTimelineSummary.loanTotal)}</>
                    ) : null}
                    {expenseTimelineSummary.loanBorrowRepaidTotal > 0 ? (
                      <>
                        {expenseTimelineSummary.loanGivenOriginalTotal > 0 ||
                        expenseTimelineSummary.loanTotal > 0
                          ? ' ·'
                          : ' '}
                        Settlement {formatMoney(expenseTimelineSummary.loanBorrowRepaidTotal)}
                      </>
                    ) : null}
                    {expenseTimelineSummary.loanGivenOriginalTotal > 0 ? (
                      <>
                        <br />
                        Settled expense {formatMoney(expenseTimelineSummary.loanGivenSettledTotal)} · Open{' '}
                        {formatMoney(expenseTimelineSummary.loanGivenUnsettledTotal)}
                      </>
                    ) : null}
                  </small>
                  <span className="reports-summary-card-chevron" aria-hidden="true">
                    ▸
                  </span>
                </button>
                <button
                  type="button"
                  className="reports-summary-card reports-summary-card--not-sale reports-summary-card--expandable"
                  onClick={() => selectSection('not-sale')}
                >
                  <span>Not sale · cash in</span>
                  <strong>{formatMoney(notSaleInflowTotals.total)}</strong>
                  <small>
                    {notSaleInflowTotals.count} item{notSaleInflowTotals.count === 1 ? '' : 's'}
                    <br />
                    💵 Counter {formatMoney(notSaleInflowTotals.cashTotal)} · 🏦 Bank{' '}
                    {formatMoney(notSaleInflowTotals.bankTotal)}
                  </small>
                  <span className="reports-summary-card-chevron" aria-hidden="true">
                    ▸
                  </span>
                </button>
                <div className="reports-summary-card reports-summary-card--collected">
                  <span>Sales + not sale</span>
                  <strong>{formatMoney(totalCollectedWithNotSale)}</strong>
                  <small>
                    Sales {formatMoney(overviewSalesTotals.totalBills)} + Not sale{' '}
                    {formatMoney(notSaleInflowTotals.total)}
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

            {activeSection === 'sales' && salesDateMode === 'collected' ? (
              <div className="reports-summary reports-summary--single">
                <div className="reports-summary-card reports-summary-card--green">
                  <span>Total sales</span>
                  <strong>{formatMoney(salesTotals.totalBills)}</strong>
                  <small>
                    {salesTotals.billCount} bill{salesTotals.billCount === 1 ? '' : 's'} collected ·{' '}
                    {formatCollectedSalesBreakdown(salesTotals.cashTotal, salesTotals.bankTotal)}
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
              <div
                className={`reports-summary reports-summary--single ${activeSection === 'not-sale' ? 'reports-summary--not-sale-head' : ''}`}
              >
                {activeSection === 'not-sale' && (
                  <>
                    <div className="reports-summary-card reports-summary-card--green">
                      <span>Total sales</span>
                      <strong>{formatMoney(overviewSalesTotals.totalBills)}</strong>
                      <small>
                        {overviewSalesTotals.billCount} bill
                        {overviewSalesTotals.billCount === 1 ? '' : 's'} collected · 💵{' '}
                        {formatMoney(overviewSalesChannelTotals.cash)} · 🏦{' '}
                        {formatMoney(overviewSalesChannelTotals.bank)}
                      </small>
                    </div>
                    <div className="reports-summary-card reports-summary-card--not-sale">
                      <span>Not sale · cash in</span>
                      <strong>{formatMoney(notSaleInflowTotals.total)}</strong>
                      <small>
                        {notSaleInflowTotals.count} item{notSaleInflowTotals.count === 1 ? '' : 's'} · 💵 Counter{' '}
                        {formatMoney(notSaleInflowTotals.cashTotal)} · 🏦 Bank{' '}
                        {formatMoney(notSaleInflowTotals.bankTotal)}
                      </small>
                    </div>
                    <div className="reports-summary-card reports-summary-card--collected">
                      <span>Sales + not sale</span>
                      <strong>{formatMoney(totalCollectedWithNotSale)}</strong>
                      <small>
                        Sales {formatMoney(overviewSalesTotals.totalBills)} + Not sale{' '}
                        {formatMoney(notSaleInflowTotals.total)}
                      </small>
                    </div>
                  </>
                )}
                {activeSection === 'credit' && (
                  <div className="reports-summary-card">
                    <span>Credit open</span>
                    <strong>{formatMoney(creditTotals.pendingTotal)}</strong>
                    <small>
                      Total {formatMoney(creditTotals.total)} · Paid {formatMoney(creditTotals.paidTotal)}
                      {chequeOverview.totalPending > 0
                        ? ` · Cheque open ${formatMoney(chequeOverview.totalPending)}`
                        : ''}
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
                    {filteredExpenseTimelineSummary.loanGivenOriginalTotal > 0 ||
                    filteredExpenseTimelineSummary.loanBorrowRepaidTotal > 0 ? (
                      <ExpenseAfterLoanSummary
                        grossTotal={expenseGrossTotal(filteredExpenseTimelineSummary)}
                        afterTotal={expenseTotalAfterLoanSettlement(filteredExpenseTimelineSummary)}
                        variant="card"
                      />
                    ) : (
                      <strong>{formatMoney(expenseGrossTotal(filteredExpenseTimelineSummary))}</strong>
                    )}
                    <small>
                      {filteredExpenseTimeline.length} items · chronological
                      {expensePayChannel !== 'all' ? ` · ${expensePayChannel}` : ''}
                    </small>
                  </div>
                )}
                {activeSection === 'expense-report' && (
                  <div className="reports-summary-card reports-summary-card--orange">
                    <span>Expense Report</span>
                    {loanOutflowTotals.givenOriginalTotal > 0 ||
                    loanOutflowTotals.borrowRepaidTotal > 0 ? (
                      <ExpenseAfterLoanSummary
                        grossTotal={analyzedExpenseTotal}
                        afterTotal={analyzedExpenseAfterLoan}
                        variant="card"
                      />
                    ) : (
                      <strong>{formatMoney(analyzedExpenseTotal)}</strong>
                    )}
                    <small>
                      Names {formatMoney(expenseTotals.total)}
                      {loanOutflowTotals.givenOriginalTotal > 0
                        ? ` · Loan given ${formatMoney(loanOutflowTotals.givenOriginalTotal)} · Settled ${formatMoney(loanOutflowTotals.givenSettledTotal)} · Open ${formatMoney(loanOutflowTotals.givenUnsettledTotal)}`
                        : ''}
                      {loanOutflowTotals.borrowRepaidTotal > 0
                        ? ` · Settlement ${formatMoney(loanOutflowTotals.borrowRepaidTotal)}`
                        : ''}
                      {expensePayChannel !== 'all' ? ` · ${expensePayChannel}` : ''}
                    </small>
                  </div>
                )}
                {activeSection === 'cheque' && (
                  <div className="reports-summary-card">
                    <span>Cheque</span>
                    <strong>{formatMoney(chequeTotals.total)}</strong>
                    <small>
                      Pending {formatMoney(chequeTotals.pendingTotal)} · {chequeTotals.pendingCount} waiting
                      {creditOverview.totalPending > 0
                        ? ` · Credit open ${formatMoney(creditOverview.totalPending)}`
                        : ''}
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
                <ReportsSectionHead
                  title="💰 Sales"
                  amount={formatMoney(overviewSalesTotals.totalBills)}
                  onOpen={() => selectSection('sales')}
                />
              ) : null}
            <section className="reports-section">
              <p className="reports-list-meta">
                {(activeSection === 'all' ? overviewSalesBills : salesBills).length} sale
                {(activeSection === 'all' ? overviewSalesBills : salesBills).length === 1 ? '' : 's'}
                {activeSection === 'all' || salesDateMode === 'collected'
                  ? ' · by collected date'
                  : ' · by bill date'}
                {activeSection === 'all' ? (
                  <>
                    {' '}
                    · 💵 {formatMoney(overviewSalesChannelTotals.cash)} · 🏦{' '}
                    {formatMoney(overviewSalesChannelTotals.bank)}
                  </>
                ) : null}
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

            {activeSection === 'all' ? (
              <>
                <ReportsSectionHead
                  title="📥 Not sale · cash in"
                  amount={formatMoney(notSaleInflowTotals.total)}
                  onOpen={() => selectSection('not-sale')}
                />
                <section className="reports-section">
                  <p className="reports-list-meta">
                    {notSaleInflowItems.length} item{notSaleInflowItems.length === 1 ? '' : 's'} · not
                    sales · 💵 {formatMoney(notSaleInflowTotals.cashTotal)} · 🏦{' '}
                    {formatMoney(notSaleInflowTotals.bankTotal)}
                  </p>
                  {notSaleInflowItems.length === 0 ? (
                    <p className="reports-empty">No not-sale credits for this period.</p>
                  ) : (
                    <ul className="reports-list">
                      {notSaleInflowItems.slice(0, 8).map((row, index) => (
                        <NotSaleInflowReportRow key={row.id} row={row} index={index + 1} />
                      ))}
                    </ul>
                  )}
                  {notSaleInflowItems.length > 0 ? (
                    <button
                      type="button"
                      className="reports-supplier-btn reports-expense-open-btn"
                      onClick={() => selectSection('not-sale')}
                    >
                      <div className="reports-item-meta">View all not sale credits →</div>
                    </button>
                  ) : null}
                </section>
              </>
            ) : null}
            </>
          )}

          {activeSection === 'not-sale' ? (
            <section className="reports-section">
              <NotSaleInflowSection
                items={notSaleInflowItems}
                totals={notSaleInflowTotals}
                salesTotal={overviewSalesTotals.totalBills}
                salesBillCount={overviewSalesTotals.billCount}
                totalWithNotSale={totalCollectedWithNotSale}
              />
            </section>
          ) : null}

          {showSection('purchase') && (
            <>
              {activeSection === 'all' ? (
                <ReportsSectionHead
                  title="🛒 Purchase"
                  amount={formatMoney(purchaseTotals.total)}
                  onOpen={() => selectSection('purchase')}
                />
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
                <ReportsSectionHead
                  title="📤 Expense"
                  amount={formatMoney(combinedExpenseTotal)}
                  onOpen={() => selectSection('expense')}
                />
              ) : null}
              <section className="reports-section">
                {(activeSection === 'expense' || activeSection === 'all') && (
                  <>
                    {activeSection === 'expense' ? (
                      <>
                        <div className="reports-pay-channel-bar" role="group" aria-label="Expense payment channel">
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
                              className={`reports-date-chip ${expensePayChannel === opt.id ? 'reports-date-chip--active' : ''}`}
                              onClick={() => setExpensePayChannel(opt.id)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div className="reports-pay-channel-bar" role="group" aria-label="Expense sort">
                          <button
                            type="button"
                            className={`reports-date-chip ${expenseTimelineSort === 'time-desc' ? 'reports-date-chip--active' : ''}`}
                            onClick={() => setExpenseTimelineSort('time-desc')}
                          >
                            Latest first
                          </button>
                          <button
                            type="button"
                            className={`reports-date-chip ${expenseTimelineSort === 'time-asc' ? 'reports-date-chip--active' : ''}`}
                            onClick={() => setExpenseTimelineSort('time-asc')}
                          >
                            Oldest first
                          </button>
                        </div>
                        {filteredExpenseTimeline.length > 4 ? (
                          <input
                            type="search"
                            className="reports-inline-search"
                            value={expenseNameSearch}
                            onChange={(e) => setExpenseNameSearch(e.target.value)}
                            placeholder="Search expense…"
                            autoComplete="off"
                            aria-label="Search expenses"
                          />
                        ) : null}
                      </>
                    ) : null}
                    {activeSection === 'expense' || activeSection === 'all' ? (
                      <ExpenseReportSummaryBreakdown
                        summary={filteredExpenseTimelineSummary}
                        itemCount={
                          activeSection === 'expense' ? filteredExpenseTimeline.length : undefined
                        }
                        channelLabel={expensePayChannel !== 'all' ? expensePayChannel : undefined}
                      />
                    ) : null}
                    {filteredExpenseTimeline.length === 0 ? (
                      <p className="reports-empty">No expenses for this period.</p>
                    ) : (
                      <ul className="reports-list">
                        {(activeSection === 'all'
                          ? filteredExpenseTimeline.slice(0, 8)
                          : filteredExpenseTimeline
                        ).map((entry, index) => (
                          <ExpenseTimelineReportRow
                            key={`${entry.kind}:${entry.id}`}
                            entry={entry}
                            index={index + 1}
                            expanded={expandedReportKey === `expense-tl:${entry.kind}:${entry.id}`}
                            onToggle={() =>
                              toggleReportExpand(`expense-tl:${entry.kind}:${entry.id}`)
                            }
                          />
                        ))}
                      </ul>
                    )}
                    {activeSection === 'all' && filteredExpenseTimeline.length > 8 ? (
                      <button
                        type="button"
                        className="reports-supplier-btn reports-expense-open-btn"
                        onClick={() => setActiveSection('expense')}
                      >
                        <div className="reports-item-meta">View all expenses in order →</div>
                      </button>
                    ) : null}
                  </>
                )}
              </section>
            </>
          )}

          {showSection('expense-report') && (
            <>
              <section className="reports-section">
                <div className="reports-pay-channel-bar" role="group" aria-label="Expense report channel">
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
                      className={`reports-date-chip ${expensePayChannel === opt.id ? 'reports-date-chip--active' : ''}`}
                      onClick={() => {
                        setExpensePayChannel(opt.id)
                        setSelectedExpenseNameKey(null)
                        setExpandedReportKey(null)
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {!selectedExpenseNameGroup ? (
                  <>
                    <p className="reports-list-meta">
                      {filteredExpenseNameGroups.length} name
                      {filteredExpenseNameGroups.length === 1 ? '' : 's'} ·{' '}
                      {expenseTotals.count} expense
                      {expenseTotals.count === 1 ? '' : 's'} · {formatMoney(analyzedExpenseTotal)} · by
                      name %
                    </p>
                    {expenseNameGroups.length > 4 ? (
                      <input
                        type="search"
                        className="reports-inline-search"
                        value={expenseNameSearch}
                        onChange={(e) => setExpenseNameSearch(e.target.value)}
                        placeholder="Search expense name…"
                        autoComplete="off"
                        aria-label="Search expense names"
                      />
                    ) : null}
                    {filteredExpenseNameGroups.length === 0 && loanOutflowItems.length === 0 ? (
                      <p className="reports-empty">No expenses for this period.</p>
                    ) : (
                      <ul className="reports-list">
                        {filteredExpenseNameGroups.map((group) => (
                          <li key={group.nameKey} className="reports-item reports-item--tap">
                            <button
                              type="button"
                              className="reports-supplier-btn"
                              onClick={() => {
                                setSelectedExpenseNameKey(group.nameKey)
                                setExpandedReportKey(null)
                                bodyRef.current?.scrollTo({ top: 0 })
                              }}
                            >
                              <div className="reports-item-head">
                                <span className="reports-item-title">{group.name}</span>
                                <span className="reports-item-amount">{formatMoney(group.total)}</span>
                              </div>
                              <div className="reports-item-meta">
                                {group.count} expense{group.count === 1 ? '' : 's'} · 💵{' '}
                                {formatMoney(group.cashTotal)} · 🏦 {formatMoney(group.bankTotal)}
                                {expenseTotals.total > 0
                                  ? ` · ${((group.total / expenseTotals.total) * 100).toFixed(0)}%`
                                  : ''}
                              </div>
                            </button>
                          </li>
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
                  </>
                ) : (
                  <>
                    {selectedExpenseAnalysis ? (
                      <div className="reports-expense-analysis" aria-label="Expense name analysis">
                        <div className="reports-supplier-summary">
                          <span>
                            {selectedExpenseAnalysis.count} expense
                            {selectedExpenseAnalysis.count === 1 ? '' : 's'} in {periodLabel}
                          </span>
                          <strong>{formatMoney(selectedExpenseAnalysis.total)}</strong>
                        </div>
                        <div className="reports-expense-analysis-grid">
                          <div className="reports-expense-analysis-card">
                            <span>Average</span>
                            <strong>{formatMoney(selectedExpenseAnalysis.average)}</strong>
                          </div>
                          <div className="reports-expense-analysis-card">
                            <span>Share of expenses</span>
                            <strong>{selectedExpenseAnalysis.shareOfPeriod.toFixed(0)}%</strong>
                          </div>
                          <div className="reports-expense-analysis-card">
                            <span>Cash</span>
                            <strong>{formatMoney(selectedExpenseAnalysis.cashTotal)}</strong>
                          </div>
                          <div className="reports-expense-analysis-card">
                            <span>Bank</span>
                            <strong>{formatMoney(selectedExpenseAnalysis.bankTotal)}</strong>
                          </div>
                        </div>
                        {selectedExpenseAnalysis.largest ? (
                          <p className="reports-expense-analysis-note">
                            Largest: {formatMoney(selectedExpenseAnalysis.largest.amount)} ·{' '}
                            {formatDate(selectedExpenseAnalysis.largest.date)} ·{' '}
                            {selectedExpenseAnalysis.largest.payLabel}
                          </p>
                        ) : null}
                        {selectedExpenseAnalysis.topByAmount.length > 1 ? (
                          <div className="reports-expense-top">
                            <span className="reports-expense-top-title">Top amounts</span>
                            <ul className="reports-expense-top-list">
                              {selectedExpenseAnalysis.topByAmount.map((row, index) => (
                                <li key={row.id}>
                                  <span>
                                    #{index + 1} · {formatDate(row.date)} · {row.payLabel}
                                  </span>
                                  <strong>{formatMoney(row.amount)}</strong>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="reports-list-meta">All entries · newest first · tap for details</p>
                    <ul className="reports-list">
                      {selectedExpenseNameGroup.items.map((row, index) => (
                        <ExpenseReportRow
                          key={row.id}
                          row={row}
                          index={index + 1}
                          expanded={expandedReportKey === `expense:${row.id}`}
                          onToggle={() => toggleReportExpand(`expense:${row.id}`)}
                        />
                      ))}
                    </ul>
                  </>
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
                                  {(() => {
                                    const peer = chequeOverview.customers.find(
                                      (row) =>
                                        row.name.trim().toLowerCase() ===
                                        customer.name.trim().toLowerCase(),
                                    )
                                    return peer && peer.pendingAmount > 0
                                      ? ` · Cheque ${formatMoney(peer.pendingAmount)}`
                                      : ''
                                  })()}
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
              ) : (
                <div className="reports-dues-actions">
                  <button
                    type="button"
                    className="reports-dues-pdf-btn"
                    disabled={creditOverview.openBillCount === 0}
                    onClick={() => printCreditDuesReport(data)}
                  >
                    PDF / Print all credit dues ({formatMoney(creditOverview.totalPending)})
                  </button>
                </div>
              )}
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
              ) : (
                <div className="reports-dues-actions">
                  <button
                    type="button"
                    className="reports-dues-pdf-btn"
                    disabled={chequeOverview.openBillCount === 0}
                    onClick={() => printChequeDuesReport(data)}
                  >
                    PDF / Print all cheque dues ({formatMoney(chequeOverview.totalPending)})
                  </button>
                </div>
              )}
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

function ExpenseReportSummaryBreakdown({
  summary,
  itemCount,
  channelLabel,
}: {
  summary: ExpenseTimelineSummary
  itemCount?: number
  channelLabel?: string
}) {
  const gross = expenseGrossTotal(summary)
  const after = expenseTotalAfterLoanSettlement(summary)
  const loanCombined = expenseLoanCombinedTotal(summary)
  const loanCombinedCash = summary.loanCash + summary.loanBorrowRepaidCash
  const loanCombinedBank = summary.loanBank + summary.loanBorrowRepaidBank
  const hasLoanGiven = summary.loanGivenOriginalTotal > 0 || summary.loanTotal > 0
  const hasLoanActivity = expenseHasLoanActivity(summary)

  return (
    <div className="reports-expense-breakdown">
      <div className="reports-expense-breakdown-row reports-expense-breakdown-row--total">
        <span>Expense</span>
        <strong>{formatMoney(gross)}</strong>
      </div>
      <p className="reports-expense-breakdown-meta">
        Normal {formatMoney(summary.expenseTotal)}
        {summary.purchaseTotal > 0 ? ` · Purchase ${formatMoney(summary.purchaseTotal)}` : ''}
        {hasLoanGiven ? ` · Loan given ${formatMoney(summary.loanGivenOriginalTotal || summary.loanTotal)}` : ''}
        {summary.loanBorrowRepaidTotal > 0
          ? ` · Settlement ${formatMoney(summary.loanBorrowRepaidTotal)}`
          : ''}
        {itemCount != null ? ` · ${itemCount} items` : ''}
        {channelLabel ? ` · ${channelLabel}` : ''}
      </p>

      {hasLoanGiven && summary.loanGivenSettledTotal > 0 ? (
        <>
          <div className="reports-expense-breakdown-row reports-expense-breakdown-row--settled">
            <span>Settled expense</span>
            <strong>{formatMoney(summary.loanGivenSettledTotal)}</strong>
          </div>
          <p className="reports-expense-breakdown-meta">
            Collected back on loans · Open {formatMoney(summary.loanGivenUnsettledTotal)}
          </p>
        </>
      ) : null}

      {hasLoanActivity ? (
        <>
          <div className="reports-expense-breakdown-row reports-expense-breakdown-row--after">
            <span>After loan settlement</span>
            <strong>{formatMoney(after)}</strong>
          </div>
          <p className="reports-expense-breakdown-meta">
            Normal + purchase
            {hasLoanGiven && summary.loanGivenUnsettledTotal > 0
              ? ` · Open loan given ${formatMoney(summary.loanGivenUnsettledTotal)}`
              : hasLoanGiven
                ? ' · Loan given settled'
                : ''}
            {summary.loanBorrowRepaidTotal > 0 ? ' · Borrow repayments excluded' : ''}
          </p>
        </>
      ) : null}

      {hasLoanActivity ? (
        <>
          <div className="reports-expense-breakdown-row reports-expense-breakdown-row--loan">
            <span>Loan</span>
            <strong>{formatMoney(loanCombined)}</strong>
          </div>
          <p className="reports-expense-breakdown-meta">
            {hasLoanGiven
              ? `Given ${formatMoney(summary.loanGivenOriginalTotal || summary.loanTotal)}`
              : null}
            {summary.loanBorrowRepaidTotal > 0
              ? `${hasLoanGiven ? ' · ' : ''}Settlement ${formatMoney(summary.loanBorrowRepaidTotal)}`
              : null}
            <br />
            💵 Cash {formatMoney(loanCombinedCash)} · 🏦 Bank {formatMoney(loanCombinedBank)}
          </p>
        </>
      ) : null}
    </div>
  )
}

function ExpenseAfterLoanSummary({
  grossTotal,
  afterTotal,
  variant = 'card',
}: {
  grossTotal: number
  afterTotal: number
  variant?: 'card' | 'inline' | 'banner'
}) {
  const differs = grossTotal !== afterTotal
  return (
    <div className={`expense-after-loan expense-after-loan--${variant}`}>
      {differs ? (
        <span className="expense-after-loan-gross">{formatMoney(grossTotal)}</span>
      ) : null}
      <span className="expense-after-loan-label">After loan settlement</span>
      <strong className="expense-after-loan-amount">{formatMoney(afterTotal)}</strong>
    </div>
  )
}

function LoanGivenAmountStack({ original, open }: { original: number; open: number }) {
  return (
    <div className="loan-given-amount-stack">
      <span className="loan-given-amount-stack-original">-{formatMoney(original)}</span>
      <span className="loan-given-amount-stack-open">Open {formatMoney(open)}</span>
    </div>
  )
}

function NotSaleInflowSection({
  items,
  totals,
  salesTotal,
  salesBillCount,
  totalWithNotSale,
}: {
  items: NotSaleInflowItem[]
  totals: ReturnType<typeof summarizeNotSaleInflow>
  salesTotal: number
  salesBillCount: number
  totalWithNotSale: number
}) {
  return (
    <>
      <div className="reports-summary reports-summary--not-sale-detail">
        <div className="reports-summary-card reports-summary-card--green">
          <span>Total sales</span>
          <strong>{formatMoney(salesTotal)}</strong>
          <small>
            {salesBillCount} bill{salesBillCount === 1 ? '' : 's'} collected · bill payments only
          </small>
        </div>
        <div className="reports-summary-card reports-summary-card--not-sale">
          <span>Not sale · cash in</span>
          <strong>{formatMoney(totals.total)}</strong>
          <small>{totals.count} add{totals.count === 1 ? '' : 's'} · not sales</small>
        </div>
        <div className="reports-summary-card reports-summary-card--collected">
          <span>Sales + not sale</span>
          <strong>{formatMoney(totalWithNotSale)}</strong>
          <small>
            Sales {formatMoney(salesTotal)} + Not sale {formatMoney(totals.total)}
          </small>
        </div>
        <div className="reports-summary-card">
          <span>Cash in · counter</span>
          <strong>{formatMoney(totals.cashTotal)}</strong>
        </div>
        <div className="reports-summary-card">
          <span>Cash in · bank</span>
          <strong>{formatMoney(totals.bankTotal)}</strong>
        </div>
      </div>
      <p className="reports-list-meta">
        {items.length} cash-in{items.length === 1 ? '' : 's'} · by date received · Add to Counter / Bank only
      </p>
      {items.length === 0 ? (
        <p className="reports-empty">No not-sale credits for this period.</p>
      ) : (
        <ul className="reports-list">
          {items.map((row, index) => (
            <NotSaleInflowReportRow key={row.id} row={row} index={index + 1} detailed />
          ))}
        </ul>
      )}
    </>
  )
}

function ReportsSectionHead({
  title,
  amount,
  onOpen,
}: {
  title: string
  amount: string
  onOpen?: () => void
}) {
  if (!onOpen) {
    return (
      <div className="reports-section-head">
        <h2>{title}</h2>
        <strong>{amount}</strong>
      </div>
    )
  }
  return (
    <button type="button" className="reports-section-head reports-section-head--tap" onClick={onOpen}>
      <h2>{title}</h2>
      <strong>{amount}</strong>
      <span className="reports-section-head-chevron" aria-hidden="true">
        →
      </span>
    </button>
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
          {salesTotals.billCount} bills · tap to list ·{' '}
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
        <span>Old Credit &amp; Cheque &amp; Pending</span>
        <strong>{formatMoney(salesTotals.oldCreditChequeCollected)}</strong>
        <small>
          {oldCreditChequeCount} from earlier pending · already in Sales collected
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
        A part payment does not move the remaining balance to today. Older pending collected today stays in
        Sales collected / Old Credit &amp; Cheque &amp; Pending.
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
        Old credit, cheque &amp; pending collected today · {formatMoney(total)} · already counted in Sales
        collected (that day&apos;s total)
      </p>
      {rows.length === 0 ? (
        <p className="reports-empty">No old credit, cheque or pending collected in this period.</p>
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

function NotSaleInflowReportRow({
  row,
  index,
  detailed = false,
}: {
  row: NotSaleInflowItem
  index: number
  detailed?: boolean
}) {
  return (
    <li className={`reports-item ${detailed ? 'reports-item--not-sale-detail' : ''}`}>
      <div className="reports-item-head">
        <span className="reports-item-title">{row.name}</span>
        <span className="reports-item-amount reports-item-amount--in reports-item-amount--not-sale">
          +{formatMoney(row.amount)}
        </span>
      </div>
      <div className="reports-item-meta">
        #{index} · {notSaleInflowKindLabel(row)} · {row.payLabel}
      </div>
      <div className="reports-item-meta reports-item-meta--detail reports-not-sale-date">
        <strong>{formatDate(row.date)}</strong> {formatTime(row.date)}
        {detailed ? (
          <>
            {' '}
            · Received on this date · 💵 {formatMoney(row.cashAmount)} · 🏦{' '}
            {formatMoney(row.bankAmount)}
          </>
        ) : null}
      </div>
      {detailed ? (
        <div className="reports-item-meta reports-item-meta--detail">{row.detail}</div>
      ) : (
        <div className="reports-item-meta reports-item-meta--detail">
          {row.detail} · 💵 {formatMoney(row.cashAmount)} · 🏦 {formatMoney(row.bankAmount)}
        </div>
      )}
    </li>
  )
}

function ExpenseTimelineReportRow({
  entry,
  index,
  expanded,
  onToggle,
}: {
  entry: ExpenseTimelineEntry
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const isLoanGiven =
    entry.kind === 'loan' &&
    entry.loanOutflowKind === 'given' &&
    entry.loanOriginalAmount != null
  const isBorrowRepaid = entry.kind === 'loan' && entry.loanOutflowKind === 'borrow-repaid'
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''} ${isLoanGiven ? 'reports-item--loan-given' : ''} ${isBorrowRepaid ? 'reports-item--loan-borrow-repaid' : ''}`}
      data-report-key={`expense-tl:${entry.kind}:${entry.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">{entry.title}</span>
          {isLoanGiven ? (
            <LoanGivenAmountStack
              original={entry.loanOriginalAmount ?? entry.amount}
              open={entry.loanUnsettledAmount ?? 0}
            />
          ) : isBorrowRepaid ? (
            <span className="reports-item-amount reports-item-amount--loan-repay">
              -{formatMoney(entry.amount)}
            </span>
          ) : (
            <span className="reports-item-amount">-{formatMoney(entry.amount)}</span>
          )}
        </div>
        <div className="reports-item-meta">
          #{index} · {expenseTimelineKindLabel(entry.kind)} · {entry.payLabel} ·{' '}
          {formatDate(entry.date)} {formatTime(entry.date)}
          {isLoanGiven ? (
            <>
              {' '}
              · Settled {formatMoney(entry.loanSettledAmount ?? 0)}
            </>
          ) : isBorrowRepaid ? (
            <> · Loan settlement</>
          ) : null}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Name', value: entry.title },
            { label: 'Type', value: expenseTimelineKindLabel(entry.kind) },
            { label: 'Date', value: `${formatDate(entry.date)} ${formatTime(entry.date)}` },
            { label: 'Amount', value: formatMoney(entry.amount) },
            ...(isLoanGiven
              ? [
                  { label: 'Original', value: formatMoney(entry.loanOriginalAmount ?? entry.amount) },
                  { label: 'Settled', value: formatMoney(entry.loanSettledAmount ?? 0) },
                  { label: 'Open', value: formatMoney(entry.loanUnsettledAmount ?? 0) },
                ]
              : []),
            { label: 'Payment', value: entry.payDetail },
            ...(entry.detail ? [{ label: 'Details', value: entry.detail }] : []),
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
            {formatDate(row.date)} · {row.payLabel}
          </span>
          <span className="reports-item-amount">{formatMoney(row.amount)}</span>
        </div>
        <div className="reports-item-meta">
          #{index} · {formatTime(row.date)} · {row.payDetail}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Name', value: row.name },
            { label: 'Date', value: `${formatDate(row.date)} ${formatTime(row.date)}` },
            { label: 'Amount', value: formatMoney(row.amount) },
            { label: 'Cash', value: formatMoney(row.cashAmount) },
            { label: 'Bank', value: formatMoney(row.bankAmount) },
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
  const kindLabel = row.kind === 'given' ? 'Loan given' : 'Loan settlement'
  const payLabel = row.paySource === 'bank' ? '🏦 Bank' : '💵 Cash'
  const isLoanGiven = row.kind === 'given'
  const isBorrowRepaid = row.kind === 'borrow-repaid'
  return (
    <li
      className={`reports-item reports-item--tap ${expanded ? 'reports-item--expanded' : ''} ${isLoanGiven ? 'reports-item--loan-given' : ''} ${isBorrowRepaid ? 'reports-item--loan-borrow-repaid' : ''}`}
      data-report-key={`loan-out:${row.id}`}
    >
      <button type="button" className="reports-item-btn" onClick={onToggle}>
        <div className="reports-item-head">
          <span className="reports-item-title">
            Loan #{index} · {row.name}
          </span>
          {isLoanGiven ? (
            <LoanGivenAmountStack
              original={row.originalAmount ?? row.amount}
              open={row.unsettledAmount ?? 0}
            />
          ) : isBorrowRepaid ? (
            <span className="reports-item-amount reports-item-amount--loan-repay">
              -{formatMoney(row.amount)}
            </span>
          ) : (
            <span className="reports-item-amount">{formatMoney(row.amount)}</span>
          )}
        </div>
        <div className="reports-item-meta">
          {formatDate(row.date)} · {kindLabel} · {payLabel}
          {isLoanGiven ? ` · Settled ${formatMoney(row.settledAmount ?? 0)}` : ''}
          {isBorrowRepaid ? ' · Settlement' : ''}
        </div>
      </button>
      {expanded ? (
        <ReportDetailGrid
          rows={[
            { label: 'Name', value: row.name },
            { label: 'Date', value: formatDate(row.date) },
            { label: 'Amount', value: formatMoney(row.amount) },
            ...(row.kind === 'given'
              ? [
                  {
                    label: 'Original',
                    value: formatMoney(row.originalAmount ?? row.amount),
                  },
                  { label: 'Settled', value: formatMoney(row.settledAmount ?? 0) },
                  { label: 'Open', value: formatMoney(row.unsettledAmount ?? 0) },
                ]
              : []),
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
