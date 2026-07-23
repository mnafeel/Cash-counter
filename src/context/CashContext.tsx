import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  AppData,
  ExpenseKind,
  ExpensePayType,
  PayType,
  Sale,
  SaleStatus,
  TransferDirection,
} from '../types'
import {
  addExpense,
  addExpenseBatch,
  addSale,
  addSupplier as addSupplierToData,
  addSupplierItem as addSupplierItemToData,
  addTransfer,
  applyPartialCreditSaleCollection,
  applyPurchaseCreditPayment,
  cancelApprovedCheque,
  cancelPurchaseCredit,
  cancelSaleCredit,
  collectPendingBill,
  deleteExpense,
  deleteSale,
  getBankBalance,
  getCurrentBalance,
  getPendingBills,
  importTallyBills,
  loadData,
  replaceData,
  replaceDataPreservingTallyPending,
  clearAllLocalData,
  setHomePin,
  setOpeningBalance,
  setOpeningBankBalance,
  updateExpenseName,
  updateExpense,
  updatePendingBill,
  updateSaleBill,
  updateSaleCustomerName,
} from '../storage/database'
import { isFirebaseConfigured } from '../firebase/config'
import { restoreCloudDataForUser, subscribeToAuth } from '../firebase/backup'
import {
  fetchTallyBills,
  getTallyApiUrl,
  getTallyDateScope,
  setTallyApiUrl,
  setTallyDateScope,
  testTallyConnection,
  type TallyDateScope,
} from '../tally/localSource'
import { applyTheme } from '../utils/theme'

interface CashContextValue {
  data: AppData
  balance: number
  bankBalance: number
  pendingBills: Sale[]
  homeUnlocked: boolean
  unlockHome: () => void
  lockHome: () => void
  recordSale: (sale: {
    id?: string
    billAmount: number
    originalBillAmount?: number
    paidAmount: number
    changeAmount: number
    payType?: PayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    creditAmount?: number
    chequeApproved?: boolean
    parentSplitId?: string
    pendingPayType?: PayType
    customerName?: string
    status?: SaleStatus
  }) => void
  updatePendingSale: (
    id: string,
    sale: {
      billAmount: number
      originalBillAmount?: number
      customerName?: string
      payType?: PayType
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      creditAmount?: number
      pendingPayType?: PayType
    },
  ) => void
  collectPendingSale: (
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
  ) => void
  recordExpense: (expense: {
    amount: number
    name: string
    description?: string
    payType: ExpensePayType
    cashAmount?: number
    bankAmount?: number
    chequeAmount?: number
    chequeApproved?: boolean
    giveAmount?: number
    changeAmount?: number
    kind?: ExpenseKind
  }) => void
  recordExpenses: (
    expenses: {
      amount: number
      name: string
      description?: string
      payType: ExpensePayType
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      chequeApproved?: boolean
      giveAmount?: number
      changeAmount?: number
      billNumber?: 1 | 2
      kind?: ExpenseKind
    }[],
  ) => void
  recordTransfer: (transfer: {
    amount: number
    name: string
    direction: TransferDirection
  }) => void
  updateOpeningBalance: (amount: number) => void
  updateOpeningBankBalance: (amount: number) => void
  updateHomePin: (pin: string) => void
  removeSale: (id: string, relatedSaleIds?: string[]) => void
  removeExpense: (id: string) => void
  cancelApprovedCheque: (id: string) => void
  cancelPurchaseCredit: (id: string) => void
  cancelSaleCredit: (id: string, relatedSaleIds?: string[]) => void
  applyPurchaseCreditPayment: (
    id: string,
    payment: {
      payType: ExpensePayType
      payAmount: number
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      chequeApproved?: boolean
    },
  ) => void
  collectCreditPayment: (
    id: string,
    payment: {
      dueAmount: number
      collected: number
      payType: PayType
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      chequeApproved?: boolean
      customerName?: string
      changeAmount?: number
    },
  ) => void
  addSupplier: (name: string) => void
  addSupplierItem: (name: string, item: string) => void
  updateHistoryName: (
    type: 'sale' | 'expense' | 'deposit' | 'transfer',
    id: string,
    name: string,
    relatedSaleIds?: string[],
  ) => void
  updateExpense: (
    id: string,
    expense: {
      amount: number
      name: string
      description?: string
      payType: ExpensePayType
      cashAmount?: number
      bankAmount?: number
      creditAmount?: number
      chequeAmount?: number
      chequeApproved?: boolean
      giveAmount?: number
      changeAmount?: number
      billNumber?: 1 | 2
      kind?: ExpenseKind
    },
  ) => void
  updateSaleBill: (
    id: string,
    updates: {
      customerName?: string
      billAmount?: number
      originalBillAmount?: number
      paidCollected?: number
      pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
      createdAt?: string
    },
    relatedSaleIds?: string[],
  ) => void
  replaceAllData: (data: AppData) => void
  resetAllData: () => void
  refresh: () => void
  getTallyApiUrl: () => string
  getTallyDateScope: () => TallyDateScope
  saveTallyApiUrl: (url: string) => void
  saveTallyDateScope: (scope: TallyDateScope) => void
  syncTallyBills: () => Promise<{ connected: boolean; billCount: number; imported: number }>
}

