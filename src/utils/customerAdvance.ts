import type { AppData, CustomerAdvanceLedgerEntry, CustomerAdvanceKind, Sale } from '../types'
import { formatMoney } from './format'
import { formatSaleReturnLine } from './saleReturns'
import { memoByDataRef } from './memoByDataRef'

export function getAdvanceSalesCountMode(data: AppData): 'on_bill' | 'on_receive' {
  return data.advanceSalesCountMode === 'on_receive' ? 'on_receive' : 'on_bill'
}

function localDayTimestamp(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function inputDateTimestamp(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** Cash advances collected in range that should count toward Sales when received. */
export function sumCustomerAdvancesReceivedInRange(
  data: AppData,
  fromDate?: string,
  toDate?: string,
): number {
  const legacyCountAll = getAdvanceSalesCountMode(data) === 'on_receive'
  let total = 0
  for (const row of data.customerAdvances ?? []) {
    if (row.kind !== 'received' || row.amount <= 0) continue
    const counts =
      row.countInSalesOnReceive === true ||
      (row.countInSalesOnReceive == null && legacyCountAll)
    if (!counts) continue
    if (fromDate || toDate) {
      const day = localDayTimestamp(row.at)
      if (fromDate && day < inputDateTimestamp(fromDate)) continue
      if (toDate && day > inputDateTimestamp(toDate)) continue
    }
    total += row.amount
  }
  return roundMoney(total)
}

/**
 * Of `applyAmount` drawn from open advance balance, how much should still count toward Sales
 * when applied on the bill (FIFO over open lots).
 */
export function advanceSalesCountOnApplyAmount(
  data: AppData,
  customerName: string,
  applyAmount: number,
): number {
  const want = roundMoney(Math.max(0, applyAmount))
  if (want <= 0) return 0

  const rows = [...customerAdvanceEntriesForName(data, customerName)].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )

  type Lot = { remaining: number; alreadyInSales: boolean }
  const lots: Lot[] = []

  for (const row of rows) {
    if (row.kind === 'received') {
      lots.push({
        remaining: row.amount,
        alreadyInSales: receivedAdvanceCountsInSales(data, row),
      })
    } else if (row.kind === 'from_return') {
      // Return credit was never counted as Sales cash — count when applied on a bill.
      lots.push({ remaining: row.amount, alreadyInSales: false })
    } else if (row.kind === 'applied' || row.kind === 'refunded') {
      let need = row.amount
      for (const lot of lots) {
        if (need <= 0.01) break
        if (lot.remaining <= 0.01) continue
        const take = Math.min(lot.remaining, need)
        lot.remaining = roundMoney(lot.remaining - take)
        need = roundMoney(need - take)
      }
    }
  }

  let remaining = want
  let countOnApply = 0
  for (const lot of lots) {
    if (remaining <= 0.01) break
    if (lot.remaining <= 0.01) continue
    const take = Math.min(lot.remaining, remaining)
    if (!lot.alreadyInSales) countOnApply = roundMoney(countOnApply + take)
    remaining = roundMoney(remaining - take)
  }
  return countOnApply
}

/**
 * How much of a sale's applied advance should count in Sales on the bill.
 * Replays the ledger so toggling Add-to-sales on a receive updates bill figures.
 * — Add to sales ON  → already counted when received → 0 on the bill
 * — Add to sales OFF → not counted yet → full applied amount on the bill
 */
export function saleAdvanceSalesCountAmount(data: AppData, sale: Sale): number {
  const appliedTarget = sale.customerAdvanceApplied ?? 0
  if (appliedTarget <= 0.01 || !sale.customerName?.trim()) return 0

  const rows = [...customerAdvanceEntriesForName(data, sale.customerName)].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )

  type Lot = { remaining: number; alreadyInSales: boolean }
  const lots: Lot[] = []
  let countedOnBill = 0

  for (const row of rows) {
    if (row.kind === 'received') {
      lots.push({
        remaining: row.amount,
        alreadyInSales: receivedAdvanceCountsInSales(data, row),
      })
    } else if (row.kind === 'from_return') {
      lots.push({ remaining: row.amount, alreadyInSales: false })
    } else if (row.kind === 'applied' || row.kind === 'refunded') {
      let need = row.amount
      let fromNotYetInSales = 0
      for (const lot of lots) {
        if (need <= 0.01) break
        if (lot.remaining <= 0.01) continue
        const take = Math.min(lot.remaining, need)
        if (!lot.alreadyInSales) fromNotYetInSales = roundMoney(fromNotYetInSales + take)
        lot.remaining = roundMoney(lot.remaining - take)
        need = roundMoney(need - take)
      }
      if (row.kind === 'applied' && row.saleId === sale.id) {
        countedOnBill = roundMoney(countedOnBill + fromNotYetInSales)
      }
    }
  }

  // Sale has advance applied but ledger row not written yet (in-flight save).
  if (countedOnBill <= 0.01) {
    const ledgerApplied = rows
      .filter((row) => row.kind === 'applied' && row.saleId === sale.id)
      .reduce((sum, row) => sum + row.amount, 0)
    if (ledgerApplied <= 0.01 && appliedTarget > 0.01) {
      return advanceSalesCountOnApplyAmount(data, sale.customerName, appliedTarget)
    }
  }

  return countedOnBill
}

export function normalizeCustomerAdvanceKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function customerAdvanceEntriesForName(
  data: AppData,
  customerName: string,
): CustomerAdvanceLedgerEntry[] {
  const key = normalizeCustomerAdvanceKey(customerName)
  if (!key) return []
  return (data.customerAdvances ?? []).filter(
    (row) => normalizeCustomerAdvanceKey(row.customerName) === key,
  )
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}

function advanceBalanceDelta(kind: CustomerAdvanceKind, amount: number): number {
  if (kind === 'applied' || kind === 'refunded') return -amount
  return amount
}

export function customerAdvanceBalance(data: AppData, customerName: string): number {
  const rows = customerAdvanceEntriesForName(data, customerName)
  let balance = 0
  for (const row of rows) {
    balance += advanceBalanceDelta(row.kind, row.amount)
  }
  return roundMoney(Math.max(0, balance))
}

export interface CustomerAdvanceBreakdown {
  cash: number
  bank: number
  /** Return credits held as advance (not drawer cash until applied). */
  credit: number
  total: number
}

function deductLegacyApplied(
  amount: number,
  pools: { cash: number; bank: number; credit: number },
) {
  let remaining = amount
  const fromCredit = Math.min(pools.credit, remaining)
  pools.credit = roundMoney(pools.credit - fromCredit)
  remaining = roundMoney(remaining - fromCredit)
  if (remaining <= 0) return
  const funded = pools.cash + pools.bank
  if (funded <= 0) return
  const cashTake = roundMoney(Math.min(pools.cash, remaining * (pools.cash / funded)))
  const bankTake = roundMoney(Math.min(pools.bank, remaining - cashTake))
  pools.cash = roundMoney(pools.cash - cashTake)
  pools.bank = roundMoney(pools.bank - bankTake)
}

/** Replay ledger to current cash / bank / return-credit pools for one customer. */
export function customerAdvanceBalanceBreakdown(
  data: AppData,
  customerName: string,
): CustomerAdvanceBreakdown {
  const rows = [...customerAdvanceEntriesForName(data, customerName)].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
  const pools = { cash: 0, bank: 0, credit: 0 }
  for (const row of rows) {
    if (row.kind === 'received') {
      pools.cash = roundMoney(pools.cash + (row.cashAmount ?? 0))
      pools.bank = roundMoney(pools.bank + (row.bankAmount ?? 0))
    } else if (row.kind === 'from_return') {
      pools.credit = roundMoney(pools.credit + row.amount)
    } else if (row.kind === 'applied' || row.kind === 'refunded') {
      const cashPart = row.cashAmount ?? 0
      const bankPart = row.bankAmount ?? 0
      const creditPart = roundMoney(Math.max(0, row.amount - cashPart - bankPart))
      if (cashPart > 0 || bankPart > 0 || creditPart > 0) {
        pools.cash = roundMoney(Math.max(0, pools.cash - cashPart))
        pools.bank = roundMoney(Math.max(0, pools.bank - bankPart))
        pools.credit = roundMoney(Math.max(0, pools.credit - creditPart))
      } else {
        deductLegacyApplied(row.amount, pools)
      }
    }
  }
  pools.cash = Math.max(0, pools.cash)
  pools.bank = Math.max(0, pools.bank)
  pools.credit = Math.max(0, pools.credit)
  return {
    cash: pools.cash,
    bank: pools.bank,
    credit: pools.credit,
    total: roundMoney(pools.cash + pools.bank + pools.credit),
  }
}

