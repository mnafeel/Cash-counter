import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips from '../components/PayTypeChips'
import BillNoChips, { type BillMode } from '../components/BillNoChips'
import PurchaseHistoryPanel from '../components/PurchaseHistoryPanel'
import type { Expense, ExpensePayType } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { expenseBillSuffix, GST_BILL_LABEL, isGstExpense, isPurchaseExpense, NO_GST_BILL_LABEL, parseExpenseBillMode, purchaseBillLabel, stripExpenseBillSuffix } from '../utils/expenseBillLabels'
import { PURCHASE_CASH_LABEL } from '../utils/purchaseHistory'
import {
  getSupplierOpenCreditTotal,
  isPurchaseCreditExpense,
  normalizeCreditPaymentPayType,
  purchaseCreditAmount,
  purchasePaidAmount,
} from '../utils/purchaseHistory'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import { useAppPageBack } from '../hooks/useAppPageBack'
import { usePageEscape } from '../hooks/usePageEscape'
import { toInputDate } from '../utils/salesReport'
import './PurchaseExpense.css'

type BillSlot = 1 | 2

type ExpenseField =
  | 'name'
  | 'description'
  | 'billNo'
  | 'billDate'
  | 'bill'
  | 'amount'
  | 'cashSplit'
  | 'bankSplit'
  | 'creditSplit'
  | 'chequeSplit'
  | 'pay'

type BillFormState = {
  amountStr: string
  payType: ExpensePayType
  cashSplitStr: string
  bankSplitStr: string
  creditSplitStr: string
  chequeSplitStr: string
  chequeApproved: boolean
}

const EMPTY_BILL: BillFormState = {
  amountStr: '',
  payType: 'cash',
  cashSplitStr: '',
  bankSplitStr: '',
  creditSplitStr: '',
  chequeSplitStr: '',
  chequeApproved: false,
}

const BILL_PAY_TYPES: ExpensePayType[] = ['cash', 'bank', 'credit', 'cheque', 'split']
const CREDIT_UPDATE_PAY_TYPES: ExpensePayType[] = ['cash', 'bank', 'cheque', 'split']

function creditUpdatePayOptions(_expense: Expense): ExpensePayType[] {
  return CREDIT_UPDATE_PAY_TYPES
}

function creditPaymentFromBill(bill: BillFormState): number {
  if (bill.payType === 'split') {
    const cash = parseAmount(bill.cashSplitStr)
    const bank = parseAmount(bill.bankSplitStr)
    const cheque = bill.chequeApproved ? parseAmount(bill.chequeSplitStr) : 0
    const fromSplits = cash + bank + cheque
    if (fromSplits > 0) return fromSplits
    return parseAmount(bill.amountStr)
  }
  if (bill.payType === 'cheque' && !bill.chequeApproved) return 0
  return parseAmount(bill.amountStr)
}

function validateCreditPaymentBill(bill: BillFormState, openingBalance: number): boolean {
  if (bill.payType === 'credit') return false
  const paying = creditPaymentFromBill(bill)
  if (paying <= 0 || paying > openingBalance) return false
  if (bill.payType === 'cheque' && !bill.chequeApproved) return false
  if (bill.payType === 'split') {
    const cash = parseAmount(bill.cashSplitStr)
    const bank = parseAmount(bill.bankSplitStr)
    const cheque = bill.chequeApproved ? parseAmount(bill.chequeSplitStr) : 0
    if (cash <= 0 && bank <= 0 && cheque <= 0) return false
    const total = parseAmount(bill.amountStr)
    if (total > 0 && cash + bank + cheque !== total) return false
  }
  return true
}

function formatSplitPart(amount: number): string {
  if (amount <= 0) return ''
  return Number.isInteger(amount) ? String(amount) : String(amount)
}

function purchaseBillPaidNow(bill: BillFormState): number {
  const amount = parseAmount(bill.amountStr)
  if (amount <= 0) return 0
  if (bill.payType === 'split') {
    const cheque = bill.chequeApproved ? parseAmount(bill.chequeSplitStr) : 0
    return parseAmount(bill.cashSplitStr) + parseAmount(bill.bankSplitStr) + cheque
  }
  if (bill.payType === 'cheque' && !bill.chequeApproved) return 0
  if (bill.payType === 'credit') return 0
  return amount
}

function purchaseBillBalanceDue(bill: BillFormState): number {
  const amount = parseAmount(bill.amountStr)
  if (amount <= 0) return 0
  if (bill.payType === 'split') {
    return Math.max(0, parseAmount(bill.creditSplitStr))
  }
  if (bill.payType === 'credit') return amount
  return Math.max(0, amount - purchaseBillPaidNow(bill))
}

function billFieldSteps(bill: BillFormState, creditUpdate = false): ExpenseField[] {
  if (bill.payType === 'split') {
    if (creditUpdate) return ['amount', 'cashSplit', 'bankSplit', 'chequeSplit']
    return ['amount', 'cashSplit', 'bankSplit', 'creditSplit', 'chequeSplit']
  }
  return ['amount']
}

function nextExpenseField(
  current: ExpenseField,
  bill: BillFormState,
  creditUpdate = false,
): ExpenseField {
  const order: ExpenseField[] = creditUpdate
    ? ['name', 'description', ...billFieldSteps(bill, creditUpdate), 'pay']
    : ['name', 'description', 'billNo', 'billDate', ...billFieldSteps(bill, creditUpdate), 'pay']
  const idx = order.indexOf(current)
  if (idx < 0) return order[0]
  return order[(idx + 1) % order.length]
}

function canChequeApproveBill(bill: BillFormState): boolean {
  const amount = parseAmount(bill.amountStr)
  const splitMode = bill.payType === 'split'
  const cashSplitAmount = parseAmount(bill.cashSplitStr)
  const bankSplitAmount = parseAmount(bill.bankSplitStr)
  const creditSplitAmount = parseAmount(bill.creditSplitStr)
  const chequeSplitAmount = parseAmount(bill.chequeSplitStr)
  const splitPaidTotal =
    cashSplitAmount + bankSplitAmount + creditSplitAmount + chequeSplitAmount

  return (
    (bill.payType === 'cheque' && amount > 0 && !bill.chequeApproved) ||
    (splitMode &&
      chequeSplitAmount > 0 &&
      !bill.chequeApproved &&
      splitPaidTotal === amount)
  )
}

function describeBillPay(bill: BillFormState): string {
  const amount = parseAmount(bill.amountStr)
  if (amount <= 0) return '—'
  const splitMode = bill.payType === 'split'
  const cashSplitAmount = parseAmount(bill.cashSplitStr)
  const bankSplitAmount = parseAmount(bill.bankSplitStr)
  const creditSplitAmount = parseAmount(bill.creditSplitStr)
  const chequeSplitAmount = parseAmount(bill.chequeSplitStr)
  if (splitMode) {
    const parts: string[] = []
    if (cashSplitAmount > 0) parts.push(`💵 ${formatMoney(cashSplitAmount)}`)
    if (bankSplitAmount > 0) parts.push(`🏦 ${formatMoney(bankSplitAmount)}`)
    if (creditSplitAmount > 0) parts.push(`💳 ${formatMoney(creditSplitAmount)}`)
    if (chequeSplitAmount > 0) {
      parts.push(`🧾 ${formatMoney(chequeSplitAmount)}${bill.chequeApproved ? ' ✓' : ''}`)
    }
    return parts.length > 0 ? parts.join(' + ') : 'Split'
  }
  if (bill.payType === 'cheque') {
    return `🧾 Cheque ${formatMoney(amount)}${bill.chequeApproved ? ' ✓' : ''}`
  }
  if (bill.payType === 'credit') return `💳 Credit ${formatMoney(amount)}`
  if (bill.payType === 'bank') return `🏦 Bank ${formatMoney(amount)}`
  return `💵 ${PURCHASE_CASH_LABEL} ${formatMoney(amount)}`
}

