import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AppData } from '../types'
import type { PayType } from '../types'
import {
  addExpense,
  addSale,
  deleteExpense,
  deleteSale,
  getCurrentBalance,
  loadData,
  setOpeningBalance,
} from '../storage/database'

interface CashContextValue {
  data: AppData
  balance: number
  recordSale: (sale: {
    billAmount: number
    originalBillAmount?: number
    paidAmount: number
    changeAmount: number
    payType?: PayType
    cashAmount?: number
    bankAmount?: number
    customerName?: string
  }) => void
  recordExpense: (amount: number, note: string) => void
  updateOpeningBalance: (amount: number) => void
  removeSale: (id: string) => void
  removeExpense: (id: string) => void
  refresh: () => void
}

const CashContext = createContext<CashContextValue | null>(null)

export function CashProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData())

  const refresh = useCallback(() => setData(loadData()), [])

  const balance = useMemo(() => getCurrentBalance(data), [data])

  const recordSale = useCallback(
    (sale: {
      billAmount: number
      originalBillAmount?: number
      paidAmount: number
      changeAmount: number
      payType?: PayType
      cashAmount?: number
      bankAmount?: number
      customerName?: string
    }) => {
      setData((prev) => addSale(prev, sale))
    },
    [],
  )

  const recordExpense = useCallback((amount: number, note: string) => {
    setData((prev) => addExpense(prev, { amount, note }))
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

  const value = useMemo(
    () => ({
      data,
      balance,
      recordSale,
      recordExpense,
      updateOpeningBalance,
      removeSale,
      removeExpense,
      refresh,
    }),
    [
      data,
      balance,
      recordSale,
      recordExpense,
      updateOpeningBalance,
      removeSale,
      removeExpense,
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