/** How an advance application is drawn from current pools (credit first, then cash/bank proportionally). */
export function allocateAdvanceApplication(
  amount: number,
  pools: CustomerAdvanceBreakdown,
): { cash: number; bank: number; credit: number } {
  const total = roundMoney(amount)
  if (total <= 0) return { cash: 0, bank: 0, credit: 0 }
  let remaining = total
  const credit = roundMoney(Math.min(pools.credit, remaining))
  remaining = roundMoney(remaining - credit)
  let cash = 0
  let bank = 0
  if (remaining > 0) {
    const funded = pools.cash + pools.bank
    if (funded > 0) {
      cash = roundMoney(Math.min(pools.cash, remaining * (pools.cash / funded)))
      bank = roundMoney(Math.min(pools.bank, remaining - cash))
      if (cash + bank < remaining) {
        bank = roundMoney(remaining - cash)
      }
    }
  }
  return { cash, bank, credit }
}

/** Refund payout from drawable cash/bank pools (return credit must be converted manually). */
export function allocateAdvanceRefund(
  amount: number,
  pools: CustomerAdvanceBreakdown,
): { cash: number; bank: number } {
  let remaining = roundMoney(Math.min(amount, pools.total))
  const drawable = roundMoney(pools.cash + pools.bank)
  remaining = roundMoney(Math.min(remaining, drawable))
  if (remaining <= 0) return { cash: 0, bank: 0 }
  const funded = pools.cash + pools.bank
  if (funded <= 0) return { cash: 0, bank: 0 }
  const cash = roundMoney(Math.min(pools.cash, remaining * (pools.cash / funded)))
  const bank = roundMoney(remaining - cash)
  return { cash, bank }
}

export function customerAdvanceCashBankTotals(
  data: AppData,
): { cash: number; bank: number } {
  let cash = 0
  let bank = 0
  for (const row of data.customerAdvances ?? []) {
    if (row.kind === 'received') {
      cash += row.cashAmount ?? 0
      bank += row.bankAmount ?? 0
    } else if (row.kind === 'refunded') {
      cash -= row.cashAmount ?? 0
      bank -= row.bankAmount ?? 0
    }
  }
  return {
    cash: roundMoney(cash),
    bank: roundMoney(bank),
  }
}

export interface CustomerAdvanceSummaryRow {
  customerName: string
  balance: number
  lastAt: string
}

