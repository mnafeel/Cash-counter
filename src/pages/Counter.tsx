import { useEffect, useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips, { type PayType } from '../components/PayTypeChips'
import PendingBillsPanel from '../components/PendingBillsPanel'
import RoundTypeChips from '../components/RoundTypeChips'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import type { Sale } from '../types'
import { formatDate, formatMoney, parseAmount } from '../utils/format'
import { getSaleCustomerName } from '../utils/saleCustomerName'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { getBillRoundOptions } from '../utils/roundSuggestions'
import './Counter.css'

type ActiveField = 'bill' | 'give' | 'paid' | 'cashSplit' | 'bankSplit' | 'chequeSplit' | 'creditSplit'

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

export default function Counter() {
  const { recordSale, updatePendingSale, collectPendingSale, pendingBills, data } = useCash()
  const [billStr, setBillStr] = useState('')
  const [giveStr, setGiveStr] = useState('')
  const [paidStr, setPaidStr] = useState('')
  const [cashSplitStr, setCashSplitStr] = useState('')
  const [bankSplitStr, setBankSplitStr] = useState('')
  const [chequeSplitStr, setChequeSplitStr] = useState('')
  const [creditSplitStr, setCreditSplitStr] = useState('')
  const [roundOffAmount, setRoundOffAmount] = useState<number | null>(null)
  const [paymentStep, setPaymentStep] = useState(false)
  const [payType, setPayType] = useState<PayType>('cash')
  const [customerName, setCustomerName] = useState('')
  const [activeField, setActiveField] = useState<ActiveField>('bill')
  const [savedAction, setSavedAction] = useState<SavedAction>(null)
  const [loadedPendingId, setLoadedPendingId] = useState<string | null>(null)
  const [nameSectionFocus, setNameSectionFocus] = useState(false)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1)
  const [chequeListOpen, setChequeListOpen] = useState(false)
  const [highlightedChequeIndex, setHighlightedChequeIndex] = useState(-1)
  const [creditListOpen, setCreditListOpen] = useState(false)
  const [highlightedCreditIndex, setHighlightedCreditIndex] = useState(-1)
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
  const customerNameInputRef = useRef<HTMLInputElement>(null)
  const pendingPanelRef = useRef<HTMLElement>(null)
  const activeNameSuggestionRef = useRef<HTMLButtonElement>(null)
  const nameSuggestionsListRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (highlightedNameIndex < 0) return
    const item = activeNameSuggestionRef.current
    const list = nameSuggestionsListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [highlightedNameIndex])

  const customerNameSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (let i = data.sales.length - 1; i >= 0; i--) {
      const raw = data.sales[i]?.customerName?.trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (!seen.has(key)) seen.set(key, raw)
    }
    return Array.from(seen.values())
  }, [data.sales])

  const filteredNameSuggestions = useMemo(() => {
    const query = customerName.trim().toLowerCase()
    if (!query) return customerNameSuggestions.slice(0, 8)
    return customerNameSuggestions
      .filter((name) => {
        const lower = name.toLowerCase()
        return lower.includes(query) && lower !== query
      })
      .slice(0, 8)
  }, [customerName, customerNameSuggestions])

  const chequePendingBills = useMemo(
    () => pendingBills.filter(isChequePendingBill),
    [pendingBills],
  )

  const creditPendingBills = useMemo(
    () => pendingBills.filter(isCreditPendingBill),
    [pendingBills],
  )

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
      pendingBills.filter(
        (bill) => !isChequePendingBill(bill) && !isCreditPendingBill(bill),
      ),
    [pendingBills],
  )

  const balanceOnlyMode = balanceDueAmount != null && balanceDueAmount > 0

  const loadedPendingBill = useMemo(
    () => resolveLoadedPendingBill(data.sales, loadedPendingId),
    [data.sales, loadedPendingId],
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

  const billAmount = parseAmount(billStr)
  const giveAmount = parseAmount(giveStr)
  const paidAmount = parseAmount(paidStr)
  const cashSplitAmount = parseAmount(cashSplitStr)
  const bankSplitAmount = parseAmount(bankSplitStr)
  const chequeSplitAmount = parseAmount(chequeSplitStr)
  const creditSplitAmount = parseAmount(creditSplitStr)
  const chequeInSplitTotal =
    splitChequeApprovedAmount > 0 ? splitChequeApprovedAmount : chequeSplitAmount
  const dueAmount = roundOffAmount ?? billAmount

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

  const showSplitCashGive =
    showFullSplitGrid && cashSplitAmount > 0 && Boolean(collectingCreditId)

  const hideChequeSplitGive = showFullSplitGrid && chequeCollectLayout

  const creditCollectDueAmount =
    creditCollectDue > 0 ? creditCollectDue : balanceDueAmount ?? 0

  const chequeCollectDueAmount =
    chequeCollectDue > 0 ? chequeCollectDue : balanceDueAmount ?? 0

  const splitTotal =
    payType === 'split'
      ? collectingCreditId
        ? creditCollectDueAmount
        : collectingChequeId
          ? chequeCollectDueAmount
          : paidAmount > 0
            ? paidAmount
            : dueAmount
      : 0

  const creditCollectDisplayAmount = useMemo(() => {
    if (!collectingCreditId) return 0
    return Math.max(
      0,
      creditCollectDueAmount - cashSplitAmount - bankSplitAmount - chequeSplitAmount,
    )
  }, [
    collectingCreditId,
    creditCollectDueAmount,
    cashSplitAmount,
    bankSplitAmount,
    chequeSplitAmount,
  ])

  const chequeCollectDisplayAmount = useMemo(() => {
    if (!collectingChequeId || chequeCollectCreditMode) return 0
    return Math.max(
      0,
      chequeCollectDueAmount -
        cashSplitAmount -
        bankSplitAmount -
        chequeSplitAmount -
        creditSplitAmount,
    )
  }, [
    collectingChequeId,
    chequeCollectCreditMode,
    chequeCollectDueAmount,
    cashSplitAmount,
    bankSplitAmount,
    chequeSplitAmount,
    creditSplitAmount,
  ])

  const chequeCollectCreditRemainder = useMemo(() => {
    if (!collectingChequeId || !chequeCollectCreditMode) return 0
    return Math.max(
      0,
      chequeCollectDueAmount - cashSplitAmount - bankSplitAmount - chequeSplitAmount,
    )
  }, [
    collectingChequeId,
    chequeCollectCreditMode,
    chequeCollectDueAmount,
    cashSplitAmount,
    bankSplitAmount,
    chequeSplitAmount,
  ])

  const loadedChequeChildOfSplit = useMemo(() => {
    if (!loadedPendingBill || !isChequePendingBill(loadedPendingBill)) return false
    if (!loadedPendingBill.parentSplitId) return false
    const parent = data.sales.find((sale) => sale.id === loadedPendingBill.parentSplitId)
    return Boolean(parent)
  }, [loadedPendingBill, data.sales])

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
      getSplitParentSale(data.sales, {
        collectingCreditId,
        collectingChequeId,
        loadedPendingId,
      }),
    [data.sales, collectingCreditId, collectingChequeId, loadedPendingId],
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
      cash: bankCovers || chequeCovers || (splitCreditPaidCash > 0 && cashSplitAmount <= 0),
      bank: cashCovers || chequeCovers || (splitCreditPaidBank > 0 && bankSplitAmount <= 0),
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

  const splitPaidTotal =
    collectingCreditId ||
    (collectingChequeId && chequeCollectCreditMode) ||
    (balanceOnlyMode && splitChequeApprovedAmount > 0) ||
    isLoadedChequeSplitCollect
      ? splitPaidActive
      : chequeSplitCountsCredit
        ? splitPaidActive + creditSplitAmount
        : splitPaidActive +
          (splitChequeApprovedAmount > 0 ? splitChequeApprovedAmount : chequeSplitAmount) +
          (splitSiblingCreditPending > 0 && !collectingCreditId ? 0 : creditSplitAmount)

  const splitPaidTotalDisplay = (() => {
    if (showFullSplitGrid) {
      if (chequeSplitCountsCredit) {
        const total = splitPaidActive + creditSplitAmount
        return total > 0 ? total : 0
      }
      if (splitPaidActive > 0) return splitPaidActive
      if (collectingCreditId) return creditCollectDueAmount
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
      ? (splitTotal > 0 && splitPaidTotal > 0) || (showSplitCashGive && giveAmount > 0)
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

  const isValid =
    billAmount > 0 &&
    (collectingCreditId
      ? payType === 'split'
        ? creditCollectDisplayAmount === 0 &&
          (cashSplitAmount > 0 || bankSplitAmount > 0 || chequeSplitAmount > 0) &&
          (cashSplitAmount === 0 || giveAmount >= cashSplitAmount)
        : payType === 'cash'
          ? paymentStep && paidAmount > 0 && giveAmount >= paidAmount
          : payType === 'bank' || payType === 'cheque'
            ? paymentStep && paidAmount > 0
            : false
      : collectingChequeId
        ? payType === 'split'
          ? chequeCollectCreditMode
            ? chequeCollectCreditRemainder === 0 &&
              (cashSplitAmount > 0 || bankSplitAmount > 0 || chequeSplitAmount > 0)
            : chequeCollectDisplayAmount === 0 &&
              (cashSplitAmount > 0 ||
                bankSplitAmount > 0 ||
                chequeSplitAmount > 0 ||
                creditSplitAmount > 0)
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
                  creditSplitAmount > 0)
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

  const cashShowsCreditPaid = splitCreditPaidCash > 0 && cashSplitAmount <= 0
  const bankShowsCreditPaid = splitCreditPaidBank > 0 && bankSplitAmount <= 0
  const chequeShowsCreditPaid =
    splitCreditPaidCheque > 0 &&
    chequeSplitAmount <= 0 &&
    splitChequeApprovedAmount <= 0 &&
    splitSiblingChequePending <= 0

  const billRoundOptions = useMemo(() => getBillRoundOptions(billAmount), [billAmount])
  const showRoundChips =
    !balanceOnlyMode && billAmount > 0 && billRoundOptions.length > 0

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
      setCashSplitStr(nextCashStr)
      if (nextCashStr === '') {
        pinSiblingCreditPending()
        return
      }
      const cash = parseAmount(nextCashStr)
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
      setCashSplitStr(nextCashStr)
      if (nextCashStr === '') {
        const bank = parseAmount(bankSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - bank - cheque)))
        return
      }
      const cash = parseAmount(nextCashStr)
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
      setCashSplitStr(nextCashStr)
      if (nextCashStr === '') {
        const bank = parseAmount(bankSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - bank - cheque)))
        return
      }
      const cash = parseAmount(nextCashStr)
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

    setCashSplitStr(nextCashStr)
    const fixed = chequeInSplitTotal + creditSplitAmount
    const room = Math.max(0, total - fixed)
    if (room <= 0) {
      setBankSplitStr('')
      return
    }
    if (nextCashStr === '') {
      setBankSplitStr('')
      return
    }
    const cash = parseAmount(nextCashStr)
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
      setBankSplitStr(nextBankStr)
      if (nextBankStr === '') {
        pinSiblingCreditPending()
        return
      }
      const bank = parseAmount(nextBankStr)
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
      setBankSplitStr(nextBankStr)
      if (nextBankStr === '') {
        const cash = parseAmount(cashSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - cheque)))
        return
      }
      const bank = parseAmount(nextBankStr)
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
      setBankSplitStr(nextBankStr)
      if (nextBankStr === '') {
        const cash = parseAmount(cashSplitStr)
        const cheque = chequeSplitAmount
        setCreditSplitStr(formatSplitPart(Math.max(0, total - cash - cheque)))
        return
      }
      const bank = parseAmount(nextBankStr)
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

    setBankSplitStr(nextBankStr)
    const fixed = chequeInSplitTotal + creditSplitAmount
    const room = Math.max(0, total - fixed)
    if (room <= 0) {
      setCashSplitStr('')
      return
    }
    if (nextBankStr === '') {
      setCashSplitStr('')
      return
    }
    const bank = parseAmount(nextBankStr)
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

    setChequeSplitStr(nextChequeStr)
    const cheque = parseAmount(nextChequeStr)
    const base = Math.max(0, total - cheque)
    const bank = Math.max(0, base - cashSplitAmount - creditSplitAmount)
    setBankSplitStr(formatSplitPart(bank))
  }

  function applySplitCredit(nextCreditStr: string, totalOverride?: number) {
    if (isLoadedChequeSplitCollect) return

    const total = totalOverride ?? splitTotal

    if (collectingCreditId) {
      setCreditSplitStr(nextCreditStr)
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
      return
    }

    setCreditSplitStr(nextCreditStr)
    const credit = parseAmount(nextCreditStr)
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
    }
  }

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  useNumpadKeyboard(
    (action) => numpadHandlerRef.current(action),
    !isSaving && !pendingSectionFocus,
  )

  function resetForm() {
    setBillStr('')
    setGiveStr('')
    setPaidStr('')
    setCashSplitStr('')
    setBankSplitStr('')
    setChequeSplitStr('')
    setCreditSplitStr('')
    setRoundOffAmount(null)
    setPaymentStep(false)
    setPayType('cash')
    setCustomerName('')
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
    setChequeListOpen(false)
    setCreditListOpen(false)
  }

  function buildPendingPayload() {
    const name = customerName.trim() || undefined
    const due = payType === 'split' ? splitTotal : dueAmount
    const base = {
      billAmount: due,
      originalBillAmount: billAmount,
      customerName: name,
      payType,
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
    const due = bill.billAmount
    const original = bill.originalBillAmount ?? bill.billAmount
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
    setBillStr(String(isBalanceBill ? due : original))
    setGiveStr('')
    setPaidStr('')
    setRoundOffAmount(null)
    setCustomerName(getSaleCustomerName(bill, data.sales) ?? '')
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
        setPayType('cash')
        setActiveField('paid')
      }

      setCollectingCreditId(bill.id)
      setCreditCollectDue(due)
      setBalanceDueAmount(due)
      if (!parent) {
        setOriginalBillHint(original !== due ? original : null)
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

  function clearPendingSection() {
    setPendingSectionFocus(false)
    setHighlightedPendingIndex(null)
  }

  function updateCreditPendingBill(id: string, name?: string) {
    const amount =
      creditSplitAmount > 0 ? creditSplitAmount : creditCollectDueAmount
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

    if (splitSaleId) {
      const parentBill = data.sales.find((sale) => sale.id === splitSaleId)
      if (parentBill?.status === 'pending') {
        if (collected > 0 || bothToPending) {
          collectPendingSale(splitSaleId, {
            billAmount: billAmount,
            originalBillAmount: billAmount,
            paidAmount: cashSplitAmount,
            changeAmount: 0,
            payType: 'split',
            cashAmount: cashSplitAmount || undefined,
            bankAmount: bankSplitAmount || undefined,
            chequeAmount: chequeSplitAmount || splitChequeApprovedAmount || undefined,
            creditAmount: creditSplitAmount || undefined,
            chequeApproved: splitChequeApprovedAmount > 0 || undefined,
            customerName: name,
          })
        } else {
          updatePendingSale(splitSaleId, {
            billAmount: dueAmount,
            originalBillAmount: billAmount,
            customerName: name,
            payType: 'split',
            cashAmount: cashSplitAmount,
            bankAmount: bankSplitAmount,
            chequeAmount: chequeSplitAmount,
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
          originalBillAmount: billAmount,
          paidAmount: cashSplitAmount,
          changeAmount: 0,
          payType: 'split',
          cashAmount: cashSplitAmount || undefined,
          bankAmount: bankSplitAmount || undefined,
          chequeAmount: chequeSplitAmount || splitChequeApprovedAmount || undefined,
          creditAmount: creditSplitAmount || undefined,
          chequeApproved: splitChequeApprovedAmount > 0 || undefined,
          customerName: name,
          status: 'paid',
        })
      }
    }

    if (options.credit && creditSplitAmount > 0) {
      if (updateCreditId) {
        updateCreditPendingBill(updateCreditId, name)
      } else {
        recordSale({
          billAmount: creditSplitAmount,
          originalBillAmount: billAmount,
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
          originalBillAmount: billAmount,
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
    const chequeToBank = options.chequeToBank ?? false
    const bankAmount = chequeToBank
      ? bankSplitAmount + chequeSplitAmount
      : bankSplitAmount
    const splitSaleId = loadedPendingId ?? crypto.randomUUID()

    const salePayload = {
      billAmount: splitTotal,
      originalBillAmount: billAmount,
      paidAmount: cashSplitAmount,
      changeAmount: 0,
      payType: 'split' as const,
      cashAmount: cashSplitAmount,
      bankAmount,
      chequeAmount: chequeSplitAmount || splitChequeApprovedAmount,
      creditAmount: creditSplitAmount,
      chequeApproved: chequeToBank || splitChequeApprovedAmount > 0,
      customerName: name,
    }

    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined
    const loadedPendingOpen =
      Boolean(loadedPendingId && loadedBill?.status === 'pending')

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
    const name = customerName.trim() || undefined

    if (collectingCreditId) {
      updateCreditPendingBill(collectingCreditId, name)
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    if (collectingChequeId && !chequeCollectCreditMode) {
      const collected = cashSplitAmount + bankSplitAmount + chequeSplitAmount
      const chequeBill = data.sales.find((sale) => sale.id === collectingChequeId)
      if (collected > 0) {
        collectPendingSale(collectingChequeId, {
          billAmount: chequeCollectDueAmount,
          originalBillAmount: originalBillHint ?? billAmount,
          paidAmount: collected,
          changeAmount: 0,
          payType:
            cashSplitAmount > 0 && (bankSplitAmount > 0 || chequeSplitAmount > 0)
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
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    if (isSplitComplete) {
      saveSplitCollected(name, { createCreditPending: true })
    } else {
      recordSplitPendingBills(name, { credit: true, cheque: false })
    }
    setSavedAction('pending')
    setTimeout(resetForm, 900)
  }

  function handleSplitChequePending() {
    if (!canSendSplitChequePending) return
    const name = customerName.trim() || undefined
    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined
    const isLoadedChequePending =
      loadedBill?.payType === 'cheque' && loadedBill?.status === 'pending'

    if (collectingCreditId) {
      const creditBill = data.sales.find((sale) => sale.id === collectingCreditId)
      collectPendingSale(collectingCreditId, {
        billAmount: splitTotal,
        originalBillAmount: billAmount,
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
          originalBillAmount: billAmount,
          paidAmount: 0,
          changeAmount: 0,
          payType: 'cheque',
          pendingPayType: 'cheque',
          customerName: name,
          parentSplitId: creditBill?.parentSplitId,
          status: 'pending',
        })
      }
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    if (isLoadedChequePending && loadedPendingId) {
      updateChequePendingBill(loadedPendingId, name)
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    if (isSplitComplete) {
      saveSplitCollected(name, { createChequePending: true })
    } else {
      recordSplitPendingBills(name, { credit: false, cheque: true })
    }
    setSavedAction('pending')
    setTimeout(resetForm, 900)
  }

  function handleSplitCreditChequePending() {
    if (!canSendSplitBothPending) return
    const name = customerName.trim() || undefined
    if (isSplitComplete || loadedPendingId) {
      saveSplitCollected(name, { createCreditPending: true, createChequePending: true })
    } else {
      recordSplitPendingBills(name, { credit: true, cheque: true })
    }
    setSavedAction('pending')
    setTimeout(resetForm, 900)
  }

  function handleApproveSiblingCheque() {
    if (!canApproveSiblingCheque || !siblingChequePendingId) return
    const name = customerName.trim() || undefined
    const amount = splitSiblingChequePending

    collectPendingSale(siblingChequePendingId, {
      billAmount: amount,
      originalBillAmount: originalBillHint ?? billAmount,
      paidAmount: amount,
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
    setSavedAction('collect')
    setTimeout(() => setSavedAction(null), 900)
  }

  function handleSplitChequeApprove() {
    if (!canSplitChequeApprove) return
    const name = customerName.trim() || undefined
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
      collectPendingSale(loadedPendingId, {
        billAmount: approvedCheque,
        originalBillAmount: originalBillHint ?? billAmount,
        paidAmount: approvedCheque,
        changeAmount: 0,
        payType: 'cheque',
        chequeAmount: approvedCheque,
        chequeApproved: true,
        bankAmount: approvedCheque,
        customerName: name,
      })
      setSavedAction('collect')
      setTimeout(resetForm, 900)
      return
    }

    if (collectingCreditId) {
      collectPendingSale(collectingCreditId, {
        billAmount: splitTotal,
        originalBillAmount: billAmount,
        paidAmount: approvedCheque,
        changeAmount: 0,
        payType: 'cheque',
        chequeAmount: approvedCheque,
        chequeApproved: true,
        bankAmount: approvedCheque,
        customerName: name,
      })
      setSavedAction('collect')
      setTimeout(resetForm, 900)
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
      setSavedAction('collect')
      setTimeout(() => setSavedAction(null), 900)
      return
    }

    setSavedAction('collect')
    setTimeout(resetForm, 900)
  }

  function handleSavePending() {
    if (!canSavePending) return

    const name = customerName.trim() || undefined

    if (collectingCreditId) {
      updateCreditPendingBill(collectingCreditId, name)
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    if (collectingChequeId) {
      if (chequeCollectCreditMode) {
        const amount =
          creditSplitAmount > 0 ? creditSplitAmount : chequeCollectDueAmount
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
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    const loadedBill = loadedPendingId
      ? data.sales.find((sale) => sale.id === loadedPendingId)
      : undefined

    if (loadedBill?.status === 'pending' && loadedBill.payType === 'cheque') {
      updateChequePendingBill(loadedPendingId!, name)
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    if (loadedBill?.status === 'pending' && loadedBill.payType === 'credit' && payType !== 'split') {
      updatePendingSale(loadedPendingId!, {
        billAmount: dueAmount,
        originalBillAmount: originalBillHint ?? billAmount,
        customerName: name,
        payType: 'credit',
        pendingPayType: 'credit',
      })
      setSavedAction('pending')
      setTimeout(resetForm, 900)
      return
    }

    const pendingPayload = buildPendingPayload()

    if (loadedPendingId) {
      updatePendingSale(loadedPendingId, pendingPayload)
      if (
        payType === 'split' &&
        (creditSplitAmount > 0 || chequeSplitAmount > 0)
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

    setSavedAction('pending')
    setTimeout(resetForm, 900)
  }

  function handleSave() {
    if (!isValid) return

    const name = customerName.trim() || undefined

    if (collectingCreditId) {
      if (payType === 'split') {
        const collected = cashSplitAmount + bankSplitAmount + chequeSplitAmount
        collectPendingSale(collectingCreditId, {
          billAmount: creditCollectDueAmount,
          originalBillAmount: originalBillHint ?? billAmount,
          paidAmount: collected,
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
        setSavedAction('collect')
        setTimeout(resetForm, 900)
        return
      }

      const cashAmount = payType === 'cash' ? paidAmount : 0
      const bankAmount = payType === 'bank' ? paidAmount : 0
      const chequeAmount = payType === 'cheque' ? paidAmount : 0

      collectPendingSale(collectingCreditId, {
        billAmount: creditCollectDueAmount,
        originalBillAmount: originalBillHint ?? billAmount,
        paidAmount: payType === 'cash' ? giveAmount : paidAmount,
        changeAmount: payType === 'cash' ? changeAmount : 0,
        payType,
        cashAmount: cashAmount > 0 ? cashAmount : undefined,
        bankAmount: bankAmount > 0 ? bankAmount : undefined,
        chequeAmount: chequeAmount > 0 ? chequeAmount : undefined,
        chequeApproved: payType === 'cheque' ? true : undefined,
        customerName: name,
      })
      setSavedAction('collect')
      setTimeout(resetForm, 900)
      return
    }

    if (collectingChequeId) {
      if (payType === 'split') {
        const collected = cashSplitAmount + bankSplitAmount + chequeSplitAmount
        collectPendingSale(collectingChequeId, {
          billAmount: chequeCollectDueAmount,
          originalBillAmount: originalBillHint ?? billAmount,
          paidAmount: collected,
          changeAmount: 0,
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
        setSavedAction('collect')
        setTimeout(resetForm, 900)
        return
      }

      const cashAmount = payType === 'cash' ? paidAmount : 0
      const bankAmount = payType === 'bank' ? paidAmount : payType === 'cheque' ? paidAmount : 0
      const chequeAmount = payType === 'cheque' ? paidAmount : 0

      collectPendingSale(collectingChequeId, {
        billAmount: chequeCollectDueAmount,
        originalBillAmount: originalBillHint ?? billAmount,
        paidAmount: payType === 'cash' ? giveAmount : paidAmount,
        changeAmount: payType === 'cash' ? changeAmount : 0,
        payType,
        cashAmount: cashAmount > 0 ? cashAmount : undefined,
        bankAmount: bankAmount > 0 ? bankAmount : undefined,
        chequeAmount: chequeAmount > 0 ? chequeAmount : undefined,
        chequeApproved: payType === 'cheque' ? true : undefined,
        customerName: name,
      })
      setSavedAction('collect')
      setTimeout(resetForm, 900)
      return
    }

    if (payType === 'split') {
      saveSplitCollected(name, {
        createCreditPending: splitHasCredit,
        createChequePending: splitHasChequePending,
      })
      setSavedAction('collect')
      setTimeout(resetForm, 900)
      return
    }

    const cashAmount = payType === 'cash' ? paidAmount : 0
    const bankAmount =
      payType === 'bank' || payType === 'cheque' ? paidAmount : 0
    const chequeAmount = payType === 'cheque' ? paidAmount : 0
    const creditAmount = 0

    const salePayload = {
      billAmount: paidAmount,
      originalBillAmount: billAmount,
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

    if (loadedPendingId) {
      collectPendingSale(loadedPendingId, salePayload)
    } else {
      recordSale(salePayload)
    }
    setSavedAction('collect')
    setTimeout(resetForm, 900)
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

  function focusNameSection() {
    setNameSectionFocus(true)
    clearPendingSection()
    customerNameInputRef.current?.focus()
    customerNameInputRef.current?.select()
  }

  function focusPendingSection() {
    setPendingSectionFocus(true)
    setNameSectionFocus(false)
    customerNameInputRef.current?.blur()

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
      document.activeElement === customerNameInputRef.current

    setNameSectionFocus(false)
    clearPendingSection()
    customerNameInputRef.current?.blur()

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
  chequePendingBillsRef.current = chequePendingBills
  creditPendingBillsRef.current = creditPendingBills
  highlightedChequeIndexRef.current = highlightedChequeIndex
  highlightedCreditIndexRef.current = highlightedCreditIndex
  pendingBillsRef.current = billPendingBills
  highlightedPendingIndexRef.current = highlightedPendingIndex
  selectPendingBillRef.current = selectPendingBill

  useEffect(() => {
    if (!pendingSectionFocus) return

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
  }, [pendingSectionFocus])

  useEffect(() => {
    if (!pendingSectionFocus || highlightedPendingIndex == null) return

    const panel = pendingPanelRef.current
    const billId = pendingBills[highlightedPendingIndex]?.id
    if (!panel || !billId) return

    const item = panel.querySelector(`[data-bill-id="${billId}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [pendingSectionFocus, highlightedPendingIndex, pendingBills])

  useEffect(() => {
    if (!chequeListOpen && !creditListOpen) return

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
  }, [chequeListOpen, creditListOpen])

  useEffect(() => {
    if (!chequeListOpen) return

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
  }, [chequeListOpen])

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
    if (!creditListOpen) return

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
  }, [creditListOpen])

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
    if (isSaving) return

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
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSaving, isValid, canSavePending])

  const payTypeChipValue: PayType =
    effectiveCollectingChequeId && chequeCollectCreditMode && payType === 'split'
      ? 'credit'
      : collectingCreditId && payType === 'split'
        ? 'credit'
        : payType

  const creditCollectGridClass = ''

  const chequeCollectGridClass = ''

  return (
    <div className="counter-page">
      <div className="counter-body">
        <div className="counter-main">
          <div className="counter-top">
            <div
              className={`counter-amounts ${
                showFullSplitGrid
                  ? 'counter-amounts--split'
                  : creditCollectGridClass || chequeCollectGridClass
              }`}
            >
            {balanceOnlyMode ? (
              <div className="counter-readonly counter-readonly--balance">
                <span className="counter-readonly-label">Balance</span>
                <span className="counter-readonly-value">
                  {formatMoney(balanceDueAmount ?? billAmount)}
                </span>
                {originalBillHint ? (
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
                label="Customer Paid"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
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
                compact
              />
            ) : chequeCollectChequeMode ? (
              <AmountDisplay
                label="Cheque"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
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

          <div className={`counter-customer ${nameSectionFocus ? 'counter-customer--focused' : ''}`}>
            <label className="counter-customer-label" htmlFor="customer-name">
              Customer Name <span className="counter-shortcut-hint">Alt+N</span>
            </label>
            <input
              ref={customerNameInputRef}
              id="customer-name"
              type="text"
              className="counter-customer-input"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value)
                setNameDropdownOpen(true)
                setHighlightedNameIndex(-1)
              }}
              onFocus={() => {
                setNameSectionFocus(true)
                setNameDropdownOpen(true)
                setHighlightedNameIndex(-1)
                clearPendingSection()
              }}
              onBlur={() => {
                setNameSectionFocus(false)
                setNameDropdownOpen(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setNameDropdownOpen(false)
                  setHighlightedNameIndex(-1)
                  return
                }
                if (!nameDropdownOpen || filteredNameSuggestions.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightedNameIndex((prev) => (prev + 1) % filteredNameSuggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightedNameIndex((prev) =>
                    prev <= 0 ? filteredNameSuggestions.length - 1 : prev - 1,
                  )
                } else if (e.key === 'Enter' && highlightedNameIndex >= 0) {
                  e.preventDefault()
                  setCustomerName(filteredNameSuggestions[highlightedNameIndex])
                  setNameDropdownOpen(false)
                  setHighlightedNameIndex(-1)
                }
              }}
              placeholder="Optional"
              autoComplete="off"
            />
            {nameDropdownOpen && filteredNameSuggestions.length > 0 && (
              <ul ref={nameSuggestionsListRef} className="counter-customer-suggestions" role="listbox">
                {filteredNameSuggestions.map((name, index) => (
                  <li key={name}>
                    <button
                      type="button"
                      ref={index === highlightedNameIndex ? activeNameSuggestionRef : null}
                      className={`counter-customer-suggestion ${index === highlightedNameIndex ? 'counter-customer-suggestion--active' : ''}`}
                      onMouseEnter={() => setHighlightedNameIndex(index)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setCustomerName(name)
                        setNameDropdownOpen(false)
                        setHighlightedNameIndex(-1)
                      }}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

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
              onPress={handleNumpad}
              hint={keyboardHint(activeField)}
            />
          </div>

          <div className="counter-footer">
            <div className="counter-round">
            {showRoundChips ? (
              <RoundTypeChips
                label="Round down"
                options={billRoundOptions}
                onSelect={(amt) => {
                  setRoundOffAmount(amt)
                  if (payType === 'split') {
                    setPaidStr(String(amt))
                    if (cashSplitStr) applySplitCash(cashSplitStr, amt)
                    else if (bankSplitStr) applySplitBank(bankSplitStr, amt)
                    else if (chequeSplitStr) applySplitCheque(chequeSplitStr, amt)
                    else if (creditSplitStr) applySplitCredit(creditSplitStr, amt)
                    else openSplitMode()
                  } else if (paymentStep) setPaidStr(String(amt))
                  else if (needsGive(payType)) setActiveField('give')
                  else openPaymentStep()
                }}
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
              <ul ref={chequeListRef} className="counter-cheque-list" role="listbox">
                {chequePendingBills.map((bill, index) => {
                  const billName = getSaleCustomerName(bill, data.sales)
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
                      <span className="counter-cheque-item-date">
                        {formatDate(bill.updatedAt ?? bill.createdAt)}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
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
              <ul ref={creditListRef} className="counter-credit-list" role="listbox">
                {creditPendingBills.map((bill, index) => {
                  const billName = getSaleCustomerName(bill, data.sales)
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
                      <span className="counter-credit-item-date">
                        {formatDate(bill.updatedAt ?? bill.createdAt)}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
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
          onSelect={selectPendingBill}
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
    </div>
  )
}
