import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { isPurchaseCreditExpense, purchaseCreditAmount } from '../utils/purchaseHistory'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import './PurchaseExpense.css'

type BillSlot = 1 | 2

type ExpenseField =
  | 'name'
  | 'description'
  | 'bill'
  | 'amount'
  | 'cashSplit'
  | 'creditSplit'
  | 'chequeSplit'
  | 'pay'

type BillFormState = {
  amountStr: string
  payType: ExpensePayType
  cashSplitStr: string
  creditSplitStr: string
  chequeSplitStr: string
  chequeApproved: boolean
}

const EMPTY_BILL: BillFormState = {
  amountStr: '',
  payType: 'cash',
  cashSplitStr: '',
  creditSplitStr: '',
  chequeSplitStr: '',
  chequeApproved: false,
}

const BILL_PAY_TYPES: ExpensePayType[] = ['cash', 'bank', 'credit', 'cheque', 'split']

function creditUpdatePayOptions(expense: Expense): ExpensePayType[] {
  if (expense.payType === 'split') return ['split']
  if (expense.payType === 'credit') return ['credit']
  return [expense.payType]
}

function formatSplitPart(amount: number): string {
  if (amount <= 0) return ''
  return Number.isInteger(amount) ? String(amount) : String(amount)
}


function billFieldSteps(bill: BillFormState): ExpenseField[] {
  if (bill.payType === 'split') {
    return ['amount', 'cashSplit', 'creditSplit', 'chequeSplit']
  }
  return ['amount']
}

function nextExpenseField(current: ExpenseField, bill: BillFormState): ExpenseField {
  const order: ExpenseField[] = ['name', 'description', ...billFieldSteps(bill), 'pay']
  const idx = order.indexOf(current)
  if (idx < 0) return order[0]
  return order[(idx + 1) % order.length]
}