function buildCustomerAdvanceSummariesUncached(data: AppData): CustomerAdvanceSummaryRow[] {
  const byKey = new Map<string, { display: string; balance: number; lastAt: string }>()
  for (const row of data.customerAdvances ?? []) {
    const key = normalizeCustomerAdvanceKey(row.customerName)
    if (!key) continue
    const prev = byKey.get(key) ?? { display: row.customerName.trim(), balance: 0, lastAt: row.at }
    const delta = advanceBalanceDelta(row.kind, row.amount)
    const balance = Math.round((prev.balance + delta) * 100) / 100
    const lastAt =
      new Date(row.at).getTime() > new Date(prev.lastAt).getTime() ? row.at : prev.lastAt
    byKey.set(key, {
      display: prev.display || row.customerName.trim(),
      balance: Math.max(0, balance),
      lastAt,
    })
  }
  return [...byKey.values()]
    .filter((row) => row.balance > 0.009)
    .map((row) => ({
      customerName: row.display,
      balance: row.balance,
      lastAt: row.lastAt,
    }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

export const buildCustomerAdvanceSummaries = memoByDataRef(buildCustomerAdvanceSummariesUncached)

export interface CustomerAdvanceGroup {
  customerName: string
  key: string
  balance: number
  lastAt: string
  isActive: boolean
  /** Newest first — for history display. */
  entries: CustomerAdvanceLedgerEntry[]
}

function buildCustomerAdvanceGroupsUncached(data: AppData): CustomerAdvanceGroup[] {
  const byKey = new Map<string, { display: string; entries: CustomerAdvanceLedgerEntry[] }>()
  for (const row of data.customerAdvances ?? []) {
    const key = normalizeCustomerAdvanceKey(row.customerName)
    if (!key) continue
    const prev = byKey.get(key) ?? { display: row.customerName.trim(), entries: [] }
    if (!prev.display) prev.display = row.customerName.trim()
    prev.entries.push(row)
    byKey.set(key, prev)
  }
  const groups: CustomerAdvanceGroup[] = []
  for (const [key, { display, entries }] of byKey) {
    let balance = 0
    for (const entry of entries) {
      balance += advanceBalanceDelta(entry.kind, entry.amount)
    }
    balance = roundMoney(Math.max(0, balance))
    const sorted = [...entries].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    )
    const lastAt = sorted[0]?.at ?? ''
    groups.push({
      customerName: display || key,
      key,
      balance,
      lastAt,
      isActive: balance > 0.009,
      entries: sorted,
    })
  }
  return groups.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
  })
}

export const buildCustomerAdvanceGroups = memoByDataRef(buildCustomerAdvanceGroupsUncached)

export function advanceEntryIsOutflow(kind: CustomerAdvanceKind): boolean {
  return kind === 'applied' || kind === 'refunded'
}

export type AdvanceStatementStatusTag = 'Open' | 'Refund' | 'Advance' | 'Applied' | 'Return'

export interface AdvanceStatementRow {
  id: string
  at: string
  label: string
  detail?: string
  statusTag?: AdvanceStatementStatusTag
  credit: number
  debit: number
  balance: number
  saleId?: string
}

function statementStatusTag(
  kind: CustomerAdvanceKind,
  isLastOpen: boolean,
): AdvanceStatementStatusTag | undefined {
  if (isLastOpen) return 'Open'
  if (kind === 'received') return 'Advance'
  if (kind === 'refunded') return 'Refund'
  if (kind === 'applied') return 'Applied'
  if (kind === 'from_return') return 'Return'
  return undefined
}

function statementLabel(
  entry: CustomerAdvanceLedgerEntry,
  sale?: Sale,
): { label: string; detail?: string } {
  if (entry.kind === 'received') {
    const ch = entryChannelShort(entry)
    return {
      label: 'Advance created',
      detail: ch ? `${ch}${entry.note ? ` · ${entry.note}` : ''}` : entry.note,
    }
  }
  if (entry.kind === 'from_return') {
    return {
      label: 'Return → advance',
      detail: entry.note?.trim() || 'Return credited to advance',
    }
  }
  if (entry.kind === 'refunded') {
    const ch = refundChannelShort(entry)
    return {
      label: 'Refund',
      detail: ch ? `${ch}${entry.note ? ` · ${entry.note}` : ''}` : entry.note,
    }
  }
  if (entry.kind === 'applied') {
    const bill = sale?.billAmount
    const billPart =
      bill != null && bill > 0 ? `Bill ${formatMoney(bill)}` : 'Bill'
    return {
      label: 'Applied to bill',
      detail: `Advance applied against ${billPart}${entry.note ? ` · ${entry.note}` : ''}`,
    }
  }
  return { label: customerAdvanceKindLabel(entry.kind), detail: entry.note }
}

function entryChannelShort(entry: CustomerAdvanceLedgerEntry): string {
  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (cash > 0 && bank > 0) return 'Cash & bank'
  if (bank > 0) return 'Bank'
  if (cash > 0) return 'Cash'
  return ''
}

function refundChannelShort(entry: CustomerAdvanceLedgerEntry): string {
  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (bank > 0 && cash <= 0) return 'Paid via bank'
  if (cash > 0 && bank <= 0) return 'Paid via cash'
  if (cash > 0 && bank > 0) return 'Cash & bank'
  return 'Refund payout'
}

