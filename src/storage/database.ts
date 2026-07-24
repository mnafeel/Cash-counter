import type { AppData, AppTheme, Expense, PayType, ReminderAlertSettings, Sale, SupplierEntry, TransferDirection, CustomerReminderMap } from '../types'
import { DEFAULT_REMINDER_ALERTS, STORAGE_KEY } from '../types'
import { collectSplitNameTargets } from '../utils/saleCustomerName'
import { stripExpenseBillSuffix, isPurchaseExpense } from '../utils/expenseBillLabels'
import {
  buildCreditPaymentUpdate,
  isPurchaseCreditExpense,
  type CreditPaymentInput,
} from '../utils/purchaseHistory'
import { notifyDataChanged } from '../firebase/sync'
import { applyStoredCustomerReminderToSale, listOpenBillIdsForCustomer } from '../utils/customerReminders'
import type { BillReminderKind } from '../utils/billReminders'
import {
  appendSalePaymentEvent,
  buildIncrementalPaymentEvent,
  migrateSalePaymentEvents,
  priorPaymentEventsFromSale,
  saleCollectedAmount,
  salePendingCreditPaidBreakdown,
} from '../utils/salePayment'
import type { SalePaymentEvent } from '../types'
import { normalizePin } from '../utils/numpad'
import { normalizeTheme } from '../utils/theme'

const defaultData: AppData = {
  openingBalance: 0,
  openingBankBalance: 0,
  homePin: '0000',
  theme: 'premium',
  suppliers: [],
  sales: [],
  expenses: [],
}

function normalizeItemList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    seen.set(trimmed.toLowerCase(), trimmed)
  }
  return Array.from(seen.values())
}

export function normalizeSuppliers(raw: unknown): SupplierEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, SupplierEntry>()
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, { name: trimmed, items: [] })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<SupplierEntry>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    const prev = seen.get(key)
    const items = normalizeItemList(record.items)
    const mergedItems = new Map<string, string>()
    for (const label of [...(prev?.items ?? []), ...items]) {
      mergedItems.set(label.toLowerCase(), label)
    }
    seen.set(key, { name, items: Array.from(mergedItems.values()) })
  }
  return Array.from(seen.values())
}

export function ensureSupplierInData(data: AppData, rawName: string): AppData {
  const name = stripExpenseBillSuffix(rawName.trim())
  if (!name) return data
  const key = name.toLowerCase()
  const existing = normalizeSuppliers(data.suppliers)
  if (existing.some((supplier) => supplier.name.toLowerCase() === key)) return data
  return { ...data, suppliers: [{ name, items: [] }, ...existing] }
}

export function addSupplier(data: AppData, rawName: string): AppData {
  const next = ensureSupplierInData(data, rawName)
  if (next === data) return data
  saveData(next)
  return next
}

export function addSupplierItem(data: AppData, rawName: string, item: string): AppData {
  const supplierName = stripExpenseBillSuffix(rawName.trim())
  const itemLabel = item.trim()
  if (!supplierName || !itemLabel) return data

  const key = supplierName.toLowerCase()
  const itemKey = itemLabel.toLowerCase()
  let suppliers = normalizeSuppliers(data.suppliers)
  const index = suppliers.findIndex((supplier) => supplier.name.toLowerCase() === key)

  if (index < 0) {
    suppliers = [{ name: supplierName, items: [itemLabel] }, ...suppliers]
  } else {
    const entry = suppliers[index]
    const items = entry.items ?? []
    if (items.some((label) => label.toLowerCase() === itemKey)) return data
    suppliers = [...suppliers]
    suppliers[index] = { ...entry, items: [itemLabel, ...items] }
  }

  const next = { ...data, suppliers }
  saveData(next)
  return next
}

function normalizeCustomerReminders(raw: unknown): CustomerReminderMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const map: CustomerReminderMap = {}
  for (const [name, entry] of Object.entries(raw as CustomerReminderMap)) {
    const trimmed = name.trim()
    if (!trimmed || !entry || typeof entry !== 'object') continue
    const creditReminderAt =
      typeof entry.creditReminderAt === 'string' ? entry.creditReminderAt : undefined
    const creditReminderNote =
      typeof entry.creditReminderNote === 'string' ? entry.creditReminderNote.trim() || undefined : undefined
    const chequeReminderAt =
      typeof entry.chequeReminderAt === 'string' ? entry.chequeReminderAt : undefined
    const chequeReminderNote =
      typeof entry.chequeReminderNote === 'string' ? entry.chequeReminderNote.trim() || undefined : undefined
    if (!creditReminderAt && !chequeReminderAt) continue
    map[trimmed] = {
      creditReminderAt,
      creditReminderNote,
      chequeReminderAt,
      chequeReminderNote,
    }
  }
  return Object.keys(map).length > 0 ? map : undefined
}

export function normalizeData(parsed: Partial<AppData>): AppData {
  const alerts = parsed.reminderAlerts
  return {
    openingBalance: parsed.openingBalance ?? 0,
    openingBankBalance: parsed.openingBankBalance ?? 0,
    homePin: normalizePin(parsed.homePin, '0000'),
    theme: normalizeTheme(parsed.theme),
    suppliers: normalizeSuppliers(parsed.suppliers),
    reminderAlerts: {
      creditDaysBefore: Math.max(0, alerts?.creditDaysBefore ?? DEFAULT_REMINDER_ALERTS.creditDaysBefore),
      chequeDaysBefore: Math.max(0, alerts?.chequeDaysBefore ?? DEFAULT_REMINDER_ALERTS.chequeDaysBefore),
      alertIntervalDays: Math.max(1, alerts?.alertIntervalDays ?? DEFAULT_REMINDER_ALERTS.alertIntervalDays),
      notificationShowSeconds: Math.max(
        0,
        alerts?.notificationShowSeconds ?? DEFAULT_REMINDER_ALERTS.notificationShowSeconds,
      ),
      notificationSoundEnabled:
        alerts?.notificationSoundEnabled ?? DEFAULT_REMINDER_ALERTS.notificationSoundEnabled,
    },
    customerReminders: normalizeCustomerReminders(parsed.customerReminders),
    sales: (parsed.sales ?? []).map((sale) => migrateSalePaymentEvents(sale)),
    expenses: (parsed.expenses ?? []).map((e) => ({
      ...e,
      name: e.name ?? e.note ?? 'Expense',
      payType: e.payType === 'bank' ? 'bank' : 'cash',
      kind:
        e.kind === 'add' ? 'add' : e.kind === 'transfer' ? 'transfer' : 'expense',
      transferDirection:
        e.kind === 'transfer'
          ? e.transferDirection === 'bank-to-cash'
            ? 'bank-to-cash'
            : 'cash-to-bank'
          : undefined,
    })),
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultData }
    const parsed = JSON.parse(raw) as AppData
    const normalized = normalizeData(parsed)
    const migrated = (parsed.sales ?? []).some((sale, index) => {
      const next = normalized.sales[index]
      return JSON.stringify(sale.paymentEvents ?? null) !== JSON.stringify(next?.paymentEvents ?? null)
    })
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
      notifyDataChanged(normalized)
    }
    return normalized
  } catch {
    return { ...defaultData }
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  notifyDataChanged(data)
}