function canChequeApproveBill(bill: BillFormState): boolean {
  const amount = parseAmount(bill.amountStr)
  const splitMode = bill.payType === 'split'
  const cashSplitAmount = parseAmount(bill.cashSplitStr)
  const creditSplitAmount = parseAmount(bill.creditSplitStr)
  const chequeSplitAmount = parseAmount(bill.chequeSplitStr)
  const splitPaidTotal = cashSplitAmount + creditSplitAmount + chequeSplitAmount

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
  const creditSplitAmount = parseAmount(bill.creditSplitStr)
  const chequeSplitAmount = parseAmount(bill.chequeSplitStr)
  if (splitMode) {
    const parts: string[] = []
    if (cashSplitAmount > 0) parts.push(`💵 ${formatMoney(cashSplitAmount)}`)
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
  return `💵 Cash ${formatMoney(amount)}`
}

function validateBill(bill: BillFormState, requireName: boolean, name: string): boolean {
  const amount = parseAmount(bill.amountStr)
  if (amount <= 0) return false
  if (requireName && name.trim().length === 0) return false

  if (bill.payType === 'split') {
    const cash = parseAmount(bill.cashSplitStr)
    const credit = parseAmount(bill.creditSplitStr)
    const cheque = parseAmount(bill.chequeSplitStr)
    const paid = cash + credit + cheque
    if (paid !== amount) return false
    if (cash <= 0 && credit <= 0 && cheque <= 0) return false
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
  tagBill: boolean,
): {
  amount: number
  name: string
  description?: string
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
  const creditSplit = parseAmount(bill.creditSplitStr)
  const chequeSplit = parseAmount(bill.chequeSplitStr)

  const displayName =
    tagBill && billSlot === 2
      ? `${name.trim()}${expenseBillSuffix(2)}`
      : tagBill && billSlot === 1
        ? `${name.trim()}${expenseBillSuffix(1)}`
        : name.trim()
  const itemDescription = description.trim() || undefined

  if (bill.payType === 'split') {
    return {
      amount,
      name: displayName,
      description: itemDescription,
      payType: 'split',
      cashAmount: cashSplit || undefined,
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

export default function PurchaseExpense() {
  const { recordExpenses, updateExpense, addSupplier, data } = useCash()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
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

  const amount = parseAmount(bill.amountStr)
  const cashSplitAmount = parseAmount(bill.cashSplitStr)
  const creditSplitAmount = parseAmount(bill.creditSplitStr)
  const chequeSplitAmount = parseAmount(bill.chequeSplitStr)

  const splitPaidTotal = cashSplitAmount + creditSplitAmount + chequeSplitAmount
  const splitShortfall = splitMode && amount > 0 ? Math.max(0, amount - splitPaidTotal) : 0
  const splitExcess = splitMode && amount > 0 ? Math.max(0, splitPaidTotal - amount) : 0

  const bill1Valid = validateBill(bill1, false, name)
  const bill2Valid = validateBill(bill2, false, name)
  const hasBill1 = bill1Amount > 0
  const hasBill2 = bill2Amount > 0

  const isValid = (() => {
    if (name.trim().length === 0) return false
    if (!hasBill1 && !hasBill2) return false
    return (!hasBill1 || bill1Valid) && (!hasBill2 || bill2Valid)
  })()

  const canChequeApprove = !saved && canChequeApproveBill(bill)

  const payDetailText = amount > 0 ? describeBillPay(bill) : ''
  const isEditing = editingExpenseIds.length > 0
  const canSave = isValid && !saved && (isEditing || !formNote)

  const creditUpdateInfo = useMemo(() => {
    if (!isEditing || editingExpenseIds.length === 0) return null
    const loaded = editingExpenseIds
      .map((id) => data.expenses.find((entry) => entry.id === id))
      .filter((entry): entry is Expense => Boolean(entry && isPurchaseCreditExpense(entry)))
    if (loaded.length === 0) return null
    const balance = loaded.reduce((sum, entry) => sum + purchaseCreditAmount(entry), 0)
    const activeExpense =
      loaded.find((entry) => entry.id === editingExpenseIds[editingBill === 1 ? 0 : 1]) ??
      loaded.find((entry) => entry.id === editingExpenseIds[0]) ??
      loaded[0]
    return {
      balance,
      payLabel: activeExpense.payType === 'split' ? 'Split' : 'Credit',
      billLabel:
        activeExpense.billNumber === 2 ? purchaseBillLabel(2) : purchaseBillLabel(1),
      payOptions: creditUpdatePayOptions(activeExpense),
    }
  }, [isEditing, editingExpenseIds, data.expenses, editingBill])

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

  function applySplitCashFor(slot: BillSlot, nextCashStr: string) {
    const b = billState(slot)
    const total = parseAmount(b.amountStr)
    patchBillFor(slot, { cashSplitStr: nextCashStr, chequeApproved: false })
    if (total <= 0) return
    const cash = parseAmount(nextCashStr)
    const cheque = parseAmount(b.chequeSplitStr)
    const room = Math.max(0, total - cheque)
    if (nextCashStr === '') {
      patchBillFor(slot, { creditSplitStr: formatSplitPart(Math.max(0, room)) })
      return
    }
    const credit = Math.min(parseAmount(b.creditSplitStr), Math.max(0, room - cash))
    patchBillFor(slot, {
      cashSplitStr: nextCashStr,
      creditSplitStr: formatSplitPart(credit > 0 ? credit : Math.max(0, room - cash)),
      chequeApproved: false,
    })
  }

  function applySplitCreditFor(slot: BillSlot, nextCreditStr: string) {
    const b = billState(slot)
    const total = parseAmount(b.amountStr)
    patchBillFor(slot, { creditSplitStr: nextCreditStr, chequeApproved: false })
    if (total <= 0) return
    const credit = parseAmount(nextCreditStr)
    const cheque = parseAmount(b.chequeSplitStr)
    const room = Math.max(0, total - cheque)
    if (nextCreditStr === '') {
      patchBillFor(slot, { cashSplitStr: formatSplitPart(Math.max(0, room)) })
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
    patchBillFor(slot, { chequeSplitStr: nextChequeStr, chequeApproved: false })
    if (total <= 0) return
    const cheque = parseAmount(nextChequeStr)
    const room = Math.max(0, total - cheque)
    const cash = Math.min(parseAmount(b.cashSplitStr), room)
    const credit = Math.max(0, room - cash)
    patchBillFor(slot, {
      chequeSplitStr: nextChequeStr,
      cashSplitStr: formatSplitPart(cash),
      creditSplitStr: formatSplitPart(credit),
      chequeApproved: false,
    })
  }

  function applySplitCash(nextCashStr: string) {
    applySplitCashFor(editingBill, nextCashStr)
  }

  function applySplitCredit(nextCreditStr: string) {
    applySplitCreditFor(editingBill, nextCreditStr)
  }

  function applySplitCheque(nextChequeStr: string) {
    applySplitChequeFor(editingBill, nextChequeStr)
  }

  function syncSplitFromTotalFor(slot: BillSlot, nextAmountStr: string) {
    const b = billState(slot)
    patchBillFor(slot, { amountStr: nextAmountStr, chequeApproved: false })
    const total = parseAmount(nextAmountStr)
    if (total <= 0 || b.payType !== 'split') return
    if (b.cashSplitStr) applySplitCashFor(slot, b.cashSplitStr)
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

  function handleSave() {
    if (!isValid || saved) return
    const payloads = []
    if (hasBill1 && bill1Valid) {
      payloads.push(buildExpensePayload(bill1, 1, name, description, true))
    }
    if (hasBill2 && bill2Valid) {
      payloads.push(buildExpensePayload(bill2, 2, name, description, true))
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
      setBill1({ ...EMPTY_BILL })
      setBill2({ ...EMPTY_BILL, payType: 'cash' })
      setName('')
      setDescription('')
      setBillMode('no1')
      setActiveField('name')
      setSaved(false)
      setFormNote(null)
      setEditingExpenseIds([])
      setLoadedExpenseIds([])
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

    if (paired) {
      const no1 = isGstExpense(expense.name, expense.billNumber) ? expense : paired
      const no2 = no1.id === expense.id ? paired : expense
      setBill1(expenseToBillState(no1))
      setBill2(expenseToBillState(no2))
      setBillMode('no1')
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
      const state = expenseToBillState(expense)
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
    nameInputRef.current?.blur()
    descriptionInputRef.current?.blur()
  }

  function handlePayTypeChange(type: ExpensePayType) {
    const b = bill
    const slotAmount = parseAmount(b.amountStr)
    patchBill({
      payType: type,
      cashSplitStr: '',
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
    setBill1({ ...EMPTY_BILL })
    setBill2({ ...EMPTY_BILL, payType: 'cash' })
    setName('')
    setDescription('')
    setBillMode('no1')
    setActiveField('name')
    setSaved(false)
    setFormNote(null)
    setEditingExpenseIds([])
    setLoadedExpenseIds([])
  }

  function enableBillUpdate() {
    if (loadedExpenseIds.length === 0) return
    setEditingExpenseIds(loadedExpenseIds)
    setFormNote(`Updating purchase · ${name.trim() || 'supplier'}`)
    setActiveField('amount')
  }

  function handleChequeApprove() {
    if (!canChequeApprove) return
    patchBill({ chequeApproved: true })
  }

  function handleEnter() {
    focusField(nextExpenseField(activeField, bill))
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

  const topGridClass = splitMode ? 'expenses-top--split' : ''

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
      setActiveField('amount')
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
                  {item}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  return (
    <div className="purchase-page expenses-page">
      <div className="purchase-page-corners">
        <button
          type="button"
          className="purchase-corner-btn purchase-corner-btn--home"
          onClick={() => navigate('/')}
          aria-label="Close and go to Home"
        >
          <span className="purchase-corner-btn-icon" aria-hidden="true">
            🏠
          </span>
          <span>Home</span>
        </button>
        <button
          type="button"
          className="purchase-corner-btn purchase-corner-btn--history"
          onClick={() => setShowPurchaseHistory(true)}
          aria-label="Purchase history"
        >
          <span className="purchase-corner-btn-icon" aria-hidden="true">
            📋
          </span>
          <span>History</span>
        </button>
      </div>

      <header className="purchase-page-head">
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
            <div className="purchase-credit-update-balance">
              <span>Credit Balance</span>
              <strong>{formatMoney(creditUpdateInfo.balance)}</strong>
            </div>
            <div className="purchase-credit-update-types">
              <span className="purchase-credit-update-type">
                <span className="purchase-credit-update-type-label">Bill</span>
                <strong>{creditUpdateInfo.billLabel}</strong>
              </span>
              <span className="purchase-credit-update-type">
                <span className="purchase-credit-update-type-label">Pay</span>
                <strong>{creditUpdateInfo.payLabel}</strong>
              </span>
            </div>
          </div>
        ) : null}
        <p className="purchase-page-active-bill">
          {billMode === 'no1' ? purchaseBillLabel(1) : purchaseBillLabel(2)}
        </p>
      </header>

      <div className="purchase-entry-row">
        <div className="purchase-fields-stack">
          {renderNameField()}
          {renderDescriptionField()}
        </div>
        <div className="purchase-amount-side">
          <div
            className={`purchase-field-panel purchase-amount-panel ${
              activeField === 'amount' || activeField === 'bill'
                ? 'purchase-field-panel--active purchase-amount-panel--active'
                : ''
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
            <AmountDisplay
              label={splitMode ? 'Bill Amount' : 'Expense Amount'}
              value={bill.amountStr}
              active={activeField === 'amount'}
              onSelect={() => focusField('amount')}
              compact
            />
          </div>
        </div>
      </div>

      {splitMode ? (
        <div className={`expenses-top purchase-split-row ${topGridClass}`}>
          <AmountDisplay
            label="Cash"
            value={bill.cashSplitStr}
            active={activeField === 'cashSplit'}
            onSelect={() => focusField('cashSplit')}
            compact
          />
          <AmountDisplay
            label="Credit"
            value={bill.creditSplitStr}
            active={activeField === 'creditSplit'}
            onSelect={() => focusField('creditSplit')}
            compact
          />
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
          />
        </div>
      </div>

      {hasBill1 || hasBill2 ? (
        <div className="purchase-bill-total purchase-bill-total--static">
          <span>
            No 1 {formatMoney(bill1Amount)} + No 2 {formatMoney(bill2Amount)}
          </span>
          <strong>Total {formatMoney(purchaseTotal)}</strong>
        </div>
      ) : null}

      {splitMode && amount > 0 ? (
        <div
          className={`expenses-split-total ${splitShortfall > 0 || splitExcess > 0 ? 'expenses-split-total--warn' : ''}`}
        >
          <span>Paid Total</span>
          <strong>
            {formatMoney(splitPaidTotal)} / {formatMoney(amount)}
            {splitShortfall > 0 ? ` · need ${formatMoney(splitShortfall)}` : null}
            {splitExcess > 0 ? ` · over ${formatMoney(splitExcess)}` : null}
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
        onOpenBill={(expenseId) => {
          setShowPurchaseHistory(false)
          loadPurchaseBill(expenseId, 'open')
        }}
        onUpdateBill={(expenseId) => {
          setShowPurchaseHistory(false)
          loadPurchaseBill(expenseId, 'update')
        }}
      />
    </div>
  )
}