/** Chronological statement with running balance (oldest first). */
export function buildCustomerAdvanceStatement(
  entries: CustomerAdvanceLedgerEntry[],
  sales: Sale[],
  openBalance: number,
): AdvanceStatementRow[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
  const saleById = new Map(sales.map((s) => [s.id, s]))
  let running = 0
  const rows: AdvanceStatementRow[] = []

  for (const entry of sorted) {
    const out = advanceEntryIsOutflow(entry.kind)
    const credit = out ? 0 : entry.amount
    const debit = out ? entry.amount : 0
    running = roundMoney(Math.max(0, running + credit - debit))
    const sale = entry.saleId ? saleById.get(entry.saleId) : undefined
    const { label, detail } = statementLabel(entry, sale)
    rows.push({
      id: entry.id,
      at: entry.at,
      label,
      detail,
      statusTag: statementStatusTag(entry.kind, false),
      credit,
      debit,
      balance: running,
      saleId: entry.saleId,
    })
  }

  if (openBalance > 0.009) {
    const lastAt = sorted[sorted.length - 1]?.at ?? new Date().toISOString()
    rows.push({
      id: '__open__',
      at: lastAt,
      label: 'Open balance',
      detail: 'Available advance',
      statusTag: 'Open',
      credit: 0,
      debit: 0,
      balance: openBalance,
    })
  }

  return rows
}

export interface AdvancePortfolioTotals {
  /** All-time advance received (cash/bank) plus return → advance credits. */
  totalReceived: number
  /** Sum of open customer advance balances now. */
  totalOpen: number
}

export function advancePortfolioTotals(data: AppData): AdvancePortfolioTotals {
  let totalReceived = 0
  for (const row of data.customerAdvances ?? []) {
    if (row.kind === 'received' || row.kind === 'from_return') {
      totalReceived += row.amount
    }
  }
  let totalOpen = 0
  for (const group of buildCustomerAdvanceGroupsUncached(data)) {
    if (group.isActive) totalOpen += group.balance
  }
  return {
    totalReceived: roundMoney(totalReceived),
    totalOpen: roundMoney(totalOpen),
  }
}

export interface GlobalAdvanceStatementRow extends AdvanceStatementRow {
  customerName: string
}

/** All customers — chronological (oldest first) with running total advance held. */
export function buildGlobalAdvanceStatement(data: AppData): GlobalAdvanceStatementRow[] {
  const saleById = new Map(data.sales.map((s) => [s.id, s]))
  const sorted = [...(data.customerAdvances ?? [])].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
  let running = 0
  const rows: GlobalAdvanceStatementRow[] = []

  for (const entry of sorted) {
    const out = advanceEntryIsOutflow(entry.kind)
    const credit = out ? 0 : entry.amount
    const debit = out ? entry.amount : 0
    running = roundMoney(Math.max(0, running + credit - debit))
    const sale = entry.saleId ? saleById.get(entry.saleId) : undefined
    const { label, detail } = statementLabel(entry, sale)
    rows.push({
      id: entry.id,
      at: entry.at,
      customerName: entry.customerName.trim(),
      label,
      detail,
      statusTag: statementStatusTag(entry.kind, false),
      credit,
      debit,
      balance: running,
      saleId: entry.saleId,
    })
  }

  return rows
}

export function appendCustomerAdvanceEntry(
  data: AppData,
  entry: Omit<CustomerAdvanceLedgerEntry, 'id'> & { id?: string },
): AppData {
  const row: CustomerAdvanceLedgerEntry = {
    ...entry,
    id: entry.id ?? crypto.randomUUID(),
    customerName: entry.customerName.trim(),
    amount: Math.round(entry.amount * 100) / 100,
  }
  return {
    ...data,
    customerAdvances: [row, ...(data.customerAdvances ?? [])],
  }
}

export type AdvanceApplySaleOption = {
  id: string
  label: string
  due: number
}