function validateBill(bill: BillFormState, requireName: boolean, name: string): boolean {
  const amount = parseAmount(bill.amountStr)
  if (amount <= 0) return false
  if (requireName && name.trim().length === 0) return false

  if (bill.payType === 'split') {
    const cash = parseAmount(bill.cashSplitStr)
    const bank = parseAmount(bill.bankSplitStr)
    const credit = parseAmount(bill.creditSplitStr)
    const cheque = parseAmount(bill.chequeSplitStr)
    const paid = cash + bank + credit + cheque
    if (paid !== amount) return false
    if (cash <= 0 && bank <= 0 && credit <= 0 && cheque <= 0) return false
    return true
  }

  if (bill.payType === 'cheque' && !bill.chequeApproved) return false
  return true
}

function buildExpensePayload(
  bill: BillFormState,
  billSlot: BillSlot,
  name: string,
  description: string,
  billNo: string,
  billDate: string,
  tagBill: boolean,
): {
  amount: number
  name: string
  description?: string
  billNo?: string
  billDate?: string
  payType: ExpensePayType
  cashAmount?: number
  bankAmount?: number
  creditAmount?: number
  chequeAmount?: number
  chequeApproved?: boolean
  billNumber?: 1 | 2
  kind: 'expense'
} {
  const amount = parseAmount(bill.amountStr)
  const cashSplit = parseAmount(bill.cashSplitStr)
  const bankSplit = parseAmount(bill.bankSplitStr)
  const creditSplit = parseAmount(bill.creditSplitStr)
  const chequeSplit = parseAmount(bill.chequeSplitStr)

  const displayName =
    tagBill && billSlot === 2
      ? `${name.trim()}${expenseBillSuffix(2)}`
      : tagBill && billSlot === 1
        ? `${name.trim()}${expenseBillSuffix(1)}`
        : name.trim()
  const itemDescription = description.trim() || undefined
  const purchaseBillNo = billNo.trim() || undefined
  const purchaseBillDate = billDate.trim() || undefined

  if (bill.payType === 'split') {
    return {
      amount,
      name: displayName,
      description: itemDescription,
      billNo: purchaseBillNo,
      billDate: purchaseBillDate,
      payType: 'split',
      cashAmount: cashSplit || undefined,
      bankAmount: bankSplit || undefined,
      creditAmount: creditSplit || undefined,
      chequeAmount: chequeSplit || undefined,
      chequeApproved: bill.chequeApproved && chequeSplit > 0 ? true : undefined,
      billNumber: tagBill ? billSlot : undefined,
      kind: 'expense',
    }
  }

  if (bill.payType === 'cheque') {
    return {
      amount,
      name: displayName,
      description: itemDescription,
      billNo: purchaseBillNo,
      billDate: purchaseBillDate,
      payType: 'cheque',
      chequeAmount: amount,
      chequeApproved: bill.chequeApproved,
      billNumber: tagBill ? billSlot : undefined,
      kind: 'expense',
    }
  }

  if (bill.payType === 'bank') {
    return {
      amount,
      name: displayName,
      description: itemDescription,
      billNo: purchaseBillNo,
      billDate: purchaseBillDate,
      payType: 'bank',
      bankAmount: amount,
      billNumber: tagBill ? billSlot : undefined,
      kind: 'expense',
    }
  }

  if (bill.payType === 'credit') {
    return {
      amount,
      name: displayName,
      description: itemDescription,
      billNo: purchaseBillNo,
      billDate: purchaseBillDate,
      payType: 'credit',
      creditAmount: amount,
      billNumber: tagBill ? billSlot : undefined,
      kind: 'expense',
    }
  }

  return {
    amount,
    name: displayName,
    description: itemDescription,
    billNo: purchaseBillNo,
    billDate: purchaseBillDate,
    payType: 'cash',
    billNumber: tagBill ? billSlot : undefined,
    kind: 'expense',
  }
}

function expenseToBillState(expense: Expense): BillFormState {
  return {
    amountStr: String(expense.amount),
    payType: expense.payType,
    cashSplitStr:
      expense.payType === 'split' && (expense.cashAmount ?? 0) > 0
        ? String(expense.cashAmount)
        : '',
    bankSplitStr:
      expense.payType === 'split' && (expense.bankAmount ?? 0) > 0
        ? String(expense.bankAmount)
        : '',
    creditSplitStr:
      expense.payType === 'split' && (expense.creditAmount ?? 0) > 0
        ? String(expense.creditAmount)
        : '',
    chequeSplitStr:
      expense.payType === 'split' && (expense.chequeAmount ?? 0) > 0
        ? String(expense.chequeAmount)
        : '',
    chequeApproved: expense.chequeApproved ?? false,
  }
}

function expenseToCreditPayState(): BillFormState {
  return {
    amountStr: '',
    payType: 'cash',
    cashSplitStr: '',
    bankSplitStr: '',
    creditSplitStr: '',
    chequeSplitStr: '',
    chequeApproved: false,
  }
}

function billStateForLoad(expense: Expense, mode: 'open' | 'update'): BillFormState {
  if (mode === 'update' && isPurchaseCreditExpense(expense)) {
    return expenseToCreditPayState()
  }
  return expenseToBillState(expense)
}

