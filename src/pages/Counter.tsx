import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips, { type PayType } from '../components/PayTypeChips'
import PendingBillsPanel from '../components/PendingBillsPanel'
import CounterCustomerNameField, {
  type CounterCustomerNameFieldHandle,
} from '../components/CounterCustomerNameField'
import RoundTypeChips from '../components/RoundTypeChips'
import SaleReturnModal from '../components/SaleReturnModal'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { useCashActions } from '../context/CashContext'
import { useCashSnapshot } from '../hooks/useCashSnapshot'
import { useOpenTiming } from '../hooks/useOpenTiming'
import type { Sale, SaleReturnEntry } from '../types'
import { formatDate, formatMoney, parseAmount } from '../utils/format'
import { isReminderDue } from '../utils/billReminders'
import {
  getEffectiveSaleReminderAt,
  getEffectiveSaleReminderNote,
} from '../utils/customerReminders'
import { buildCustomerSummaries } from '../utils/customerLedger'
import { buildChequeCustomerSummaries } from '../utils/chequeLedger'
import { getSaleCustomerName } from '../utils/saleCustomerName'
import { saleCollectedAmount, salePendingCreditPaidBreakdown } from '../utils/salePayment'
import {
  buildSaleReturnEntry,
  saleBillGroupPaidTotal,
  saleBillPaymentLines,
  saleCreditBalanceDue,
  saleGrossBillAmount,
  saleReturnTotal,
} from '../utils/saleReturns'
import { useDeferredSearch } from '../hooks/useDeferredSearch'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { getBillRoundOptions, effectiveCollectTarget } from '../utils/roundSuggestions'
import './Counter.css'

type ActiveField =
  | 'bill'
  | 'give'
  | 'paid'
  | 'cashSplit'
  | 'bankSplit'
  | 'chequeSplit'
  | 'creditSplit'
  | 'roundCustom'

const COUNTER_PAY_TYPES: PayType[] = ['cash', 'bank', 'credit', 'split', 'cheque']
const CREDIT_COLLECT_PAY_TYPES: PayType[] = ['cash', 'bank', 'credit', 'split', 'cheque']
const CHEQUE_COLLECT_PAY_TYPES: PayType[] = ['cash', 'bank', 'credit', 'split', 'cheque']

function needsGive(payType: PayType): boolean {
  return payType === 'cash'
}

function keyboardHint(activeField: ActiveField): string {
  if (activeField === 'bill') return 'Bill Amount'
  if (activeField === 'give') return 'Customer Give'
  if (activeField === 'paid') return 'Customer Paid'
  if (activeField === 'cashSplit') return 'Cash'
  if (activeField === 'bankSplit') return 'Bank'
  if (activeField === 'chequeSplit') return 'Cheque'
  if (activeField === 'creditSplit') return 'Credit'
  if (activeField === 'roundCustom') return 'Custom round amount'
  return 'Amount'
}

function formatSplitPart(amount: number): string {
  if (amount <= 0) return '0'
  return Number.isInteger(amount) ? String(amount) : String(amount)
}

function getPaidSaleBreakdown(sale: Sale | undefined): {
  cash: number
  bank: number
  cheque: number
  total: number
} {
  const empty = { cash: 0, bank: 0, cheque: 0, total: 0 }
  if (!sale || sale.status !== 'paid') return empty

  const cash = sale.cashAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (sale.chequeApproved && cheque > 0) {
    bank = Math.max(0, bank - cheque)
  }

  if (sale.payType === 'cash') {
    const amount = cash > 0 ? cash : sale.billAmount
    return { cash: amount, bank: 0, cheque: 0, total: amount }
  }
  if (sale.payType === 'bank') {
    const amount = bank > 0 ? bank : sale.billAmount
    return { cash: 0, bank: amount, cheque: 0, total: amount }
  }
  if (sale.payType === 'cheque') {
    const amount = cheque > 0 ? cheque : sale.billAmount
    return { cash: 0, bank: 0, cheque: amount, total: amount }
  }
  if (sale.payType === 'split') {
    const total = cash + bank + cheque
    return { cash, bank, cheque, total: total > 0 ? total : sale.billAmount }
  }

  return { cash: 0, bank: 0, cheque: 0, total: sale.billAmount }
}

function getSplitParentSale(
  sales: Sale[],
  opts: {
    collectingCreditId: string | null
    collectingChequeId: string | null
    loadedPendingId: string | null
  },
): Sale | undefined {
  let parentId: string | undefined
  if (opts.collectingCreditId) {
    parentId = sales.find((sale) => sale.id === opts.collectingCreditId)?.parentSplitId
  } else if (opts.collectingChequeId) {
    parentId = sales.find((sale) => sale.id === opts.collectingChequeId)?.parentSplitId
  } else if (opts.loadedPendingId) {
    parentId = sales.find((sale) => sale.id === opts.loadedPendingId)?.parentSplitId
  }
  if (!parentId) return undefined
  return sales.find((sale) => sale.id === parentId)
}

function getPendingBillPayType(bill: Sale): PayType {
  if (bill.pendingPayType === 'credit' || bill.pendingPayType === 'cheque') {
    return bill.pendingPayType
  }
  if (bill.payType === 'credit' || bill.payType === 'cheque') {
    return bill.payType
  }
  if (bill.status === 'pending' && bill.parentSplitId) {
    if ((bill.chequeAmount ?? 0) > 0 && !(bill.creditAmount ?? 0)) return 'cheque'
    if ((bill.creditAmount ?? 0) > 0 && !(bill.chequeAmount ?? 0)) return 'credit'
  }
  return bill.payType ?? 'cash'
}

function findSplitChildPending(
  sales: Sale[],
  parentId: string,
): {
  chequeId: string | null
  creditId: string | null
  chequeAmount: number
  creditAmount: number
} {
  const children = sales.filter(
    (sale) => sale.parentSplitId === parentId && sale.status === 'pending',
  )
  const cheque = children.find((sale) => getPendingBillPayType(sale) === 'cheque')
  const credit = children.find((sale) => getPendingBillPayType(sale) === 'credit')
  return {
    chequeId: cheque?.id ?? null,
    creditId: credit?.id ?? null,
    chequeAmount: cheque?.billAmount ?? 0,
    creditAmount: credit?.billAmount ?? 0,
  }
}

function isChequePendingBill(bill: Sale): boolean {
  return getPendingBillPayType(bill) === 'cheque'
}

function isCreditPendingBill(bill: Sale): boolean {
  return getPendingBillPayType(bill) === 'credit'
}

function resolveLoadedPendingBill(
  sales: Sale[],
  id: string | null,
): Sale | undefined {
  if (!id) return undefined
  return sales.find((sale) => sale.id === id)
}

type SavedAction = 'collect' | 'pending' | null