/** Open pending bills for a customer that can receive an advance credit. */
export function customerOpenSalesForAdvanceApply(
  data: AppData,
  customerName: string,
  preferredSaleId?: string | null,
): AdvanceApplySaleOption[] {
  const key = normalizeCustomerAdvanceKey(customerName)
  const options: AdvanceApplySaleOption[] = []
  const seen = new Set<string>()

  function pushSale(sale: (typeof data.sales)[number], force = false) {
    if (seen.has(sale.id)) return
    if (sale.status !== 'pending' && !force) return
    const isCredit = sale.payType === 'credit' || sale.pendingPayType === 'credit'
    const isCheque = sale.payType === 'cheque' || sale.pendingPayType === 'cheque'
    const due = Math.max(
      0,
      Math.round(
        (sale.status === 'pending'
          ? isCredit
            ? Math.max(sale.billAmount ?? 0, sale.creditAmount ?? 0)
            : isCheque
              ? Math.max(sale.billAmount ?? 0, sale.chequeAmount ?? 0)
              : sale.billAmount
          : Math.max(
              0,
              (sale.originalBillAmount ?? sale.billAmount) - (sale.customerAdvanceApplied ?? 0),
            )) * 100,
      ) / 100,
    )
    if (due <= 0.01 && !force) return
    const kind =
      sale.status !== 'pending'
        ? 'Sale'
        : isCredit
          ? 'Credit'
          : isCheque
            ? 'Cheque'
            : 'Pending'
    const when = new Date(sale.createdAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })
    const who = (sale.customerName ?? '').trim()
    options.push({
      id: sale.id,
      due: Math.max(due, 0.01),
      label: `${who ? `${who} · ` : ''}${kind} · ${formatMoney(due)} · ${when}`,
    })
    seen.add(sale.id)
  }

  if (preferredSaleId) {
    const preferred = data.sales.find((sale) => sale.id === preferredSaleId)
    if (preferred) pushSale(preferred, true)
  }

  if (key) {
    for (const sale of data.sales) {
      const name = (sale.customerName ?? '').trim()
      if (normalizeCustomerAdvanceKey(name) !== key) continue
      pushSale(sale)
    }
  }

  return options.sort((a, b) => b.due - a.due)
}

export type ReceivedAdvanceSettingsRow = {
  id: string
  customerName: string
  amount: number
  remaining: number
  applied: number
  at: string
  payLabel: string
  note?: string
  countInSalesOnReceive: boolean
}

/** FIFO remaining open amount for each received / return-credit advance entry. */
export function receivedAdvanceRemainingById(data: AppData): Map<string, number> {
  const byCustomer = new Map<string, CustomerAdvanceLedgerEntry[]>()
  for (const row of data.customerAdvances ?? []) {
    const key = normalizeCustomerAdvanceKey(row.customerName)
    if (!key) continue
    const list = byCustomer.get(key) ?? []
    list.push(row)
    byCustomer.set(key, list)
  }

  const remainingById = new Map<string, number>()

  for (const entries of byCustomer.values()) {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    )
    type Lot = { id: string; remaining: number }
    const lots: Lot[] = []
    for (const row of sorted) {
      if (row.kind === 'received' || row.kind === 'from_return') {
        lots.push({ id: row.id, remaining: row.amount })
        remainingById.set(row.id, row.amount)
      } else if (row.kind === 'applied' || row.kind === 'refunded') {
        let need = row.amount
        for (const lot of lots) {
          if (need <= 0.01) break
          if (lot.remaining <= 0.01) continue
          const take = Math.min(lot.remaining, need)
          lot.remaining = roundMoney(lot.remaining - take)
          remainingById.set(lot.id, lot.remaining)
          need = roundMoney(need - take)
        }
      }
    }
  }

  return remainingById
}

export function receivedAdvanceCountsInSales(
  data: AppData,
  entry: CustomerAdvanceLedgerEntry,
): boolean {
  if (entry.kind !== 'received') return false
  if (entry.countInSalesOnReceive === true) return true
  if (entry.countInSalesOnReceive === false) return false
  return getAdvanceSalesCountMode(data) === 'on_receive'
}