const CashContext = createContext<CashContextValue | null>(null)

function tallyBillsToImport(bills: Awaited<ReturnType<typeof fetchTallyBills>>) {
  return bills.map((bill) => ({
    sourceId: bill.id,
    billAmount: bill.billAmount,
    customerName: bill.customerName,
    createdAt: bill.createdAt,
  }))
}

function applyTallyImport(data: AppData, bills: Awaited<ReturnType<typeof fetchTallyBills>>) {
  if (bills.length === 0) return { next: data, imported: 0 }
  const existing = new Set(
    data.sales
      .filter((s) => s.source === 'tally' && s.sourceId)
      .map((s) => s.sourceId as string),
  )
  const imported = bills.filter((b) => !existing.has(b.id)).length
  const next = importTallyBills(data, tallyBillsToImport(bills))
  return { next, imported }
}

export function CashProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData())
  const [homeUnlocked, setHomeUnlocked] = useState(false)

  const unlockHome = useCallback(() => setHomeUnlocked(true), [])
  const lockHome = useCallback(() => setHomeUnlocked(false), [])

  useEffect(() => {
    applyTheme()
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured()) return
    return subscribeToAuth(async (user) => {
      if (!user) return
      try {
        const restored = await restoreCloudDataForUser()
        if (restored) setData((prev) => replaceDataPreservingTallyPending(prev, restored))
      } catch {
        /* cloud restore optional on session resume */
      }
    })
  }, [])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setInterval> | null = null

    const importBills = async () => {
      const apiUrl = getTallyApiUrl()
      if (!apiUrl) return
      const bills = await fetchTallyBills()
      if (!active || bills.length === 0) return
      setData((prev) => applyTallyImport(prev, bills).next)
    }

    void importBills()
    timer = setInterval(() => void importBills(), 30000)

    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [])

  const refresh = useCallback(() => setData(loadData()), [])

  const syncTallyBills = useCallback(async () => {
    const apiUrl = getTallyApiUrl()
    if (!apiUrl) return { connected: false, billCount: 0, imported: 0 }
    const test = await testTallyConnection(apiUrl, getTallyDateScope())
    if (!test.connected) return { connected: false, billCount: 0, imported: 0 }
    const bills = await fetchTallyBills()
    let imported = 0
    setData((prev) => {
      const result = applyTallyImport(prev, bills)
      imported = result.imported
      return result.next
    })
    return { connected: true, billCount: bills.length, imported }
  }, [])

  const saveTallyApiUrlHandler = useCallback(
    (url: string) => {
      setTallyApiUrl(url)
      void syncTallyBills()
    },
    [syncTallyBills],
  )

  const saveTallyDateScopeHandler = useCallback(
    (scope: TallyDateScope) => {
      setTallyDateScope(scope)
      void syncTallyBills()
    },
    [syncTallyBills],
  )

  const balance = useMemo(() => getCurrentBalance(data), [data])
  const bankBalance = useMemo(() => getBankBalance(data), [data])
  const pendingBills = useMemo(() => getPendingBills(data), [data])

  const recordSale = useCallback(
    (sale: {
      id?: string
      billAmount: number
      originalBillAmount?: number
      paidAmount: number
      changeAmount: number
      payType?: PayType
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      creditAmount?: number
      chequeApproved?: boolean
      parentSplitId?: string
      pendingPayType?: PayType
      customerName?: string
      status?: SaleStatus
    }) => {
      setData((prev) => addSale(prev, sale))
    },
    [],
  )

  const updatePendingSale = useCallback(
    (
      id: string,
      sale: {
        billAmount: number
        originalBillAmount?: number
        customerName?: string
        payType?: PayType
        cashAmount?: number
        bankAmount?: number
        chequeAmount?: number
        creditAmount?: number
        pendingPayType?: PayType
      },
    ) => {
      setData((prev) => updatePendingBill(prev, id, sale))
    },
    [],
  )

  const collectPendingSale = useCallback(
    (
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
    ) => {
      setData((prev) => collectPendingBill(prev, id, sale))
    },
    [],
  )

  const recordExpense = useCallback(
    (expense: {
      amount: number
      name: string
      payType: ExpensePayType
      cashAmount?: number
      bankAmount?: number
      chequeAmount?: number
      chequeApproved?: boolean
      giveAmount?: number
      changeAmount?: number
      kind?: ExpenseKind
    }) => {
      setData((prev) =>
        addExpense(prev, {
          amount: expense.amount,
          name: expense.name.trim(),
          payType: expense.payType,
          cashAmount: expense.payType === 'split' ? expense.cashAmount : undefined,
          bankAmount:
            expense.payType === 'split' || expense.payType === 'bank'
              ? expense.bankAmount ?? (expense.payType === 'bank' ? expense.amount : undefined)
              : undefined,
          chequeAmount:
            expense.payType === 'split' || expense.payType === 'cheque'
              ? expense.chequeAmount ?? (expense.payType === 'cheque' ? expense.amount : undefined)
              : undefined,
          chequeApproved: expense.chequeApproved,
          giveAmount: expense.giveAmount,
          changeAmount: expense.changeAmount,
          kind: expense.kind ?? 'expense',
        }),
      )
    },
    [],
  )

  const recordExpenses = useCallback(
    (
      expenses: {
        amount: number
        name: string
        description?: string
        payType: ExpensePayType
        cashAmount?: number
        bankAmount?: number
        creditAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
        giveAmount?: number
        changeAmount?: number
        billNumber?: 1 | 2
        kind?: ExpenseKind
      }[],
    ) => {
      if (expenses.length === 0) return
      setData((prev) =>
        addExpenseBatch(
          prev,
          expenses.map((expense) => ({
            amount: expense.amount,
            name: expense.name.trim(),
            description: expense.description?.trim() || undefined,
            payType: expense.payType,
            cashAmount: expense.payType === 'split' ? expense.cashAmount : undefined,
            bankAmount:
              expense.payType === 'split' || expense.payType === 'bank'
                ? expense.bankAmount ?? (expense.payType === 'bank' ? expense.amount : undefined)
                : undefined,
            creditAmount:
              expense.payType === 'split' || expense.payType === 'credit'
                ? expense.creditAmount ?? (expense.payType === 'credit' ? expense.amount : undefined)
                : undefined,
            chequeAmount:
              expense.payType === 'split' || expense.payType === 'cheque'
                ? expense.chequeAmount ?? (expense.payType === 'cheque' ? expense.amount : undefined)
                : undefined,
            chequeApproved: expense.chequeApproved,
            giveAmount: expense.giveAmount,
            changeAmount: expense.changeAmount,
            billNumber: expense.billNumber,
            kind: expense.kind ?? 'expense',
          })),
        ),
      )
    },
    [],
  )

  const recordTransfer = useCallback(
    (transfer: { amount: number; name: string; direction: TransferDirection }) => {
      setData((prev) =>
        addTransfer(prev, {
          amount: transfer.amount,
          name: transfer.name.trim(),
          direction: transfer.direction,
        }),
      )
    },
    [],
  )

  const updateOpeningBankBalance = useCallback((amount: number) => {
    setData((prev) => setOpeningBankBalance(prev, amount))
  }, [])

  const updateHomePin = useCallback((pin: string) => {
    setData((prev) => setHomePin(prev, pin))
  }, [])

  const updateOpeningBalance = useCallback((amount: number) => {
    setData((prev) => setOpeningBalance(prev, amount))
  }, [])

  const removeSale = useCallback((id: string, relatedSaleIds?: string[]) => {
    setData((prev) => deleteSale(prev, id, relatedSaleIds))
  }, [])

  const removeExpense = useCallback((id: string) => {
    setData((prev) => deleteExpense(prev, id))
  }, [])

  const addSupplier = useCallback((name: string) => {
    setData((prev) => addSupplierToData(prev, name))
  }, [])

  const addSupplierItem = useCallback((name: string, item: string) => {
    setData((prev) => addSupplierItemToData(prev, name, item))
  }, [])

  const cancelApprovedChequeSale = useCallback((id: string) => {
    setData((prev) => cancelApprovedCheque(prev, id))
  }, [])

  const cancelPurchaseCreditBalance = useCallback((id: string) => {
    setData((prev) => cancelPurchaseCredit(prev, id))
  }, [])

  const cancelSaleCreditBalance = useCallback((id: string, relatedSaleIds?: string[]) => {
    setData((prev) => cancelSaleCredit(prev, id, relatedSaleIds))
  }, [])

  const applyPurchaseCreditPaymentHandler = useCallback(
    (
      id: string,
      payment: {
        payType: ExpensePayType
        payAmount: number
        cashAmount?: number
        bankAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
      },
    ) => {
      setData((prev) => applyPurchaseCreditPayment(prev, id, payment))
    },
    [],
  )

  const collectCreditPaymentHandler = useCallback(
    (
      id: string,
      payment: {
        dueAmount: number
        collected: number
        payType: PayType
        cashAmount?: number
        bankAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
        customerName?: string
        changeAmount?: number
      },
    ) => {
      setData((prev) => {
        if (payment.collected <= 0) return prev

        return applyPartialCreditSaleCollection(prev, id, {
          collected: payment.collected,
          payType: payment.payType,
          cashAmount: payment.cashAmount,
          bankAmount: payment.bankAmount,
          chequeAmount: payment.chequeAmount,
          chequeApproved: payment.chequeApproved,
          customerName: payment.customerName,
          changeAmount: payment.changeAmount,
        })
      })
    },
    [],
  )

  const updateHistoryName = useCallback(
    (
      type: 'sale' | 'expense' | 'deposit' | 'transfer',
      id: string,
      name: string,
      relatedSaleIds?: string[],
    ) => {
      setData((prev) =>
        type === 'sale'
          ? updateSaleCustomerName(prev, id, name, relatedSaleIds)
          : updateExpenseName(prev, id, name),
      )
    },
    [],
  )

  const updateExpenseHandler = useCallback(
    (
      id: string,
      expense: {
        amount: number
        name: string
        description?: string
        payType: ExpensePayType
        cashAmount?: number
        bankAmount?: number
        creditAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
        giveAmount?: number
        changeAmount?: number
        billNumber?: 1 | 2
        kind?: ExpenseKind
      },
    ) => {
      setData((prev) =>
        updateExpense(prev, id, {
          amount: expense.amount,
          name: expense.name.trim(),
          description: expense.description?.trim() || undefined,
          payType: expense.payType,
          cashAmount: expense.payType === 'split' ? expense.cashAmount : undefined,
          bankAmount:
            expense.payType === 'split' || expense.payType === 'bank'
              ? expense.bankAmount ?? (expense.payType === 'bank' ? expense.amount : undefined)
              : undefined,
          creditAmount:
            expense.payType === 'split' || expense.payType === 'credit'
              ? expense.creditAmount ?? (expense.payType === 'credit' ? expense.amount : undefined)
              : undefined,
          chequeAmount:
            expense.payType === 'split' || expense.payType === 'cheque'
              ? expense.chequeAmount ?? (expense.payType === 'cheque' ? expense.amount : undefined)
              : undefined,
          chequeApproved: expense.chequeApproved,
          giveAmount: expense.giveAmount,
          changeAmount: expense.changeAmount,
          billNumber: expense.billNumber,
          kind: expense.kind ?? 'expense',
        }),
      )
    },
    [],
  )

  const updateSaleBillHandler = useCallback(
    (
      id: string,
      updates: {
        customerName?: string
        billAmount?: number
        originalBillAmount?: number
        paidCollected?: number
        pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
        createdAt?: string
      },
      relatedSaleIds?: string[],
    ) => {
      setData((prev) => updateSaleBill(prev, id, updates, relatedSaleIds))
    },
    [],
  )

  const replaceAllData = useCallback((next: AppData) => {
    setData(replaceData(next))
  }, [])

  const resetAllData = useCallback(() => {
    setData(clearAllLocalData())
    setHomeUnlocked(false)
  }, [])

  const value = useMemo(
    () => ({
      data,
      balance,
      bankBalance,
      pendingBills,
      homeUnlocked,
      unlockHome,
      lockHome,
      recordSale,
      updatePendingSale,
      collectPendingSale,
      recordExpense,
      recordExpenses,
      recordTransfer,
      updateOpeningBalance,
      updateOpeningBankBalance,
      updateHomePin,
      removeSale,
      removeExpense,
      addSupplier,
      addSupplierItem,
      cancelApprovedCheque: cancelApprovedChequeSale,
      cancelPurchaseCredit: cancelPurchaseCreditBalance,
      cancelSaleCredit: cancelSaleCreditBalance,
      applyPurchaseCreditPayment: applyPurchaseCreditPaymentHandler,
      collectCreditPayment: collectCreditPaymentHandler,
      updateHistoryName,
      updateExpense: updateExpenseHandler,
      updateSaleBill: updateSaleBillHandler,
      replaceAllData,
      resetAllData,
      refresh,
      getTallyApiUrl,
      getTallyDateScope,
      saveTallyApiUrl: saveTallyApiUrlHandler,
      saveTallyDateScope: saveTallyDateScopeHandler,
      syncTallyBills,
    }),
    [
      data,
      balance,
      bankBalance,
      pendingBills,
      homeUnlocked,
      unlockHome,
      lockHome,
      recordSale,
      updatePendingSale,
      collectPendingSale,
      recordExpense,
      recordExpenses,
      recordTransfer,
      updateOpeningBalance,
      updateOpeningBankBalance,
      updateHomePin,
      removeSale,
      removeExpense,
      addSupplier,
      addSupplierItem,
      cancelApprovedChequeSale,
      cancelPurchaseCreditBalance,
      cancelSaleCreditBalance,
      applyPurchaseCreditPaymentHandler,
      collectCreditPaymentHandler,
      updateHistoryName,
      updateExpenseHandler,
      updateSaleBillHandler,
      replaceAllData,
      resetAllData,
      refresh,
      saveTallyApiUrlHandler,
      saveTallyDateScopeHandler,
      syncTallyBills,
    ],
  )

  return <CashContext.Provider value={value}>{children}</CashContext.Provider>
}

export function useCash() {
  const ctx = useContext(CashContext)
  if (!ctx) throw new Error('useCash must be used within CashProvider')
  return ctx
}
