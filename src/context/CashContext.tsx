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
  LoanPaySource,
  PayType,
  ReminderAlertSettings,
  Sale,
  SaleStatus,
  StaffLeaveType,
  TransferDirection,
} from '../types'
import type { SalaryMonthKey } from '../utils/staffLedger'
import {
  addExpenseBatch,
  addExpenseWithOptionalStaff,
  addSale,
  addSupplier as addSupplierToData,
  addSupplierItem as addSupplierItemToData,
  addLoan,
  addStaffMember,
  addStaffLeave,
  setStaffAttendance,
  applyStaffSalaryAdvance,
  addTransfer,
  applyPartialBalanceSaleCollection,
  applyPurchaseCreditPayment,
  cancelApprovedCheque,
  cancelApprovedChequeEntry,
  cancelPurchaseCredit,
  cancelSaleCredit,
  cancelSaleCheque,
  cancelSaleChequeAsUnpaid,
  collectPendingBill,
  clearAllLocalData,
  deleteExpense,
  deleteLoan,
  deleteStaffMember,
  deleteStaffLeave,
  deleteSale,
  editPaidSalePayment,
  type BillCreatePayType,
  type PaidSalePaymentEdit,
  computeDrawerBalances,
  getPendingBills,
  importTallyBills,
  loadData,
  replaceData,
  scheduleSalePaymentEventsMigration,
  setHomePin,
  setOpeningBalance,
  setOpeningBankBalance,
  setLoanReminder,
  setReminderAlertSettings,
  setSaleReminder,
  settleLoan,
  updateApprovedChequeEntryDate,
  setCustomerReminder,
  updateExpenseName,
  updateExpense,
  updateStaffMember,
  updateExpenseStaffSalaryMonth,
  updatePendingBill,
  updateSaleBill,
  updateSaleCustomerName,
} from '../storage/database'
import { setCloudRemoteListener } from '../firebase/sync'
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
  /** True while a large cloud dataset is being applied — show loading overlay. */
  dataBooting: boolean
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
    staffId?: string
    staffSalaryMonth?: string
    staffSalaryLink?: boolean
    createStaffIfMissing?: boolean
  }) => boolean
  recordExpenses: (
    expenses: {
      amount: number
      name: string
      description?: string
      billNo?: string
      billDate?: string
      createdAt?: string
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
  removeLoan: (id: string) => void
  addStaff: (input: { name: string; monthlySalary: number; linkExisting?: boolean }) => boolean
  updateStaff: (id: string, updates: { name?: string; monthlySalary?: number; salaryDaysPerMonth?: number }) => void
  removeStaff: (id: string) => void
  addStaffLeave: (input: { staffId: string; date: string; type: StaffLeaveType }) => string | null
  setStaffAttendance: (input: {
    staffId: string
    date: string
    type: StaffLeaveType | 'unset'
  }) => string | null
  removeStaffLeave: (leaveId: string) => void
  applyStaffSalaryAdvance: (input: { staffId: string; fromMonth: string }) => string | null
  updateExpenseStaffSalaryMonth: (expenseId: string, staffSalaryMonth: string) => void
  cancelApprovedCheque: (id: string, eventIndex?: number | null) => boolean
  updateApprovedChequeDate: (
    id: string,
    eventIndex: number | null,
    atIso: string,
    options?: { applyToAll?: boolean },
  ) => boolean
  cancelPurchaseCredit: (id: string) => void
  cancelSaleCredit: (id: string, relatedSaleIds?: string[]) => void
  cancelSaleCheque: (id: string, relatedSaleIds?: string[]) => void
  cancelSaleChequeAsUnpaid: (id: string, relatedSaleIds?: string[]) => boolean
  setBillReminder: (id: string, reminderAt: string | null, reminderNote?: string | null) => void
  setCustomerReminder: (
    customerName: string,
    kind: 'credit' | 'cheque',
    reminderAt: string | null,
    reminderNote?: string | null,
  ) => void
  updateReminderAlertSettings: (settings: ReminderAlertSettings) => void
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
  collectChequePayment: (
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
      billNo?: string
      billDate?: string
      createdAt?: string
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
      payType?: BillCreatePayType
      pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
      createdAt?: string
    },
    relatedSaleIds?: string[],
  ) => void
  editPaidSalePayment: (id: string, payment: PaidSalePaymentEdit, relatedSaleIds?: string[]) => void
  replaceAllData: (data: AppData) => void
  /** Update React state from data already persisted locally (cloud restore). */
  hydrateData: (data: AppData) => void
  resetAllData: () => void
  refresh: () => void
  getTallyApiUrl: () => string
  getTallyDateScope: () => TallyDateScope
  saveTallyApiUrl: (url: string) => void
  saveTallyDateScope: (scope: TallyDateScope) => void
  syncTallyBills: () => Promise<{ connected: boolean; billCount: number; imported: number }>
  giveLoan: (input: {
    personName: string
    amount: number
    paySource: LoanPaySource
    note?: string
    reminderAt?: string
    reminderNote?: string
  }) => boolean
  takeLoan: (input: {
    personName: string
    amount: number
    note?: string
    reminderAt?: string
    reminderNote?: string
  }) => boolean
  settleLoanRecord: (
    id: string,
    settlementPaySource: LoanPaySource,
    options?: { amount?: number; settledAt?: string },
  ) => boolean
  setLoanReminder: (
    id: string,
    reminderAt: string | null,
    reminderNote?: string | null,
    reminderUrgent?: boolean | null,
  ) => void
}