export function replaceData(data: AppData): AppData {
  const next = normalizeData(data)
  saveData(next)
  return next
}

/** Wipe local counter data — used on cloud logout. Does not trigger cloud backup. */
export function clearAllLocalData(): AppData {
  const next = { ...defaultData }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function splitSaleBankAmount(sale: Sale): number {
  const bank = sale.bankAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  if (!sale.chequeApproved || cheque <= 0) return bank
  const bankOnly = bank >= cheque ? bank - cheque : bank
  return bankOnly + cheque
}

function saleCashToDrawer(sale: Sale): number {
  if (sale.status === 'pending') {
    return salePendingCreditPaidBreakdown(sale).cash
  }
  if (sale.payType === 'bank' || sale.payType === 'credit' || sale.payType === 'cheque') return 0
  if (sale.payType === 'split') return sale.cashAmount ?? 0
  if ((sale.cashAmount ?? 0) > 0) return sale.cashAmount ?? 0
  return sale.billAmount
}

export function getPendingBills(data: AppData): Sale[] {
  return data.sales
    .filter((s) => s.status === 'pending')
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

function splitExpenseBankAmount(expense: Expense): number {
  const bank = expense.bankAmount ?? 0
  const cheque = expense.chequeAmount ?? 0
  if (!expense.chequeApproved || cheque <= 0) return bank
  const bankOnly = bank >= cheque ? bank - cheque : bank
  return bankOnly + cheque
}

function expenseCashToDrawer(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return expense.amount
    if (expense.transferDirection === 'bank-to-cash') return -expense.amount
    return 0
  }
  if (expense.payType === 'bank' || expense.payType === 'cheque') return 0
  if (expense.payType === 'split') {
    const cash = expense.cashAmount ?? 0
    return expense.kind === 'add' ? -cash : cash
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

function saleBankToBalance(sale: Sale): number {
  if (sale.status === 'pending') {
    const { bank, cheque } = salePendingCreditPaidBreakdown(sale)
    return bank + cheque
  }
  if (sale.payType === 'bank' || sale.payType === 'cheque') return sale.billAmount
  if (sale.payType === 'split') return splitSaleBankAmount(sale)
  return 0
}

function expenseBankToBalance(expense: Expense): number {
  if (expense.kind === 'transfer') {
    if (expense.transferDirection === 'cash-to-bank') return -expense.amount
    if (expense.transferDirection === 'bank-to-cash') return expense.amount
    return 0
  }
  if (expense.payType === 'cash') return 0
  if (expense.payType === 'cheque') {
    if (!expense.chequeApproved) return 0
    const cheque = expense.chequeAmount ?? expense.amount
    return expense.kind === 'add' ? -cheque : cheque
  }
  if (expense.payType === 'split') {
    const bank = splitExpenseBankAmount(expense)
    return expense.kind === 'add' ? -bank : bank
  }
  return expense.kind === 'add' ? -expense.amount : expense.amount
}

export function getBankBalance(data: AppData): number {
  const salesTotal = data.sales.reduce((sum, s) => sum + saleBankToBalance(s), 0)
  const expensesTotal = data.expenses.reduce((sum, e) => sum + expenseBankToBalance(e), 0)
  return (data.openingBankBalance ?? 0) + salesTotal - expensesTotal
}

export function getCurrentBalance(data: AppData): number {
  const salesTotal = data.sales.reduce((sum, s) => sum + saleCashToDrawer(s), 0)
  const expensesTotal = data.expenses.reduce((sum, e) => sum + expenseCashToDrawer(e), 0)
  return data.openingBalance + salesTotal - expensesTotal
}

export function addSale(
  data: AppData,
  sale: Omit<Sale, 'id' | 'createdAt'> & { id?: string },
): AppData {
  const presetId = sale.id
  const { id: _id, ...rest } = sale
  const now = new Date().toISOString()
  const newSale: Sale = applyStoredCustomerReminderToSale(data, {
    ...rest,
    status: rest.status ?? 'paid',
    id: presetId ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: (rest.status ?? 'paid') === 'paid' ? now : rest.updatedAt,
  })
  const next = { ...data, sales: [newSale, ...data.sales] }
  saveData(next)
  return next
}

/**
 * Import a Tally sales voucher as a pending bill (party name + amount).
 * De-duplicates on sourceId. Does not persist — use importTallyBills for batch save.
 */
export function addTallyPendingBill(
  data: AppData,
  bill: { sourceId: string; billAmount: number; customerName?: string; createdAt?: string },
): AppData {
  if (!bill.sourceId || !(bill.billAmount > 0)) return data
  if (data.sales.some((s) => s.source === 'tally' && s.sourceId === bill.sourceId)) {
    return data
  }
  const now = new Date().toISOString()
  const newSale: Sale = {
    id: crypto.randomUUID(),
    billAmount: bill.billAmount,
    paidAmount: 0,
    changeAmount: 0,
    status: 'pending',
    payType: 'credit',
    pendingPayType: 'credit',
    customerName: bill.customerName?.trim() || undefined,
    source: 'tally',
    sourceId: bill.sourceId,
    createdAt: bill.createdAt ?? now,
    updatedAt: now,
  }
  return { ...data, sales: [newSale, ...data.sales] }
}

export function importTallyBills(
  data: AppData,
  bills: { sourceId: string; billAmount: number; customerName?: string; createdAt?: string }[],
): AppData {
  let next = data
  for (const bill of bills) {
    next = addTallyPendingBill(next, bill)
  }
  if (next !== data) saveData(next)
  return next
}

function mergePreservedTallyPending(local: AppData, restored: AppData): AppData {
  const restoredIds = new Set(
    restored.sales
      .filter((s) => s.source === 'tally' && s.sourceId)
      .map((s) => s.sourceId as string),
  )
  const extra = local.sales.filter(
    (s) =>
      s.status === 'pending' &&
      s.source === 'tally' &&
      s.sourceId &&
      !restoredIds.has(s.sourceId),
  )
  if (extra.length === 0) return restored
  return { ...restored, sales: [...extra, ...restored.sales] }
}

export function replaceDataPreservingTallyPending(local: AppData, restored: AppData): AppData {
  return replaceData(mergePreservedTallyPending(local, restored))
}

export function addTransfer(
  data: AppData,
  transfer: { amount: number; name: string; direction: TransferDirection },
): AppData {
  const newTransfer: Expense = {
    id: crypto.randomUUID(),
    amount: transfer.amount,
    name: transfer.name.trim(),
    payType: transfer.direction === 'cash-to-bank' ? 'cash' : 'bank',
    kind: 'transfer',
    transferDirection: transfer.direction,
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, expenses: [newTransfer, ...data.expenses] }
  saveData(next)
  return next
}

export function addExpense(data: AppData, expense: Omit<Expense, 'id' | 'createdAt'>): AppData {
  const newExpense: Expense = {
    ...expense,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const next = { ...data, expenses: [newExpense, ...data.expenses] }
  saveData(next)
  return next
}

export function addExpenseBatch(
  data: AppData,
  expenses: Omit<Expense, 'id' | 'createdAt' | 'pairedExpenseId'>[],
): AppData {
  if (expenses.length === 0) return data
  const now = new Date().toISOString()
  const ids = expenses.map(() => crypto.randomUUID())
  const newExpenses: Expense[] = expenses.map((expense, index) => ({
    ...expense,
    id: ids[index],
    createdAt: now,
    billNumber:
      expense.billNumber ??
      (expenses.length > 1 ? ((index === 0 ? 1 : 2) as 1 | 2) : undefined),
    pairedExpenseId: expenses.length > 1 ? ids[1 - index] : undefined,
  }))
  const next = { ...data, expenses: [...newExpenses, ...data.expenses] }
  const supplierName = stripExpenseBillSuffix(expenses[0]?.name?.trim() ?? '')
  const withSupplier = supplierName ? ensureSupplierInData(next, supplierName) : next
  const description = expenses[0]?.description?.trim()
  const withItem =
    supplierName && description
      ? addSupplierItem(withSupplier, supplierName, description)
      : withSupplier
  saveData(withItem)
  return withItem
}

export function setTheme(data: AppData, theme: AppTheme): AppData {
  const next = { ...data, theme }
  saveData(next)
  return next
}

export function setOpeningBankBalance(data: AppData, amount: number): AppData {
  const next = { ...data, openingBankBalance: amount }
  saveData(next)
  return next
}

export function setHomePin(data: AppData, pin: string): AppData {
  const next = { ...data, homePin: normalizePin(pin, '0000') }
  saveData(next)
  return next
}

export function setOpeningBalance(data: AppData, amount: number): AppData {
  const next = { ...data, openingBalance: amount }
  saveData(next)
  return next
}

export function deleteSale(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const idsToRemove = new Set<string>()

  function addSaleTree(saleId: string) {
    if (!saleId || saleId.startsWith('split-group-')) return
    const sale = data.sales.find((s) => s.id === saleId)
    if (!sale || idsToRemove.has(saleId)) return
    idsToRemove.add(saleId)
    for (const child of data.sales) {
      if (child.parentSplitId === saleId) addSaleTree(child.id)
    }
  }

  if (relatedSaleIds?.length) {
    for (const saleId of relatedSaleIds) addSaleTree(saleId)
  } else {
    addSaleTree(id)
  }

  // Orphan split children share a parentSplitId with no parent sale — remove the whole group.
  for (const saleId of [...idsToRemove]) {
    const sale = data.sales.find((s) => s.id === saleId)
    const parentId = sale?.parentSplitId
    if (!parentId || data.sales.some((s) => s.id === parentId)) continue
    for (const sibling of data.sales) {
      if (sibling.parentSplitId === parentId) addSaleTree(sibling.id)
    }
  }

  if (idsToRemove.size === 0) return data

  const next = { ...data, sales: data.sales.filter((s) => !idsToRemove.has(s.id)) }
  saveData(next)
  return next
}

export function deleteExpense(data: AppData, id: string): AppData {
  const next = { ...data, expenses: data.expenses.filter((e) => e.id !== id) }
  saveData(next)
  return next
}

export function updateSaleCustomerName(
  data: AppData,
  id: string,
  customerName: string,
  relatedSaleIds?: string[],
): AppData {
  const trimmed = customerName.trim()
  const now = new Date().toISOString()
  const targets = new Set<string>()

  if (data.sales.some((sale) => sale.id === id)) {
    for (const saleId of collectSplitNameTargets(data, id)) targets.add(saleId)
  }

  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((sale) => sale.id === saleId)) {
        for (const relatedId of collectSplitNameTargets(data, saleId)) {
          targets.add(relatedId)
        }
      }
    }
  }

  if (targets.size === 0) return data

  const next = {
    ...data,
    sales: data.sales.map((s) =>
      targets.has(s.id)
        ? {
            ...s,
            customerName: trimmed || undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

export function updatePendingBill(
  data: AppData,
  id: string,
  updates: {
    billAmount: number
    originalBillAmount?: number
    customerName?: string
    payType?: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    creditAmount?: number
    pendingPayType?: PayType
    paidAmount?: number
  },
): AppData {
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id && s.status === 'pending'
        ? {
            ...s,
            billAmount: updates.billAmount,
            originalBillAmount: updates.originalBillAmount ?? s.originalBillAmount,
            customerName: updates.customerName ?? s.customerName,
            payType: updates.payType ?? s.payType,
            pendingPayType: updates.pendingPayType ?? s.pendingPayType,
            cashAmount:
              updates.cashAmount !== undefined
                ? updates.cashAmount
                : updates.payType === 'split'
                  ? updates.cashAmount
                  : updates.payType === 'credit' || s.payType === 'credit'
                    ? s.cashAmount
                    : undefined,
            bankAmount:
              updates.bankAmount !== undefined
                ? updates.bankAmount
                : updates.payType === 'split'
                  ? updates.bankAmount
                  : updates.payType === 'credit' || s.payType === 'credit'
                    ? s.bankAmount
                    : undefined,
            chequeAmount:
              updates.chequeAmount !== undefined
                ? updates.chequeAmount
                : updates.payType === 'split'
                  ? updates.chequeAmount
                  : updates.payType === 'cheque' ||
                      (updates.payType == null &&
                        (s.payType === 'cheque' || s.pendingPayType === 'cheque'))
                    ? updates.billAmount
                    : updates.payType === 'credit' || s.payType === 'credit'
                      ? s.chequeAmount
                      : undefined,
            creditAmount:
              updates.creditAmount !== undefined
                ? updates.creditAmount
                : updates.payType === 'split'
                  ? updates.creditAmount
                  : updates.payType === 'credit' ||
                      (updates.payType == null &&
                        (s.payType === 'credit' || s.pendingPayType === 'credit'))
                    ? updates.billAmount
                    : undefined,
            chequeApproved:
              updates.payType === 'cheque' ||
              (updates.payType == null && (s.payType === 'cheque' || s.pendingPayType === 'cheque'))
                ? s.chequeApproved
                : updates.payType === 'credit'
                  ? undefined
                  : s.chequeApproved,
            paidAmount: updates.paidAmount ?? s.paidAmount,
            updatedAt: new Date().toISOString(),
          }
        : s,
    ),
  }
  const updated = next.sales.find((s) => s.id === id)
  if (
    updated &&
    updated.parentSplitId &&
    isCreditPendingSale(updated)
  ) {
    const synced = syncParentSplitCreditAmount(next, updated, updates.billAmount)
    saveData(synced)
    return synced
  }
  saveData(next)
  return next
}

export function setSaleReminder(
  data: AppData,
  id: string,
  reminderAt: string | null,
  reminderNote?: string | null,
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || sale.status !== 'pending') return data

  const next: AppData = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id
        ? {
            ...s,
            reminderAt: reminderAt ?? undefined,
            reminderNote: reminderAt ? reminderNote?.trim() || undefined : undefined,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

export function setCustomerReminder(
  data: AppData,
  customerName: string,
  kind: Extract<BillReminderKind, 'credit' | 'cheque'>,
  reminderAt: string | null,
  reminderNote?: string | null,
): AppData {
  const trimmed = customerName.trim()
  if (!trimmed) return data

  const trimmedNote = reminderNote?.trim() || undefined

  const existing = { ...(data.customerReminders ?? {}) }
  const entry = { ...(existing[trimmed] ?? {}) }
  if (kind === 'credit') {
    if (reminderAt) {
      entry.creditReminderAt = reminderAt
      entry.creditReminderNote = trimmedNote
    } else {
      delete entry.creditReminderAt
      delete entry.creditReminderNote
    }
  } else {
    if (reminderAt) {
      entry.chequeReminderAt = reminderAt
      entry.chequeReminderNote = trimmedNote
    } else {
      delete entry.chequeReminderAt
      delete entry.chequeReminderNote
    }
  }

  if (!entry.creditReminderAt && !entry.chequeReminderAt) delete existing[trimmed]
  else existing[trimmed] = entry

  let next: AppData = {
    ...data,
    customerReminders: Object.keys(existing).length > 0 ? existing : undefined,
  }

  const billIds = new Set(listOpenBillIdsForCustomer(next, trimmed, kind))
  if (billIds.size > 0) {
    next = {
      ...next,
      sales: next.sales.map((s) =>
        billIds.has(s.id)
          ? {
              ...s,
              reminderAt: reminderAt ?? undefined,
              reminderNote: reminderAt ? trimmedNote : undefined,
            }
          : s,
      ),
    }
  }

  saveData(next)
  return next
}

export function setReminderAlertSettings(
  data: AppData,
  settings: ReminderAlertSettings,
): AppData {
  const next: AppData = {
    ...data,
    reminderAlerts: {
      creditDaysBefore: Math.max(0, settings.creditDaysBefore),
      chequeDaysBefore: Math.max(0, settings.chequeDaysBefore),
      alertIntervalDays: Math.max(1, settings.alertIntervalDays),
      notificationShowSeconds: Math.max(0, settings.notificationShowSeconds),
      notificationSoundEnabled: settings.notificationSoundEnabled,
    },
  }
  saveData(next)
  return next
}

export function isApprovedChequeSale(sale: Sale): boolean {
  return getApprovedChequeAmount(sale) > 0
}

export function getApprovedChequeAmount(sale: Sale): number {
  if (sale.chequeApproved && (sale.chequeAmount ?? 0) > 0) {
    return sale.chequeAmount ?? 0
  }
  if (sale.status === 'paid' && sale.payType === 'cheque') {
    return sale.chequeAmount ?? sale.billAmount
  }
  return 0
}

export function listApprovedCheques(data: AppData): Sale[] {
  return data.sales
    .filter(isApprovedChequeSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

export function listPendingCreditSales(data: AppData): Sale[] {
  return data.sales
    .filter(isPendingCreditSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

export function listPendingChequeSales(data: AppData): Sale[] {
  return data.sales
    .filter(isPendingChequeSale)
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime(),
    )
}

/** Clear open customer credit — deletes unpaid bills or finalizes partial collections. */
export function cancelSaleCredit(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isPendingCreditSale(sale)) return data

  const collected = saleCollectedAmount(sale)
  if (collected <= 0) {
    let next = deleteSale(data, id, relatedSaleIds)
    if (sale.parentSplitId) {
      next = syncParentSplitCreditAmount(next, sale, 0)
      saveData(next)
    }
    return next
  }

  const cash = sale.cashAmount ?? 0
  const bank = sale.bankAmount ?? 0
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  const originalBillAmount = sale.originalBillAmount ?? sale.billAmount + collected

  return collectPendingBill(data, id, {
    billAmount: originalBillAmount,
    originalBillAmount,
    paidAmount: collected,
    changeAmount: 0,
    payType: payTypeFromCollectedTotals(cash, bank, cheque, 'cash'),
    cashAmount: cash || undefined,
    bankAmount: bank || undefined,
    chequeAmount: cheque || undefined,
    chequeApproved: cheque > 0 ? true : undefined,
    customerName: sale.customerName,
  })
}

/** Clear open cheque bill — deletes unpaid bills or finalizes partial collections. */
export function cancelSaleCheque(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isPendingChequeSale(sale)) return data

  const collected = saleCollectedAmount(sale)
  if (collected <= 0) {
    return deleteSale(data, id, relatedSaleIds)
  }

  const cash = sale.cashAmount ?? 0
  const bank = sale.bankAmount ?? 0
  const cheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0
  const originalBillAmount = sale.originalBillAmount ?? sale.billAmount + collected

  return collectPendingBill(data, id, {
    billAmount: originalBillAmount,
    originalBillAmount,
    paidAmount: collected,
    changeAmount: 0,
    payType: payTypeFromCollectedTotals(cash, bank, cheque, 'cheque'),
    cashAmount: cash || undefined,
    bankAmount: bank || undefined,
    chequeAmount: cheque || undefined,
    chequeApproved: cheque > 0 ? true : undefined,
    customerName: sale.customerName,
  })
}

function revertPendingPayTypes(sale: Sale): { payType: PayType; pendingPayType: PayType } {
  if (sale.pendingPayType === 'credit') {
    return { payType: 'credit', pendingPayType: 'credit' }
  }
  return { payType: 'cheque', pendingPayType: 'cheque' }
}

export function cancelApprovedCheque(data: AppData, id: string): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale || !isApprovedChequeSale(sale)) return data

  const now = new Date().toISOString()
  const chequeAmt = getApprovedChequeAmount(sale)
  if (chequeAmt <= 0) return data

  if (sale.status === 'pending' && sale.chequeApproved) {
    const cash = sale.cashAmount ?? 0
    const bank = Math.max(0, (sale.bankAmount ?? 0) - chequeAmt)
    const totalPaid = cash + bank
    let next: AppData = {
      ...data,
      sales: data.sales.map((s) =>
        s.id === id
          ? {
              ...s,
              chequeAmount: undefined,
              chequeApproved: undefined,
              bankAmount: bank > 0 ? bank : undefined,
              paidAmount: totalPaid,
              updatedAt: now,
            }
          : s,
      ),
    }
    const updated = next.sales.find((s) => s.id === id)
    if (updated?.parentSplitId && isPendingCreditSale(updated)) {
      next = syncParentSplitCreditAmount(next, updated, updated.billAmount)
    }
    saveData(next)
    return next
  }

  if (sale.payType === 'split') {
    const bankOnly = Math.max(0, (sale.bankAmount ?? 0) - chequeAmt)
    const pendingCheque: Sale = {
      id: crypto.randomUUID(),
      billAmount: chequeAmt,
      originalBillAmount: sale.originalBillAmount ?? sale.billAmount,
      paidAmount: 0,
      changeAmount: 0,
      payType: 'cheque',
      pendingPayType: 'cheque',
      parentSplitId: sale.id,
      customerName: sale.customerName,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }

    const next = {
      ...data,
      sales: [
        pendingCheque,
        ...data.sales.map((s) =>
          s.id === id
            ? {
                ...s,
                bankAmount: bankOnly > 0 ? bankOnly : undefined,
                chequeAmount: undefined,
                chequeApproved: undefined,
                updatedAt: now,
              }
            : s,
        ),
      ],
    }
    saveData(next)
    return next
  }

  const revert = revertPendingPayTypes(sale)
  const reopenDue = revert.pendingPayType === 'credit'
    ? sale.originalBillAmount ?? sale.billAmount
    : chequeAmt
  const next = {
    ...data,
    sales: data.sales.map((s) =>
      s.id === id
        ? {
            ...s,
            status: 'pending' as const,
            payType: revert.payType,
            pendingPayType: revert.pendingPayType,
            billAmount: reopenDue,
            originalBillAmount: s.originalBillAmount,
            paidAmount: 0,
            changeAmount: 0,
            chequeApproved: undefined,
            bankAmount: undefined,
            cashAmount: undefined,
            chequeAmount: revert.payType === 'cheque' ? reopenDue : undefined,
            creditAmount: revert.pendingPayType === 'credit' ? reopenDue : undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
  saveData(next)
  return next
}

/** Record a partial collection against a pending credit sale — keeps balance open. */
function payTypeFromCollectedTotals(
  cash: number,
  bank: number,
  cheque: number,
  fallback: PayType,
): PayType {
  const modes = [cash > 0, bank > 0, cheque > 0].filter(Boolean).length
  if (modes > 1) return 'split'
  if (cash > 0) return 'cash'
  if (bank > 0) return 'bank'
  if (cheque > 0) return 'cheque'
  return fallback
}

function syncParentSplitCreditAmount(
  data: AppData,
  creditSale: Sale,
  remainingCredit: number,
): AppData {
  if (!creditSale.parentSplitId) return data

  const now = new Date().toISOString()
  return {
    ...data,
    sales: data.sales.map((s) =>
      s.id === creditSale.parentSplitId
        ? {
            ...s,
            creditAmount: remainingCredit > 0 ? remainingCredit : undefined,
            updatedAt: now,
          }
        : s,
    ),
  }
}

export function isPendingCreditSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'credit' || sale.payType === 'credit')
  )
}

export function isPendingChequeSale(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.pendingPayType === 'cheque' || sale.payType === 'cheque')
  )
}

export function isPendingBalanceSale(sale: Sale): boolean {
  return isPendingCreditSale(sale) || isPendingChequeSale(sale)
}

export type BillCreatePayType = Extract<PayType, 'cash' | 'bank' | 'credit' | 'cheque'>

export function saleBillCreatePayType(sale: Sale): BillCreatePayType {
  if (sale.pendingPayType === 'credit' || (sale.status === 'pending' && sale.payType === 'credit')) {
    return 'credit'
  }
  if (sale.pendingPayType === 'cheque' || (sale.status === 'pending' && sale.payType === 'cheque')) {
    return 'cheque'
  }
  if (sale.payType === 'bank') return 'bank'
  if (sale.payType === 'cheque') return 'cheque'
  if (sale.payType === 'credit') return 'credit'
  return 'cash'
}

function applyPaidBillPayType(sale: Sale, payType: BillCreatePayType, billAmount: number): Sale {
  const amount = billAmount
  const paidAmount = sale.paidAmount > 0 ? sale.paidAmount : amount
  const base: Sale = {
    ...sale,
    payType,
    billAmount: amount,
    paidAmount,
    pendingPayType: undefined,
    status: 'paid',
    cashAmount: undefined,
    bankAmount: undefined,
    chequeAmount: undefined,
    creditAmount: undefined,
    chequeApproved: undefined,
    updatedAt: new Date().toISOString(),
  }

  if (payType === 'cash') {
    return { ...base, changeAmount: Math.max(0, paidAmount - amount) }
  }
  if (payType === 'bank') {
    return { ...base, bankAmount: amount, changeAmount: 0 }
  }
  if (payType === 'cheque') {
    return {
      ...base,
      bankAmount: amount,
      chequeAmount: amount,
      chequeApproved: true,
      changeAmount: 0,
    }
  }
  return { ...base, changeAmount: 0 }
}

function isCreditPendingSale(sale: Sale): boolean {
  return isPendingCreditSale(sale)
}

export function applyPartialBalanceSaleCollection(
  data: AppData,
  id: string,
  payment: {
    collected: number
    payType: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    chequeApproved?: boolean
    customerName?: string
    changeAmount?: number
  },
): AppData {
  const sale = data.sales.find((s) => s.id === id && s.status === 'pending')
  if (!sale || !isPendingBalanceSale(sale)) return data

  const isCheque = isPendingChequeSale(sale)

  const due = sale.billAmount
  const collected = Math.min(Math.max(0, payment.collected), due)
  if (collected <= 0) return data

  const remaining = due - collected
  const now = new Date().toISOString()
  const prevCash = sale.cashAmount ?? 0
  const prevBank = sale.bankAmount ?? 0
  const prevCheque =
    sale.chequeApproved && (sale.chequeAmount ?? 0) > 0 ? sale.chequeAmount ?? 0 : 0

  const addCash = payment.cashAmount ?? (payment.payType === 'cash' ? collected : 0)
  const addBank = payment.bankAmount ?? (payment.payType === 'bank' ? collected : 0)
  const addCheque =
    payment.payType === 'cheque' && payment.chequeApproved
      ? payment.chequeAmount ?? collected
      : payment.chequeApproved
        ? payment.chequeAmount ?? 0
        : 0

  const totalCash = prevCash + addCash
  const totalBank = prevBank + addBank
  const totalCheque = prevCheque + addCheque
  const totalPaid = totalCash + totalBank + totalCheque
  const paymentEvent = {
    at: now,
    amount: collected,
    cash: addCash,
    bank: addBank,
    cheque: addCheque,
  }

  if (remaining <= 0) {
    const originalBillAmount = sale.originalBillAmount ?? due + (totalPaid - collected)
    const settledPayType = payTypeFromCollectedTotals(
      totalCash,
      totalBank,
      totalCheque,
      payment.payType,
    )
    return collectPendingBill(data, id, {
      billAmount: originalBillAmount,
      originalBillAmount,
      paidAmount: totalPaid,
      changeAmount: payment.changeAmount ?? 0,
      payType: settledPayType,
      cashAmount: totalCash || undefined,
      bankAmount: totalBank || undefined,
      chequeAmount: totalCheque || undefined,
      chequeApproved: totalCheque > 0 ? true : undefined,
      customerName: payment.customerName,
    }, paymentEvent)
  }

  const balancePayType = isCheque ? 'cheque' : 'credit'
  const patched: Sale = appendSalePaymentEvent(
    {
      ...sale,
      billAmount: remaining,
      originalBillAmount: sale.originalBillAmount ?? remaining + totalPaid,
      paidAmount: totalPaid,
      payType: balancePayType,
      pendingPayType: balancePayType,
      cashAmount: totalCash || undefined,
      bankAmount: totalBank || undefined,
      chequeAmount: totalCheque || undefined,
      chequeApproved: totalCheque > 0 ? payment.chequeApproved ?? true : sale.chequeApproved,
      creditAmount: isCheque ? undefined : remaining,
      customerName: payment.customerName ?? sale.customerName,
      status: 'pending',
      updatedAt: now,
    },
    paymentEvent,
  )

  let next: AppData = {
    ...data,
    sales: data.sales.map((s) => (s.id === id ? patched : s)),
  }
  if (!isCheque) {
    next = syncParentSplitCreditAmount(next, patched, remaining)
  }
  saveData(next)
  return next
}

/** @deprecated Use applyPartialBalanceSaleCollection */
export const applyPartialCreditSaleCollection = applyPartialBalanceSaleCollection

function applyCreditPaymentFields(expense: Expense, updates: Partial<Expense>): Expense {
  const payType = updates.payType ?? expense.payType
  const patched: Expense = {
    ...expense,
    ...updates,
    payType,
    updatedAt: new Date().toISOString(),
  }

  if (payType === 'cash') {
    patched.cashAmount = undefined
    patched.bankAmount = undefined
    patched.creditAmount = undefined
    patched.chequeAmount = undefined
    patched.chequeApproved = undefined
    return patched
  }

  if (payType === 'bank') {
    patched.bankAmount = updates.bankAmount ?? expense.amount
    patched.cashAmount = undefined
    patched.creditAmount = undefined
    patched.chequeAmount = undefined
    patched.chequeApproved = undefined
    return patched
  }

  if (payType === 'cheque') {
    patched.chequeAmount = updates.chequeAmount ?? expense.amount
    patched.chequeApproved = updates.chequeApproved ?? true
    patched.cashAmount = undefined
    patched.bankAmount = undefined
    patched.creditAmount = undefined
    return patched
  }

  if (payType === 'split') {
    patched.cashAmount = updates.cashAmount
    patched.bankAmount = updates.bankAmount
    patched.creditAmount = updates.creditAmount
    patched.chequeAmount = updates.chequeAmount
    patched.chequeApproved = updates.chequeApproved
  }

  return patched
}

/** Apply supplier credit pay-down — merges paid cash/bank/cheque correctly. */
export function applyPurchaseCreditPayment(
  data: AppData,
  id: string,
  payment: CreditPaymentInput,
): AppData {
  const expense = data.expenses.find((e) => e.id === id)
  if (!expense || !isPurchaseExpense(expense) || !isPurchaseCreditExpense(expense)) {
    return data
  }

  const updates = buildCreditPaymentUpdate(expense, payment)
  const patched = applyCreditPaymentFields(expense, { ...updates, amount: expense.amount })

  let next: AppData = {
    ...data,
    expenses: data.expenses.map((e) => (e.id === id ? patched : e)),
  }

  const supplierName = stripExpenseBillSuffix(patched.name?.trim() ?? '')
  if (supplierName) next = ensureSupplierInData(next, supplierName)
  const item = patched.description?.trim()
  if (supplierName && item) next = addSupplierItem(next, supplierName, item)

  saveData(next)
  return next
}

export function collectPendingBill(
  data: AppData,
  id: string,
  sale: {
    billAmount: number
    originalBillAmount?: number
    paidAmount: number
    changeAmount: number
    payType: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    creditAmount?: number
    chequeApproved?: boolean
    customerName?: string
  },
  paymentEvent?: Omit<SalePaymentEvent, 'amount'> & { amount: number },
): AppData {
  const original = data.sales.find((s) => s.id === id && s.status === 'pending')
  const now = new Date().toISOString()
  const event: SalePaymentEvent =
    paymentEvent ?? buildIncrementalPaymentEvent(original, sale, now)
  const next = {
    ...data,
    sales: data.sales.map((s) => {
      if (s.id !== id || s.status !== 'pending') return s

      const settled: Sale = {
        ...s,
        ...sale,
        pendingPayType:
          s.pendingPayType ??
          (s.payType === 'credit' || s.payType === 'cheque' ? s.payType : undefined),
        status: 'paid' as const,
        creditAmount: sale.payType === 'split' ? sale.creditAmount : undefined,
        chequeApproved:
          sale.payType === 'split' || sale.payType === 'cheque'
            ? sale.chequeApproved ?? (sale.payType === 'cheque' ? true : undefined)
            : undefined,
        updatedAt: now,
      }

      if (event.amount > 0) {
        const priorEvents = original ? priorPaymentEventsFromSale(original) : (s.paymentEvents ?? [])
        return appendSalePaymentEvent({ ...settled, paymentEvents: priorEvents }, event)
      }
      const priorEvents = original ? priorPaymentEventsFromSale(original) : []
      return priorEvents.length > 0 ? { ...settled, paymentEvents: priorEvents } : settled
    }),
  }
  const settled = next.sales.find((s) => s.id === id)
  const synced =
    original?.parentSplitId && isCreditPendingSale(original) && settled
      ? syncParentSplitCreditAmount(next, settled, 0)
      : next
  saveData(synced)
  return synced
}

function defaultExpenseName(expense: Expense): string {
  if (expense.kind === 'add') return 'Added'
  if (expense.kind === 'transfer') return 'Transfer'
  return 'Expense'
}

function collectBillDateTargets(
  data: AppData,
  id: string,
  relatedSaleIds?: string[],
): Set<string> {
  const targets = new Set<string>([id])
  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (data.sales.some((s) => s.id === saleId)) targets.add(saleId)
    }
  }
  const sale = data.sales.find((s) => s.id === id)
  if (sale?.parentSplitId) targets.add(sale.parentSplitId)
  for (const child of data.sales) {
    if (child.parentSplitId === id) targets.add(child.id)
  }
  return targets
}

