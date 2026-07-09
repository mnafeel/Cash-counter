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
  AppTheme,
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
  deleteExpense,
  deleteSale,
  getBankBalance,
  getCurrentBalance,
  getPendingBills,
  loadData,
  setHomePin,
  setOpeningBalance,
  setOpeningBankBalance,
  setTheme,
  updateExpenseName,
  updateSaleCustomerName,
} from '../storage/database'
import { applyTheme, normalizeTheme } from '../utils/theme'

interface CashContextValue {
  data: AppData
  balance: number
  bankBalance: number
  pendingBills: Sale[]
  recordSale: (sale: {
    billAmount: number
    originalBillAmount?: number
    paidAmount: number
    changeAmount: number
    payType?: PayType
    cashAmount?: number
    bankAmount?: number
    creditAmount?: number
    customerName?: string
    status?: SaleStatus
  }) => void
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
  updateTheme: (theme: AppTheme) => void
  removeSale: (id: string) => void
  removeExpense: (id: string) => void
  updateHistoryName: (type: 'sale' | 'expense' | 'deposit' | 'transfer', id: string, name: string) => void
  refresh: () => void
}

const CashContext = createContext<CashContextValue | null>(null)

export function CashProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData())

  useEffect(() => {
    applyTheme(normalizeTheme(data.theme))
  }, [data.theme])

  const refresh = useCallback(() => setData(loadData()), [])

  const balance = useMemo(() => getCurrentBalance(data), [data])
  const bankBalance = useMemo(() => getBankBalance(data), [data])
  const pendingBills = useMemo(() => getPendingBills(data), [data])

  const recordSale = useCallback(
    (sale: {
      billAmount: number
      originalBillAmount?: number
      paidAmount: number
      changeAmount: number
      payType?: PayType
      cashAmount?: number
      bankAmount?: number
      creditAmount?: number
      customerName?: string
      status?: SaleStatus
    }) => {
      setData((prev) => addSale(prev, sale))
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

  const updateTheme = useCallback((theme: AppTheme) => {
    setData((prev) => setTheme(prev, theme))
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

  const updateHistoryName = useCallback(
    (type: 'sale' | 'expense' | 'deposit' | 'transfer', id: string, name: string) => {
      setData((prev) =>
        type === 'sale' ? updateSaleCustomerName(prev, id, name) : updateExpenseName(prev, id, name),
      )
    },
    [],
  )

  const value = useMemo(
    () => ({
      data,
      balance,
      bankBalance,
      pendingBills,
      recordSale,
      recordExpense,
      recordTransfer,
      updateOpeningBalance,
      updateOpeningBankBalance,
      updateHomePin,
      updateTheme,
      removeSale,
      removeExpense,
      updateHistoryName,
      refresh,
    }),
    [
      data,
      balance,
      bankBalance,
      pendingBills,
      recordSale,
      recordExpense,
      recordTransfer,
      updateOpeningBalance,
      updateOpeningBankBalance,
      updateHomePin,
      updateTheme,
      removeSale,
      removeExpense,
      updateHistoryName,
      refresh,
    ],
  )

  return <CashContext.Provider value={value}>{children}</CashContext.Provider>
}

export function useCash() {
  const ctx = useContext(CashContext)
  if (!ctx) throw new Error('useCash must be used within CashProvider')
  return ctx
}
