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
  addSale,
  addTransfer,
  cancelApprovedCheque,
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
  updatePendingBill,
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
    payType: ExpensePayType
    kind?: ExpenseKind
  }) => void
  recordTransfer: (transfer: {
    amount: number
    name: string
    direction: TransferDirection
  }) => void
  updateOpeningBalance: (amount: number) => void
  updateOpeningBankBalance: (amount: number) => void
  updateHomePin: (pin: string) => void
  removeSale: (id: string) => void
  removeExpense: (id: string) => void
  cancelApprovedCheque: (id: string) => void
  updateHistoryName: (type: 'sale' | 'expense' | 'deposit' | 'transfer', id: string, name: string) => void
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
      kind?: ExpenseKind
    }) => {
      setData((prev) =>
        addExpense(prev, {
          amount: expense.amount,
          name: expense.name.trim(),
          payType: expense.payType,
          kind: expense.kind ?? 'expense',
        }),
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

  const removeSale = useCallback((id: string) => {
    setData((prev) => deleteSale(prev, id))
  }, [])

  const removeExpense = useCallback((id: string) => {
    setData((prev) => deleteExpense(prev, id))
  }, [])

  const cancelApprovedChequeSale = useCallback((id: string) => {
    setData((prev) => cancelApprovedCheque(prev, id))
  }, [])

  const updateHistoryName = useCallback(
    (type: 'sale' | 'expense' | 'deposit' | 'transfer', id: string, name: string) => {
      setData((prev) =>
        type === 'sale' ? updateSaleCustomerName(prev, id, name) : updateExpenseName(prev, id, name),
      )
    },
    [],
  )

  const replaceAllData = useCallback((next: AppData) => {
    setData(replaceData(next))
  }, [])

  const resetAllData = useCallback(() => {
    setData(clearAllLocalData())
  }, [])

  const value = useMemo(
    () => ({
      data,
      balance,
      bankBalance,
      pendingBills,
      recordSale,
      updatePendingSale,
      collectPendingSale,
      recordExpense,
      recordTransfer,
      updateOpeningBalance,
      updateOpeningBankBalance,
      updateHomePin,
      removeSale,
      removeExpense,
      cancelApprovedCheque: cancelApprovedChequeSale,
      updateHistoryName,
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
      recordSale,
      updatePendingSale,
      collectPendingSale,
      recordExpense,
      recordTransfer,
      updateOpeningBalance,
      updateOpeningBankBalance,
      updateHomePin,
      removeSale,
      removeExpense,
      cancelApprovedChequeSale,
      updateHistoryName,
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