export default function PurchaseExpense() {
  const { recordExpenses, updateExpense, addSupplier, applyPurchaseCreditPayment, data } = useCash()
  const goBack = useAppPageBack()
  const [searchParams, setSearchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDateStr, setBillDateStr] = useState(() => toInputDate())
  const [billMode, setBillMode] = useState<BillMode>('no1')
  const [bill1, setBill1] = useState<BillFormState>({ ...EMPTY_BILL })
  const [bill2, setBill2] = useState<BillFormState>({ ...EMPTY_BILL, payType: 'cash' })
  const [activeField, setActiveField] = useState<ExpenseField>('name')
  const [saved, setSaved] = useState(false)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false)
  const [showPurchaseHistory, setShowPurchaseHistory] = useState(false)
  const [formNote, setFormNote] = useState<string | null>(null)
  const [editingExpenseIds, setEditingExpenseIds] = useState<string[]>([])
  const [loadedExpenseIds, setLoadedExpenseIds] = useState<string[]>([])
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1)
  const [highlightedItemIndex, setHighlightedItemIndex] = useState(-1)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLInputElement>(null)
  const billNoInputRef = useRef<HTMLInputElement>(null)
  const billDateInputRef = useRef<HTMLInputElement>(null)
  const billSectionRef = useRef<HTMLDivElement>(null)
  const paySectionRef = useRef<HTMLDivElement>(null)
  const activeNameSuggestionRef = useRef<HTMLButtonElement>(null)
  const activeItemSuggestionRef = useRef<HTMLButtonElement>(null)
  const nameSuggestionsListRef = useRef<HTMLUListElement>(null)
  const itemSuggestionsListRef = useRef<HTMLUListElement>(null)

  const editingBill: BillSlot = billMode === 'no2' ? 2 : 1
  const bill = editingBill === 1 ? bill1 : bill2
  const splitMode = bill.payType === 'split'
  const bill1Amount = parseAmount(bill1.amountStr)
  const bill2Amount = parseAmount(bill2.amountStr)
  const purchaseTotal = bill1Amount + bill2Amount

  const purchaseSupplierSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (let i = data.expenses.length - 1; i >= 0; i--) {
      const item = data.expenses[i]
      if (!isPurchaseExpense(item)) continue
      const raw = stripExpenseBillSuffix(item?.name ?? '')
      if (!raw) continue
      const key = raw.toLowerCase()
      if (!seen.has(key)) seen.set(key, raw)
    }
    return Array.from(seen.values())
  }, [data.expenses])

  const supplierOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const supplier of data.suppliers ?? []) {
      const trimmed = supplier.name.trim()
      if (!trimmed) continue
      seen.set(trimmed.toLowerCase(), trimmed)
    }
    for (const item of purchaseSupplierSuggestions) {
      const key = item.toLowerCase()
      if (!seen.has(key)) seen.set(key, item)
    }
    return Array.from(seen.values())
  }, [data.suppliers, purchaseSupplierSuggestions])

  const supplierItemOptions = useMemo(() => {
    const supplierKey = name.trim().toLowerCase()
    if (!supplierKey) return []
    const seen = new Map<string, string>()
    const entry = (data.suppliers ?? []).find(
      (supplier) => supplier.name.trim().toLowerCase() === supplierKey,
    )
    for (const item of entry?.items ?? []) {
      const trimmed = item.trim()
      if (trimmed) seen.set(trimmed.toLowerCase(), trimmed)
    }
    for (const expense of data.expenses) {
      if (!isPurchaseExpense(expense)) continue
      const expenseSupplier = stripExpenseBillSuffix(expense.name ?? '').trim().toLowerCase()
      if (expenseSupplier !== supplierKey) continue
      const desc = expense.description?.trim()
      if (desc) seen.set(desc.toLowerCase(), desc)
    }
    return Array.from(seen.values())
  }, [name, data.suppliers, data.expenses])

  const allItemOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const supplier of data.suppliers ?? []) {
      for (const item of supplier.items ?? []) {
        const trimmed = item.trim()
        if (trimmed) seen.set(trimmed.toLowerCase(), trimmed)
      }
    }
    for (const expense of data.expenses) {
      if (!isPurchaseExpense(expense)) continue
      const desc = expense.description?.trim()
      if (desc) seen.set(desc.toLowerCase(), desc)
    }
    return Array.from(seen.values())
  }, [data.suppliers, data.expenses])

  const visibleItemOptions = name.trim() ? supplierItemOptions : allItemOptions

  const filteredItemSuggestions = useMemo(() => {
    const query = description.trim().toLowerCase()
    if (!query) return visibleItemOptions.slice(0, 10)
    return visibleItemOptions
      .filter((item) => {
        const lower = item.toLowerCase()
        return lower.includes(query) && lower !== query
      })
      .slice(0, 10)
  }, [description, visibleItemOptions])

  const filteredNameSuggestions = useMemo(() => {
    const query = name.trim().toLowerCase()
    if (!query) return supplierOptions.slice(0, 10)
    return supplierOptions
      .filter((item) => {
        const lower = item.toLowerCase()
        return lower.includes(query) && lower !== query
      })
      .slice(0, 10)
  }, [name, supplierOptions])

  const supplierPendingByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of supplierOptions) {
      const pending = getSupplierOpenCreditTotal(data, item)
      if (pending > 0) map.set(item.toLowerCase(), pending)
    }
    return map
  }, [supplierOptions, data])

  const supplierOpenCreditTotal = useMemo(() => {
    const key = name.trim().toLowerCase()
    if (!key) return 0
    return supplierPendingByName.get(key) ?? 0
  }, [name, supplierPendingByName])

  const amount = parseAmount(bill.amountStr)
  const cashSplitAmount = parseAmount(bill.cashSplitStr)
  const bankSplitAmount = parseAmount(bill.bankSplitStr)
  const creditSplitAmount = parseAmount(bill.creditSplitStr)
  const chequeSplitAmount = parseAmount(bill.chequeSplitStr)

  const isEditing = editingExpenseIds.length > 0

  const isCreditUpdateMode = useMemo(() => {
    if (!isEditing) return false
    return editingExpenseIds.some((id) => {
      const expense = data.expenses.find((entry) => entry.id === id)
      return expense && isPurchaseCreditExpense(expense)
    })
  }, [isEditing, editingExpenseIds, data.expenses])

  const activeCreditExpense = useMemo(() => {
    if (!isCreditUpdateMode || editingExpenseIds.length === 0) return null
    const idx = editingBill === 1 ? 0 : editingExpenseIds.length > 1 ? 1 : 0
    const id = editingExpenseIds[idx]
    const expense = data.expenses.find((entry) => entry.id === id)
    return expense && isPurchaseCreditExpense(expense) ? expense : null
  }, [isCreditUpdateMode, editingExpenseIds, editingBill, data.expenses])

  const creditUpdateActiveSlot = Boolean(activeCreditExpense)
  const creditOpeningBalance = activeCreditExpense ? purchaseCreditAmount(activeCreditExpense) : 0
  const creditAlreadyPaid = activeCreditExpense ? purchasePaidAmount(activeCreditExpense) : 0
  const creditBillTotal = activeCreditExpense?.amount ?? 0
  const creditPayingNow = creditUpdateActiveSlot ? creditPaymentFromBill(bill) : 0
  const creditTotalPaid = creditAlreadyPaid + creditPayingNow
  const creditRemaining = Math.max(0, creditOpeningBalance - creditPayingNow)

  const splitPaidTotal =
    creditUpdateActiveSlot && splitMode
      ? cashSplitAmount + bankSplitAmount + chequeSplitAmount
      : cashSplitAmount + bankSplitAmount + creditSplitAmount + chequeSplitAmount
  const splitShortfall = splitMode && amount > 0 ? Math.max(0, amount - splitPaidTotal) : 0
  const splitExcess = splitMode && amount > 0 ? Math.max(0, splitPaidTotal - amount) : 0
  const editBillPaidNow = isEditing && !isCreditUpdateMode ? purchaseBillPaidNow(bill) : 0
  const editBillBalanceDue = isEditing && !isCreditUpdateMode ? purchaseBillBalanceDue(bill) : 0

  const bill1Valid = creditUpdateActiveSlot && editingBill === 1
    ? validateCreditPaymentBill(bill1, creditOpeningBalance)
    : validateBill(bill1, false, name)
  const bill2Valid = creditUpdateActiveSlot && editingBill === 2
    ? validateCreditPaymentBill(bill2, creditOpeningBalance)
    : validateBill(bill2, false, name)
  const hasBill1 = creditUpdateActiveSlot && editingBill === 1
    ? creditPayingNow > 0
    : bill1Amount > 0
  const hasBill2 = creditUpdateActiveSlot && editingBill === 2
    ? creditPayingNow > 0
    : bill2Amount > 0

  const isValid = (() => {
    if (isCreditUpdateMode) {
      if (name.trim().length === 0) return false
      return creditUpdateActiveSlot && validateCreditPaymentBill(bill, creditOpeningBalance)
    }
    if (name.trim().length === 0) return false
    if (!hasBill1 && !hasBill2) return false
    return (!hasBill1 || bill1Valid) && (!hasBill2 || bill2Valid)
  })()

  const canChequeApprove = !saved && (
    creditUpdateActiveSlot
      ? (bill.payType === 'cheque' && creditPayingNow > 0 && !bill.chequeApproved) ||
        (splitMode && chequeSplitAmount > 0 && !bill.chequeApproved)
      : canChequeApproveBill(bill)
  )

  const payDetailText = creditUpdateActiveSlot
    ? creditPayingNow > 0
      ? `Paid ${formatMoney(creditTotalPaid)} · Credit ${formatMoney(creditRemaining)}`
      : creditAlreadyPaid > 0
        ? `Paid ${formatMoney(creditAlreadyPaid)} · Credit ${formatMoney(creditOpeningBalance)}`
        : ''
    : amount > 0
      ? describeBillPay(bill)
      : ''
  const canSave = isValid && !saved && (isCreditUpdateMode || isEditing || !formNote)

  const creditUpdateInfo = useMemo(() => {
    if (!isCreditUpdateMode) return null
    if (!activeCreditExpense) {
      const anyCredit = editingExpenseIds
        .map((id) => data.expenses.find((entry) => entry.id === id))
        .find((entry) => entry && isPurchaseCreditExpense(entry))
      if (!anyCredit) return null
      return {
        balance: 0,
        openingBalance: 0,
        alreadyPaid: 0,
        totalPaid: 0,
        payingNow: 0,
        remaining: 0,
        billTotal: 0,
        payLabel: 'Credit',
        billLabel: 'Switch bill',
        payOptions: CREDIT_UPDATE_PAY_TYPES,
        activeSlot: false,
      }
    }
    return {
      balance: creditOpeningBalance,
      openingBalance: creditOpeningBalance,
      alreadyPaid: creditAlreadyPaid,
      totalPaid: creditTotalPaid,
      payingNow: creditPayingNow,
      remaining: creditRemaining,
      billTotal: creditBillTotal,
      payLabel: activeCreditExpense.payType === 'split' ? 'Split' : 'Credit',
      billLabel:
        activeCreditExpense.billNumber === 2 ? purchaseBillLabel(2) : purchaseBillLabel(1),
      payOptions: creditUpdatePayOptions(activeCreditExpense),
      activeSlot: true,
    }
  }, [
    isCreditUpdateMode,
    editingExpenseIds,
    data.expenses,
    activeCreditExpense,
    creditOpeningBalance,
    creditAlreadyPaid,
    creditTotalPaid,
    creditPayingNow,
    creditRemaining,
    creditBillTotal,
  ])

  const visiblePayTypes = creditUpdateInfo?.payOptions ?? BILL_PAY_TYPES

  function billState(slot: BillSlot): BillFormState {
    return slot === 1 ? bill1 : bill2
  }

  function patchBillFor(slot: BillSlot, patch: Partial<BillFormState>) {
    if (slot === 1) setBill1((prev) => ({ ...prev, ...patch }))
    else setBill2((prev) => ({ ...prev, ...patch }))
  }

  function patchBill(patch: Partial<BillFormState>) {
    patchBillFor(editingBill, patch)
  }

  function slotHasOpenCredit(slot: BillSlot): boolean {
    if (!isCreditUpdateMode || editingExpenseIds.length === 0) return false
    const idx = slot === 1 ? 0 : editingExpenseIds.length > 1 ? 1 : 0
    const id = editingExpenseIds[idx]
    const expense = data.expenses.find((entry) => entry.id === id)
    return Boolean(expense && isPurchaseCreditExpense(expense))
  }

  function applySplitCashFor(slot: BillSlot, nextCashStr: string) {
    const b = billState(slot)
    const total = parseAmount(b.amountStr)
    const creditUpdateSlot = slotHasOpenCredit(slot)
    patchBillFor(slot, { cashSplitStr: nextCashStr, chequeApproved: false })
    if (total <= 0) return
    const cash = parseAmount(nextCashStr)
    const bank = parseAmount(b.bankSplitStr)
    const cheque = parseAmount(b.chequeSplitStr)
    if (creditUpdateSlot) {
      if (cash + bank + cheque > total) {
        const roomAfterCash = Math.max(0, total - cash)
        const newBank = Math.min(bank, roomAfterCash)
        patchBillFor(slot, {
          bankSplitStr: formatSplitPart(newBank),
          chequeSplitStr: formatSplitPart(Math.max(0, roomAfterCash - newBank)),
        })
      }
      return
    }
    const room = Math.max(0, total - bank - cheque)
    if (nextCashStr === '') {
      patchBillFor(slot, { creditSplitStr: formatSplitPart(room) })
      return
    }
    const credit = Math.min(parseAmount(b.creditSplitStr), Math.max(0, room - cash))
    patchBillFor(slot, {
      cashSplitStr: nextCashStr,
      creditSplitStr: formatSplitPart(credit > 0 ? credit : Math.max(0, room - cash)),
      chequeApproved: false,
    })
  }

  function applySplitBankFor(slot: BillSlot, nextBankStr: string) {
    const b = billState(slot)
    const total = parseAmount(b.amountStr)
    const creditUpdateSlot = slotHasOpenCredit(slot)
    patchBillFor(slot, { bankSplitStr: nextBankStr, chequeApproved: false })
    if (total <= 0) return
    const bank = parseAmount(nextBankStr)
    const cash = parseAmount(b.cashSplitStr)
    const cheque = parseAmount(b.chequeSplitStr)
    if (creditUpdateSlot) {
      if (cash + bank + cheque > total) {
        const roomAfterBank = Math.max(0, total - bank)
        const newCash = Math.min(cash, roomAfterBank)
        patchBillFor(slot, {
          cashSplitStr: formatSplitPart(newCash),
          chequeSplitStr: formatSplitPart(Math.max(0, roomAfterBank - newCash)),
        })
      }
      return
    }
    const room = Math.max(0, total - cash - cheque)
    if (nextBankStr === '') {
      patchBillFor(slot, { creditSplitStr: formatSplitPart(Math.max(0, room)) })
      return
    }
    const credit = Math.min(parseAmount(b.creditSplitStr), Math.max(0, room - bank))
    patchBillFor(slot, {
      bankSplitStr: nextBankStr,
      creditSplitStr: formatSplitPart(credit > 0 ? credit : Math.max(0, room - bank)),
      chequeApproved: false,
    })
  }

  function applySplitCreditFor(slot: BillSlot, nextCreditStr: string) {
    const b = billState(slot)
    const total = parseAmount(b.amountStr)
    patchBillFor(slot, { creditSplitStr: nextCreditStr, chequeApproved: false })
    if (total <= 0) return
    const credit = parseAmount(nextCreditStr)
    const bank = parseAmount(b.bankSplitStr)
    const cheque = parseAmount(b.chequeSplitStr)
    const room = Math.max(0, total - bank - cheque)
    if (nextCreditStr === '') {
      patchBillFor(slot, { cashSplitStr: formatSplitPart(room) })
      return
    }
    const cash = Math.min(parseAmount(b.cashSplitStr), Math.max(0, room - credit))
    patchBillFor(slot, {
      creditSplitStr: nextCreditStr,
      cashSplitStr: formatSplitPart(cash > 0 ? cash : Math.max(0, room - credit)),
      chequeApproved: false,
    })
  }

  function applySplitChequeFor(slot: BillSlot, nextChequeStr: string) {
    const b = billState(slot)
    const total = parseAmount(b.amountStr)
    const creditUpdateSlot = slotHasOpenCredit(slot)
    patchBillFor(slot, { chequeSplitStr: nextChequeStr, chequeApproved: false })
    if (total <= 0) return
    const cheque = parseAmount(nextChequeStr)
    const bank = parseAmount(b.bankSplitStr)
    const room = Math.max(0, total - cheque)
    const cash = Math.min(parseAmount(b.cashSplitStr), Math.max(0, room - bank))
    if (creditUpdateSlot) {
      patchBillFor(slot, {
        chequeSplitStr: nextChequeStr,
        cashSplitStr: formatSplitPart(cash),
        bankSplitStr: formatSplitPart(Math.max(0, room - cash)),
        chequeApproved: false,
      })
      return
    }
    const credit = Math.max(0, total - cheque - bank - cash)
    patchBillFor(slot, {
      chequeSplitStr: nextChequeStr,
      cashSplitStr: formatSplitPart(cash),
      bankSplitStr: formatSplitPart(bank),
      creditSplitStr: formatSplitPart(credit),
      chequeApproved: false,
    })
  }

  function applySplitCash(nextCashStr: string) {
    applySplitCashFor(editingBill, nextCashStr)
  }

  function applySplitBank(nextBankStr: string) {
    applySplitBankFor(editingBill, nextBankStr)
  }

  function applySplitCredit(nextCreditStr: string) {
    applySplitCreditFor(editingBill, nextCreditStr)
  }

  function applySplitCheque(nextChequeStr: string) {
    applySplitChequeFor(editingBill, nextChequeStr)
  }

  function syncSplitFromTotalFor(slot: BillSlot, nextAmountStr: string) {
    const b = billState(slot)
    const creditUpdateSlot = slotHasOpenCredit(slot)
    patchBillFor(slot, { amountStr: nextAmountStr, chequeApproved: false })
    const total = parseAmount(nextAmountStr)
    if (total <= 0 || b.payType !== 'split') return
    if (creditUpdateSlot) {
      if (b.cashSplitStr) applySplitCashFor(slot, b.cashSplitStr)
      else if (b.bankSplitStr) applySplitBankFor(slot, b.bankSplitStr)
      else if (b.chequeSplitStr) applySplitChequeFor(slot, b.chequeSplitStr)
      return
    }
    if (b.cashSplitStr) applySplitCashFor(slot, b.cashSplitStr)
    else if (b.bankSplitStr) applySplitBankFor(slot, b.bankSplitStr)
    else if (b.creditSplitStr) applySplitCreditFor(slot, b.creditSplitStr)
    else if (b.chequeSplitStr) applySplitChequeFor(slot, b.chequeSplitStr)
  }

  function syncSplitFromTotal(nextAmountStr: string) {
    syncSplitFromTotalFor(editingBill, nextAmountStr)
  }

  function handleBillModeChange(mode: BillMode) {
    setBillMode(mode)
    setActiveField('amount')
  }

  function resetPurchaseForm() {
    setBill1({ ...EMPTY_BILL })
    setBill2({ ...EMPTY_BILL, payType: 'cash' })
    setName('')
    setDescription('')
    setBillNo('')
    setBillDateStr(toInputDate())
    setBillMode('no1')
    setActiveField('name')
    setSaved(false)
    setFormNote(null)
    setEditingExpenseIds([])
    setLoadedExpenseIds([])
  }

  function handleSave() {
    if (!isValid || saved) return

    if (isCreditUpdateMode && creditUpdateActiveSlot) {
      const expenseId = editingExpenseIds[editingBill === 1 ? 0 : editingExpenseIds.length > 1 ? 1 : 0]
      const expense = data.expenses.find((entry) => entry.id === expenseId)
      if (!expense || !isPurchaseCreditExpense(expense)) return
      const payAmount = creditPaymentFromBill(bill)
      const payType = normalizeCreditPaymentPayType(bill.payType)
      applyPurchaseCreditPayment(expenseId, {
        payType,
        payAmount,
        cashAmount: parseAmount(bill.cashSplitStr),
        bankAmount:
          payType === 'split'
            ? parseAmount(bill.bankSplitStr)
            : payType === 'bank'
              ? payAmount
              : undefined,
        chequeAmount: parseAmount(bill.chequeSplitStr),
        chequeApproved: bill.chequeApproved,
      })
      setSaved(true)
      setTimeout(() => {
        resetPurchaseForm()
      }, 900)
      return
    }

    const payloads = []
    if (hasBill1 && bill1Valid) {
      payloads.push(buildExpensePayload(bill1, 1, name, description, billNo, billDateStr, true))
    }
    if (hasBill2 && bill2Valid) {
      payloads.push(buildExpensePayload(bill2, 2, name, description, billNo, billDateStr, true))
    }
    if (payloads.length === 0) return

    if (isEditing) {
      if (hasBill1 && bill1Valid && editingExpenseIds[0]) {
        updateExpense(editingExpenseIds[0], payloads[0])
      }
      if (hasBill2 && bill2Valid) {
        const updateId = editingExpenseIds[hasBill1 && bill1Valid ? 1 : 0]
        const payload = hasBill1 && bill1Valid ? payloads[1] : payloads[0]
        if (updateId && payload) updateExpense(updateId, payload)
      }
    } else {
      recordExpenses(payloads)
    }

    setSaved(true)
    setTimeout(() => {
      resetPurchaseForm()
    }, 900)
  }

  function loadPurchaseBill(primaryId: string, mode: 'open' | 'update') {
    const expense = data.expenses.find((entry) => entry.id === primaryId)
    if (!expense || !isPurchaseExpense(expense)) return

    const paired = expense.pairedExpenseId
      ? data.expenses.find((entry) => entry.id === expense.pairedExpenseId)
      : undefined

    setName(stripExpenseBillSuffix(expense.name ?? paired?.name ?? ''))
    setDescription(expense.description ?? paired?.description ?? '')
    setBillNo(expense.billNo ?? paired?.billNo ?? '')
    setBillDateStr(expense.billDate ?? paired?.billDate ?? toInputDate())

    if (paired) {
      const no1 = isGstExpense(expense.name, expense.billNumber) ? expense : paired
      const no2 = no1.id === expense.id ? paired : expense
      const open1 = isPurchaseCreditExpense(no1) ? purchaseCreditAmount(no1) : 0
      const open2 = isPurchaseCreditExpense(no2) ? purchaseCreditAmount(no2) : 0
      setBill1(billStateForLoad(no1, mode))
      setBill2(billStateForLoad(no2, mode))
      if (mode === 'update' && (open1 > 0 || open2 > 0)) {
        setBillMode(open1 > 0 ? 'no1' : 'no2')
      } else {
        setBillMode('no1')
      }
      const ids = [no1.id, no2.id]
      setLoadedExpenseIds(ids)
      setEditingExpenseIds(mode === 'update' ? ids : [])
      const supplierLabel = stripExpenseBillSuffix(no1.name)
      const creditBalance = [no1, no2]
        .filter((entry) => isPurchaseCreditExpense(entry))
        .reduce((sum, entry) => sum + purchaseCreditAmount(entry), 0)
      setFormNote(
        mode === 'update' && creditBalance > 0
          ? `Credit Update · ${supplierLabel} · Balance ${formatMoney(creditBalance)}`
          : mode === 'update'
            ? `Updating purchase · ${supplierLabel}`
            : `Purchase bill · ${supplierLabel}`,
      )
    } else {
      const slot = expense.billNumber === 2 ? 2 : 1
      setBillMode(slot === 2 ? 'no2' : 'no1')
      const state = billStateForLoad(expense, mode)
      if (slot === 1) {
        setBill1(state)
        setBill2({ ...EMPTY_BILL })
      } else {
        setBill2(state)
        setBill1({ ...EMPTY_BILL })
      }
      setLoadedExpenseIds([expense.id])
      setEditingExpenseIds(mode === 'update' ? [expense.id] : [])
      const supplierLabel = stripExpenseBillSuffix(expense.name)
      const creditBalance = isPurchaseCreditExpense(expense) ? purchaseCreditAmount(expense) : 0
      setFormNote(
        mode === 'update' && creditBalance > 0
          ? `Credit Update · ${supplierLabel} · Balance ${formatMoney(creditBalance)}`
          : mode === 'update'
            ? `Updating purchase · ${supplierLabel}`
            : `Purchase bill · ${supplierLabel}`,
      )
    }

    setActiveField(mode === 'update' ? 'amount' : 'name')
    setSaved(false)
  }

  function focusField(field: ExpenseField) {
    setActiveField(field)
    if (field === 'name') {
      nameInputRef.current?.focus()
      return
    }
    if (field === 'description') {
      descriptionInputRef.current?.focus()
      nameInputRef.current?.blur()
      return
    }
    if (field === 'billNo') {
      billNoInputRef.current?.focus()
      nameInputRef.current?.blur()
      descriptionInputRef.current?.blur()
      return
    }
    if (field === 'billDate') {
      billDateInputRef.current?.focus()
      nameInputRef.current?.blur()
      descriptionInputRef.current?.blur()
      billNoInputRef.current?.blur()
      return
    }
    nameInputRef.current?.blur()
    descriptionInputRef.current?.blur()
    billNoInputRef.current?.blur()
    billDateInputRef.current?.blur()
  }

  function handlePayTypeChange(type: ExpensePayType) {
    const b = bill
    const slotAmount = parseAmount(b.amountStr)
    patchBill({
      payType: type,
      cashSplitStr: '',
      bankSplitStr: '',
      creditSplitStr: '',
      chequeSplitStr: '',
      chequeApproved: false,
    })
    if (type === 'split') {
      if (slotAmount > 0) setActiveField('cashSplit')
      else setActiveField('amount')
      return
    }
    focusField('pay')
  }

  function handleClear() {
    if (isCreditUpdateMode) {
      if (slotHasOpenCredit(1)) setBill1(expenseToCreditPayState())
      if (slotHasOpenCredit(2)) setBill2(expenseToCreditPayState())
      setActiveField('amount')
      setSaved(false)
      return
    }
    setBill1({ ...EMPTY_BILL })
    setBill2({ ...EMPTY_BILL, payType: 'cash' })
    setName('')
    setDescription('')
    setBillNo('')
    setBillDateStr(toInputDate())
    setBillMode('no1')
    setActiveField('name')
    setSaved(false)
    setFormNote(null)
    setEditingExpenseIds([])
    setLoadedExpenseIds([])
  }

  useEffect(() => {
    if (!isCreditUpdateMode || !creditUpdateActiveSlot) return
    if (bill.payType === 'credit') {
      patchBill({ payType: 'cash', amountStr: bill.amountStr, chequeApproved: false })
    }
  }, [isCreditUpdateMode, creditUpdateActiveSlot, bill.payType])

  function enableBillUpdate() {
    if (loadedExpenseIds.length === 0) return
    const hasCredit = loadedExpenseIds.some((id) => {
      const expense = data.expenses.find((entry) => entry.id === id)
      return expense && isPurchaseCreditExpense(expense)
    })
    if (hasCredit) {
      loadPurchaseBill(loadedExpenseIds[0], 'update')
      return
    }
    setEditingExpenseIds(loadedExpenseIds)
    setFormNote(`Updating purchase · ${name.trim() || 'supplier'}`)
    setActiveField('amount')
  }

  function handleChequeApprove() {
    if (!canChequeApprove) return
    patchBill({ chequeApproved: true })
  }

  function handleEnter() {
    focusField(nextExpenseField(activeField, bill, creditUpdateActiveSlot))
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'amount') {
      syncSplitFromTotal(applyNumpadAction(bill.amountStr, action))
      return
    }
    if (activeField === 'cashSplit') {
      applySplitCash(applyNumpadAction(bill.cashSplitStr, action))
      return
    }
    if (activeField === 'bankSplit') {
      applySplitBank(applyNumpadAction(bill.bankSplitStr, action))
      return
    }
    if (activeField === 'creditSplit') {
      applySplitCredit(applyNumpadAction(bill.creditSplitStr, action))
      return
    }
    if (activeField === 'chequeSplit') {
      applySplitCheque(applyNumpadAction(bill.chequeSplitStr, action))
    }
  }

  useEffect(() => {
    if (activeField === 'bill') billSectionRef.current?.focus()
    if (activeField === 'pay') paySectionRef.current?.focus()
  }, [activeField])

  useEffect(() => {
    setActiveField('name')
    nameInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const mode = parseExpenseBillMode(searchParams.get('bill'))
    if (!mode) return
    setBillMode(mode)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (editId) {
      loadPurchaseBill(editId, 'update')
      setSearchParams({}, { replace: true })
      return
    }
    const openId = searchParams.get('open')
    if (openId) {
      loadPurchaseBill(openId, 'open')
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, data.expenses, setSearchParams])

  useEffect(() => {
    if (highlightedNameIndex < 0) return
    const item = activeNameSuggestionRef.current
    const list = nameSuggestionsListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) list.scrollTop = itemTop
    else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [highlightedNameIndex])

  useEffect(() => {
    if (highlightedItemIndex < 0) return
    const item = activeItemSuggestionRef.current
    const list = itemSuggestionsListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) list.scrollTop = itemTop
    else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [highlightedItemIndex])

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  useNumpadKeyboard((action) => numpadHandlerRef.current(action), !saved)

  const saveHandlerRef = useRef(handleSave)
  saveHandlerRef.current = handleSave

  useEffect(() => {
    if (saved) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code === 'KeyS') {
        if (!isValid) return
        e.preventDefault()
        saveHandlerRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saved, isValid])

  const topGridClass = splitMode
    ? creditUpdateActiveSlot
      ? 'expenses-top--split-pay'
      : 'expenses-top--split-give'
    : ''

  function resolveSupplierForItem(item: string): string {
    const itemKey = item.trim().toLowerCase()
    if (!itemKey) return ''

    for (const expense of data.expenses) {
      if (!isPurchaseExpense(expense)) continue
      if (expense.description?.trim().toLowerCase() !== itemKey) continue
      const supplier = stripExpenseBillSuffix(expense.name ?? '').trim()
      if (supplier) return supplier
    }

    const matches = (data.suppliers ?? []).filter((entry) =>
      (entry.items ?? []).some((label) => label.trim().toLowerCase() === itemKey),
    )
    if (matches.length > 0) return matches[0].name.trim()

    return ''
  }

  function applySupplierFromItem(item: string) {
    const supplier = name.trim() || resolveSupplierForItem(item)
    if (!supplier) return false
    setName(supplier)
    addSupplier(supplier)
    return true
  }

  function selectSupplier(supplier: string) {
    setName(supplier)
    setNameDropdownOpen(false)
    setHighlightedNameIndex(-1)
    setActiveField('description')
    window.setTimeout(() => descriptionInputRef.current?.focus(), 0)
  }

  function selectItem(item: string) {
    setDescription(item)
    setItemDropdownOpen(false)
    setHighlightedItemIndex(-1)
    if (applySupplierFromItem(item)) {
      setActiveField('billNo')
      window.setTimeout(() => billNoInputRef.current?.focus(), 0)
      return
    }
    setActiveField('name')
    window.setTimeout(() => nameInputRef.current?.focus(), 0)
  }

  function renderDescriptionField() {
    const dropdownCount = filteredItemSuggestions.length

    return (
      <div
        className={`purchase-field-panel purchase-item-section ${activeField === 'description' ? 'purchase-field-panel--active' : ''}`}
      >
        <span className="purchase-field-panel-label">Item / Description</span>
        <label className="purchase-field-input-row">
          <input
            ref={descriptionInputRef}
            type="text"
            className={`expense-name-input ${activeField === 'description' ? 'expense-name-input--active' : ''}`}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setItemDropdownOpen(true)
              setHighlightedItemIndex(-1)
            }}
            onFocus={() => {
              setActiveField('description')
              setItemDropdownOpen(true)
              setHighlightedItemIndex(-1)
            }}
            onBlur={() => setItemDropdownOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setItemDropdownOpen(false)
                setHighlightedItemIndex(-1)
                return
              }
              if (itemDropdownOpen && dropdownCount > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightedItemIndex((prev) => (prev + 1) % dropdownCount)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightedItemIndex((prev) =>
                    prev <= 0 ? dropdownCount - 1 : prev - 1,
                  )
                  return
                }
                if (e.key === 'Enter' && highlightedItemIndex >= 0) {
                  e.preventDefault()
                  const picked = filteredItemSuggestions[highlightedItemIndex]
                  if (picked) selectItem(picked)
                  return
                }
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                setItemDropdownOpen(false)
                handleEnter()
              }
            }}
            placeholder="Type item — e.g. Fabric"
            autoComplete="off"
          />
          {description.trim() ? (
            <button
              type="button"
              className="purchase-field-clear"
              aria-label="Clear item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDescription('')
                setItemDropdownOpen(true)
                setHighlightedItemIndex(-1)
                descriptionInputRef.current?.focus()
              }}
            >
              ×
            </button>
          ) : null}
        </label>
        {itemDropdownOpen && dropdownCount > 0 ? (
          <ul ref={itemSuggestionsListRef} className="expense-name-suggestions" role="listbox">
            {filteredItemSuggestions.map((item, index) => (
              <li key={item}>
                <button
                  type="button"
                  ref={index === highlightedItemIndex ? activeItemSuggestionRef : null}
                  className={`expense-name-suggestion ${index === highlightedItemIndex ? 'expense-name-suggestion--active' : ''}`}
                  onMouseEnter={() => setHighlightedItemIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectItem(item)
                  }}
                >
                  {item}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  function renderBillDateField() {
    return (
      <div
        className={`purchase-field-panel purchase-billdate-section ${activeField === 'billDate' ? 'purchase-field-panel--active' : ''}`}
      >
        <span className="purchase-field-panel-label">Bill Date</span>
        <label className="purchase-field-input-row">
          <input
            ref={billDateInputRef}
            type="date"
            className={`expense-name-input expense-name-input--date ${activeField === 'billDate' ? 'expense-name-input--active' : ''}`}
            value={billDateStr}
            onChange={(e) => setBillDateStr(e.target.value)}
            onFocus={() => setActiveField('billDate')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                handleEnter()
              }
            }}
            aria-label="Bill date"
          />
        </label>
      </div>
    )
  }

  function renderBillNoField() {
    return (
      <div
        className={`purchase-field-panel purchase-billno-section ${activeField === 'billNo' ? 'purchase-field-panel--active' : ''}`}
      >
        <span className="purchase-field-panel-label">Bill No</span>
        <label className="purchase-field-input-row">
          <input
            ref={billNoInputRef}
            type="text"
            className={`expense-name-input ${activeField === 'billNo' ? 'expense-name-input--active' : ''}`}
            value={billNo}
            onChange={(e) => setBillNo(e.target.value)}
            onFocus={() => setActiveField('billNo')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                handleEnter()
              }
            }}
            placeholder="Supplier bill / invoice no."
            autoComplete="off"
          />
          {billNo.trim() ? (
            <button
              type="button"
              className="purchase-field-clear"
              aria-label="Clear bill number"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setBillNo('')
                billNoInputRef.current?.focus()
              }}
            >
              ×
            </button>
          ) : null}
        </label>
      </div>
    )
  }

  function renderNameField(standalone = false) {
    const dropdownCount = filteredNameSuggestions.length

    return (
      <div
        className={`purchase-field-panel expense-name ${standalone ? 'expense-name--standalone' : ''} ${activeField === 'name' ? 'purchase-field-panel--active' : ''}`}
      >
        <span className="purchase-field-panel-label">Supplier / Purchase Name</span>
        <label className="purchase-field-input-row">
        <input
          ref={nameInputRef}
          type="text"
          className={`expense-name-input ${activeField === 'name' ? 'expense-name-input--active' : ''}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setNameDropdownOpen(true)
            setHighlightedNameIndex(-1)
          }}
          onFocus={() => {
            setActiveField('name')
            setNameDropdownOpen(true)
            setHighlightedNameIndex(-1)
          }}
          onBlur={() => setNameDropdownOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setNameDropdownOpen(false)
              setHighlightedNameIndex(-1)
              return
            }
            if (nameDropdownOpen && dropdownCount > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlightedNameIndex((prev) => (prev + 1) % dropdownCount)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlightedNameIndex((prev) =>
                  prev <= 0 ? dropdownCount - 1 : prev - 1,
                )
                return
              }
              if (e.key === 'Enter' && highlightedNameIndex >= 0) {
                e.preventDefault()
                const picked = filteredNameSuggestions[highlightedNameIndex]
                if (picked) selectSupplier(picked)
                return
              }
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              setNameDropdownOpen(false)
              handleEnter()
            }
          }}
          placeholder="Type supplier name"
          autoComplete="off"
        />
        {name.trim() ? (
          <button
            type="button"
            className="purchase-field-clear"
            aria-label="Clear supplier"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setName('')
              setNameDropdownOpen(true)
              setHighlightedNameIndex(-1)
              nameInputRef.current?.focus()
            }}
          >
            ×
          </button>
        ) : null}
        </label>
        {supplierOpenCreditTotal > 0 ? (
          <p className="purchase-supplier-pending-hint" role="status">
            Open credit · {formatMoney(supplierOpenCreditTotal)} pending
          </p>
        ) : null}
        {nameDropdownOpen && dropdownCount > 0 ? (
          <ul ref={nameSuggestionsListRef} className="expense-name-suggestions" role="listbox">
            {filteredNameSuggestions.map((item, index) => (
              <li key={item}>
                <button
                  type="button"
                  ref={index === highlightedNameIndex ? activeNameSuggestionRef : null}
                  className={`expense-name-suggestion ${index === highlightedNameIndex ? 'expense-name-suggestion--active' : ''}`}
                  onMouseEnter={() => setHighlightedNameIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectSupplier(item)
                  }}
                >
                  <span>{item}</span>
                  {(supplierPendingByName.get(item.toLowerCase()) ?? 0) > 0 ? (
                    <span className="expense-name-suggestion-pending">
                      {formatMoney(supplierPendingByName.get(item.toLowerCase()) ?? 0)} due
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  const handlePageBack = useCallback(() => {
    if (showPurchaseHistory) {
      setShowPurchaseHistory(false)
      return
    }
    goBack()
  }, [goBack, showPurchaseHistory])

  usePageEscape(handlePageBack, !showPurchaseHistory)

  return (
    <div className="purchase-page expenses-page page-shell">
      <PageCorners
        left={<PageBackButton onClick={handlePageBack} ariaLabel="Back" />}
        right={
          <button
            type="button"
            className="purchase-corner-btn"
            onClick={() => setShowPurchaseHistory(true)}
            aria-label="Purchase history"
          >
            <span className="purchase-corner-btn-icon" aria-hidden="true">
              📋
            </span>
            <span>History</span>
          </button>
        }
      />

      <header className="purchase-page-head page-head--corners">
        <h1 className="purchase-page-title">Purchase Expense</h1>
        <p className="purchase-page-sub">
          Purchases only · {GST_BILL_LABEL} · {NO_GST_BILL_LABEL} · cash, bank, cheque, split
        </p>
        {formNote ? (
          <div className="purchase-page-form-note-row">
            <p className="purchase-page-credit-note">{formNote}</p>
            {!isEditing && loadedExpenseIds.length > 0 ? (
              <button type="button" className="purchase-page-update-btn" onClick={enableBillUpdate}>
                Update
              </button>
            ) : null}
          </div>
        ) : null}
        {creditUpdateInfo ? (
          <div className="purchase-credit-update-banner">
            <div className="purchase-credit-update-main">
              <div className="purchase-credit-update-stats">
                <div className="purchase-credit-update-stat purchase-credit-update-stat--paid">
                  <span>Paid</span>
                  <strong className={creditUpdateInfo.payingNow > 0 ? 'purchase-credit-stat-live' : ''}>
                    {formatMoney(creditUpdateInfo.totalPaid ?? creditUpdateInfo.alreadyPaid)}
                  </strong>
                </div>
                {creditUpdateInfo.activeSlot && creditUpdateInfo.payingNow > 0 ? (
                  <div className="purchase-credit-update-stat purchase-credit-update-stat--paying">
                    <span>Paying Now</span>
                    <strong className="purchase-credit-stat-live">
                      {formatMoney(creditUpdateInfo.payingNow)}
                    </strong>
                  </div>
                ) : null}
                <div className="purchase-credit-update-stat purchase-credit-update-stat--remaining">
                  <span>Credit Balance</span>
                  <strong className={creditUpdateInfo.payingNow > 0 ? 'purchase-credit-stat-live' : ''}>
                    {formatMoney(creditUpdateInfo.remaining)}
                  </strong>
                </div>
              </div>
              <div className="purchase-credit-update-types">
                <span className="purchase-credit-update-type">
                  <span className="purchase-credit-update-type-label">Bill</span>
                  <strong>{creditUpdateInfo.billLabel}</strong>
                </span>
                {!creditUpdateInfo.activeSlot ? (
                  <span className="purchase-credit-update-type">
                    <span className="purchase-credit-update-type-label">Tip</span>
                    <strong>Switch bill</strong>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {isEditing && !isCreditUpdateMode && amount > 0 ? (
          <div className="purchase-edit-summary" aria-live="polite">
            <div className="purchase-edit-summary-stat">
              <span>Bill</span>
              <strong>{formatMoney(amount)}</strong>
            </div>
            <div className="purchase-edit-summary-stat">
              <span>Paid</span>
              <strong>{formatMoney(editBillPaidNow)}</strong>
            </div>
            <div className="purchase-edit-summary-stat purchase-edit-summary-stat--balance">
              <span>Balance</span>
              <strong>{formatMoney(editBillBalanceDue)}</strong>
            </div>
          </div>
        ) : !creditUpdateInfo ? (
          <p className="purchase-page-active-bill">
            {billMode === 'no1' ? purchaseBillLabel(1) : purchaseBillLabel(2)}
          </p>
        ) : null}
      </header>

      <div className="purchase-form">
        <section className="purchase-form-section purchase-form-section--details" aria-label="Supplier details">
          {renderNameField()}
          {!isCreditUpdateMode ? (
            <div className="purchase-form-row purchase-form-row--3">
              {renderDescriptionField()}
              {renderBillNoField()}
              {renderBillDateField()}
            </div>
          ) : (
            renderDescriptionField()
          )}
        </section>

        <section className="purchase-form-section purchase-form-section--bill" aria-label="Bill and amount">
          <div className="purchase-form-row purchase-form-row--bill-amount">
            <div
              className={`purchase-field-panel purchase-bill-option-panel ${
                activeField === 'bill' ? 'purchase-field-panel--active' : ''
              }`}
            >
              <div
                ref={billSectionRef}
                className={`purchase-amount-bill ${activeField === 'bill' ? 'purchase-amount-bill--active' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    handleEnter()
                  }
                }}
                tabIndex={activeField === 'bill' ? 0 : -1}
              >
                <BillNoChips
                  value={billMode}
                  onChange={handleBillModeChange}
                  bill1Amount={bill1Amount}
                  bill2Amount={bill2Amount}
                  label="Bill Option"
                  active={activeField === 'bill'}
                  onFocus={() => focusField('bill')}
                />
              </div>
            </div>

            <div
              className={`purchase-field-panel purchase-amount-panel ${
                activeField === 'amount' ? 'purchase-field-panel--active purchase-amount-panel--active' : ''
              }`}
            >
              <AmountDisplay
                label={
                  creditUpdateActiveSlot
                    ? 'Pay Amount'
                    : splitMode
                      ? 'Bill Amount'
                      : 'Expense Amount'
                }
                value={bill.amountStr}
                active={activeField === 'amount'}
                onSelect={() => focusField('amount')}
                compact
              />
              {creditUpdateActiveSlot ? (
                <div className="purchase-credit-pay-live" aria-live="polite">
                  <span className="purchase-credit-pay-live-item">
                    Paid{' '}
                    <strong className={creditPayingNow > 0 ? 'purchase-credit-stat-live' : ''}>
                      {formatMoney(creditTotalPaid)}
                    </strong>
                  </span>
                  <span className="purchase-credit-pay-live-item">
                    Credit{' '}
                    <strong className={creditPayingNow > 0 ? 'purchase-credit-stat-live' : ''}>
                      {formatMoney(creditRemaining)}
                    </strong>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {splitMode ? (
          <div
            className={`expenses-top purchase-split-row ${topGridClass}${creditUpdateActiveSlot ? ' purchase-split-row--credit-pay' : ''}`}
          >
          <AmountDisplay
            label={PURCHASE_CASH_LABEL}
            value={bill.cashSplitStr}
            active={activeField === 'cashSplit'}
            onSelect={() => focusField('cashSplit')}
            compact
          />
          <AmountDisplay
            label="Bank"
            value={bill.bankSplitStr}
            active={activeField === 'bankSplit'}
            onSelect={() => focusField('bankSplit')}
            compact
          />
          {!creditUpdateActiveSlot ? (
            <AmountDisplay
              label="Credit"
              value={bill.creditSplitStr}
              active={activeField === 'creditSplit'}
              onSelect={() => focusField('creditSplit')}
              compact
            />
          ) : null}
          <AmountDisplay
            label="Cheque"
            value={bill.chequeSplitStr}
            active={activeField === 'chequeSplit'}
            onSelect={() => focusField('chequeSplit')}
            compact
          />
        </div>
      ) : null}

        <div className="purchase-controls purchase-controls--pay-only">
          <div
            ref={paySectionRef}
            className={`expenses-pay purchase-controls-pay ${activeField === 'pay' ? 'expenses-pay--active' : ''}`}
            onClick={() => focusField('pay')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                handleEnter()
              }
            }}
            role="group"
            tabIndex={activeField === 'pay' ? 0 : -1}
          >
            <PayTypeChips
              value={bill.payType}
              onChange={(type) => handlePayTypeChange(type as ExpensePayType)}
              options={visiblePayTypes}
              label="Pay"
              labelOverrides={{ cash: PURCHASE_CASH_LABEL }}
            />
          </div>
        </div>

        {hasBill1 || hasBill2 || creditUpdateActiveSlot ? (
          creditUpdateActiveSlot ? (
            <div className="purchase-bill-total purchase-bill-total--credit-pay">
              <span>
                Paid {formatMoney(creditTotalPaid)}
                {creditPayingNow > 0 ? ` · Now ${formatMoney(creditPayingNow)}` : ''}
              </span>
              <strong>Credit {formatMoney(creditRemaining)}</strong>
            </div>
          ) : (
            <div className="purchase-bill-total purchase-bill-total--static">
              <span>
                No 1 {formatMoney(bill1Amount)} + No 2 {formatMoney(bill2Amount)}
              </span>
              <strong>Total {formatMoney(purchaseTotal)}</strong>
            </div>
          )
        ) : null}

        {splitMode && amount > 0 ? (
          <div
            className={`expenses-split-total ${splitShortfall > 0 || splitExcess > 0 ? 'expenses-split-total--warn' : ''}`}
          >
            <span>{creditUpdateActiveSlot ? 'Pay Split' : 'Paid Total'}</span>
            <strong>
              {formatMoney(splitPaidTotal)} / {formatMoney(amount)}
              {creditUpdateActiveSlot && creditPayingNow > 0
                ? ` · Credit ${formatMoney(creditRemaining)}`
                : null}
              {!creditUpdateActiveSlot && splitShortfall > 0 ? ` · need ${formatMoney(splitShortfall)}` : null}
              {!creditUpdateActiveSlot && splitExcess > 0 ? ` · over ${formatMoney(splitExcess)}` : null}
              {!creditUpdateActiveSlot && splitShortfall === 0 && splitExcess === 0 && editBillBalanceDue > 0
                ? ` · Balance ${formatMoney(editBillBalanceDue)}`
                : null}
            </strong>
          </div>
        ) : null}

        {bill.payType === 'cheque' && bill.chequeApproved ? (
          <div className="expenses-cheque-approved">✓ Cheque approved → Bank</div>
        ) : null}

        {splitMode && bill.chequeApproved && chequeSplitAmount > 0 ? (
          <div className="expenses-cheque-approved">
            ✓ Cheque {formatMoney(chequeSplitAmount)} approved → Bank
          </div>
        ) : null}

        {payDetailText ? <p className="purchase-page-pay-detail">{payDetailText}</p> : null}
      </div>

      <div className="expenses-keyboard purchase-keyboard">
        <NumberKeyboard onPress={handleNumpad} />
      </div>

      <div className={`expenses-actions purchase-actions ${canChequeApprove ? 'expenses-actions--approve' : ''}`}>
        <button type="button" className="btn btn-secondary purchase-action-btn" onClick={handleClear}>
          Clear
        </button>
        {canChequeApprove ? (
          <button type="button" className="btn btn-warning purchase-action-btn" onClick={handleChequeApprove}>
            Approve ✓
          </button>
        ) : null}
        <button
          type="button"
          className={`btn btn-danger btn-with-shortcut purchase-action-btn purchase-action-btn--save ${saved ? 'btn-saved' : ''}`}
          onClick={handleSave}
          disabled={!canSave || saved}
        >
          <span className="btn-text">
            {saved
              ? '✓ Saved'
              : isCreditUpdateMode && creditUpdateActiveSlot
                ? `Pay · ${formatMoney(creditPayingNow)}`
                : isEditing
                  ? `Update · ${formatMoney(purchaseTotal)}`
                  : hasBill1 && hasBill2
                    ? `Both · ${formatMoney(purchaseTotal)}`
                    : 'Record'}
          </span>
          {!saved ? <span className="btn-shortcut">Alt+S</span> : null}
        </button>
      </div>

      <PurchaseHistoryPanel
        open={showPurchaseHistory}
        onClose={() => setShowPurchaseHistory(false)}
        data={data}
        variant="modal"
        onUpdateBill={(expenseId) => {
          setShowPurchaseHistory(false)
          loadPurchaseBill(expenseId, 'update')
        }}
      />
    </div>
  )
}