/** All cash advances received — for Advance Settings list + toggles. */
export function listReceivedAdvancesForSettings(data: AppData): ReceivedAdvanceSettingsRow[] {
  const remainingById = receivedAdvanceRemainingById(data)
  const rows: ReceivedAdvanceSettingsRow[] = []
  for (const entry of data.customerAdvances ?? []) {
    if (entry.kind !== 'received' || entry.amount <= 0.01) continue
    const remaining = remainingById.get(entry.id) ?? 0
    const applied = roundMoney(Math.max(0, entry.amount - remaining))
    const cash = entry.cashAmount ?? 0
    const bank = entry.bankAmount ?? 0
    const payLabel =
      cash > 0 && bank > 0 ? 'Cash + Bank' : bank > 0 ? 'Bank' : 'Cash'
    rows.push({
      id: entry.id,
      customerName: entry.customerName.trim(),
      amount: entry.amount,
      remaining,
      applied,
      at: entry.at,
      payLabel,
      note: entry.note,
      countInSalesOnReceive: receivedAdvanceCountsInSales(data, entry),
    })
  }
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export type AdvanceSalesBillBuild = {
  id: string
  customerName: string
  at: string
  amount: number
  remaining: number
  applied: number
  cashAmount: number
  bankAmount: number
  note?: string
}

/** Advance payments that count toward Sales in a date range (for report list). */
export function listAdvanceSalesForReport(
  data: AppData,
  fromDate?: string,
  toDate?: string,
): AdvanceSalesBillBuild[] {
  const remainingById = receivedAdvanceRemainingById(data)
  const rows: AdvanceSalesBillBuild[] = []
  for (const entry of data.customerAdvances ?? []) {
    if (entry.kind !== 'received' || entry.amount <= 0.01) continue
    if (!receivedAdvanceCountsInSales(data, entry)) continue
    if (fromDate || toDate) {
      const day = localDayTimestamp(entry.at)
      if (fromDate && day < inputDateTimestamp(fromDate)) continue
      if (toDate && day > inputDateTimestamp(toDate)) continue
    }
    const remaining = remainingById.get(entry.id) ?? 0
    const applied = roundMoney(Math.max(0, entry.amount - remaining))
    rows.push({
      id: entry.id,
      customerName: entry.customerName.trim(),
      at: entry.at,
      amount: entry.amount,
      remaining,
      applied,
      cashAmount: entry.cashAmount ?? 0,
      bankAmount: entry.bankAmount ?? 0,
      note: entry.note,
    })
  }
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export type AppliedAdvanceSettingsRow = {
  id: string
  customerName: string
  amount: number
  at: string
  saleId: string
  saleLabel: string
  note?: string
}

/** Applied advances linked to sales — for Advance Settings unapply list. */
export function listAppliedAdvancesForSettings(data: AppData): AppliedAdvanceSettingsRow[] {
  const rows: AppliedAdvanceSettingsRow[] = []
  for (const entry of data.customerAdvances ?? []) {
    if (entry.kind !== 'applied' || !entry.saleId || entry.amount <= 0.01) continue
    const sale = data.sales.find((row) => row.id === entry.saleId)
    const when = new Date(entry.at).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    const saleDue = sale
      ? sale.status === 'pending'
        ? sale.billAmount
        : sale.originalBillAmount ?? sale.billAmount
      : entry.amount
    const saleStatus = sale?.status === 'pending' ? 'Open' : sale ? 'Settled' : 'Missing bill'
    rows.push({
      id: entry.id,
      customerName: entry.customerName.trim(),
      amount: entry.amount,
      at: entry.at,
      saleId: entry.saleId,
      saleLabel: `${saleStatus} · ${formatMoney(saleDue)} · ${when}`,
      note: entry.note,
    })
  }
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export function customerAdvanceKindLabel(kind: CustomerAdvanceKind): string {
  if (kind === 'received') return 'Advance created'
  if (kind === 'from_return') return 'Return → advance'
  if (kind === 'refunded') return 'Advance refunded'
  return 'Advance applied'
}

export interface AdvanceLedgerRow {
  id: string
  customerName: string
  at: string
  kind: CustomerAdvanceKind
  amount: number
  channel: 'cash' | 'bank' | 'return' | 'applied' | 'refunded' | 'split'
  note?: string
  saleId?: string
}

function advanceLedgerChannel(
  entry: CustomerAdvanceLedgerEntry,
): AdvanceLedgerRow['channel'] {
  if (entry.kind === 'applied') {
    const cash = entry.cashAmount ?? 0
    const bank = entry.bankAmount ?? 0
    if (cash > 0 && bank > 0) return 'split'
    return 'applied'
  }
  if (entry.kind === 'from_return') return 'return'
  if (entry.kind === 'refunded') return 'refunded'
  const cash = entry.cashAmount ?? 0
  const bank = entry.bankAmount ?? 0
  if (cash > 0 && bank > 0) return 'split'
  if (bank > 0) return 'bank'
  return 'cash'
}

function buildAdvanceLedgerUncached(data: AppData): AdvanceLedgerRow[] {
  return [...(data.customerAdvances ?? [])]
    .map((row) => ({
      id: row.id,
      customerName: row.customerName,
      at: row.at,
      kind: row.kind,
      amount: row.amount,
      channel: advanceLedgerChannel(row),
      note: row.note,
      saleId: row.saleId,
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export const buildAdvanceLedger = memoByDataRef(buildAdvanceLedgerUncached)

export interface ReturnHistoryRow {
  id: string
  customerName: string
  at: string
  amount: number
  itemLabel: string
  source: 'advance' | 'bill'
  saleId?: string
}

function buildReturnHistoryUncached(data: AppData): ReturnHistoryRow[] {
  const rows: ReturnHistoryRow[] = []

  for (const entry of data.customerAdvances ?? []) {
    if (entry.kind !== 'from_return') continue
    rows.push({
      id: entry.id,
      customerName: entry.customerName,
      at: entry.at,
      amount: entry.amount,
      itemLabel: entry.note?.trim() || 'Return',
      source: 'advance',
    })
  }

  for (const sale of data.sales) {
    const customerName = sale.customerName?.trim()
    if (!sale.returns?.length) continue
    for (const row of sale.returns) {
      rows.push({
        id: row.id,
        customerName: customerName || '—',
        at: row.createdAt,
        amount: row.amount,
        itemLabel: row.itemName,
        source: 'bill',
        saleId: sale.id,
      })
    }
  }

  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export const buildReturnHistory = memoByDataRef(buildReturnHistoryUncached)

export interface AdvanceLedgerRow {
  id: string
  customerName: string
  at: string
  amount: number
  kind: CustomerAdvanceKind
  channel: 'cash' | 'bank' | 'return' | 'applied' | 'refunded' | 'split'
  note?: string
  saleId?: string
}

const advanceRowChannel = advanceLedgerChannel

function buildAdvanceLedgerRowsUncached(data: AppData): AdvanceLedgerRow[] {
  return [...(data.customerAdvances ?? [])]
    .map((row) => ({
      id: row.id,
      customerName: row.customerName,
      at: row.at,
      amount: row.amount,
      kind: row.kind,
      channel: advanceRowChannel(row),
      note: row.note,
      saleId: row.saleId,
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export const buildAdvanceLedgerRows = memoByDataRef(buildAdvanceLedgerRowsUncached)

export interface CustomerReturnHistoryRow {
  id: string
  customerName: string
  at: string
  amount: number
  itemLabel: string
  source: 'bill' | 'advance'
  saleId?: string
}

function buildCustomerReturnHistoryUncached(data: AppData): CustomerReturnHistoryRow[] {
  const rows: CustomerReturnHistoryRow[] = []
  for (const sale of data.sales) {
    const name = sale.customerName?.trim() || '—'
    for (const row of sale.returns ?? []) {
      rows.push({
        id: row.id,
        customerName: name,
        at: row.createdAt,
        amount: row.amount,
        itemLabel: formatSaleReturnLine(row),
        source: 'bill',
        saleId: sale.id,
      })
    }
  }
  for (const row of data.customerAdvances ?? []) {
    if (row.kind !== 'from_return') continue
    rows.push({
      id: row.returnEntryId ?? row.id,
      customerName: row.customerName,
      at: row.at,
      amount: row.amount,
      itemLabel: row.note?.trim() || 'Return credited to advance',
      source: 'advance',
    })
  }
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export const buildCustomerReturnHistory = memoByDataRef(buildCustomerReturnHistoryUncached)