function applyBillCreatedAt(
  data: AppData,
  id: string,
  createdAt: string,
  relatedSaleIds?: string[],
): AppData {
  const targets = collectBillDateTargets(data, id, relatedSaleIds)
  return {
    ...data,
    sales: data.sales.map((s) => (targets.has(s.id) ? { ...s, createdAt } : s)),
  }
}

export function updateSaleBill(
  data: AppData,
  id: string,
  updates: {
    customerName?: string
    billAmount?: number
    originalBillAmount?: number
    paidCollected?: number
    payType?: BillCreatePayType
    pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
    createdAt?: string
  },
  relatedSaleIds?: string[],
): AppData {
  const sale = data.sales.find((s) => s.id === id)
  if (!sale) return data

  let working = updates.createdAt
    ? applyBillCreatedAt(data, id, updates.createdAt, relatedSaleIds)
    : data

  const customerName =
    updates.customerName !== undefined
      ? updates.customerName.trim() || undefined
      : sale.customerName

  const targetPayType = updates.payType ?? updates.pendingPayType

  if (sale.status === 'pending') {
    if (targetPayType === 'cash' || targetPayType === 'bank') {
      const total =
        updates.originalBillAmount != null && updates.originalBillAmount > 0
          ? updates.originalBillAmount
          : updates.billAmount != null && updates.billAmount > 0
            ? updates.billAmount
            : sale.originalBillAmount ?? sale.billAmount
      return collectPendingBill(working, id, {
        billAmount: total,
        originalBillAmount: total,
        paidAmount: total,
        changeAmount: 0,
        payType: targetPayType,
        cashAmount: targetPayType === 'cash' ? total : undefined,
        bankAmount: targetPayType === 'bank' ? total : undefined,
        customerName,
      })
    }

    const pendingPayType =
      targetPayType ??
      updates.pendingPayType ??
      sale.pendingPayType ??
      sale.payType
    const payType = targetPayType ?? updates.pendingPayType ?? sale.payType
    const isBalance = isPendingBalanceSale(sale) || payType === 'credit' || payType === 'cheque'

    let billAmount =
      updates.billAmount != null && updates.billAmount >= 0
        ? updates.billAmount
        : sale.billAmount
    let originalBillAmount =
      updates.originalBillAmount != null && updates.originalBillAmount > 0
        ? updates.originalBillAmount
        : sale.originalBillAmount ?? sale.billAmount

    let paidAmount = sale.paidAmount
    let cashAmount = sale.cashAmount
    let bankAmount = sale.bankAmount
    let chequeAmount = sale.chequeAmount
    let creditAmount: number | undefined

    if (isBalance && updates.paidCollected != null && updates.paidCollected >= 0) {
      const paid = Math.min(updates.paidCollected, originalBillAmount)
      paidAmount = paid
      if (paid !== saleCollectedAmount(sale)) {
        cashAmount = paid > 0 ? paid : undefined
        bankAmount = undefined
        chequeAmount = undefined
      }
      if (updates.billAmount == null) {
        billAmount = Math.max(0, originalBillAmount - paid)
      }
    }

    if (isBalance && updates.originalBillAmount != null && updates.originalBillAmount > 0) {
      originalBillAmount = updates.originalBillAmount
      if (updates.paidCollected == null && updates.billAmount == null) {
        billAmount = Math.max(0, originalBillAmount - saleCollectedAmount(sale))
      }
    }

    if (isBalance && updates.billAmount != null && updates.billAmount >= 0) {
      billAmount = updates.billAmount
      if (updates.originalBillAmount == null && updates.paidCollected == null) {
        const collected = saleCollectedAmount(sale)
        originalBillAmount = Math.max(billAmount + collected, billAmount)
      }
    }

    const resolvedPayType =
      payType === 'credit' || payType === 'cheque'
        ? payType
        : sale.payType === 'credit' || sale.payType === 'cheque'
          ? sale.payType
          : sale.payType
    const resolvedPending =
      pendingPayType === 'credit' || pendingPayType === 'cheque'
        ? pendingPayType
        : sale.pendingPayType

    if (resolvedPayType === 'credit') {
      creditAmount = billAmount
      chequeAmount = undefined
    } else if (resolvedPayType === 'cheque') {
      creditAmount = undefined
      chequeAmount = billAmount
    }

    return updatePendingBill(working, id, {
      billAmount,
      originalBillAmount,
      customerName,
      paidAmount,
      cashAmount,
      bankAmount,
      chequeAmount,
      creditAmount,
      payType: resolvedPayType,
      pendingPayType: resolvedPending,
    })
  }

  if (targetPayType) {
    const billAmount =
      updates.billAmount != null && updates.billAmount > 0
        ? updates.billAmount
        : sale.billAmount
    const now = new Date().toISOString()
    const nameTargets = new Set<string>()
    for (const saleId of collectSplitNameTargets(working, id)) nameTargets.add(saleId)
    if (relatedSaleIds) {
      for (const saleId of relatedSaleIds) {
        if (working.sales.some((s) => s.id === saleId)) {
          for (const relatedId of collectSplitNameTargets(working, saleId)) {
            nameTargets.add(relatedId)
          }
        }
      }
    }
    if (nameTargets.size === 0) nameTargets.add(id)

    const next = {
      ...working,
      sales: working.sales.map((s) => {
        if (!nameTargets.has(s.id) && s.id !== id) return s
        if (s.id !== id) {
          return customerName !== undefined
            ? { ...s, customerName, updatedAt: now }
            : s
        }
        let patched = applyPaidBillPayType(s, targetPayType, billAmount)
        if (customerName !== undefined) patched = { ...patched, customerName }
        if (updates.originalBillAmount != null && updates.originalBillAmount > 0) {
          patched = { ...patched, originalBillAmount: updates.originalBillAmount }
        }
        return patched
      }),
    }
    saveData(next)
    return next
  }

  const billAmount =
    updates.billAmount != null && updates.billAmount > 0 ? updates.billAmount : sale.billAmount

  const isSplitParent =
    sale.payType === 'split' || working.sales.some((s) => s.parentSplitId === sale.id)

  if (isSplitParent) {
    if (updates.customerName !== undefined) {
      return updateSaleCustomerName(working, id, updates.customerName, relatedSaleIds)
    }
    if (updates.createdAt) {
      saveData(working)
      return working
    }
    return data
  }

  const now = new Date().toISOString()
  const nameTargets = new Set<string>()
  for (const saleId of collectSplitNameTargets(working, id)) nameTargets.add(saleId)
  if (relatedSaleIds) {
    for (const saleId of relatedSaleIds) {
      if (working.sales.some((s) => s.id === saleId)) {
        for (const relatedId of collectSplitNameTargets(working, saleId)) {
          nameTargets.add(relatedId)
        }
      }
    }
  }
  if (nameTargets.size === 0) nameTargets.add(id)

  const next = {
    ...working,
    sales: working.sales.map((s) => {
      if (!nameTargets.has(s.id) && s.id !== id) return s

      let patched: Sale = { ...s }
      let touched = false
      if (nameTargets.has(s.id) && updates.customerName !== undefined) {
        patched = { ...patched, customerName }
        touched = true
      }
      if (s.id === id && updates.billAmount != null && updates.billAmount > 0) {
        patched = {
          ...patched,
          billAmount,
          updatedAt: now,
        }
        touched = true
        if (s.payType === 'cash' || !s.payType) {
          patched.changeAmount = Math.max(0, s.paidAmount - billAmount)
        }
        if (s.payType === 'cheque') {
          patched.chequeAmount = billAmount
        }
      } else if (touched) {
        patched = { ...patched, updatedAt: now }
      }
      return patched
    }),
  }
  saveData(next)
  return next
}