const CashLockContext = createContext<{ lockHome: () => void; unlockHome: () => void } | null>(null)

export function useCashLock() {
  const ctx = useContext(CashLockContext)
  if (!ctx) throw new Error('useCashLock must be used within CashProvider')
  return ctx
}

const CashContext = createContext<CashContextValue | null>(null)
const CashBootContext = createContext(false)

export function useCashBooting(): boolean {
  return useContext(CashBootContext)
}

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
  const [dataBooting, setDataBooting] = useState(false)
  const [homeUnlocked, setHomeUnlocked] = useState(false)

  const unlockHome = useCallback(() => setHomeUnlocked(true), [])
  const lockHome = useCallback(() => setHomeUnlocked(false), [])

  useEffect(() => {
    applyTheme()
  }, [])

  useEffect(() => {
    scheduleSalePaymentEventsMigration(loadData())
  }, [])

  useEffect(() => {
    setCloudRemoteListener((remoteData) => {
      const heavy = remoteData.sales.length > 250 || remoteData.expenses.length > 400
      if (!heavy) {
        setDataBooting(false)
        setData(remoteData)
        return
      }
      setDataBooting(true)
      const apply = () => {
        setData(remoteData)
        requestAnimationFrame(() => setDataBooting(false))
      }
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(apply, { timeout: 2000 })
      } else {
        setTimeout(apply, 32)
      }
    })
    return () => setCloudRemoteListener(null)
  }, [])

  useEffect(() => {
    if (!dataBooting) return
    const timer = window.setTimeout(() => setDataBooting(false), 15000)
    return () => window.clearTimeout(timer)
  }, [dataBooting])

  // Local data loads from localStorage on mount. Cloud sync uses live Firestore
  // listener — applies remote only when cloud backup is newer than local edits.

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

  const balances = useMemo(() => computeDrawerBalances(data), [data])
  const balance = balances.cash
  const bankBalance = balances.bank
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
      staffId?: string
      staffSalaryMonth?: string
      staffSalaryLink?: boolean
      createStaffIfMissing?: boolean
    }) => {
      let ok = false
      setData((prev) => {
        const result = addExpenseWithOptionalStaff(
          prev,
          {
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
          },
          {
            staffId: expense.staffId,
            staffSalaryMonth: expense.staffSalaryMonth,
            staffSalaryLink: expense.staffSalaryLink,
            createStaffIfMissing: expense.createStaffIfMissing,
          },
        )
        if (!result.ok) return prev
        ok = true
        return result.data
      })
      return ok
    },
    [],
  )

  const recordExpenses = useCallback(
    (
      expenses: {
        amount: number
        name: string
        description?: string
        billNo?: string
        billDate?: string
        createdAt?: string
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
            billNo: expense.billNo?.trim() || undefined,
            billDate: expense.billDate?.trim() || undefined,
            createdAt: expense.createdAt,
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

  const removeLoan = useCallback((id: string) => {
    setData((prev) => deleteLoan(prev, id))
  }, [])

  const addStaff = useCallback(
    (input: { name: string; monthlySalary: number; linkExisting?: boolean }): boolean => {
      let success = false
      setData((prev) => {
        const next = addStaffMember(prev, input)
        success = next !== prev
        return next
      })
      return success
    },
    [],
  )

  const updateStaff = useCallback(
    (id: string, updates: { name?: string; monthlySalary?: number; salaryDaysPerMonth?: number }) => {
      setData((prev) => updateStaffMember(prev, id, updates))
    },
    [],
  )

  const removeStaff = useCallback((id: string) => {
    setData((prev) => deleteStaffMember(prev, id))
  }, [])

  const addStaffLeaveHandler = useCallback(
    (input: { staffId: string; date: string; type: StaffLeaveType }): string | null => {
      let error: string | null = 'Could not save leave.'
      setData((prev) => {
        const result = addStaffLeave(prev, input)
        if (result.ok) {
          error = null
          return result.data
        }
        error = result.error ?? error
        return prev
      })
      return error
    },
    [],
  )

  const removeStaffLeaveHandler = useCallback((leaveId: string) => {
    setData((prev) => deleteStaffLeave(prev, leaveId))
  }, [])

  const setStaffAttendanceHandler = useCallback(
    (input: {
      staffId: string
      date: string
      type: StaffLeaveType | 'unset'
    }): string | null => {
      let error: string | null = 'Could not save attendance.'
      setData((prev) => {
        const result = setStaffAttendance(prev, input)
        if (result.ok) {
          error = null
          return result.data
        }
        error = result.error ?? error
        return prev
      })
      return error
    },
    [],
  )

  const applyStaffSalaryAdvanceHandler = useCallback(
    (input: { staffId: string; fromMonth: string }): string | null => {
      let error: string | null = 'Could not apply to next month.'
      setData((prev) => {
        const result = applyStaffSalaryAdvance(prev, {
          staffId: input.staffId,
          fromMonth: input.fromMonth as SalaryMonthKey,
        })
        if (result.ok) {
          error = null
          return result.data
        }
        error = result.error ?? error
        return prev
      })
      return error
    },
    [],
  )

  const updateExpenseStaffSalaryMonthHandler = useCallback((expenseId: string, staffSalaryMonth: string) => {
    setData((prev) => updateExpenseStaffSalaryMonth(prev, expenseId, staffSalaryMonth))
  }, [])

  const addSupplier = useCallback((name: string) => {
    setData((prev) => addSupplierToData(prev, name))
  }, [])

  const addSupplierItem = useCallback((name: string, item: string) => {
    setData((prev) => addSupplierItemToData(prev, name, item))
  }, [])

  const cancelApprovedChequeSale = useCallback(
    (id: string, eventIndex?: number | null): boolean => {
      let ok = false
      setData((prev) => {
        const next =
          eventIndex === undefined
            ? cancelApprovedCheque(prev, id)
            : cancelApprovedChequeEntry(prev, id, eventIndex)
        ok = next !== prev
        return next
      })
      return ok
    },
    [],
  )

  const updateApprovedChequeDateHandler = useCallback(
    (
      id: string,
      eventIndex: number | null,
      atIso: string,
      options?: { applyToAll?: boolean },
    ): boolean => {
      let ok = false
      setData((prev) => {
        const next = updateApprovedChequeEntryDate(prev, id, eventIndex, atIso, options)
        ok = next !== prev
        return next
      })
      return ok
    },
    [],
  )

  const cancelPurchaseCreditBalance = useCallback((id: string) => {
    setData((prev) => cancelPurchaseCredit(prev, id))
  }, [])

  const cancelSaleCreditBalance = useCallback((id: string, relatedSaleIds?: string[]) => {
    setData((prev) => cancelSaleCredit(prev, id, relatedSaleIds))
  }, [])

  const cancelSaleChequeBalance = useCallback((id: string, relatedSaleIds?: string[]) => {
    setData((prev) => cancelSaleCheque(prev, id, relatedSaleIds))
  }, [])

  const cancelSaleChequeAsUnpaidHandler = useCallback(
    (id: string, relatedSaleIds?: string[]): boolean => {
      let ok = false
      setData((prev) => {
        const next = cancelSaleChequeAsUnpaid(prev, id, relatedSaleIds)
        ok = next !== prev
        return next
      })
      return ok
    },
    [],
  )

  const setBillReminderHandler = useCallback(
    (id: string, reminderAt: string | null, reminderNote?: string | null) => {
      setData((prev) => setSaleReminder(prev, id, reminderAt, reminderNote))
    },
    [],
  )

  const setCustomerReminderHandler = useCallback(
    (
      customerName: string,
      kind: 'credit' | 'cheque',
      reminderAt: string | null,
      reminderNote?: string | null,
    ) => {
      setData((prev) => setCustomerReminder(prev, customerName, kind, reminderAt, reminderNote))
    },
    [],
  )

  const updateReminderAlertSettingsHandler = useCallback((settings: ReminderAlertSettings) => {
    setData((prev) => setReminderAlertSettings(prev, settings))
  }, [])

  const giveLoanHandler = useCallback(
    (input: {
      personName: string
      amount: number
      paySource: LoanPaySource
      note?: string
      reminderAt?: string
      reminderNote?: string
    }): boolean => {
      let success = false
      setData((prev) => {
        const next = addLoan(prev, { ...input, kind: 'lend' })
        success = next !== prev
        return next
      })
      return success
    },
    [],
  )

  const takeLoanHandler = useCallback(
    (input: {
      personName: string
      amount: number
      note?: string
      reminderAt?: string
      reminderNote?: string
    }): boolean => {
      let success = false
      setData((prev) => {
        const next = addLoan(prev, { ...input, kind: 'borrow' })
        success = next !== prev
        return next
      })
      return success
    },
    [],
  )

  const settleLoanRecordHandler = useCallback(
    (
      id: string,
      settlementPaySource: LoanPaySource,
      options?: { amount?: number; settledAt?: string },
    ): boolean => {
      let success = false
      setData((prev) => {
        const next = settleLoan(prev, id, settlementPaySource, options)
        success = next !== prev
        return next
      })
      return success
    },
    [],
  )

  const setLoanReminderHandler = useCallback(
    (
      id: string,
      reminderAt: string | null,
      reminderNote?: string | null,
      reminderUrgent?: boolean | null,
    ) => {
      setData((prev) => setLoanReminder(prev, id, reminderAt, reminderNote, reminderUrgent))
    },
    [],
  )

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

  const collectBalancePaymentHandler = useCallback(
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

        return applyPartialBalanceSaleCollection(prev, id, {
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
        billNo?: string
        billDate?: string
        createdAt?: string
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
          billNo: expense.billNo?.trim() || undefined,
          billDate: expense.billDate?.trim() || undefined,
          createdAt: expense.createdAt,
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
        payType?: BillCreatePayType
        pendingPayType?: Extract<PayType, 'credit' | 'cheque'>
        createdAt?: string
      },
      relatedSaleIds?: string[],
    ) => {
      setData((prev) => updateSaleBill(prev, id, updates, relatedSaleIds))
    },
    [],
  )

  const editPaidSalePaymentHandler = useCallback(
    (id: string, payment: PaidSalePaymentEdit, relatedSaleIds?: string[]) => {
      setData((prev) => editPaidSalePayment(prev, id, payment, relatedSaleIds))
    },
    [],
  )

  const replaceAllData = useCallback((next: AppData) => {
    setData(replaceData(next))
  }, [])

  const hydrateData = useCallback((next: AppData) => {
    const heavy = next.sales.length > 250 || next.expenses.length > 400
    if (!heavy) {
      setDataBooting(false)
      setData(next)
      return
    }
    setDataBooting(true)
    const apply = () => {
      setData(next)
      requestAnimationFrame(() => setDataBooting(false))
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(apply, { timeout: 2000 })
    } else {
      setTimeout(apply, 32)
    }
  }, [])

  const resetAllData = useCallback(() => {
    setData(clearAllLocalData())
    setHomeUnlocked(false)
  }, [])

  const value = useMemo(
    () => ({
      data,
      dataBooting,
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
      removeLoan,
      addStaff,
      updateStaff,
      removeStaff,
      addStaffLeave: addStaffLeaveHandler,
      setStaffAttendance: setStaffAttendanceHandler,
      removeStaffLeave: removeStaffLeaveHandler,
      applyStaffSalaryAdvance: applyStaffSalaryAdvanceHandler,
      updateExpenseStaffSalaryMonth: updateExpenseStaffSalaryMonthHandler,
      addSupplier,
      addSupplierItem,
      cancelApprovedCheque: cancelApprovedChequeSale,
      updateApprovedChequeDate: updateApprovedChequeDateHandler,
      cancelPurchaseCredit: cancelPurchaseCreditBalance,
      cancelSaleCredit: cancelSaleCreditBalance,
      cancelSaleCheque: cancelSaleChequeBalance,
      cancelSaleChequeAsUnpaid: cancelSaleChequeAsUnpaidHandler,
      setBillReminder: setBillReminderHandler,
      setCustomerReminder: setCustomerReminderHandler,
      updateReminderAlertSettings: updateReminderAlertSettingsHandler,
      applyPurchaseCreditPayment: applyPurchaseCreditPaymentHandler,
      collectCreditPayment: collectBalancePaymentHandler,
      collectChequePayment: collectBalancePaymentHandler,
      updateHistoryName,
      updateExpense: updateExpenseHandler,
      updateSaleBill: updateSaleBillHandler,
      editPaidSalePayment: editPaidSalePaymentHandler,
      replaceAllData,
      hydrateData,
      resetAllData,
      refresh,
      getTallyApiUrl,
      getTallyDateScope,
      saveTallyApiUrl: saveTallyApiUrlHandler,
      saveTallyDateScope: saveTallyDateScopeHandler,
      syncTallyBills,
      giveLoan: giveLoanHandler,
      takeLoan: takeLoanHandler,
      settleLoanRecord: settleLoanRecordHandler,
      setLoanReminder: setLoanReminderHandler,
    }),
    [
      data,
      dataBooting,
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
      removeLoan,
      addStaff,
      updateStaff,
      removeStaff,
      addStaffLeaveHandler,
      setStaffAttendanceHandler,
      removeStaffLeaveHandler,
      applyStaffSalaryAdvanceHandler,
      updateExpenseStaffSalaryMonthHandler,
      addSupplier,
      addSupplierItem,
      cancelApprovedChequeSale,
      updateApprovedChequeDateHandler,
      cancelPurchaseCreditBalance,
      cancelSaleCreditBalance,
      cancelSaleChequeBalance,
      cancelSaleChequeAsUnpaidHandler,
      setBillReminderHandler,
      setCustomerReminderHandler,
      updateReminderAlertSettingsHandler,
      applyPurchaseCreditPaymentHandler,
      collectBalancePaymentHandler,
      updateHistoryName,
      updateExpenseHandler,
      updateSaleBillHandler,
      editPaidSalePaymentHandler,
      replaceAllData,
      hydrateData,
      resetAllData,
      refresh,
      saveTallyApiUrlHandler,
      saveTallyDateScopeHandler,
      syncTallyBills,
      giveLoanHandler,
      takeLoanHandler,
      settleLoanRecordHandler,
      setLoanReminderHandler,
    ],
  )

  const lockActions = useMemo(() => ({ lockHome, unlockHome }), [lockHome, unlockHome])

  return (
    <CashBootContext.Provider value={dataBooting}>
      <CashLockContext.Provider value={lockActions}>
        <CashContext.Provider value={value}>{children}</CashContext.Provider>
      </CashLockContext.Provider>
    </CashBootContext.Provider>
  )
}

export function useCash() {
  const ctx = useContext(CashContext)
  if (!ctx) throw new Error('useCash must be used within CashProvider')
  return ctx
}