function Counter({ active }: { active: boolean }) {
  useOpenTiming('Counter', active, false)
  const routeActive = active
  const { data, pendingBills } = useCashSnapshot(active)
  const {
    recordSale: recordSaleAction,
    updatePendingSale: updatePendingSaleAction,
    collectPendingSale,
    collectCreditPayment,
    collectChequePayment,
    editPaidSalePayment,
    setBillReminder,
    updateReminderAlertSettings,
    applySaleReturn,
  } = useCashActions()

  function recordSale(
    sale: Parameters<typeof recordSaleAction>[0],
  ) {
    recordSaleAction({
      ...sale,
      ...(deductDraftReturns ? { originalBillAmount: typedBillAmount } : {}),
      ...(draftReturns.length > 0 && !loadedPendingId ? { returns: draftReturns } : {}),
    })
  }

  function updatePendingSale(
    id: string,
    sale: Parameters<typeof updatePendingSaleAction>[1],
  ) {
    updatePendingSaleAction(id, {
      ...sale,
      ...(deductDraftReturns ? { originalBillAmount: typedBillAmount } : {}),
      ...(draftReturns.length > 0 && !loadedPendingId ? { returns: draftReturns } : {}),
    })
  }
  const tabData = data
  const tabSales = data.sales
  const tabPendingBills = pendingBills
  const [searchParams, setSearchParams] = useSearchParams()
  const [billStr, setBillStr] = useState('')
  const [giveStr, setGiveStr] = useState('')
  const [paidStr, setPaidStr] = useState('')
  const [cashSplitStr, setCashSplitStr] = useState('')
  const [bankSplitStr, setBankSplitStr] = useState('')
  const [chequeSplitStr, setChequeSplitStr] = useState('')
  const [creditSplitStr, setCreditSplitStr] = useState('')
  const [draftReturns, setDraftReturns] = useState<SaleReturnEntry[]>([])
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [roundOffAmount, setRoundOffAmount] = useState<number | null>(null)
  const [roundOtherActive, setRoundOtherActive] = useState(false)
  const [roundCustomStr, setRoundCustomStr] = useState('')
  const [paymentStep, setPaymentStep] = useState(false)
  const [payType, setPayType] = useState<PayType>('cash')
  const [activeField, setActiveField] = useState<ActiveField>('bill')
  const [savedAction, setSavedAction] = useState<SavedAction>(null)
  const [loadedPendingId, setLoadedPendingId] = useState<string | null>(null)
  const [nameSectionFocus, setNameSectionFocus] = useState(false)
  const [chequeListOpen, setChequeListOpen] = useState(false)
  const [highlightedChequeIndex, setHighlightedChequeIndex] = useState(-1)
  const [creditListOpen, setCreditListOpen] = useState(false)
  const [highlightedCreditIndex, setHighlightedCreditIndex] = useState(-1)
  const {
    value: chequeListSearch,
    setValue: setChequeListSearch,
    deferredValue: deferredChequeListSearch,
  } = useDeferredSearch()
  const {
    value: creditListSearch,
    setValue: setCreditListSearch,
    deferredValue: deferredCreditListSearch,
  } = useDeferredSearch()
  const [collectingCreditId, setCollectingCreditId] = useState<string | null>(null)
  const [collectingChequeId, setCollectingChequeId] = useState<string | null>(null)
  const [creditCollectDue, setCreditCollectDue] = useState(0)
  const [chequeCollectDue, setChequeCollectDue] = useState(0)
  const [chequeCollectCreditMode, setChequeCollectCreditMode] = useState(false)
  const [splitChequeApprovedAmount, setSplitChequeApprovedAmount] = useState(0)
  const [splitSiblingChequePending, setSplitSiblingChequePending] = useState(0)
  const [splitSiblingCreditPending, setSplitSiblingCreditPending] = useState(0)
  const [splitSiblingCreditPaid, setSplitSiblingCreditPaid] = useState(0)
  const [splitCreditPaidCash, setSplitCreditPaidCash] = useState(0)
  const [splitCreditPaidBank, setSplitCreditPaidBank] = useState(0)
  const [splitCreditPaidCheque, setSplitCreditPaidCheque] = useState(0)
  const [siblingChequePendingId, setSiblingChequePendingId] = useState<string | null>(null)
  const [balanceDueAmount, setBalanceDueAmount] = useState<number | null>(null)
  const [originalBillHint, setOriginalBillHint] = useState<number | null>(null)
  const [pendingSectionFocus, setPendingSectionFocus] = useState(false)
  const [highlightedPendingIndex, setHighlightedPendingIndex] = useState<number | null>(null)
  const customerNameFieldRef = useRef<CounterCustomerNameFieldHandle>(null)
  const creditExitTimerRef = useRef<number | null>(null)
  const pendingPanelRef = useRef<HTMLElement>(null)

  function getCustomerName(): string {
    return customerNameFieldRef.current?.getValue().trim() ?? ''
  }

  const customerSummaries = useMemo(() => buildCustomerSummaries(tabData), [tabData])

  const customerNameSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (let i = tabSales.length - 1; i >= 0; i--) {
      const raw = tabSales[i]?.customerName?.trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (!seen.has(key)) seen.set(key, raw)
    }
    return Array.from(seen.values())
  }, [tabSales])

  const customerPendingByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const summary of customerSummaries) {
      if (summary.totalCreditPending > 0) {
        map.set(summary.name.trim().toLowerCase(), summary.totalCreditPending)
      }
    }
    return map
  }, [customerSummaries])

  const customerChequePendingByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const summary of buildChequeCustomerSummaries(tabData)) {
      if (summary.totalChequePending > 0) {
        map.set(summary.name.trim().toLowerCase(), summary.totalChequePending)
      }
    }
    return map
  }, [tabData])

  const chequePendingBills = useMemo(
    () => tabPendingBills.filter(isChequePendingBill),
    [tabPendingBills],
  )

  const collectingCreditBill = useMemo(
    () =>
      collectingCreditId
        ? tabSales.find((sale) => sale.id === collectingCreditId)
        : undefined,
    [collectingCreditId, tabSales],
  )
  const creditCollectCustomerName = collectingCreditBill
    ? (getSaleCustomerName(collectingCreditBill, data.sales)?.trim() ||
        getCustomerName() ||
        '')
    : ''

  const creditPendingBills = useMemo(
    () => tabPendingBills.filter(isCreditPendingBill),
    [tabPendingBills],
  )

  const filteredChequePendingBills = useMemo(() => {
    const query = deferredChequeListSearch.trim().toLowerCase()
    if (!query) return chequePendingBills
    return chequePendingBills.filter((bill) => {
      const name = getSaleCustomerName(bill, data.sales)?.toLowerCase() ?? ''
      return name.includes(query) || String(bill.billAmount).includes(query)
    })
  }, [chequePendingBills, deferredChequeListSearch, data.sales])

  const filteredCreditPendingBills = useMemo(() => {
    const query = deferredCreditListSearch.trim().toLowerCase()
    if (!query) return creditPendingBills
    return creditPendingBills.filter((bill) => {
      const name = getSaleCustomerName(bill, data.sales)?.toLowerCase() ?? ''
      return name.includes(query) || String(bill.billAmount).includes(query)
    })
  }, [creditPendingBills, deferredCreditListSearch, data.sales])

  useEffect(() => {
    if (!chequeListOpen) setChequeListSearch('')
  }, [chequeListOpen, setChequeListSearch])

  useEffect(() => {
    if (!creditListOpen) setCreditListSearch('')
  }, [creditListOpen, setCreditListSearch])

  useEffect(() => {
    if (!chequeListOpen) return
    setHighlightedChequeIndex(filteredChequePendingBills.length > 0 ? 0 : -1)
  }, [deferredChequeListSearch, chequeListOpen, filteredChequePendingBills.length])

  useEffect(() => {
    if (!creditListOpen) return
    setHighlightedCreditIndex(filteredCreditPendingBills.length > 0 ? 0 : -1)
  }, [deferredCreditListSearch, creditListOpen, filteredCreditPendingBills.length])

  const chequePendingTotal = useMemo(
    () => chequePendingBills.reduce((sum, bill) => sum + bill.billAmount, 0),
    [chequePendingBills],
  )

  const creditPendingTotal = useMemo(
    () => creditPendingBills.reduce((sum, bill) => sum + bill.billAmount, 0),
    [creditPendingBills],
  )

  const billPendingBills = useMemo(
    () =>
      tabPendingBills.filter(
        (bill) => !isChequePendingBill(bill) && !isCreditPendingBill(bill),
      ),
    [tabPendingBills],
  )

  const balanceOnlyMode = balanceDueAmount != null && balanceDueAmount > 0

  const loadedPendingBill = useMemo(
    () => resolveLoadedPendingBill(tabSales, loadedPendingId),
    [tabSales, loadedPendingId],
  )

  const effectiveCollectingChequeId = useMemo((): string | null => {
    if (collectingChequeId) return collectingChequeId
    if (loadedPendingBill && isChequePendingBill(loadedPendingBill)) {
      return loadedPendingBill.id
    }
    return null
  }, [collectingChequeId, loadedPendingBill])

  const effectiveCollectingCreditId = useMemo((): string | null => {
    if (collectingCreditId) return collectingCreditId
    if (loadedPendingBill && isCreditPendingBill(loadedPendingBill)) {
      return loadedPendingBill.id
    }
    return null
  }, [collectingCreditId, loadedPendingBill])

  const showCreditSession = useMemo(
    () =>
      Boolean(collectingCreditId || effectiveCollectingCreditId) ||
      payType === 'credit' ||
      (payType === 'split' && parseAmount(creditSplitStr) > 0) ||
      (loadedPendingBill != null && isCreditPendingBill(loadedPendingBill)),
    [
      collectingCreditId,
      effectiveCollectingCreditId,
      payType,
      creditSplitStr,
      loadedPendingBill,
    ],
  )

  const showChequeSession = useMemo(
    () =>
      Boolean(effectiveCollectingChequeId) ||
      payType === 'cheque' ||
      (payType === 'split' && parseAmount(chequeSplitStr) > 0) ||
      (loadedPendingBill != null && isChequePendingBill(loadedPendingBill)),
    [effectiveCollectingChequeId, payType, chequeSplitStr, loadedPendingBill],
  )

  const creditCollectPayTypes = useMemo(
    (): PayType[] => (collectingCreditId ? CREDIT_COLLECT_PAY_TYPES : COUNTER_PAY_TYPES),
    [collectingCreditId],
  )

  const balanceCollectPayTypes = useMemo((): PayType[] => {
    if (collectingCreditId) return CREDIT_COLLECT_PAY_TYPES
    if (effectiveCollectingChequeId) return CHEQUE_COLLECT_PAY_TYPES
    return COUNTER_PAY_TYPES
  }, [collectingCreditId, effectiveCollectingChequeId])

  const collectingBalanceBillId = collectingCreditId ?? effectiveCollectingChequeId

  const typedBillAmount = parseAmount(billStr)
  const draftReturnTotal = useMemo(
    () => draftReturns.reduce((sum, row) => sum + Math.max(0, row.amount), 0),
    [draftReturns],
  )
  /** New bill: bill field is gross; deduct draft returns for pay/credit due. */
  const deductDraftReturns =
    !loadedPendingId && !balanceOnlyMode && draftReturnTotal > 0
  const billAmount = deductDraftReturns
    ? Math.max(0, typedBillAmount - draftReturnTotal)
    : typedBillAmount
  const giveAmount = parseAmount(giveStr)
  const paidAmount = parseAmount(paidStr)
  const cashSplitAmount = parseAmount(cashSplitStr)
  const bankSplitAmount = parseAmount(bankSplitStr)
  const chequeSplitAmount = parseAmount(chequeSplitStr)
  const creditSplitAmount = parseAmount(creditSplitStr)
  const chequeInSplitTotal =
    splitChequeApprovedAmount > 0 ? splitChequeApprovedAmount : chequeSplitAmount
  const dueAmount = roundOffAmount ?? billAmount
  const billCollectTarget = effectiveCollectTarget(billAmount, roundOffAmount)
  const returnGrossDisplay = deductDraftReturns
    ? typedBillAmount
    : balanceOnlyMode && originalBillHint
      ? originalBillHint
      : loadedPendingBill
        ? saleGrossBillAmount(loadedPendingBill)
        : collectingCreditBill
          ? saleGrossBillAmount(collectingCreditBill)
          : typedBillAmount
  const returnTotalDisplay = loadedPendingBill
    ? saleReturnTotal(loadedPendingBill)
    : collectingCreditBill
      ? saleReturnTotal(collectingCreditBill)
      : draftReturnTotal
  const paidSoFarDisplay = (() => {
    const bill = collectingCreditBill ?? loadedPendingBill
    if (!bill) return 0
    return saleBillGroupPaidTotal(bill, tabSales)
  })()
  /** Remaining due after collections + returns (what to collect now). */
  const balanceToPayDisplay = balanceOnlyMode
    ? (() => {
        const bill = collectingCreditBill ?? loadedPendingBill
        if (bill) {
          const due = saleCreditBalanceDue(bill, tabSales)
          if (roundOffAmount != null && roundOffAmount > 0) {
            return Math.min(roundOffAmount, due)
          }
          return due
        }
        return collectingCreditId || effectiveCollectingCreditId
          ? creditCollectDue > 0
            ? creditCollectDue
            : balanceDueAmount ?? billAmount
          : collectingChequeId || effectiveCollectingChequeId
            ? chequeCollectDue > 0
              ? chequeCollectDue
              : balanceDueAmount ?? billAmount
            : balanceDueAmount ?? billAmount
      })()
    : Math.max(0, dueAmount)
  const showBalanceBreakdown =
    returnTotalDisplay > 0 ||
    (balanceOnlyMode &&
      (paidSoFarDisplay > 0 ||
        returnTotalDisplay > 0 ||
        (returnGrossDisplay > 0 && returnGrossDisplay !== balanceToPayDisplay)))
  const canOpenReturn =
    typedBillAmount > 0 || balanceOnlyMode || (loadedPendingBill?.billAmount ?? 0) > 0

  const creditCollectLayout = Boolean(collectingCreditId || effectiveCollectingCreditId)
  const chequeCollectLayout = Boolean(effectiveCollectingChequeId)
  const showFullSplitGrid = payType === 'split'
  const creditCollectCashMode = creditCollectLayout && payType === 'cash'
  const creditCollectBankMode = creditCollectLayout && payType === 'bank'
  const creditCollectChequeMode = creditCollectLayout && payType === 'cheque'
  const chequeCollectCashMode = chequeCollectLayout && payType === 'cash'
  const chequeCollectBankMode = chequeCollectLayout && payType === 'bank'
  const chequeCollectChequeMode = chequeCollectLayout && payType === 'cheque'

  const chequeSplitCountsCredit =
    Boolean(collectingChequeId) && payType === 'split' && !chequeCollectCreditMode

  const showSplitCashGive = showFullSplitGrid && cashSplitAmount > 0

  const hideChequeSplitGive = showFullSplitGrid && chequeCollectLayout

  const creditCollectDueAmount =
    creditCollectDue > 0 ? creditCollectDue : balanceDueAmount ?? 0

  const chequeCollectDueAmount =
    chequeCollectDue > 0 ? chequeCollectDue : balanceDueAmount ?? 0

  const splitTotal =
    payType === 'split'
      ? collectingCreditId
        ? roundOffAmount ?? creditCollectDueAmount
        : collectingChequeId
          ? roundOffAmount ?? chequeCollectDueAmount
          : paidAmount > 0
            ? paidAmount
            : dueAmount
      : 0

  const creditCollectDisplayAmount = useMemo(() => {
    if (!collectingCreditId && !effectiveCollectingCreditId) return 0
    return Math.max(
      0,
      splitTotal - cashSplitAmount - bankSplitAmount - chequeSplitAmount,
    )
  }, [
    collectingCreditId,
    effectiveCollectingCreditId,
    splitTotal,
    cashSplitAmount,
    bankSplitAmount,
    chequeSplitAmount,
  ])

  const chequeCollectRemainingAmount = useMemo(() => {
    if (!collectingChequeId || chequeCollectCreditMode) return 0
    if (payType === 'split') {
      return Math.max(
        0,
        chequeCollectDueAmount -
          cashSplitAmount -
          bankSplitAmount -
          chequeSplitAmount -
          creditSplitAmount,
      )
    }
    if (payType === 'cash' || payType === 'bank' || payType === 'cheque') {
      return Math.max(0, chequeCollectDueAmount - paidAmount)
    }
    return 0
  }, [
    collectingChequeId,
    chequeCollectCreditMode,
    payType,
    chequeCollectDueAmount,
    cashSplitAmount,
    bankSplitAmount,
    chequeSplitAmount,
    creditSplitAmount,
    paidAmount,
  ])

  const chequeCollectCreditRemainder = useMemo(() => {
    if (!collectingChequeId || !chequeCollectCreditMode) return 0
    return Math.max(
      0,
      splitTotal - cashSplitAmount - bankSplitAmount - chequeSplitAmount,
    )
  }, [
    collectingChequeId,
    chequeCollectCreditMode,
    splitTotal,
    cashSplitAmount,
    bankSplitAmount,
    chequeSplitAmount,
  ])

  const loadedChequeChildOfSplit = useMemo(() => {
    if (!loadedPendingBill || !isChequePendingBill(loadedPendingBill)) return false
    if (!loadedPendingBill.parentSplitId) return false
    const parent = tabSales.find((sale) => sale.id === loadedPendingBill.parentSplitId)
    return Boolean(parent)
  }, [loadedPendingBill, tabSales])

  const isLoadedChequeSplitCollect =
    payType === 'split' &&
    balanceOnlyMode &&
    loadedPendingId != null &&
    !collectingCreditId &&
    Boolean(effectiveCollectingChequeId) &&
    loadedChequeChildOfSplit &&
    !chequeCollectCreditMode

  const splitParentSale = useMemo(
    () =>
      getSplitParentSale(tabSales, {
        collectingCreditId,
        collectingChequeId,
        loadedPendingId,
      }),
    [tabSales, collectingCreditId, collectingChequeId, loadedPendingId],
  )

  const splitParentPriorBreakdown = useMemo(
    () =>
      getPaidSaleBreakdown(
        splitParentSale?.status === 'paid' ? splitParentSale : undefined,
      ),
    [splitParentSale],
  )

  const splitParentPriorPaid = splitParentPriorBreakdown.total
  const splitParentCashPrior = splitParentPriorBreakdown.cash

  const splitOriginCollect =
    Boolean(originalBillHint) &&
    (collectingCreditId ||
      collectingChequeId ||
      isLoadedChequeSplitCollect ||
      (loadedPendingId != null && balanceOnlyMode))

  const showSplitPaidTotal = showFullSplitGrid

  const splitDueDenominator =
    splitTotal > 0
      ? splitTotal
      : collectingCreditId
        ? creditCollectDueAmount
        : collectingChequeId
          ? chequeCollectDueAmount
          : dueAmount

  const splitFieldLocked = (() => {
    const unlocked = { cash: false, bank: false, credit: false, cheque: false }

    if (collectingCreditId && payType !== 'split') {
      return {
        cash: payType !== 'cash',
        bank: payType !== 'bank',
        credit: true,
        cheque: payType !== 'cheque',
      }
    }

    if (collectingChequeId && payType !== 'split') {
      return {
        cash: payType !== 'cash',
        bank: payType !== 'bank',
        credit: true,
        cheque: payType !== 'cheque',
      }
    }

    const balanceChequeCollect =
      balanceOnlyMode &&
      payType === 'split' &&
      (splitChequeApprovedAmount > 0 ||
        splitSiblingCreditPending > 0 ||
        isLoadedChequeSplitCollect)
    if (payType !== 'split' || (!collectingCreditId && !collectingChequeId && !balanceChequeCollect)) return unlocked

    const total = splitTotal
    const cashCovers = total > 0 && cashSplitAmount >= total
    const bankCovers = total > 0 && bankSplitAmount >= total
    const chequeCovers = total > 0 && chequeSplitAmount >= total

    return {
      cash:
        bankCovers ||
        chequeCovers ||
        (splitCreditPaidCash > 0 && cashSplitAmount <= 0 && !collectingCreditId),
      bank:
        cashCovers ||
        chequeCovers ||
        (splitCreditPaidBank > 0 && bankSplitAmount <= 0 && !collectingCreditId),
      credit:
        Boolean(collectingCreditId) ||
        (Boolean(collectingChequeId) && chequeCollectCreditMode) ||
        splitSiblingCreditPending > 0 ||
        splitSiblingCreditPaid > 0,
      cheque:
        cashCovers ||
        bankCovers ||
        splitChequeApprovedAmount > 0 ||
        (splitCreditPaidCheque > 0 &&
          chequeSplitAmount <= 0 &&
          splitChequeApprovedAmount <= 0 &&
          splitSiblingChequePending <= 0),
    }
  })()

  function isSplitFieldLocked(field: ActiveField): boolean {
    if (field === 'cashSplit') return splitFieldLocked.cash
    if (field === 'bankSplit') return splitFieldLocked.bank
    if (field === 'creditSplit') return splitFieldLocked.credit
    if (field === 'chequeSplit') return splitFieldLocked.cheque
    return false
  }

  function nextUnlockedSplitField(current: ActiveField): ActiveField {
    const order: ActiveField[] = ['cashSplit', 'bankSplit', 'chequeSplit', 'creditSplit']
    const idx = order.indexOf(current)
    if (idx < 0) return 'cashSplit'
    for (let step = 1; step <= order.length; step++) {
      const next = order[(idx + step) % order.length]
      if (!isSplitFieldLocked(next)) return next
    }
    return current
  }

  const splitPaidActive =
    cashSplitAmount + bankSplitAmount + chequeSplitAmount

  const splitChequeCounted =
    splitChequeApprovedAmount > 0
      ? splitChequeApprovedAmount
      : Math.max(chequeSplitAmount, splitSiblingChequePending)

  const splitCreditCounted = Math.max(creditSplitAmount, splitSiblingCreditPending)

  const splitPaidTotal =
    collectingCreditId || (collectingChequeId && chequeCollectCreditMode)
      ? splitPaidActive
      : cashSplitAmount +
        bankSplitAmount +
        splitChequeCounted +
        splitCreditCounted

  const splitPaidTotalDisplay = (() => {
    if (showFullSplitGrid) {
      if (chequeSplitCountsCredit) {
        const total = splitPaidActive + creditSplitAmount
        return total > 0 ? total : 0
      }
      if (splitPaidTotal > 0) return splitPaidTotal
      if (collectingCreditId) return splitTotal
      if (balanceOnlyMode && payType === 'split') return 0
      return splitTotal > 0 ? splitTotal : 0
    }
    if (collectingCreditId) {
      return paidAmount > 0 ? paidAmount : 0
    }
    if (collectingChequeId) {
      return paidAmount > 0 ? paidAmount : 0
    }
    if (splitOriginCollect && (collectingCreditId || collectingChequeId)) {
      return paidAmount > 0 ? paidAmount : 0
    }
    if (isLoadedChequeSplitCollect) {
      if (splitPaidActive > 0) return splitPaidActive
      return splitTotal > 0 ? splitTotal : 0
    }
    return 0
  })()

  const showPriorChequeInPaidTotal =
    splitChequeApprovedAmount > 0 &&
    !collectingCreditId &&
    (isLoadedChequeSplitCollect ||
      splitOriginCollect ||
      creditSplitAmount > 0 ||
      cashSplitAmount > 0 ||
      bankSplitAmount > 0)

  const showPendingChequeInPaidTotal =
    splitSiblingChequePending > 0 &&
    !collectingCreditId &&
    splitOriginCollect

  const showPendingCreditInPaidTotal =
    splitSiblingCreditPending > 0 && loadedPendingId != null

  const showPaidCreditInPaidTotal =
    splitSiblingCreditPaid > 0 &&
    (isLoadedChequeSplitCollect ||
      splitOriginCollect ||
      splitCreditPaidCash > 0 ||
      splitCreditPaidBank > 0 ||
      splitCreditPaidCheque > 0)

  const showParentPriorPaidInPaidTotal =
    splitParentPriorPaid > 0 &&
    (collectingCreditId ||
      collectingChequeId ||
      isLoadedChequeSplitCollect ||
      splitOriginCollect)

  const showSplitDueHint =
    showSplitPaidTotal &&
    (splitDueDenominator > 0 || (originalBillHint ?? 0) > 0) &&
    (collectingCreditId ||
      collectingChequeId ||
      balanceOnlyMode ||
      splitOriginCollect ||
      showPriorChequeInPaidTotal ||
      showPendingChequeInPaidTotal ||
      showPendingCreditInPaidTotal ||
      showPaidCreditInPaidTotal ||
      showParentPriorPaidInPaidTotal)

  const splitPaidTotalBill = collectingCreditId
    ? showFullSplitGrid
      ? originalBillHint ?? creditCollectDueAmount
      : creditCollectDueAmount
    : collectingChequeId
      ? showFullSplitGrid
        ? originalBillHint ?? chequeCollectDueAmount
        : chequeCollectDueAmount
      : originalBillHint && originalBillHint > splitDueDenominator
        ? originalBillHint
        : splitDueDenominator

  const paidForReturn =
    payType === 'split'
      ? cashSplitAmount
      : paymentStep
        ? paidAmount
        : dueAmount

  const splitShortfall =
    showFullSplitGrid && splitTotal > 0 && splitPaidTotal > 0 && splitPaidTotal < splitTotal
      ? splitTotal - splitPaidTotal
      : 0

  const splitExcess =
    showFullSplitGrid && splitTotal > 0 && splitPaidTotal > splitTotal
      ? splitPaidTotal - splitTotal
      : 0

  const splitCashChange =
    showSplitCashGive && giveAmount >= cashSplitAmount ? giveAmount - cashSplitAmount : 0

  const splitCashNeedMore =
    showSplitCashGive && giveAmount > 0 && giveAmount < cashSplitAmount

  const splitCashShortfall = splitCashNeedMore ? cashSplitAmount - giveAmount : 0

  const changeAmount =
    payType === 'cash'
      ? Math.max(0, giveAmount - paidForReturn)
      : showSplitCashGive
        ? splitCashChange
        : payType === 'bank' || payType === 'split' || payType === 'cheque' || payType === 'credit'
          ? 0
          : Math.max(0, giveAmount - paidForReturn)

  const needMore =
    (payType === 'cash' &&
      giveAmount > 0 &&
      paidForReturn > 0 &&
      giveAmount < paidForReturn) ||
    splitCashNeedMore

  const shortfallAmount = splitCashNeedMore
    ? splitCashShortfall
    : needMore
      ? paidForReturn - giveAmount
      : 0

  const showReturnLive =
    showFullSplitGrid
      ? splitTotal > 0 &&
        (splitPaidTotal > 0 ||
          cashSplitAmount > 0 ||
          bankSplitAmount > 0 ||
          chequeSplitAmount > 0 ||
          creditSplitAmount > 0 ||
          splitSiblingChequePending > 0 ||
          splitSiblingCreditPending > 0 ||
          (showSplitCashGive && giveAmount > 0))
      : payType === 'cash' && giveAmount > 0 && paidForReturn > 0

  const returnDisplay = (() => {
    if (showFullSplitGrid) {
      if (splitCashNeedMore) return `+${formatMoney(splitCashShortfall)}`
      if (splitCashChange > 0) return formatMoney(splitCashChange)
      if (splitTotal <= 0 || splitPaidTotal <= 0) return '—'
      if (splitShortfall > 0) return `+${formatMoney(splitShortfall)}`
      if (splitExcess > 0) return formatMoney(splitExcess)
      return '—'
    }
    if (payType === 'bank' || payType === 'cheque' || payType === 'credit') return '—'
    if (needMore) return `+${formatMoney(shortfallAmount)}`
    if (showReturnLive && changeAmount > 0) return formatMoney(changeAmount)
    return '—'
  })()

  const hasCollectDue = collectingCreditId
    ? creditCollectDueAmount > 0
    : collectingChequeId
      ? chequeCollectDueAmount > 0
      : billAmount > 0

  const isValid =
    hasCollectDue &&
    (collectingCreditId
      ? payType === 'split'
        ? (cashSplitAmount > 0 || bankSplitAmount > 0 || chequeSplitAmount > 0) &&
          (cashSplitAmount === 0 || giveAmount === 0 || giveAmount >= cashSplitAmount)
        : payType === 'cash'
          ? paymentStep &&
            paidAmount > 0 &&
            (giveAmount === 0 || giveAmount >= paidAmount)
          : payType === 'bank' || payType === 'cheque'
            ? paymentStep && paidAmount > 0
            : false
      : collectingChequeId
        ? payType === 'split'
          ? chequeCollectCreditMode
            ? chequeCollectCreditRemainder === 0 &&
              (cashSplitAmount > 0 || bankSplitAmount > 0 || chequeSplitAmount > 0)
            : (() => {
                const collected = cashSplitAmount + bankSplitAmount + chequeSplitAmount
                if (collected <= 0 || collected > chequeCollectDueAmount) return false
                if (cashSplitAmount > 0 && giveAmount > 0 && giveAmount < cashSplitAmount) {
                  return false
                }
                return true
              })()
          : payType === 'cash'
            ? paymentStep && paidAmount > 0 && giveAmount >= paidAmount
            : payType === 'bank' || payType === 'cheque'
              ? paymentStep && paidAmount > 0
              : false
      : payType === 'bank' || payType === 'cheque'
        ? paymentStep && paidAmount > 0
        : payType === 'credit'
          ? false
          : payType === 'cash'
            ? paymentStep && paidAmount > 0 && giveAmount >= paidAmount
            : payType === 'split'
              ? splitTotal > 0 &&
                splitPaidTotal === splitTotal &&
                cashSplitAmount >= 0 &&
                bankSplitAmount >= 0 &&
                chequeSplitAmount >= 0 &&
                creditSplitAmount >= 0 &&
                (cashSplitAmount > 0 ||
                  bankSplitAmount > 0 ||
                  chequeSplitAmount > 0 ||
                  creditSplitAmount > 0) &&
                (cashSplitAmount === 0 || giveAmount === 0 || giveAmount >= cashSplitAmount)
              : false)

  const canSavePending = dueAmount > 0 && savedAction === null
  const isSaving = savedAction !== null

  const splitHasCredit = payType === 'split' && creditSplitAmount > 0
  const splitHasNewChequePending = payType === 'split' && chequeSplitAmount > 0
  const splitHasChequePending = splitHasNewChequePending
  const splitHasChequeApproved = payType === 'split' && splitChequeApprovedAmount > 0
  const splitHasCheque = splitHasNewChequePending || splitHasChequeApproved
  const splitHasBoth = splitHasCredit && splitHasNewChequePending
  const splitHasExtras =
    (splitHasCredit || splitHasCheque) &&
    (!collectingBalanceBillId ||
      (Boolean(collectingChequeId) && payType === 'split' && !chequeCollectCreditMode))
  const isSplitComplete = payType === 'split' && isValid

  const canSendSplitCreditPending =
    splitHasCredit && !splitHasBoth && billAmount > 0 && savedAction === null
  const canSendSplitChequePending =
    splitHasChequePending && !splitHasBoth && billAmount > 0 && savedAction === null
  const canSendSplitBothPending =
    splitHasBoth && billAmount > 0 && savedAction === null
  const canSplitChequeApprove =
    savedAction === null &&
    splitHasChequePending &&
    (isSplitComplete ||
      (isLoadedChequeSplitCollect &&
        chequeSplitAmount > 0 &&
        cashSplitAmount + bankSplitAmount + chequeSplitAmount === splitTotal))

  const canApproveSiblingCheque =
    Boolean(collectingCreditId) &&
    payType === 'split' &&
    splitSiblingChequePending > 0 &&
    siblingChequePendingId != null &&
    savedAction === null

  const creditCollectExtraButtons =
    (canApproveSiblingCheque ? 1 : 0) +
    (collectingCreditId && payType === 'split' && splitHasChequePending ? 1 : 0)
  const actionsLayoutClass = collectingCreditId
    ? creditCollectExtraButtons > 0
      ? 'counter-actions--split'
      : 'counter-actions--3'
    : collectingChequeId
      ? splitHasExtras
        ? 'counter-actions--split'
        : 'counter-actions--3'
      : splitHasExtras
        ? 'counter-actions--split'
        : 'counter-actions--3'

  const creditCollectRemaining =
    collectingCreditId && creditCollectDisplayAmount > 0
      ? creditCollectDisplayAmount
      : collectingChequeId && chequeCollectCreditMode && chequeCollectCreditRemainder > 0
        ? chequeCollectCreditRemainder
        : undefined

  const cashShowsCreditPaid =
    splitCreditPaidCash > 0 && cashSplitAmount <= 0 && !collectingCreditId
  const bankShowsCreditPaid =
    splitCreditPaidBank > 0 && bankSplitAmount <= 0 && !collectingCreditId
  const chequeShowsCreditPaid =
    splitCreditPaidCheque > 0 &&
    chequeSplitAmount <= 0 &&
    splitChequeApprovedAmount <= 0 &&
    splitSiblingChequePending <= 0

  const roundBaseAmount =
    collectingCreditId
      ? creditCollectDueAmount
      : collectingChequeId
        ? chequeCollectDueAmount
        : billAmount

  const billRoundOptions = useMemo(
    () => getBillRoundOptions(roundBaseAmount),
    [roundBaseAmount],
  )
  const showRoundChips = roundBaseAmount > 0

  function reconcileSplitCreditToCollectTarget(target: number) {
    if (collectingCreditId || (collectingChequeId && chequeCollectCreditMode)) {
      const cash = parseAmount(cashSplitStr)
      const bank = parseAmount(bankSplitStr)
      const cheque = chequeSplitAmount
      setCreditSplitStr(formatSplitPart(Math.max(0, target - cash - bank - cheque)))
      return
    }
    if (isSplitFieldLocked('creditSplit')) return
    const cash = parseAmount(cashSplitStr)
    const bank = parseAmount(bankSplitStr)
    const chequeCounted =
      splitChequeApprovedAmount > 0 ? splitChequeApprovedAmount : parseAmount(chequeSplitStr)
    if (splitSiblingCreditPending > 0) {
      pinSiblingCreditPending()
      return
    }
    if (parseAmount(creditSplitStr) > 0) {
      setCreditSplitStr(formatSplitPart(Math.max(0, target - cash - bank - chequeCounted)))
    }
  }

  function applyRoundCollectAmount(amt: number) {
    if (amt <= 0 || amt > roundBaseAmount) return
    setRoundOffAmount(amt)
    setRoundOtherActive(false)
    setRoundCustomStr('')
    if (payType === 'split') {
      setPaidStr(String(amt))
      if (cashSplitStr) applySplitCash(cashSplitStr, amt)
      else if (bankSplitStr) applySplitBank(bankSplitStr, amt)
      else if (chequeSplitStr) applySplitCheque(chequeSplitStr, amt)
      else if (collectingCreditId || (collectingChequeId && chequeCollectCreditMode)) {
        reconcileSplitCreditToCollectTarget(amt)
      } else if (creditSplitStr) applySplitCredit(creditSplitStr, amt)
      else openSplitMode()
      reconcileSplitCreditToCollectTarget(amt)
    } else if (paymentStep) setPaidStr(String(amt))
    else if (needsGive(payType)) setActiveField('give')
    else openPaymentStep()
  }

  function applyCustomRoundAmount() {
    const amt = parseAmount(roundCustomStr)
    if (amt <= 0 || amt > roundBaseAmount) return
    applyRoundCollectAmount(amt)
    if (payType === 'split') setActiveField('cashSplit')
    else if (needsGive(payType)) setActiveField('give')
    else if (paymentStep) setActiveField('paid')
    else setActiveField('bill')
  }

  const customerPaidPreview =
    payType === 'split'
      ? splitPaidTotal > 0
        ? formatMoney(splitPaidTotal)
        : splitTotal > 0
          ? formatMoney(splitTotal)
          : '—'
      : paymentStep && paidAmount > 0
        ? formatMoney(paidAmount)
        : billStr
          ? formatMoney(dueAmount)
          : '—'

  function pinSiblingCreditPending() {
    if (splitSiblingCreditPending > 0) {
      setCreditSplitStr(formatSplitPart(splitSiblingCreditPending))
    }
  }

  function applySplitCash(nextCashStr: string, totalOverride?: number) {
    const total = totalOverride ?? splitTotal

    if (isLoadedChequeSplitCollect) {
      if (nextCashStr === '') {
        setCashSplitStr('')
        pinSiblingCreditPending()
        return
      }
      const cash = Math.min(parseAmount(nextCashStr), total)
      setCashSplitStr(formatSplitPart(cash))
      let bank = parseAmount(bankSplitStr)
      let cheque = chequeSplitAmount
      const room = Math.max(0, total - cash)
      if (cheque > 0) {
        cheque = Math.min(cheque, room)
        setChequeSplitStr(formatSplitPart(cheque))
        bank = Math.min(bank, Math.max(0, room - cheque))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
        setChequeSplitStr(formatSplitPart(Math.max(0, total - cash - bank)))
      } else {
        setChequeSplitStr(formatSplitPart(Math.max(0, room)))
      }
      pinSiblingCreditPending()
      return
    }

    if (collectingCreditId) {
      if (nextCashStr === '') {
        setCashSplitStr('')
        const bank = parseAmount(bankSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - bank - cheque)))
        return
      }
      const cash = Math.min(parseAmount(nextCashStr), total)
      setCashSplitStr(formatSplitPart(cash))
      let bank = parseAmount(bankSplitStr)
      let cheque = chequeSplitAmount
      const room = Math.max(0, total - cash)
      if (cheque > 0) {
        cheque = Math.min(cheque, room)
        setChequeSplitStr(formatSplitPart(cheque))
        bank = Math.min(bank, Math.max(0, room - cheque))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
      }
      setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - bank - cheque)))
      return
    }

    if (collectingChequeId && chequeCollectCreditMode) {
      if (nextCashStr === '') {
        setCashSplitStr('')
        const bank = parseAmount(bankSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - bank - cheque)))
        return
      }
      const cash = Math.min(parseAmount(nextCashStr), total)
      setCashSplitStr(formatSplitPart(cash))
      let bank = parseAmount(bankSplitStr)
      let cheque = chequeSplitAmount
      const room = Math.max(0, total - cash)
      if (cheque > 0) {
        cheque = Math.min(cheque, room)
        setChequeSplitStr(formatSplitPart(cheque))
        bank = Math.min(bank, Math.max(0, room - cheque))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
      }
      setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - bank - cheque)))
      return
    }

    const fixed = chequeInSplitTotal + creditSplitAmount
    const room = Math.max(0, total - fixed)
    if (room <= 0) {
      setCashSplitStr('')
      setBankSplitStr('')
      return
    }
    if (nextCashStr === '') {
      setCashSplitStr('')
      setBankSplitStr('')
      return
    }
    const cash = Math.min(parseAmount(nextCashStr), room)
    setCashSplitStr(formatSplitPart(cash))
    let bank = parseAmount(bankSplitStr)
    if (bank > 0) {
      bank = Math.min(bank, Math.max(0, room - cash))
      setBankSplitStr(formatSplitPart(bank))
    } else {
      bank = Math.max(0, room - cash)
      setBankSplitStr(formatSplitPart(bank))
    }
  }

  function applySplitBank(nextBankStr: string, totalOverride?: number) {
    const total = totalOverride ?? splitTotal

    if (isLoadedChequeSplitCollect) {
      if (nextBankStr === '') {
        setBankSplitStr('')
        pinSiblingCreditPending()
        return
      }
      const bank = Math.min(parseAmount(nextBankStr), total)
      setBankSplitStr(formatSplitPart(bank))
      let cash = parseAmount(cashSplitStr)
      let cheque = chequeSplitAmount
      const room = Math.max(0, total - bank)
      if (cheque > 0) {
        cheque = Math.min(cheque, room)
        setChequeSplitStr(formatSplitPart(cheque))
        cash = Math.min(cash, Math.max(0, room - cheque))
        setCashSplitStr(formatSplitPart(cash))
      } else if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
        setChequeSplitStr(formatSplitPart(Math.max(0, total - bank - cash)))
      } else {
        setChequeSplitStr(formatSplitPart(Math.max(0, room)))
      }
      pinSiblingCreditPending()
      return
    }

    if (collectingCreditId) {
      if (nextBankStr === '') {
        setBankSplitStr('')
        const cash = parseAmount(cashSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - cheque)))
        return
      }
      const bank = Math.min(parseAmount(nextBankStr), total)
      setBankSplitStr(formatSplitPart(bank))
      let cash = parseAmount(cashSplitStr)
      let cheque = chequeSplitAmount
      const room = Math.max(0, total - bank)
      if (cheque > 0) {
        cheque = Math.min(cheque, room)
        setChequeSplitStr(formatSplitPart(cheque))
        cash = Math.min(cash, Math.max(0, room - cheque))
        setCashSplitStr(formatSplitPart(cash))
      } else if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
      }
      setCreditSplitStr(formatSplitPart(Math.max(0, total - bank - cash - cheque)))
      return
    }

    if (collectingChequeId && chequeCollectCreditMode) {
      if (nextBankStr === '') {
        setBankSplitStr('')
        const cash = parseAmount(cashSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - cheque)))
        return
      }
      const bank = Math.min(parseAmount(nextBankStr), total)
      setBankSplitStr(formatSplitPart(bank))
      let cash = parseAmount(cashSplitStr)
      let cheque = chequeSplitAmount
      const room = Math.max(0, total - bank)
      if (cheque > 0) {
        cheque = Math.min(cheque, room)
        setChequeSplitStr(formatSplitPart(cheque))
        cash = Math.min(cash, Math.max(0, room - cheque))
        setCashSplitStr(formatSplitPart(cash))
      } else if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
      }
      setCreditSplitStr(formatSplitPart(Math.max(0, total - bank - cash - cheque)))
      return
    }

    const fixed = chequeInSplitTotal + creditSplitAmount
    const room = Math.max(0, total - fixed)
    if (room <= 0) {
      setBankSplitStr('')
      setCashSplitStr('')
      return
    }
    if (nextBankStr === '') {
      setBankSplitStr('')
      setCashSplitStr('')
      return
    }
    const bank = Math.min(parseAmount(nextBankStr), room)
    setBankSplitStr(formatSplitPart(bank))
    let cash = parseAmount(cashSplitStr)
    if (cash > 0) {
      cash = Math.min(cash, Math.max(0, room - bank))
      setCashSplitStr(formatSplitPart(cash))
    } else {
      cash = Math.max(0, room - bank)
      setCashSplitStr(formatSplitPart(cash))
    }
  }

  function applySplitCheque(nextChequeStr: string, totalOverride?: number) {
    const total = totalOverride ?? splitTotal

    if (isLoadedChequeSplitCollect) {
      setChequeSplitStr(nextChequeStr)
      if (nextChequeStr === '') {
        pinSiblingCreditPending()
        return
      }
      const cheque = parseAmount(nextChequeStr)
      const room = Math.max(0, total - cheque)
      let cash = parseAmount(cashSplitStr)
      let bank = parseAmount(bankSplitStr)
      if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
        bank = Math.min(bank, Math.max(0, room - cash))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
      }
      pinSiblingCreditPending()
      return
    }

    if (collectingCreditId) {
      setChequeSplitStr(nextChequeStr)
      if (nextChequeStr === '') {
        const cash = parseAmount(cashSplitStr)
        const bank = parseAmount(bankSplitStr)
        setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - bank)))
        return
      }
      const cheque = parseAmount(nextChequeStr)
      let cash = parseAmount(cashSplitStr)
      let bank = parseAmount(bankSplitStr)
      const room = Math.max(0, total - cheque)
      if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
        bank = Math.min(bank, Math.max(0, room - cash))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
      }
      setCreditSplitStr(formatSplitPart(Math.max(0, total - cheque - cash - bank)))
      return
    }

    if (collectingChequeId && chequeCollectCreditMode) {
      setChequeSplitStr(nextChequeStr)
      if (nextChequeStr === '') {
        const cash = parseAmount(cashSplitStr)
        const bank = parseAmount(bankSplitStr)
        setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - bank)))
        return
      }
      const cheque = parseAmount(nextChequeStr)
      let cash = parseAmount(cashSplitStr)
      let bank = parseAmount(bankSplitStr)
      const room = Math.max(0, total - cheque)
      if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
        bank = Math.min(bank, Math.max(0, room - cash))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
      }
      setCreditSplitStr(formatSplitPart(Math.max(0, total - cheque - cash - bank)))
      return
    }

    if (nextChequeStr === '') {
      setChequeSplitStr('')
      return
    }
    const maxCheque = Math.max(0, total - cashSplitAmount - creditSplitAmount)
    const cheque = Math.min(parseAmount(nextChequeStr), maxCheque)
    setChequeSplitStr(formatSplitPart(cheque))
    const base = Math.max(0, total - cheque)
    const bank = Math.max(0, base - cashSplitAmount - creditSplitAmount)
    setBankSplitStr(formatSplitPart(bank))
  }

  function applySplitCredit(nextCreditStr: string, totalOverride?: number) {
    const total = totalOverride ?? splitTotal

    if (isLoadedChequeSplitCollect) {
      setCreditSplitStr(nextCreditStr)
      if (nextCreditStr === '') {
        pinSiblingCreditPending()
        return
      }
      const credit = parseAmount(nextCreditStr)
      let bank = parseAmount(bankSplitStr)
      let cash = parseAmount(cashSplitStr)
      const room = Math.max(0, total - credit)
      if (cash > 0) {
        cash = Math.min(cash, room)
        setCashSplitStr(formatSplitPart(cash))
        bank = Math.min(bank, Math.max(0, room - cash))
        setBankSplitStr(formatSplitPart(bank))
      } else if (bank > 0) {
        bank = Math.min(bank, room)
        setBankSplitStr(formatSplitPart(bank))
      }
      pinSiblingCreditPending()
      return
    }

    if (collectingCreditId) {
      const cash = parseAmount(cashSplitStr)
      const bank = parseAmount(bankSplitStr)
      const cheque = chequeSplitAmount
      setCreditSplitStr(
        formatSplitPart(Math.max(0, total - cash - bank - cheque)),
      )
      return
    }

    if (nextCreditStr === '') {
      setCreditSplitStr('')
      return
    }
    const maxCredit = Math.max(0, total - chequeInSplitTotal)
    const credit = Math.min(parseAmount(nextCreditStr), maxCredit)
    setCreditSplitStr(formatSplitPart(credit))
    const room = Math.max(0, total - credit - chequeInSplitTotal)
    let cash = parseAmount(cashSplitStr)
    let bank = parseAmount(bankSplitStr)
    if (cash > 0) {
      cash = Math.min(cash, room)
      setCashSplitStr(formatSplitPart(cash))
      bank = Math.min(bank, Math.max(0, room - cash))
      setBankSplitStr(formatSplitPart(bank))
    } else if (bank > 0) {
      bank = Math.min(bank, room)
      setBankSplitStr(formatSplitPart(bank))
    } else {
      bank = Math.max(0, room)
      setBankSplitStr(formatSplitPart(bank))
    }
  }

  function openSplitMode() {
    if (billAmount <= 0) {
      setPaymentStep(false)
      setActiveField('bill')
      return
    }

    setPaymentStep(true)
    if (dueAmount > 0) setPaidStr(String(dueAmount))
    setCashSplitStr('')
    setBankSplitStr('')
    setChequeSplitStr('')
    setCreditSplitStr('')
    setGiveStr('')
    setActiveField('cashSplit')
  }

  function openPaymentStep() {
    if (payType === 'split') {
      openSplitMode()
      return
    }
    if (collectingBalanceBillId) return
    setPaymentStep(true)
    if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
    setActiveField('paid')
  }

  function handleEnter() {
    if (activeField === 'bill') {
      if (payType === 'split') {
        if (billAmount > 0) openPaymentStep()
        return
      }
      if (needsGive(payType)) setActiveField('give')
      else openPaymentStep()
      return
    }
    if (activeField === 'give') {
      if (collectingBalanceBillId) return
      openPaymentStep()
      return
    }
    if (activeField === 'paid') {
      if (needsGive(payType)) setActiveField('give')
      else setActiveField('bill')
      return
    }
    if (activeField === 'cashSplit') {
      if (showSplitCashGive && cashSplitAmount > 0) {
        setActiveField('give')
        return
      }
      setActiveField(nextUnlockedSplitField('cashSplit'))
      return
    }
    if (activeField === 'bankSplit') {
      setActiveField(nextUnlockedSplitField('bankSplit'))
      return
    }
    if (activeField === 'chequeSplit') {
      setActiveField(nextUnlockedSplitField('chequeSplit'))
      return
    }
    if (activeField === 'creditSplit') {
      setActiveField(nextUnlockedSplitField('creditSplit'))
      return
    }
    if (activeField === 'roundCustom') {
      applyCustomRoundAmount()
      return
    }
  }

  function handlePayTypeChange(type: PayType) {
    if (collectingCreditId) {
      if (!creditCollectPayTypes.includes(type)) return
      setPaymentStep(true)

      if (type === 'credit' || type === 'split') {
        setPayType('split')
        setGiveStr('')
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
        setChequeSplitStr('')
        setCreditSplitStr(formatSplitPart(creditCollectDueAmount))
        setActiveField('cashSplit')
        return
      }

      setPayType(type)
      setCashSplitStr('')
      setBankSplitStr('')
      setChequeSplitStr('')
      setCreditSplitStr('')

      if (type === 'cash') {
        setGiveStr('')
        setPaidStr('')
        setActiveField('paid')
        return
      }

      if (type === 'bank' || type === 'cheque') {
        setGiveStr('')
        setActiveField('paid')
      }
      return
    }

    if (collectingChequeId || effectiveCollectingChequeId) {
      if (!collectingChequeId && effectiveCollectingChequeId) {
        setCollectingChequeId(effectiveCollectingChequeId)
        if (loadedPendingBill) {
          setChequeCollectDue(loadedPendingBill.billAmount)
          setBalanceDueAmount(loadedPendingBill.billAmount)
        }
      }
      if (!CHEQUE_COLLECT_PAY_TYPES.includes(type)) return
      setPaymentStep(true)

      if (type === 'credit') {
        setChequeCollectCreditMode(true)
        setPayType('split')
        setGiveStr('')
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
        setChequeSplitStr('')
        setCreditSplitStr(formatSplitPart(chequeCollectDueAmount))
        setActiveField('cashSplit')
        return
      }

      if (type === 'split') {
        setChequeCollectCreditMode(false)
        setPayType('split')
        setGiveStr('')
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
        setChequeSplitStr('')
        setCreditSplitStr('')
        setActiveField('cashSplit')
        return
      }

      setChequeCollectCreditMode(false)
      setPayType(type)
      setCashSplitStr('')
      setBankSplitStr('')
      setChequeSplitStr('')
      setCreditSplitStr('')

      if (type === 'cash') {
        setGiveStr('')
        setActiveField('paid')
        return
      }

      if (type === 'bank' || type === 'cheque') {
        setGiveStr('')
        setActiveField('paid')
      }
      return
    }

    if (balanceOnlyMode && !collectingBalanceBillId) return
    setPayType(type)
    if (type !== 'cash') {
      setCollectingCreditId(null)
      setCollectingChequeId(null)
    }
    setCashSplitStr('')
    setBankSplitStr('')
    setChequeSplitStr('')
    setCreditSplitStr('')
    if (!needsGive(type)) setGiveStr('')
    if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))

    if (type === 'split') {
      openSplitMode()
    } else if (paymentStep) {
      setActiveField('paid')
    } else if (!needsGive(type) && billAmount > 0) {
      setActiveField('bill')
    }
  }

  function cyclePayType() {
    if (balanceOnlyMode && !collectingBalanceBillId) return
    const types = balanceCollectPayTypes
    const current =
      collectingChequeId && chequeCollectCreditMode && payType === 'split'
        ? 'credit'
        : payType === 'split'
          ? 'split'
          : payType
    const idx = types.indexOf(current)
    const nextIdx = idx >= 0 ? (idx + 1) % types.length : 0
    const next = types[nextIdx]
    handlePayTypeChange(next)
  }

  function openChequeTab() {
    if (creditListOpen) {
      setCreditListOpen(false)
      setHighlightedCreditIndex(-1)
      setChequeListOpen(true)
      setHighlightedChequeIndex(chequePendingBills.length > 0 ? 0 : -1)
      return
    }
    setChequeListOpen((open) => {
      const next = !open
      if (next) setHighlightedChequeIndex(chequePendingBills.length > 0 ? 0 : -1)
      else setHighlightedChequeIndex(-1)
      return next
    })
  }

  function openCreditTab() {
    if (chequeListOpen) {
      setChequeListOpen(false)
      setHighlightedChequeIndex(-1)
      setCreditListOpen(true)
      setHighlightedCreditIndex(creditPendingBills.length > 0 ? 0 : -1)
      return
    }
    setCreditListOpen((open) => {
      const next = !open
      if (next) setHighlightedCreditIndex(creditPendingBills.length > 0 ? 0 : -1)
      else setHighlightedCreditIndex(-1)
      return next
    })
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'bill') {
      if (balanceOnlyMode) return
      const next = applyNumpadAction(billStr, action)
      setBillStr(next)
      setRoundOffAmount(null)
      setRoundOtherActive(false)
      setRoundCustomStr('')
      if (payType === 'split') {
        const newDue = parseAmount(next)
        if (newDue > 0) {
          setPaidStr(String(newDue))
          if (cashSplitStr) applySplitCash(cashSplitStr, newDue)
          else if (bankSplitStr) applySplitBank(bankSplitStr, newDue)
          else if (chequeSplitStr) applySplitCheque(chequeSplitStr, newDue)
          else if (creditSplitStr) applySplitCredit(creditSplitStr, newDue)
        } else {
          setPaidStr('')
          setCashSplitStr('')
          setBankSplitStr('')
          setChequeSplitStr('')
          setCreditSplitStr('')
        }
      } else {
        setPaymentStep(false)
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
        setChequeSplitStr('')
        setCreditSplitStr('')
      }
    } else     if (activeField === 'give') {
      setGiveStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'paid') {
      if (balanceOnlyMode && payType === 'cheque' && !collectingBalanceBillId) return
      setPaidStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'cashSplit') {
      if (isSplitFieldLocked('cashSplit')) return
      applySplitCash(applyNumpadAction(cashSplitStr, action))
    } else if (activeField === 'bankSplit') {
      if (isSplitFieldLocked('bankSplit')) return
      applySplitBank(applyNumpadAction(bankSplitStr, action))
    } else if (activeField === 'chequeSplit') {
      if (isSplitFieldLocked('chequeSplit')) return
      applySplitCheque(applyNumpadAction(chequeSplitStr, action))
    } else if (activeField === 'creditSplit') {
      if (isSplitFieldLocked('creditSplit')) return
      applySplitCredit(applyNumpadAction(creditSplitStr, action))
    } else if (activeField === 'roundCustom') {
      setRoundCustomStr((prev) => applyNumpadAction(prev, action))
    }
  }

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  const stableNumpadPress = useCallback((action: NumpadAction) => {
    numpadHandlerRef.current(action)
  }, [])
  useRouteNumpadKeyboard(
    '/counter',
    stableNumpadPress,
    !pendingSectionFocus,
  )

  function cancelCreditExitTimer() {
    if (creditExitTimerRef.current != null) {
      window.clearTimeout(creditExitTimerRef.current)
      creditExitTimerRef.current = null
    }
  }

  function clearBillAmounts() {
    setBillStr('')
    setGiveStr('')
    setPaidStr('')
    setCashSplitStr('')
    setBankSplitStr('')
    setChequeSplitStr('')
    setCreditSplitStr('')
    setRoundOffAmount(null)
    setRoundOtherActive(false)
    setRoundCustomStr('')
  }

  function resetForm() {
    cancelCreditExitTimer()
    clearBillAmounts()
    clearPendingSection()
    setNameSectionFocus(false)
    customerNameFieldRef.current?.blur()
    setPaymentStep(false)
    setPayType('cash')
    customerNameFieldRef.current?.setValue('')
    setActiveField('bill')
    setSavedAction(null)
    setLoadedPendingId(null)
    setCollectingCreditId(null)
    setCollectingChequeId(null)
    setCreditCollectDue(0)
    setChequeCollectDue(0)
    setChequeCollectCreditMode(false)
    setSplitChequeApprovedAmount(0)
    setSplitSiblingChequePending(0)
    setSplitSiblingCreditPending(0)
    clearSplitCreditPaidBreakdown()
    setSiblingChequePendingId(null)
    setBalanceDueAmount(null)
    setOriginalBillHint(null)
    setDraftReturns([])
    setShowReturnModal(false)
    setChequeListOpen(false)
    setCreditListOpen(false)
  }

  /** Clear the form immediately; keep a short button flash without locking typing. */
  function flashSaved(action: SavedAction, fullReset = true) {
    cancelCreditExitTimer()
    if (fullReset) {
      clearBillAmounts()
      clearPendingSection()
      setNameSectionFocus(false)
      customerNameFieldRef.current?.blur()
      setPaymentStep(false)
      setPayType('cash')
      customerNameFieldRef.current?.setValue('')
      setActiveField('bill')
      setLoadedPendingId(null)
      setCollectingCreditId(null)
      setCollectingChequeId(null)
      setCreditCollectDue(0)
      setChequeCollectDue(0)
      setChequeCollectCreditMode(false)
      setSplitChequeApprovedAmount(0)
      setSplitSiblingChequePending(0)
      setSplitSiblingCreditPending(0)
      clearSplitCreditPaidBreakdown()
      setSiblingChequePendingId(null)
      setBalanceDueAmount(null)
      setOriginalBillHint(null)
      setDraftReturns([])
      setShowReturnModal(false)
      setChequeListOpen(false)
      setCreditListOpen(false)
    }
    setSavedAction(action)
    creditExitTimerRef.current = window.setTimeout(() => {
      creditExitTimerRef.current = null
      setSavedAction(null)
    }, 220)
  }

  function buildPendingPayload() {
    const name = getCustomerName() || undefined
    const due = payType === 'split' ? splitTotal : dueAmount
    const base = {
      billAmount: due,
      originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
      customerName: name,
      payType,
      ...(draftReturns.length > 0 && !loadedPendingId ? { returns: draftReturns } : {}),
    }

    if (payType === 'split') {
      return {
        ...base,
        cashAmount: cashSplitAmount,
        bankAmount: bankSplitAmount,
        chequeAmount: chequeSplitAmount,
        creditAmount: creditSplitAmount,
      }
    }

    return base
  }

  function findSiblingPending(bill: Sale) {
    if (!bill.parentSplitId) {
      return {
        cheque: 0,
        chequeId: null as string | null,
        credit: 0,
        creditId: null as string | null,
        creditPaid: 0,
        creditPaidSale: undefined as Sale | undefined,
      }
    }
    const siblings = data.sales.filter(
      (s) => s.parentSplitId === bill.parentSplitId && s.id !== bill.id,
    )
    const pending = siblings.filter((s) => s.status === 'pending')
    const chequeSib = pending.find((s) => getPendingBillPayType(s) === 'cheque')
    const creditSib = pending.find((s) => getPendingBillPayType(s) === 'credit')
    const creditPaidSib = siblings.find(
      (s) => getPendingBillPayType(s) === 'credit' && s.status === 'paid',
    )
    return {
      cheque: chequeSib?.billAmount ?? 0,
      chequeId: chequeSib?.id ?? null,
      credit: creditSib?.billAmount ?? 0,
      creditId: creditSib?.id ?? null,
      creditPaid: creditPaidSib?.billAmount ?? 0,
      creditPaidSale: creditPaidSib,
    }
  }

  function applyPendingCreditPaidBreakdown(bill: Sale) {
    const breakdown = salePendingCreditPaidBreakdown(bill)
    setSplitCreditPaidCash(breakdown.cash)
    setSplitCreditPaidBank(breakdown.bank)
    setSplitCreditPaidCheque(breakdown.cheque)
    setSplitSiblingCreditPaid(0)
  }

  function applySplitCreditPaidBreakdown(sale: Sale | undefined) {
    const breakdown = getPaidSaleBreakdown(sale)
    setSplitSiblingCreditPaid(breakdown.total)
    setSplitCreditPaidCash(breakdown.cash)
    setSplitCreditPaidBank(breakdown.bank)
    setSplitCreditPaidCheque(breakdown.cheque)
  }

  function clearSplitCreditPaidBreakdown() {
    setSplitSiblingCreditPaid(0)
    setSplitCreditPaidCash(0)
    setSplitCreditPaidBank(0)
    setSplitCreditPaidCheque(0)
  }

  function loadPendingBill(bill: Sale) {
    const due = saleCreditBalanceDue(bill, data.sales)
    const original = saleGrossBillAmount(bill)
    const isCheque = isChequePendingBill(bill)
    const isCredit = isCreditPendingBill(bill)
    const type = getPendingBillPayType(bill)
    const isBalanceBill = isCheque || isCredit

    setChequeListOpen(false)
    setCreditListOpen(false)
    setHighlightedChequeIndex(-1)
    setHighlightedCreditIndex(-1)

    if (isCheque) {
      setCollectingCreditId(null)
      setCollectingChequeId(bill.id)
      setChequeCollectDue(due)
      setChequeCollectCreditMode(false)
    } else {
      setCollectingChequeId(null)
      setChequeCollectDue(0)
      setChequeCollectCreditMode(false)
    }
    if (isCredit) {
      setCollectingChequeId(null)
      setChequeCollectDue(0)
      setChequeCollectCreditMode(false)
    } else {
      setCollectingCreditId(null)
      setCreditCollectDue(0)
    }

    setLoadedPendingId(bill.id)
    setBalanceDueAmount(isBalanceBill ? due : null)
    setOriginalBillHint(isBalanceBill && original !== due ? original : null)
    setDraftReturns(bill.returns ? [...bill.returns] : [])
    setBillStr(String(isBalanceBill ? due : original))
    setGiveStr('')
    setPaidStr('')
    setRoundOffAmount(null)
    customerNameFieldRef.current?.setValue(getSaleCustomerName(bill, data.sales) ?? '')
    setPayType(type)
    setPaymentStep(true)
    setSavedAction(null)

    if (isCredit) {
      const parent = bill.parentSplitId
        ? data.sales.find((sale) => sale.id === bill.parentSplitId)
        : undefined
      const siblings = findSiblingPending(bill)

      setCashSplitStr('')
      setBankSplitStr('')
      setChequeSplitStr('')
      setCreditSplitStr('')
      setSplitChequeApprovedAmount(0)
      setSplitSiblingChequePending(0)
      setSplitSiblingCreditPending(0)
      clearSplitCreditPaidBreakdown()
      setSiblingChequePendingId(null)

      if (parent?.payType === 'split' || parent) {
        setBillStr(String(due))
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
        setCreditSplitStr(formatSplitPart(due))
        if (parent.chequeApproved && (parent.chequeAmount ?? 0) > 0) {
          setSplitChequeApprovedAmount(parent.chequeAmount ?? 0)
          setSplitSiblingChequePending(0)
          setSiblingChequePendingId(null)
          setChequeSplitStr('')
        } else {
          setSplitChequeApprovedAmount(0)
          setChequeSplitStr('')
          setSplitSiblingChequePending(siblings.cheque)
          setSiblingChequePendingId(siblings.chequeId)
        }
        setSplitSiblingCreditPending(0)
        clearSplitCreditPaidBreakdown()
        setPayType('split')
        setActiveField(
          parent.chequeApproved && (parent.chequeAmount ?? 0) > 0
            ? 'chequeSplit'
            : siblings.cheque > 0
              ? 'cashSplit'
              : 'cashSplit',
        )
        setOriginalBillHint(
          parent.originalBillAmount ??
            bill.originalBillAmount ??
            (original !== due ? original : null),
        )
      } else {
        setPayType('split')
        setActiveField('cashSplit')
      }

      applyPendingCreditPaidBreakdown(bill)

      setCollectingCreditId(bill.id)
      setCreditCollectDue(due)
      setBalanceDueAmount(due)
      if (!parent) {
        const collected = saleCollectedAmount(bill)
        setOriginalBillHint(
          bill.originalBillAmount ??
            (original !== due || collected > 0 ? Math.max(original, due + collected) : null),
        )
      }
      setPaymentStep(true)
      return
    }

    if (isCheque) {
      const parent = bill.parentSplitId
        ? data.sales.find((sale) => sale.id === bill.parentSplitId)
        : undefined

      setCashSplitStr('')
      setBankSplitStr('')
      setChequeSplitStr('')
      setCreditSplitStr('')
      setSplitChequeApprovedAmount(0)
      setSplitSiblingChequePending(0)
      setSplitSiblingCreditPending(0)
      clearSplitCreditPaidBreakdown()
      setSiblingChequePendingId(null)

      if (parent) {
        const siblings = findSiblingPending(bill)
        setSplitSiblingChequePending(0)
        setSplitSiblingCreditPending(siblings.credit)
        applySplitCreditPaidBreakdown(siblings.creditPaidSale)
        setSiblingChequePendingId(null)
        setBillStr(String(due))
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
        setBalanceDueAmount(due)
        setOriginalBillHint(
          parent.originalBillAmount ??
            bill.originalBillAmount ??
            (original !== due ? original : null),
        )
        setPayType('split')
        setCollectingCreditId(null)
        setCollectingChequeId(bill.id)
        setChequeCollectDue(due)
        setChequeCollectCreditMode(false)

        if (parent.chequeApproved && (parent.chequeAmount ?? 0) > 0) {
          setSplitChequeApprovedAmount(parent.chequeAmount ?? 0)
          setChequeSplitStr('')
        } else {
          setSplitChequeApprovedAmount(0)
          setChequeSplitStr(formatSplitPart(due))
        }

        setCreditSplitStr(
          siblings.credit > 0
            ? formatSplitPart(siblings.credit)
            : siblings.creditPaid > 0
              ? formatSplitPart(siblings.creditPaid)
              : '',
        )
        setActiveField('chequeSplit')
        return
      }

      setCollectingChequeId(bill.id)
      setChequeCollectDue(due)
      setChequeCollectCreditMode(false)
      setBalanceDueAmount(due)
      setPaidStr('')
      setPayType('cheque')
      setActiveField('paid')
      return
    }

    if (type === 'split') {
      const childPending = findSplitChildPending(data.sales, bill.id)
      clearSplitCreditPaidBreakdown()
      setCashSplitStr(bill.cashAmount ? formatSplitPart(bill.cashAmount) : '')
      if (bill.chequeApproved && (bill.chequeAmount ?? 0) > 0) {
        setSplitChequeApprovedAmount(bill.chequeAmount ?? 0)
        setChequeSplitStr('')
        const bankOnly = Math.max(0, (bill.bankAmount ?? 0) - (bill.chequeAmount ?? 0))
        setBankSplitStr(bankOnly ? formatSplitPart(bankOnly) : '')
      } else if (childPending.chequeId) {
        setSplitChequeApprovedAmount(0)
        setBankSplitStr(bill.bankAmount ? formatSplitPart(bill.bankAmount) : '')
        setChequeSplitStr(formatSplitPart(childPending.chequeAmount))
        setSiblingChequePendingId(childPending.chequeId)
        setSplitSiblingChequePending(childPending.chequeAmount)
      } else {
        setSplitChequeApprovedAmount(0)
        setBankSplitStr(bill.bankAmount ? formatSplitPart(bill.bankAmount) : '')
        setChequeSplitStr(bill.chequeAmount ? formatSplitPart(bill.chequeAmount) : '')
        setSiblingChequePendingId(null)
        setSplitSiblingChequePending(0)
      }
      if (childPending.creditId) {
        setCreditSplitStr(formatSplitPart(childPending.creditAmount))
        setSplitSiblingCreditPending(childPending.creditAmount)
      } else {
        setCreditSplitStr(bill.creditAmount ? formatSplitPart(bill.creditAmount) : '')
        setSplitSiblingCreditPending(0)
      }
      setActiveField('cashSplit')
      return
    }

    if (type === 'bank') {
      setActiveField('paid')
      return
    }

    setActiveField('give')
  }

  function selectPendingBill(bill: Sale) {
    loadPendingBill(bill)
    setPendingSectionFocus(false)
    setHighlightedPendingIndex(null)
  }

  function loadPaidBill(bill: Sale) {
    const amount = bill.originalBillAmount ?? bill.billAmount
    setChequeListOpen(false)
    setCreditListOpen(false)
    setHighlightedChequeIndex(-1)
    setHighlightedCreditIndex(-1)
    setCollectingCreditId(null)
    setCollectingChequeId(null)
    setCreditCollectDue(0)
    setChequeCollectDue(0)
    setChequeCollectCreditMode(false)
    setBalanceDueAmount(null)
    setOriginalBillHint(null)
    setLoadedPendingId(bill.id)
    customerNameFieldRef.current?.setValue(getSaleCustomerName(bill, data.sales) ?? '')
    setPaymentStep(true)
    setSavedAction(null)
    setGiveStr('')
    setPaidStr('')
    setRoundOffAmount(null)
    clearSplitCreditPaidBreakdown()
    setSplitChequeApprovedAmount(0)
    setSplitSiblingChequePending(0)
    setSplitSiblingCreditPending(0)
    setSiblingChequePendingId(null)

    if (bill.payType === 'split') {
      const childPending = findSplitChildPending(data.sales, bill.id)
      const original = bill.originalBillAmount ?? bill.billAmount
      const collected = bill.billAmount
      if (original > collected) setRoundOffAmount(collected)
      setBillStr(String(amount))
      setPayType('split')
      setCashSplitStr(bill.cashAmount ? formatSplitPart(bill.cashAmount) : '')
      if (bill.chequeApproved && (bill.chequeAmount ?? 0) > 0) {
        setSplitChequeApprovedAmount(bill.chequeAmount ?? 0)
        setChequeSplitStr('')
        const bankOnly = Math.max(0, (bill.bankAmount ?? 0) - (bill.chequeAmount ?? 0))
        setBankSplitStr(bankOnly ? formatSplitPart(bankOnly) : '')
      } else if (childPending.chequeId) {
        setSplitChequeApprovedAmount(0)
        setBankSplitStr(bill.bankAmount ? formatSplitPart(bill.bankAmount) : '')
        setChequeSplitStr(formatSplitPart(childPending.chequeAmount))
        setSiblingChequePendingId(childPending.chequeId)
        setSplitSiblingChequePending(childPending.chequeAmount)
      } else {
        setSplitChequeApprovedAmount(0)
        setBankSplitStr(bill.bankAmount ? formatSplitPart(bill.bankAmount) : '')
        setChequeSplitStr(bill.chequeAmount ? formatSplitPart(bill.chequeAmount) : '')
        setSiblingChequePendingId(null)
        setSplitSiblingChequePending(0)
      }
      if (childPending.creditId) {
        setCreditSplitStr(formatSplitPart(childPending.creditAmount))
        setSplitSiblingCreditPending(childPending.creditAmount)
      } else {
        setCreditSplitStr(bill.creditAmount ? formatSplitPart(bill.creditAmount) : '')
        setSplitSiblingCreditPending(0)
      }
      if (bill.cashAmount && bill.cashAmount > 0) {
        const giveTotal = bill.cashAmount + (bill.changeAmount ?? 0)
        setGiveStr(giveTotal > bill.cashAmount ? String(giveTotal) : '')
        setActiveField('give')
      } else {
        setActiveField('cashSplit')
      }
      return
    }

    setBillStr(String(amount))

    if (bill.payType === 'bank') {
      setPayType('bank')
      setPaidStr(String(bill.billAmount))
      setActiveField('paid')
      return
    }

    if (bill.payType === 'cheque') {
      setPayType('cheque')
      setPaidStr(String(bill.chequeAmount ?? bill.billAmount))
      setActiveField('paid')
      return
    }

    const paid = bill.paidAmount > 0 ? bill.paidAmount : bill.billAmount
    setPayType('cash')
    setPaidStr(String(paid))
    setGiveStr(String(paid))
    setActiveField('give')
  }

  function loadSaleBill(bill: Sale) {
    if (bill.status === 'pending') {
      loadPendingBill(bill)
      return
    }
    loadPaidBill(bill)
  }

  function openBillById(billId: string) {
    const bill = data.sales.find((sale) => sale.id === billId)
    if (!bill) return
    loadSaleBill(bill)
  }

  useEffect(() => {
    const billId = searchParams.get('bill')
    if (!billId) return
    openBillById(billId)
    setSearchParams({}, { replace: true })
  }, [searchParams, data.sales, setSearchParams])

  function clearPendingSection() {
    setPendingSectionFocus(false)
    setHighlightedPendingIndex(null)
  }

  function updateCreditPendingBill(id: string, name?: string) {
    const amount = collectingCreditId
      ? creditCollectDisplayAmount > 0
        ? creditCollectDisplayAmount
        : splitTotal
      : creditSplitAmount > 0
        ? creditSplitAmount
        : roundOffAmount ?? creditCollectDueAmount
    updatePendingSale(id, {
      billAmount: amount,
      originalBillAmount: originalBillHint ?? billAmount,
      customerName: name,
      payType: 'credit',
      pendingPayType: 'credit',
    })
  }

  function updateChequePendingBill(id: string, name?: string) {
    const amount =
      chequeSplitAmount > 0
        ? chequeSplitAmount
        : collectingChequeId
          ? chequeCollectDueAmount
          : balanceDueAmount ?? billAmount
    updatePendingSale(id, {
      billAmount: amount,
      originalBillAmount: originalBillHint ?? billAmount,
      customerName: name,
      payType: 'cheque',
      pendingPayType: 'cheque',
    })
  }

  function recordSplitPendingBills(
    name: string | undefined,
    options: {
      credit?: boolean
      cheque?: boolean
      splitSaleId?: string
      updateCreditId?: string | null
      updateChequeId?: string | null
    } = { credit: true, cheque: true },
  ) {
    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined
    let splitSaleId =
      options.splitSaleId ??
      (loadedPendingId && loadedBill?.status === 'pending' ? loadedPendingId : null)
    const collected =
      cashSplitAmount +
      bankSplitAmount +
      (splitChequeApprovedAmount > 0 ? chequeSplitAmount : 0)
    const bothToPending =
      Boolean(options.credit && options.cheque) &&
      creditSplitAmount > 0 &&
      chequeSplitAmount > 0
    // Pending cheque belongs on the child — never also on the parent (doubles bank/history).
    const chequeGoesToChild = Boolean(options.cheque && chequeSplitAmount > 0)
    const parentChequeAmount = chequeGoesToChild
      ? splitChequeApprovedAmount > 0
        ? splitChequeApprovedAmount
        : undefined
      : chequeSplitAmount || splitChequeApprovedAmount || undefined
    const parentChequeApproved = splitChequeApprovedAmount > 0 || undefined

    if (splitSaleId) {
      const parentBill = data.sales.find((sale) => sale.id === splitSaleId)
      if (parentBill?.status === 'pending') {
        if (collected > 0 || bothToPending) {
          collectPendingSale(splitSaleId, {
            billAmount: dueAmount,
            originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
            paidAmount: cashSplitAmount,
            changeAmount: 0,
            payType: 'split',
            cashAmount: cashSplitAmount || undefined,
            bankAmount: bankSplitAmount || undefined,
            chequeAmount: parentChequeAmount,
            creditAmount: creditSplitAmount || undefined,
            chequeApproved: parentChequeApproved,
            customerName: name,
          })
        } else {
          updatePendingSale(splitSaleId, {
            billAmount: dueAmount,
            originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
            customerName: name,
            payType: 'split',
            cashAmount: cashSplitAmount,
            bankAmount: bankSplitAmount,
            chequeAmount: parentChequeAmount,
            creditAmount: creditSplitAmount,
          })
        }
      }
    }

    const existingChildren = splitSaleId
      ? findSplitChildPending(data.sales, splitSaleId)
      : { chequeId: null, creditId: null, chequeAmount: 0, creditAmount: 0 }

    const updateCreditId =
      options.updateCreditId ??
      existingChildren.creditId ??
      collectingCreditId ??
      null
    const updateChequeId =
      options.updateChequeId ??
      existingChildren.chequeId ??
      (loadedBill?.payType === 'cheque' && loadedBill?.status === 'pending'
        ? loadedPendingId
        : null) ??
      (collectingChequeId && !chequeCollectCreditMode ? collectingChequeId : null) ??
      null

    const creatingCredit =
      options.credit && creditSplitAmount > 0 && !updateCreditId
    const creatingCheque =
      options.cheque && chequeSplitAmount > 0 && !updateChequeId

    if ((creatingCredit || creatingCheque) && !splitSaleId) {
      splitSaleId = crypto.randomUUID()
      if (collected > 0) {
        recordSale({
          id: splitSaleId,
          billAmount: collected,
          originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
          paidAmount: cashSplitAmount,
          changeAmount: 0,
          payType: 'split',
          cashAmount: cashSplitAmount || undefined,
          bankAmount: bankSplitAmount || undefined,
          chequeAmount: parentChequeAmount,
          creditAmount: creditSplitAmount || undefined,
          chequeApproved: parentChequeApproved,
          customerName: name,
          status: 'paid',
        })
      }
    }

    if (options.credit && creditSplitAmount > 0) {
      if (updateCreditId) {
        updateCreditPendingBill(updateCreditId, name)
      } else if (splitSaleId) {
        const splitBill = data.sales.find((sale) => sale.id === splitSaleId)
        if (splitBill && isCreditPendingBill(splitBill)) {
          updateCreditPendingBill(splitSaleId, name)
        } else {
          recordSale({
            billAmount: creditSplitAmount,
            originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
            paidAmount: 0,
            changeAmount: 0,
            payType: 'credit',
            pendingPayType: 'credit',
            customerName: name,
            parentSplitId: splitSaleId ?? undefined,
            status: 'pending',
          })
        }
      } else {
        recordSale({
          billAmount: creditSplitAmount,
          originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'credit',
          pendingPayType: 'credit',
          customerName: name,
          parentSplitId: splitSaleId ?? undefined,
          status: 'pending',
        })
      }
    }
    if (options.cheque && chequeSplitAmount > 0) {
      if (updateChequeId) {
        updateChequePendingBill(updateChequeId, name)
      } else {
        recordSale({
          billAmount: chequeSplitAmount,
          originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'cheque',
          pendingPayType: 'cheque',
          customerName: name,
          parentSplitId: splitSaleId ?? undefined,
          status: 'pending',
        })
      }
    }
  }

  function saveSplitCollected(
    name: string | undefined,
    options: {
      chequeToBank?: boolean
      createCreditPending?: boolean
      createChequePending?: boolean
    },
  ) {
    if (splitPaidTotal > splitTotal || splitExcess > 0) return undefined

    const chequeToBank = options.chequeToBank ?? false
    const createChequePending = options.createChequePending ?? false
    // Cheque pending child owns that leg — parent must not also store it (history/bank 2×).
    const chequeOnParentOnly = chequeToBank && !createChequePending
    const bankAmount = chequeOnParentOnly
      ? bankSplitAmount + chequeSplitAmount
      : bankSplitAmount
    const parentChequeAmount = chequeOnParentOnly
      ? chequeSplitAmount || splitChequeApprovedAmount
      : splitChequeApprovedAmount > 0
        ? splitChequeApprovedAmount
        : undefined
    const parentChequeApproved =
      chequeOnParentOnly || splitChequeApprovedAmount > 0
    const splitSaleId = loadedPendingId ?? crypto.randomUUID()

    const splitCashChangeAmount =
      cashSplitAmount > 0 ? Math.max(0, giveAmount - cashSplitAmount) : 0

    const salePayload = {
      billAmount: splitTotal,
      originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
      paidAmount: cashSplitAmount,
      changeAmount: splitCashChangeAmount,
      payType: 'split' as const,
      cashAmount: cashSplitAmount,
      bankAmount,
      chequeAmount: parentChequeAmount,
      creditAmount: creditSplitAmount,
      chequeApproved: parentChequeApproved,
      customerName: name,
    }

    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined
    const loadedPendingOpen =
      Boolean(loadedPendingId && loadedBill?.status === 'pending')
    const isPaidBillEdit = Boolean(loadedPendingId && loadedBill?.status === 'paid')

    if (isPaidBillEdit && loadedPendingId) {
      savePaidBillEdit(loadedPendingId, name, {
        originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
        billAmount: splitTotal,
        paidAmount: cashSplitAmount,
        changeAmount: splitCashChangeAmount,
        payType: 'split',
        cashAmount: cashSplitAmount > 0 ? cashSplitAmount : undefined,
        bankAmount: bankAmount > 0 ? bankAmount : undefined,
        chequeAmount: parentChequeAmount,
        creditAmount: creditSplitAmount > 0 ? creditSplitAmount : undefined,
        chequeApproved: parentChequeApproved || undefined,
        creditPending: options.createCreditPending ? creditSplitAmount : 0,
        chequePending: createChequePending ? chequeSplitAmount : 0,
      })
      return splitSaleId
    }

    if (loadedPendingOpen && loadedPendingId) {
      collectPendingSale(loadedPendingId, salePayload)
    } else if (!loadedPendingId) {
      recordSale({ ...salePayload, id: splitSaleId })
    }

    const parentSplitId = loadedPendingOpen ? loadedPendingId! : splitSaleId
    const existingChildren = findSplitChildPending(data.sales, parentSplitId)

    recordSplitPendingBills(name, {
      credit: options.createCreditPending ?? false,
      cheque: options.createChequePending ?? false,
      splitSaleId: parentSplitId,
      updateCreditId: collectingCreditId ?? existingChildren.creditId,
      updateChequeId:
        (loadedBill?.payType === 'cheque' && loadedBill?.status === 'pending'
          ? loadedPendingId
          : null) ??
        existingChildren.chequeId ??
        (collectingChequeId && !chequeCollectCreditMode ? collectingChequeId : null),
    })

    return splitSaleId
  }

  function handleSplitCreditPending() {
    if (!canSendSplitCreditPending) return
    const name = getCustomerName() || undefined
    const activeCreditCollectId = collectingCreditId ?? effectiveCollectingCreditId

    if (activeCreditCollectId) {
      if (recordCreditCollection(name, activeCreditCollectId)) {
        finishCreditCollection()
        return
      }
      updateCreditPendingBill(activeCreditCollectId, name)
      flashSaved('pending')
      return
    }

    if (collectingChequeId && !chequeCollectCreditMode) {
      const collected = cashSplitAmount + bankSplitAmount + chequeSplitAmount
      const chequeBill = data.sales.find((sale) => sale.id === collectingChequeId)
      if (collected > 0) {
        recordChequeCollection(name, collectingChequeId)
      }
      if (creditSplitAmount > 0) {
        recordSale({
          billAmount: creditSplitAmount,
          originalBillAmount: originalBillHint ?? billAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'credit',
          pendingPayType: 'credit',
          customerName: name,
          parentSplitId: chequeBill?.parentSplitId,
          status: 'pending',
        })
      }
      flashSaved('pending')
      return
    }

    if (isSplitComplete) {
      saveSplitCollected(name, { createCreditPending: true })
    } else {
      recordSplitPendingBills(name, { credit: true, cheque: false })
    }
    flashSaved('pending')
  }

  function handleSplitChequePending() {
    if (!canSendSplitChequePending) return
    const name = getCustomerName() || undefined
    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined
    const isLoadedChequePending =
      loadedBill?.payType === 'cheque' && loadedBill?.status === 'pending'

    if (collectingCreditId) {
      const creditBill = data.sales.find((sale) => sale.id === collectingCreditId)
      collectPendingSale(collectingCreditId, {
        billAmount: splitTotal,
        originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
        paidAmount: cashSplitAmount > 0 ? cashSplitAmount : 0,
        changeAmount: 0,
        payType: cashSplitAmount > 0 ? 'split' : 'cheque',
        cashAmount: cashSplitAmount > 0 ? cashSplitAmount : undefined,
        chequeAmount: chequeSplitAmount,
        customerName: name,
      })
      if (siblingChequePendingId) {
        updateChequePendingBill(siblingChequePendingId, name)
      } else {
        recordSale({
          billAmount: chequeSplitAmount,
          originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'cheque',
          pendingPayType: 'cheque',
          customerName: name,
          parentSplitId: creditBill?.parentSplitId,
          status: 'pending',
        })
      }
      flashSaved('pending')
      return
    }

    if (isLoadedChequePending && loadedPendingId) {
      updateChequePendingBill(loadedPendingId, name)
      flashSaved('pending')
      return
    }

    if (isSplitComplete) {
      saveSplitCollected(name, { createChequePending: true })
    } else {
      recordSplitPendingBills(name, { credit: false, cheque: true })
    }
    flashSaved('pending')
  }

  function handleSplitCreditChequePending() {
    if (!canSendSplitBothPending) return
    const name = getCustomerName() || undefined
    if (isSplitComplete || loadedPendingId) {
      saveSplitCollected(name, { createCreditPending: true, createChequePending: true })
    } else {
      recordSplitPendingBills(name, { credit: true, cheque: true })
    }
    flashSaved('pending')
  }

  function handleApproveSiblingCheque() {
    if (!canApproveSiblingCheque || !siblingChequePendingId) return
    const name = getCustomerName() || undefined
    const amount = splitSiblingChequePending

    collectChequePayment(siblingChequePendingId, {
      dueAmount: amount,
      collected: amount,
      changeAmount: 0,
      payType: 'cheque',
      chequeAmount: amount,
      chequeApproved: true,
      bankAmount: amount,
      customerName: name,
    })

    setSplitChequeApprovedAmount(amount)
    setSplitSiblingChequePending(0)
    setSiblingChequePendingId(null)
    setChequeSplitStr('')
    setActiveField('cashSplit')
    flashSaved('collect', false)
  }

  function handleSplitChequeApprove() {
    if (!canSplitChequeApprove) return
    const name = getCustomerName() || undefined
    const approvedCheque = chequeSplitAmount
    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined
    const isLoadedChequePending =
      loadedBill?.payType === 'cheque' && loadedBill?.status === 'pending'
    const keepCreditOpen =
      splitHasCredit &&
      creditSplitAmount > 0 &&
      splitSiblingCreditPending === 0 &&
      !isLoadedChequePending

    if (isLoadedChequePending && loadedPendingId) {
      const due = loadedBill?.billAmount ?? approvedCheque
      collectChequePayment(loadedPendingId, {
        dueAmount: due,
        collected: Math.min(approvedCheque, due),
        changeAmount: 0,
        payType: 'cheque',
        chequeAmount: Math.min(approvedCheque, due),
        chequeApproved: true,
        bankAmount: Math.min(approvedCheque, due),
        customerName: name,
      })
      flashSaved('collect')
      return
    }

    if (collectingCreditId) {
      const creditBill = data.sales.find((sale) => sale.id === collectingCreditId)
      const due = creditBill?.billAmount ?? approvedCheque
      collectCreditPayment(collectingCreditId, {
        dueAmount: due,
        collected: Math.min(approvedCheque, due),
        changeAmount: 0,
        payType: 'cheque',
        chequeAmount: Math.min(approvedCheque, due),
        chequeApproved: true,
        bankAmount: Math.min(approvedCheque, due),
        customerName: name,
      })
      flashSaved('collect')
      return
    }

    saveSplitCollected(name, {
      chequeToBank: true,
      createCreditPending: keepCreditOpen,
      createChequePending: false,
    })

    if (keepCreditOpen) {
      setSplitChequeApprovedAmount(approvedCheque)
      setChequeSplitStr('')
      setCashSplitStr('')
      setBankSplitStr('')
      setPaidStr('')
      setGiveStr('')
      setLoadedPendingId(null)
      flashSaved('collect', false)
      return
    }

    flashSaved('collect')
  }

  function recordCreditCollection(name?: string, creditId?: string | null): boolean {
    const targetId = creditId ?? collectingCreditId ?? effectiveCollectingCreditId
    if (!targetId) return false

    const creditCollectTarget = effectiveCollectTarget(creditCollectDueAmount, roundOffAmount)

    const collected =
      payType === 'split'
        ? cashSplitAmount + bankSplitAmount + chequeSplitAmount
        : payType === 'cash' || payType === 'bank' || payType === 'cheque'
          ? paidAmount
          : 0

    if (collected <= 0) return false

    if (payType === 'split') {
      collectCreditPayment(targetId, {
        dueAmount: creditCollectDueAmount,
        collectTarget: creditCollectTarget,
        collected,
        changeAmount:
          cashSplitAmount > 0 ? Math.max(0, giveAmount - cashSplitAmount) : 0,
        payType:
          cashSplitAmount > 0 && (bankSplitAmount > 0 || chequeSplitAmount > 0)
            ? 'split'
            : bankSplitAmount > 0 && chequeSplitAmount > 0
              ? 'split'
              : chequeSplitAmount > 0
                ? 'cheque'
                : bankSplitAmount > 0
                  ? 'bank'
                  : 'cash',
        cashAmount: cashSplitAmount > 0 ? cashSplitAmount : undefined,
        bankAmount:
          bankSplitAmount > 0
            ? bankSplitAmount
            : chequeSplitAmount > 0
              ? chequeSplitAmount
              : undefined,
        chequeAmount: chequeSplitAmount > 0 ? chequeSplitAmount : undefined,
        chequeApproved: chequeSplitAmount > 0 ? true : undefined,
        customerName: name,
      })
      return true
    }

    const cashAmount = payType === 'cash' ? paidAmount : 0
    const bankAmount = payType === 'bank' ? paidAmount : 0
    const chequeAmount = payType === 'cheque' ? paidAmount : 0

    collectCreditPayment(targetId, {
      dueAmount: creditCollectDueAmount,
      collectTarget: creditCollectTarget,
      collected,
      changeAmount: payType === 'cash' ? changeAmount : 0,
      payType: payType === 'credit' ? 'cash' : payType,
      cashAmount: cashAmount > 0 ? cashAmount : undefined,
      bankAmount: bankAmount > 0 ? bankAmount : undefined,
      chequeAmount: chequeAmount > 0 ? chequeAmount : undefined,
      chequeApproved: payType === 'cheque' ? true : undefined,
      customerName: name,
    })
    return true
  }

  function recordChequeCollection(name?: string, chequeId?: string | null): boolean {
    const targetId = chequeId ?? collectingChequeId ?? effectiveCollectingChequeId
    if (!targetId) return false

    const chequeCollectTarget = effectiveCollectTarget(chequeCollectDueAmount, roundOffAmount)

    const collected =
      payType === 'split'
        ? cashSplitAmount + bankSplitAmount + chequeSplitAmount
        : payType === 'cash' || payType === 'bank' || payType === 'cheque'
          ? paidAmount
          : 0

    if (collected <= 0) return false

    const submitPayment = collectChequePayment

    if (payType === 'split') {
      submitPayment(targetId, {
        dueAmount: chequeCollectDueAmount,
        collectTarget: chequeCollectTarget,
        collected,
        changeAmount:
          cashSplitAmount > 0 ? Math.max(0, giveAmount - cashSplitAmount) : 0,
        payType:
          cashSplitAmount > 0 && (bankSplitAmount > 0 || chequeSplitAmount > 0)
            ? 'split'
            : bankSplitAmount > 0 && chequeSplitAmount > 0
              ? 'split'
              : chequeSplitAmount > 0
                ? 'cheque'
                : bankSplitAmount > 0
                  ? 'bank'
                  : 'cash',
        cashAmount: cashSplitAmount > 0 ? cashSplitAmount : undefined,
        bankAmount:
          bankSplitAmount > 0
            ? bankSplitAmount
            : chequeSplitAmount > 0
              ? chequeSplitAmount
              : undefined,
        chequeAmount: chequeSplitAmount > 0 ? chequeSplitAmount : undefined,
        chequeApproved: chequeSplitAmount > 0 ? true : undefined,
        customerName: name,
      })
      return true
    }

    const cashAmount = payType === 'cash' ? paidAmount : 0
    const bankAmount = payType === 'bank' ? paidAmount : 0
    const chequeAmount = payType === 'cheque' ? paidAmount : 0

    submitPayment(targetId, {
      dueAmount: chequeCollectDueAmount,
      collectTarget: chequeCollectTarget,
      collected,
      changeAmount: payType === 'cash' ? changeAmount : 0,
      payType: payType === 'credit' ? 'cash' : payType,
      cashAmount: cashAmount > 0 ? cashAmount : undefined,
      // Mirror cheque into bankAmount so approve path always clears to bank once.
      bankAmount:
        bankAmount > 0 ? bankAmount : chequeAmount > 0 ? chequeAmount : undefined,
      chequeAmount: chequeAmount > 0 ? chequeAmount : undefined,
      chequeApproved: payType === 'cheque' ? true : undefined,
      customerName: name,
    })
    return true
  }

  function finishCreditCollection() {
    flashSaved('collect')
  }

  useEffect(() => () => cancelCreditExitTimer(), [])

  useEffect(() => {
    if (!collectingCreditId || payType !== 'cash') return
    if (paidAmount <= 0) return
    setGiveStr((prev) => {
      const give = parseAmount(prev)
      return give >= paidAmount ? prev : paidStr
    })
  }, [collectingCreditId, payType, paidAmount, paidStr])

  function handleSavePending() {
    if (!canSavePending) return

    const name = getCustomerName() || undefined
    const activeCreditCollectId = collectingCreditId ?? effectiveCollectingCreditId

    if (activeCreditCollectId) {
      if (recordCreditCollection(name, activeCreditCollectId)) {
        finishCreditCollection()
        return
      }
      updateCreditPendingBill(activeCreditCollectId, name)
      flashSaved('pending')
      return
    }

    if (collectingChequeId) {
      if (chequeCollectCreditMode) {
        const amount =
          creditSplitAmount > 0
            ? creditSplitAmount
            : chequeCollectCreditRemainder > 0
              ? chequeCollectCreditRemainder
              : splitTotal
        updatePendingSale(collectingChequeId, {
          billAmount: amount,
          originalBillAmount: originalBillHint ?? billAmount,
          customerName: name,
          payType: 'credit',
          pendingPayType: 'credit',
        })
      } else {
        updateChequePendingBill(collectingChequeId, name)
      }
      flashSaved('pending')
      return
    }

    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined

    if (loadedBill?.status === 'pending' && loadedBill.payType === 'cheque') {
      updateChequePendingBill(loadedPendingId!, name)
      flashSaved('pending')
      return
    }

    if (loadedBill?.status === 'pending' && isCreditPendingBill(loadedBill)) {
      if (recordCreditCollection(name, loadedBill.id)) {
        finishCreditCollection()
        return
      }
      updateCreditPendingBill(loadedBill.id, name)
      flashSaved('pending')
      return
    }

    const pendingPayload = buildPendingPayload()

    if (loadedPendingId) {
      updatePendingSale(loadedPendingId, pendingPayload)
      if (
        payType === 'split' &&
        (creditSplitAmount > 0 || chequeSplitAmount > 0) &&
        !(loadedBill && isCreditPendingBill(loadedBill))
      ) {
        recordSplitPendingBills(name, { splitSaleId: loadedPendingId })
      }
    } else if (payType === 'split') {
      const newId = crypto.randomUUID()
      recordSale({
        id: newId,
        ...pendingPayload,
        paidAmount: 0,
        changeAmount: 0,
        status: 'pending',
      })
      recordSplitPendingBills(name, { splitSaleId: newId })
    } else {
      recordSale({
        ...pendingPayload,
        paidAmount: 0,
        changeAmount: 0,
        status: 'pending',
        pendingPayType:
          payType === 'credit' || payType === 'cheque' ? payType : undefined,
      })
    }

    flashSaved('pending')
  }

  function savePaidBillEdit(
    id: string,
    name: string | undefined,
    payment: {
      originalBillAmount: number
      billAmount: number
      paidAmount: number
      changeAmount: number
      payType: PayType
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      creditAmount?: number
      chequeApproved?: boolean
      creditPending?: number
      chequePending?: number
    },
  ) {
    editPaidSalePayment(id, {
      originalBillAmount: payment.originalBillAmount,
      billAmount: payment.billAmount,
      paidAmount: payment.paidAmount,
      changeAmount: payment.changeAmount,
      payType: payment.payType,
      cashAmount: payment.cashAmount,
      bankAmount: payment.bankAmount,
      chequeAmount: payment.chequeAmount,
      creditAmount: payment.creditAmount,
      chequeApproved: payment.chequeApproved,
      creditPending: payment.creditPending,
      chequePending: payment.chequePending,
      customerName: name,
    })
  }

  function handleSave() {
    if (!isValid) return

    const name = getCustomerName() || undefined
    const activeCreditCollectId = collectingCreditId ?? effectiveCollectingCreditId

    if (activeCreditCollectId) {
      if (recordCreditCollection(name, activeCreditCollectId)) {
        finishCreditCollection()
      }
      return
    }

    if (collectingChequeId) {
      if (recordChequeCollection(name, collectingChequeId)) {
        flashSaved('collect')
      }
      return
    }

    if (payType === 'split') {
      saveSplitCollected(name, {
        createCreditPending: splitHasCredit,
        createChequePending: splitHasChequePending,
      })
      flashSaved('collect')
      return
    }

    const cashAmount = payType === 'cash' ? paidAmount : 0
    const bankAmount =
      payType === 'bank' || payType === 'cheque' ? paidAmount : 0
    const chequeAmount = payType === 'cheque' ? paidAmount : 0
    const creditAmount = 0

    const salePayload = {
      billAmount: paidAmount,
      originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
      paidAmount:
        payType === 'bank' || payType === 'cheque'
          ? paidAmount
          : giveAmount,
      changeAmount: changeAmount,
      payType,
      cashAmount,
      bankAmount,
      chequeAmount,
      creditAmount,
      chequeApproved: payType === 'cheque' ? true : undefined,
      customerName: name,
    }

    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined

    if (loadedPendingId && loadedBill?.status === 'paid') {
      const collectedTotal = cashAmount + bankAmount + chequeAmount
      const openCredit = Math.max(0, billCollectTarget - collectedTotal)
      savePaidBillEdit(loadedPendingId, name, {
        originalBillAmount: deductDraftReturns ? typedBillAmount : billAmount,
        billAmount: payType === 'cash' ? giveAmount : paidAmount,
        paidAmount: payType === 'bank' || payType === 'cheque' ? paidAmount : giveAmount,
        changeAmount,
        payType,
        cashAmount: cashAmount > 0 ? cashAmount : undefined,
        bankAmount: bankAmount > 0 ? bankAmount : undefined,
        chequeAmount: chequeAmount > 0 ? chequeAmount : undefined,
        chequeApproved: payType === 'cheque' ? true : undefined,
        creditPending: openCredit > 0 ? openCredit : 0,
      })
    } else if (loadedPendingId) {
      collectPendingSale(loadedPendingId, salePayload)
    } else {
      recordSale(salePayload)
    }
    flashSaved('collect')
  }

  const saveLabel =
    savedAction === 'collect'
      ? '✓ Saved'
      : collectingCreditId
        ? payType === 'cheque'
          ? 'Approve\n& Bank'
          : payType === 'bank'
            ? 'Collect\nBank'
            : payType === 'cash'
              ? 'Collect\nCash'
              : chequeSplitAmount > 0 && cashSplitAmount === 0 && bankSplitAmount === 0
                ? 'Approve\n& Bank'
                : bankSplitAmount > 0 && cashSplitAmount === 0 && chequeSplitAmount === 0
                  ? 'Collect\nBank'
                  : 'Collect\nCash'
        : collectingChequeId
          ? payType === 'cheque'
            ? 'Approve\n& Bank'
            : payType === 'bank'
              ? 'Collect\nBank'
              : payType === 'cash'
                ? 'Collect\nCash'
                : chequeCollectCreditMode
                  ? bankSplitAmount > 0 && cashSplitAmount === 0 && chequeSplitAmount === 0
                    ? 'Collect\nBank'
                    : chequeSplitAmount > 0 && cashSplitAmount === 0 && bankSplitAmount === 0
                      ? 'Approve\n& Bank'
                      : 'Collect\nCash'
                  : chequeSplitAmount > 0 && cashSplitAmount === 0 && bankSplitAmount === 0
                    ? 'Approve\n& Bank'
                    : bankSplitAmount > 0 && cashSplitAmount === 0 && chequeSplitAmount === 0
                      ? 'Collect\nBank'
                      : 'Collect\nCash'
        : payType === 'cheque'
          ? 'Approve\n& Bank'
          : 'Save &\nCollect'

  function jumpToAmountField() {
    if (collectingBalanceBillId) {
      if (payType === 'cash') {
        setActiveField('give')
        return
      }
      if (payType === 'bank' || payType === 'cheque') {
        setActiveField('paid')
        return
      }
      setActiveField(nextUnlockedSplitField('cashSplit'))
      return
    }
    if (balanceOnlyMode && payType === 'split') {
      setActiveField(nextUnlockedSplitField('cashSplit'))
      return
    }
    if (balanceOnlyMode && payType === 'cheque' && !collectingBalanceBillId) {
      setActiveField('paid')
      return
    }
    if (payType === 'split') {
      if (billAmount > 0) {
        setPaymentStep(true)
        if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
        setActiveField('cashSplit')
      } else {
        setActiveField('bill')
      }
      return
    }
    if (payType === 'cash') {
      if (billAmount > 0) {
        setPaymentStep(true)
        if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
        setActiveField('give')
      } else {
        setActiveField('bill')
      }
      return
    }
    if (billAmount > 0) openPaymentStep()
    else setActiveField('bill')
  }

  function handleReturnDone(draft: { itemName: string; quantity: number; rate: number }) {
    const targetId =
      collectingCreditId ??
      effectiveCollectingCreditId ??
      collectingChequeId ??
      effectiveCollectingChequeId ??
      loadedPendingId

    if (targetId) {
      applySaleReturn(targetId, draft)
      return
    }

    const entry = buildSaleReturnEntry(draft)
    if (!entry) return
    setDraftReturns((prev) => [...prev, entry])
  }

  function focusNameSection() {
    setNameSectionFocus(true)
    clearPendingSection()
    customerNameFieldRef.current?.focus()
    customerNameFieldRef.current?.select()
  }

  function focusPendingSection() {
    setPendingSectionFocus(true)
    setNameSectionFocus(false)
    customerNameFieldRef.current?.blur()

    const panel = pendingPanelRef.current
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      panel.focus()
    }

    if (billPendingBills.length === 0) {
      setHighlightedPendingIndex(null)
      return
    }

    if (loadedPendingId) {
      const idx = billPendingBills.findIndex((bill) => bill.id === loadedPendingId)
      setHighlightedPendingIndex(idx >= 0 ? idx : 0)
      return
    }

    setHighlightedPendingIndex(0)
  }

  function focusAmountSection() {
    const fromOtherSection =
      nameSectionFocus ||
      pendingSectionFocus ||
      customerNameFieldRef.current?.isFocused()

    setNameSectionFocus(false)
    clearPendingSection()
    customerNameFieldRef.current?.blur()

    if (fromOtherSection) {
      jumpToAmountField()
    } else {
      handleEnter()
    }
  }

  const focusNameRef = useRef(focusNameSection)
  const focusPendingRef = useRef(focusPendingSection)
  const focusAmountRef = useRef(focusAmountSection)
  focusNameRef.current = focusNameSection
  focusPendingRef.current = focusPendingSection
  focusAmountRef.current = focusAmountSection

  // After a persisted return on an open credit/cheque bill, refresh due fields.
  useEffect(() => {
    if (!loadedPendingId || !loadedPendingBill) return
    const returnCount = loadedPendingBill.returns?.length ?? 0
    if (returnCount === 0) return
    setDraftReturns([...(loadedPendingBill.returns ?? [])])
    if (!isCreditPendingBill(loadedPendingBill) && !isChequePendingBill(loadedPendingBill)) {
      return
    }
    const due = saleCreditBalanceDue(loadedPendingBill, tabSales)
    const gross = saleGrossBillAmount(loadedPendingBill)
    setBalanceDueAmount(due)
    setOriginalBillHint(gross !== due ? gross : null)
    setBillStr(String(due))
    if (isCreditPendingBill(loadedPendingBill)) {
      setCreditCollectDue(due)
      setCollectingCreditId(loadedPendingBill.id)
    }
    if (isChequePendingBill(loadedPendingBill)) {
      setChequeCollectDue(due)
      setCollectingChequeId(loadedPendingBill.id)
    }
  }, [
    loadedPendingId,
    loadedPendingBill,
    loadedPendingBill?.billAmount,
    loadedPendingBill?.updatedAt,
  ])

  const saveHandlerRef = useRef(handleSave)
  const savePendingHandlerRef = useRef(handleSavePending)
  const cyclePayTypeRef = useRef(cyclePayType)
  const openChequeRef = useRef(openChequeTab)
  const openCreditRef = useRef(openCreditTab)
  const chequePendingBillsRef = useRef(chequePendingBills)
  const creditPendingBillsRef = useRef(creditPendingBills)
  const highlightedChequeIndexRef = useRef(highlightedChequeIndex)
  const highlightedCreditIndexRef = useRef(highlightedCreditIndex)
  const activeChequeItemRef = useRef<HTMLButtonElement>(null)
  const activeCreditItemRef = useRef<HTMLButtonElement>(null)
  const chequeBarRef = useRef<HTMLDivElement>(null)
  const creditBarRef = useRef<HTMLDivElement>(null)
  const chequeListRef = useRef<HTMLUListElement>(null)
  const creditListRef = useRef<HTMLUListElement>(null)
  const pendingBillsRef = useRef(billPendingBills)
  const highlightedPendingIndexRef = useRef(highlightedPendingIndex)
  const selectPendingBillRef = useRef(selectPendingBill)
  saveHandlerRef.current = handleSave
  savePendingHandlerRef.current = handleSavePending
  cyclePayTypeRef.current = cyclePayType
  openChequeRef.current = openChequeTab
  openCreditRef.current = openCreditTab
  chequePendingBillsRef.current = filteredChequePendingBills
  creditPendingBillsRef.current = filteredCreditPendingBills
  highlightedChequeIndexRef.current = highlightedChequeIndex
  highlightedCreditIndexRef.current = highlightedCreditIndex
  pendingBillsRef.current = billPendingBills
  highlightedPendingIndexRef.current = highlightedPendingIndex
  selectPendingBillRef.current = selectPendingBill

  useEffect(() => {
    if (!routeActive || !pendingSectionFocus) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return

      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }

      const bills = pendingBillsRef.current
      if (bills.length === 0) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedPendingIndex((current) => {
          const idx = current ?? 0
          if (e.key === 'ArrowDown') return (idx + 1) % bills.length
          return (idx - 1 + bills.length) % bills.length
        })
        return
      }

      if (e.key === 'Enter') {
        const idx = highlightedPendingIndexRef.current
        if (idx == null || idx < 0 || idx >= bills.length) return
        e.preventDefault()
        selectPendingBillRef.current(bills[idx])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingSectionFocus, routeActive])

  useEffect(() => {
    if (!pendingSectionFocus || highlightedPendingIndex == null) return

    const panel = pendingPanelRef.current
    const billId = pendingBills[highlightedPendingIndex]?.id
    if (!panel || !billId) return

    const item = panel.querySelector(`[data-bill-id="${billId}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [pendingSectionFocus, highlightedPendingIndex, pendingBills])

  useEffect(() => {
    if (!routeActive || (!chequeListOpen && !creditListOpen)) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (chequeBarRef.current?.contains(target)) return
      if (creditBarRef.current?.contains(target)) return
      setChequeListOpen(false)
      setCreditListOpen(false)
      setHighlightedChequeIndex(-1)
      setHighlightedCreditIndex(-1)
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [chequeListOpen, creditListOpen, routeActive])

  useEffect(() => {
    if (!routeActive || !chequeListOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return

      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }

      const bills = chequePendingBillsRef.current
      if (bills.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedChequeIndex((current) => (current + 1) % bills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedChequeIndex((current) =>
          current <= 0 ? bills.length - 1 : current - 1,
        )
        return
      }
      if (e.key === 'Enter') {
        const idx = highlightedChequeIndexRef.current
        if (idx < 0 || idx >= bills.length) return
        e.preventDefault()
        selectPendingBillRef.current(bills[idx])
        setChequeListOpen(false)
        return
      }
      if (e.key === 'Escape') {
        setChequeListOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chequeListOpen, routeActive])

  useEffect(() => {
    if (!chequeListOpen || highlightedChequeIndex < 0) return
    const item = activeChequeItemRef.current
    const list = chequeListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [chequeListOpen, highlightedChequeIndex])

  useEffect(() => {
    if (!routeActive || !creditListOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return

      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }

      const bills = creditPendingBillsRef.current
      if (bills.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedCreditIndex((current) => (current + 1) % bills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedCreditIndex((current) =>
          current <= 0 ? bills.length - 1 : current - 1,
        )
        return
      }
      if (e.key === 'Enter') {
        const idx = highlightedCreditIndexRef.current
        if (idx < 0 || idx >= bills.length) return
        e.preventDefault()
        selectPendingBillRef.current(bills[idx])
        setCreditListOpen(false)
        return
      }
      if (e.key === 'Escape') {
        setCreditListOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [creditListOpen, routeActive])

  useEffect(() => {
    if (!creditListOpen || highlightedCreditIndex < 0) return
    const item = activeCreditItemRef.current
    const list = creditListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [creditListOpen, highlightedCreditIndex])

  useEffect(() => {
    if (!routeActive) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return

      if (e.code === 'KeyS') {
        if (!isValid) return
        e.preventDefault()
        saveHandlerRef.current()
        return
      }

      if (e.code === 'KeyB') {
        if (!canSavePending) return
        e.preventDefault()
        savePendingHandlerRef.current()
        return
      }

      if (e.code === 'KeyA') {
        e.preventDefault()
        cyclePayTypeRef.current()
        return
      }

      if (e.code === 'KeyC') {
        e.preventDefault()
        openChequeRef.current()
        return
      }

      if (e.code === 'KeyT') {
        e.preventDefault()
        openCreditRef.current()
        return
      }

      if (e.code === 'KeyN') {
        e.preventDefault()
        focusNameRef.current()
        return
      }

      if (e.code === 'KeyW') {
        e.preventDefault()
        focusPendingRef.current()
        return
      }

      if (e.code === 'KeyE') {
        e.preventDefault()
        focusAmountRef.current()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSaving, isValid, canSavePending, routeActive])

  const payTypeChipValue: PayType =
    effectiveCollectingChequeId && chequeCollectCreditMode && payType === 'split'
      ? 'credit'
      : payType

  const creditCollectGridClass = ''

  const chequeCollectGridClass = ''

  return (
    <div className="counter-page">
      <button
        type="button"
        className="counter-return-corner"
        onClick={() => setShowReturnModal(true)}
        disabled={!canOpenReturn || savedAction !== null}
        title="Sale return"
      >
        Return
      </button>
      <div className="counter-body">
        <div className="counter-main">
          <div className="counter-top">
            {showBalanceBreakdown ? (
              <div className="counter-return-strip" aria-live="polite">
                <span>
                  <em>Original</em>
                  {formatMoney(returnGrossDisplay)}
                </span>
                <span>
                  <em>Paid</em>
                  {formatMoney(paidSoFarDisplay)}
                </span>
                <span>
                  <em>Return</em>
                  {returnTotalDisplay > 0 ? `−${formatMoney(returnTotalDisplay)}` : formatMoney(0)}
                </span>
                <strong>
                  <em>To pay</em>
                  {formatMoney(balanceToPayDisplay)}
                </strong>
              </div>
            ) : null}
            <div
              className={`counter-amounts ${
                showFullSplitGrid
                  ? 'counter-amounts--split'
                  : creditCollectGridClass || chequeCollectGridClass
              }`}
            >
            {balanceOnlyMode ? (
              <div className="counter-readonly counter-readonly--balance">
                <span className="counter-readonly-label">
                  {collectingCreditId || effectiveCollectingCreditId
                    ? 'To Pay'
                    : collectingChequeId || effectiveCollectingChequeId
                      ? 'Cheque due'
                      : 'Balance'}
                </span>
                <span className="counter-readonly-value">
                  {formatMoney(balanceToPayDisplay)}
                </span>
                {collectingCreditId && creditCollectCustomerName ? (
                  <span className="counter-balance-hint counter-balance-hint--customer">
                    {creditCollectCustomerName}
                  </span>
                ) : null}
                {showBalanceBreakdown ? (
                  <span className="counter-balance-hint">
                    {formatMoney(returnGrossDisplay)}
                    {paidSoFarDisplay > 0 ? ` − paid ${formatMoney(paidSoFarDisplay)}` : ''}
                    {returnTotalDisplay > 0 ? ` − return ${formatMoney(returnTotalDisplay)}` : ''}
                    {' = '}
                    {formatMoney(balanceToPayDisplay)}
                  </span>
                ) : originalBillHint ? (
                  <span className="counter-balance-hint">
                    Bill {formatMoney(originalBillHint)}
                  </span>
                ) : null}
              </div>
            ) : (
            <AmountDisplay
              label="Bill"
              value={billStr}
              active={activeField === 'bill'}
              onSelect={() => {
                setNameSectionFocus(false)
                clearPendingSection()
                setActiveField('bill')
              }}
              compact
              shortcutHint="Alt+E"
            />
            )}
            {hideChequeSplitGive ? null : payType === 'split' ? (
              showSplitCashGive ? (
              <AmountDisplay
                label="Amount Tendered"
                value={giveStr}
                active={activeField === 'give'}
                onSelect={() => {
                  setNameSectionFocus(false)
                  clearPendingSection()
                  setActiveField('give')
                }}
                compact
              />
              ) : (
              <div className="counter-readonly counter-readonly--na">
                <span className="counter-readonly-label">Amount Tendered</span>
                <span className="counter-readonly-value">—</span>
              </div>
              )
            ) : needsGive(payType) ? (
              <AmountDisplay
                label="Customer Give"
                value={giveStr}
                active={activeField === 'give'}
                onSelect={() => {
                  setNameSectionFocus(false)
                  clearPendingSection()
                  setActiveField('give')
                }}
                compact
              />
            ) : (
              <div className="counter-readonly counter-readonly--na">
                <span className="counter-readonly-label">Customer Give</span>
                <span className="counter-readonly-value">—</span>
              </div>
            )}
            {showFullSplitGrid ? (
              <>
                <AmountDisplay
                  label="Cash"
                  value={
                    cashShowsCreditPaid
                      ? formatSplitPart(splitCreditPaidCash)
                      : cashSplitStr
                  }
                  active={cashShowsCreditPaid ? false : activeField === 'cashSplit'}
                  onSelect={() => {
                    if (!splitFieldLocked.cash) setActiveField('cashSplit')
                  }}
                  locked={splitFieldLocked.cash}
                  approved={cashShowsCreditPaid}
                  priorApprovedAmount={
                    splitParentCashPrior > 0 && cashSplitAmount <= 0 && !cashShowsCreditPaid
                      ? splitParentCashPrior
                      : undefined
                  }
                  remainingAmount={creditCollectRemaining}
                  compact
                />
                <AmountDisplay
                  label="Bank"
                  value={
                    bankShowsCreditPaid
                      ? formatSplitPart(splitCreditPaidBank)
                      : bankSplitStr
                  }
                  active={bankShowsCreditPaid ? false : activeField === 'bankSplit'}
                  onSelect={() => {
                    if (!splitFieldLocked.bank) setActiveField('bankSplit')
                  }}
                  locked={splitFieldLocked.bank}
                  approved={bankShowsCreditPaid}
                  remainingAmount={creditCollectRemaining}
                  compact
                />
                <AmountDisplay
                  label="Cheque"
                  value={
                    splitChequeApprovedAmount > 0 &&
                    chequeSplitAmount <= 0 &&
                    splitSiblingChequePending <= 0
                      ? formatSplitPart(splitChequeApprovedAmount)
                      : chequeShowsCreditPaid
                        ? formatSplitPart(splitCreditPaidCheque)
                        : chequeSplitStr
                  }
                  active={
                    splitChequeApprovedAmount > 0 &&
                    chequeSplitAmount <= 0 &&
                    splitSiblingChequePending <= 0
                      ? false
                      : chequeShowsCreditPaid
                        ? false
                        : activeField === 'chequeSplit'
                  }
                  onSelect={() => {
                    if (!splitFieldLocked.cheque) setActiveField('chequeSplit')
                  }}
                  locked={splitFieldLocked.cheque}
                  approved={
                    (splitChequeApprovedAmount > 0 &&
                      chequeSplitAmount <= 0 &&
                      splitSiblingChequePending <= 0) ||
                    chequeShowsCreditPaid
                  }
                  priorApprovedAmount={
                    splitChequeApprovedAmount > 0 && chequeSplitAmount > 0
                      ? splitChequeApprovedAmount
                      : splitCreditPaidCheque > 0 && chequeSplitAmount > 0
                        ? splitCreditPaidCheque
                        : undefined
                  }
                  priorPendingAmount={
                    splitSiblingChequePending > 0 ? splitSiblingChequePending : undefined
                  }
                  remainingAmount={creditCollectRemaining}
                  compact
                />
                {splitSiblingCreditPending > 0 ? (
                  <AmountDisplay
                    label="Credit"
                    value={creditSplitStr}
                    pending
                    compact
                  />
                ) : splitSiblingCreditPaid > 0 ? (
                  <AmountDisplay
                    label="Credit"
                    value={formatSplitPart(splitSiblingCreditPaid)}
                    approved
                    compact
                  />
                ) : collectingCreditId ? (
                <AmountDisplay
                  label="Credit"
                  value={formatSplitPart(creditCollectDisplayAmount)}
                  locked
                  priorApprovedAmount={
                    splitParentCashPrior > 0 ? splitParentCashPrior : undefined
                  }
                  compact
                />
                ) : collectingChequeId && chequeCollectCreditMode ? (
                <AmountDisplay
                  label="Credit"
                  value={formatSplitPart(chequeCollectCreditRemainder)}
                  locked
                  compact
                />
                ) : (
                <AmountDisplay
                  label="Credit"
                  value={creditSplitStr}
                  active={activeField === 'creditSplit'}
                  onSelect={() => {
                    if (!splitFieldLocked.credit) {
                      setActiveField('creditSplit')
                    }
                  }}
                  locked={splitFieldLocked.credit}
                  compact
                />
                )}
              </>
            ) : creditCollectCashMode ? (
              <AmountDisplay
                label="Cash"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                remainingAmount={creditCollectRemaining}
                compact
              />
            ) : chequeCollectCashMode ? (
              <AmountDisplay
                label="Customer Paid"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                compact
              />
            ) : creditCollectBankMode ? (
              <AmountDisplay
                label="Bank"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                compact
              />
            ) : creditCollectChequeMode ? (
              <AmountDisplay
                label="Cheque"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                compact
              />
            ) : chequeCollectBankMode ? (
              <AmountDisplay
                label="Bank"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                remainingAmount={
                  chequeCollectRemainingAmount > 0 && paidAmount > 0
                    ? chequeCollectRemainingAmount
                    : undefined
                }
                remainingKind="cheque"
                compact
              />
            ) : chequeCollectChequeMode ? (
              <AmountDisplay
                label="Cheque"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                remainingAmount={
                  chequeCollectRemainingAmount > 0 && paidAmount > 0
                    ? chequeCollectRemainingAmount
                    : undefined
                }
                remainingKind="cheque"
                compact
              />
            ) : balanceOnlyMode && payType === 'cheque' && !collectingBalanceBillId ? (
              <div className="counter-readonly counter-readonly--balance">
                <span className="counter-readonly-label">Cheque</span>
                <span className="counter-readonly-value">
                  {formatMoney(balanceDueAmount ?? paidAmount)}
                </span>
              </div>
            ) : paymentStep ? (
              <AmountDisplay
                label="Customer Paid"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                compact
              />
            ) : (
              <div
                className={`counter-readonly ${billStr ? 'counter-readonly--mirror' : ''}`}
              >
                <span className="counter-readonly-label">Customer Paid</span>
                <span className="counter-readonly-value">{customerPaidPreview}</span>
              </div>
            )}
            <div
              className={`counter-readonly counter-readonly--return ${showReturnLive && !needMore && !splitShortfall && (changeAmount > 0 || splitCashChange > 0 || (showFullSplitGrid && splitPaidTotal === splitTotal)) ? 'counter-readonly--ready' : ''} ${needMore || splitShortfall ? 'counter-readonly--warn' : ''} ${(activeField === 'give' || activeField === 'paid' || activeField === 'cashSplit' || activeField === 'bankSplit' || activeField === 'chequeSplit' || activeField === 'creditSplit') && showReturnLive ? 'counter-readonly--live' : ''}`}
            >
              <span className="counter-readonly-label">Return</span>
              <span className="counter-readonly-value">{returnDisplay}</span>
            </div>
          </div>

          {showSplitPaidTotal && (
            <div className="counter-split-total">
              <span>Paid Total</span>
              <strong>
                {splitDueDenominator > 0 ||
                splitPaidTotal > 0 ||
                splitPaidTotalDisplay > 0 ||
                showPriorChequeInPaidTotal ||
                showPendingChequeInPaidTotal ||
                showPendingCreditInPaidTotal ||
                showPaidCreditInPaidTotal ||
                showParentPriorPaidInPaidTotal ? (
                  showSplitDueHint ? (
                    <>
                      {formatMoney(splitPaidTotalDisplay)}
                      {showParentPriorPaidInPaidTotal ? (
                        <span className="counter-split-total-prior">
                          {' '}
                          + ✓{formatMoney(splitParentPriorPaid)}
                        </span>
                      ) : null}
                      {showPriorChequeInPaidTotal ? (
                        <span className="counter-split-total-prior">
                          {' '}
                          + ✓{formatMoney(splitChequeApprovedAmount)}
                        </span>
                      ) : null}
                      {showPendingChequeInPaidTotal ? (
                        <span className="counter-split-total-pending">
                          {' '}
                          + ⏳{formatMoney(splitSiblingChequePending)}
                        </span>
                      ) : null}
                      {showPendingCreditInPaidTotal ? (
                        <span className="counter-split-total-pending">
                          {' '}
                          + ⏳{formatMoney(splitSiblingCreditPending)}
                        </span>
                      ) : null}
                      {showPaidCreditInPaidTotal ? (
                        <span className="counter-split-total-prior">
                          {' '}
                          + ✓{formatMoney(splitSiblingCreditPaid)}
                        </span>
                      ) : null}
                      {' / '}
                      {formatMoney(splitPaidTotalBill)}
                    </>
                  ) : (
                    formatMoney(splitPaidTotalDisplay)
                  )
                ) : (
                  '—'
                )}
              </strong>
            </div>
          )}

          <CounterCustomerNameField
            ref={customerNameFieldRef}
            customerNameSuggestions={customerNameSuggestions}
            customerPendingByName={customerPendingByName}
            customerChequePendingByName={customerChequePendingByName}
            showCreditSession={showCreditSession}
            showChequeSession={showChequeSession}
            onFocusSection={clearPendingSection}
            onFocusChange={setNameSectionFocus}
          />

          <div className="counter-pay">
            <PayTypeChips
              value={payTypeChipValue}
              onChange={handlePayTypeChange}
              options={collectingBalanceBillId ? balanceCollectPayTypes : COUNTER_PAY_TYPES}
              shortcutHint="Alt+A"
              disabled={balanceOnlyMode && !collectingBalanceBillId}
            />
          </div>

          </div>

          <div className="counter-keyboard-wrap">
            <NumberKeyboard
              onPress={stableNumpadPress}
              hint={keyboardHint(activeField)}
            />
          </div>

          <div className="counter-footer">
            <div className="counter-round">
            {showRoundChips ? (
              <RoundTypeChips
                label="Round down"
                options={billRoundOptions}
                onSelect={(amt) => applyRoundCollectAmount(amt)}
                onOtherSelect={() => {
                  setRoundOtherActive(true)
                  setRoundCustomStr(roundOffAmount != null ? String(roundOffAmount) : '')
                  setActiveField('roundCustom')
                }}
                otherActive={roundOtherActive}
                otherValue={roundCustomStr}
                activeAmount={roundOffAmount ?? undefined}
                compact
              />
            ) : (
              <p className="counter-round-empty">Round down</p>
            )}
            </div>

          <div className="counter-cheque-bar" ref={chequeBarRef}>
            <button
              type="button"
              className="counter-cheque-open"
              onClick={openChequeTab}
              disabled={chequePendingBills.length === 0}
            >
              <span>🧾 Cheque Bills ({chequePendingBills.length})</span>
              <span className="counter-cheque-open-meta">
                <span className="counter-cheque-open-total">{formatMoney(chequePendingTotal)}</span>
                <span className="counter-cheque-open-hint">Alt+C</span>
                <span className="counter-cheque-open-caret">{chequeListOpen ? '▲' : '▼'}</span>
              </span>
            </button>
            {chequeListOpen && chequePendingBills.length > 0 && (
              <>
                {chequePendingBills.length > 4 ? (
                  <input
                    type="search"
                    className="counter-pending-search"
                    value={chequeListSearch}
                    onChange={(e) => setChequeListSearch(e.target.value)}
                    placeholder="Search cheque bills…"
                    autoComplete="off"
                    aria-label="Search cheque bills"
                  />
                ) : null}
              <ul ref={chequeListRef} className="counter-cheque-list" role="listbox">
                {filteredChequePendingBills.map((bill, index) => {
                  const billName = getSaleCustomerName(bill, data.sales)
                  const billReminderAt = getEffectiveSaleReminderAt(data, bill)
                  const billReminderNote = getEffectiveSaleReminderNote(data, bill)
                  return (
                  <li key={bill.id}>
                    <button
                      type="button"
                      ref={index === highlightedChequeIndex ? activeChequeItemRef : null}
                      className={`counter-cheque-item ${index === highlightedChequeIndex || loadedPendingId === bill.id ? 'counter-cheque-item--active' : ''}`}
                      onMouseEnter={() => setHighlightedChequeIndex(index)}
                      onClick={() => selectPendingBill(bill)}
                    >
                      <span className="counter-cheque-item-amount">
                        {formatMoney(bill.billAmount)}
                      </span>
                      {billName ? (
                        <span className="counter-cheque-item-name">{billName}</span>
                      ) : null}
                      {billReminderAt ? (
                        <span
                          className={`counter-cheque-item-reminder ${
                            isReminderDue(billReminderAt) ? '' : 'counter-cheque-item-reminder--upcoming'
                          }`}
                        >
                          🔔 {formatDate(billReminderAt)}
                        </span>
                      ) : null}
                      {billReminderNote ? (
                        <span className="counter-cheque-item-reminder-note">📝 {billReminderNote}</span>
                      ) : null}
                      <span className="counter-cheque-item-date">
                        {formatDate(bill.updatedAt ?? bill.createdAt)}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
              {filteredChequePendingBills.length === 0 ? (
                <p className="counter-pending-search-empty">No bills match your search.</p>
              ) : null}
              </>
            )}
          </div>

          <div className="counter-credit-bar" ref={creditBarRef}>
            <button
              type="button"
              className="counter-credit-open"
              onClick={openCreditTab}
              disabled={creditPendingBills.length === 0}
            >
              <span>💳 Credit Bills ({creditPendingBills.length})</span>
              <span className="counter-credit-open-meta">
                <span className="counter-credit-open-total">{formatMoney(creditPendingTotal)}</span>
                <span className="counter-credit-open-hint">Alt+T</span>
                <span className="counter-credit-open-caret">{creditListOpen ? '▲' : '▼'}</span>
              </span>
            </button>
            {creditListOpen && creditPendingBills.length > 0 && (
              <>
                {creditPendingBills.length > 4 ? (
                  <input
                    type="search"
                    className="counter-pending-search"
                    value={creditListSearch}
                    onChange={(e) => setCreditListSearch(e.target.value)}
                    placeholder="Search credit bills…"
                    autoComplete="off"
                    aria-label="Search credit bills"
                  />
                ) : null}
              <ul ref={creditListRef} className="counter-credit-list" role="listbox">
                {filteredCreditPendingBills.map((bill, index) => {
                  const billName = getSaleCustomerName(bill, data.sales)
                  const billReminderAt = getEffectiveSaleReminderAt(data, bill)
                  const billReminderNote = getEffectiveSaleReminderNote(data, bill)
                  return (
                  <li key={bill.id}>
                    <button
                      type="button"
                      ref={index === highlightedCreditIndex ? activeCreditItemRef : null}
                      className={`counter-credit-item ${index === highlightedCreditIndex || loadedPendingId === bill.id ? 'counter-credit-item--active' : ''}`}
                      onMouseEnter={() => setHighlightedCreditIndex(index)}
                      onClick={() => selectPendingBill(bill)}
                    >
                      <span className="counter-credit-item-amount">
                        {formatMoney(bill.billAmount)}
                      </span>
                      {billName ? (
                        <span className="counter-credit-item-name">{billName}</span>
                      ) : null}
                      {billReminderAt ? (
                        <span
                          className={`counter-credit-item-reminder ${
                            isReminderDue(billReminderAt) ? '' : 'counter-credit-item-reminder--upcoming'
                          }`}
                        >
                          🔔 {formatDate(billReminderAt)}
                        </span>
                      ) : null}
                      {billReminderNote ? (
                        <span className="counter-credit-item-reminder-note">📝 {billReminderNote}</span>
                      ) : null}
                      <span className="counter-credit-item-date">
                        {formatDate(bill.updatedAt ?? bill.createdAt)}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
              {filteredCreditPendingBills.length === 0 ? (
                <p className="counter-pending-search-empty">No bills match your search.</p>
              ) : null}
              </>
            )}
          </div>

          <div className={`counter-actions ${actionsLayoutClass}`}>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Clear
            </button>
            {(!collectingBalanceBillId ||
              (collectingChequeId && payType === 'split' && !chequeCollectCreditMode)) &&
            (splitHasBoth && !collectingChequeId ? (
              <button
                type="button"
                className={`btn btn-pending btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
                onClick={handleSplitCreditChequePending}
                disabled={!canSendSplitBothPending}
              >
                <span className="btn-text">
                  {savedAction === 'pending' ? '✓ Saved' : 'Credit·Cheque\nPending'}
                </span>
              </button>
            ) : (
              <>
                {splitHasCredit ? (
                  <button
                    type="button"
                    className={`btn btn-credit btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
                    onClick={handleSplitCreditPending}
                    disabled={!canSendSplitCreditPending}
                  >
                    <span className="btn-text">
                      {savedAction === 'pending' ? '✓ Saved' : 'Credit\nPending'}
                    </span>
                  </button>
                ) : null}
                {splitHasCheque && !collectingChequeId ? (
                  <button
                    type="button"
                    className={`btn btn-cheque btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
                    onClick={handleSplitChequePending}
                    disabled={!canSendSplitChequePending}
                  >
                    <span className="btn-text">
                      {savedAction === 'pending' ? '✓ Saved' : 'Cheque\nPending'}
                    </span>
                  </button>
                ) : null}
              </>
            ))}
            {splitHasChequePending && (!collectingCreditId || payType === 'split') ? (
              <button
                type="button"
                className={`btn btn-cheque btn-with-shortcut ${savedAction === 'collect' ? 'btn-saved' : ''}`}
                onClick={handleSplitChequeApprove}
                disabled={!canSplitChequeApprove || isSaving}
              >
                <span className="btn-text">
                  {savedAction === 'collect' ? '✓ Saved' : 'Approve\n& Bank'}
                </span>
              </button>
            ) : null}
            {canApproveSiblingCheque ? (
              <button
                type="button"
                className={`btn btn-cheque btn-with-shortcut ${savedAction === 'collect' ? 'btn-saved' : ''}`}
                onClick={handleApproveSiblingCheque}
                disabled={isSaving}
              >
                <span className="btn-text">
                  {savedAction === 'collect' ? '✓ Approved' : 'Approve\nCheque'}
                </span>
              </button>
            ) : null}
            {collectingCreditId ? (
              <button
                type="button"
                className={`btn btn-credit btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
                onClick={handleSavePending}
                disabled={!canSavePending}
              >
                <span className="btn-text">
                  {savedAction === 'pending' ? '✓ Saved' : 'Update\nCredit'}
                </span>
                {savedAction !== 'pending' ? (
                  <span className="btn-shortcut">Alt+B</span>
                ) : null}
              </button>
            ) : collectingChequeId ? (
              <button
                type="button"
                className={`btn ${chequeCollectCreditMode ? 'btn-credit' : 'btn-cheque'} btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
                onClick={handleSavePending}
                disabled={!canSavePending}
              >
                <span className="btn-text">
                  {savedAction === 'pending'
                    ? '✓ Saved'
                    : chequeCollectCreditMode
                      ? 'Update\nCredit'
                      : 'Update\nCheque'}
                </span>
                {savedAction !== 'pending' ? (
                  <span className="btn-shortcut">Alt+B</span>
                ) : null}
              </button>
            ) : !splitHasExtras ? (
              <button
                type="button"
                className={`btn ${payType === 'cheque' ? 'btn-cheque' : payType === 'credit' ? 'btn-credit' : 'btn-pending'} btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
                onClick={handleSavePending}
                disabled={!canSavePending}
              >
                <span className="btn-text">
                  {savedAction === 'pending'
                    ? '✓ Saved'
                    : payType === 'cheque'
                      ? loadedPendingId
                        ? 'Update\nCheque'
                        : 'Cheque\nPending'
                      : payType === 'credit'
                        ? loadedPendingId
                          ? 'Update\nCredit'
                          : 'Credit\nPending'
                        : 'Bill\nPending'}
                </span>
                {savedAction !== 'pending' ? (
                  <span className="btn-shortcut">Alt+B</span>
                ) : null}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-pending btn-with-shortcut"
                onClick={handleSavePending}
                disabled={!canSavePending}
              >
                <span className="btn-text">
                  {savedAction === 'pending' ? '✓ Saved' : 'Bill\nPending'}
                </span>
                {savedAction !== 'pending' ? (
                  <span className="btn-shortcut">Alt+B</span>
                ) : null}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-primary btn-with-shortcut ${savedAction === 'collect' ? 'btn-saved' : ''}`}
              onClick={handleSave}
              disabled={!isValid || isSaving}
            >
              <span className="btn-text">{saveLabel}</span>
              {savedAction !== 'collect' ? (
                <span className="btn-shortcut">Alt+S</span>
              ) : null}
            </button>
          </div>
          </div>
        </div>

        <PendingBillsPanel
          bills={billPendingBills}
          allSales={data.sales}
          data={data}
          onSelect={selectPendingBill}
          onSetReminder={setBillReminder}
          onSaveAlertSettings={updateReminderAlertSettings}
          focused={pendingSectionFocus}
          highlightedBillId={
            highlightedPendingIndex != null
              ? billPendingBills[highlightedPendingIndex]?.id
              : null
          }
          panelRef={pendingPanelRef}
          shortcutHint="Alt+W"
        />
      </div>

      <SaleReturnModal
        open={showReturnModal}
        onClose={() => setShowReturnModal(false)}
        customerName={
          getCustomerName() ||
          (loadedPendingBill
            ? getSaleCustomerName(loadedPendingBill, data.sales)
            : undefined)
        }
        originalBill={Math.max(returnGrossDisplay, typedBillAmount, 0)}
        paidSoFar={
          loadedPendingBill || collectingCreditBill
            ? saleBillGroupPaidTotal(
                (collectingCreditBill ?? loadedPendingBill)!,
                data.sales,
              )
            : 0
        }
        paymentLines={
          loadedPendingBill || collectingCreditBill
            ? saleBillPaymentLines(
                (collectingCreditBill ?? loadedPendingBill)!,
                data.sales,
              )
            : []
        }
        existingReturns={draftReturns}
        maxReturnable={Math.max(
          0,
          loadedPendingBill || collectingCreditBill
            ? saleCreditBalanceDue(
                (collectingCreditBill ?? loadedPendingBill)!,
                data.sales,
              )
            : Math.max(0, typedBillAmount - draftReturnTotal),
        )}
        onDone={handleReturnDone}
      />
    </div>
  )
}

export default memo(Counter)