export function updateExpenseName(data: AppData, id: string, name: string): AppData {
  const trimmed = name.trim()
  const next = {
    ...data,
    expenses: data.expenses.map((e) =>
      e.id === id ? { ...e, name: trimmed || defaultExpenseName(e) } : e,
    ),
  }
  saveData(next)
  return next
}

export function updateExpense(
  data: AppData,
  id: string,
  updates: Partial<Omit<Expense, 'id' | 'createdAt'>>,
): AppData {
  const existing = data.expenses.find((e) => e.id === id)
  if (!existing) return data

  const patched: Expense = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    name: updates.name !== undefined ? updates.name.trim() || defaultExpenseName(existing) : existing.name,
    description:
      updates.description !== undefined
        ? updates.description.trim() || undefined
        : existing.description,
  }

  let next: AppData = {
    ...data,
    expenses: data.expenses.map((e) => (e.id === id ? patched : e)),
  }

  const supplierName = stripExpenseBillSuffix(patched.name?.trim() ?? '')
  if (supplierName) next = ensureSupplierInData(next, supplierName)
  const item = patched.description?.trim()
  if (supplierName && item) next = addSupplierItem(next, supplierName, item)

  saveData(next)
  return next
}

/** Clear open supplier credit on a purchase — keeps the bill, removes credit balance. */
export function cancelPurchaseCredit(data: AppData, id: string): AppData {
  const expense = data.expenses.find((e) => e.id === id)
  if (!expense || !isPurchaseExpense(expense)) return data
  if (expense.payType === 'credit') {
    return updateExpense(data, id, { creditAmount: 0 })
  }
  if (expense.payType === 'split' && (expense.creditAmount ?? 0) > 0) {
    return updateExpense(data, id, { creditAmount: 0 })
  }
  return data
}
