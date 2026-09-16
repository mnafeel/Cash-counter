import type { AppData, CustomerAdvanceLedgerEntry, CustomerAdvanceKind, Sale } from '../types'
import { formatMoney } from './format'
import { formatSaleReturnLine } from './saleReturns'
import { memoByDataRef } from './memoByDataRef'

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

export type AdvanceStatementStatusTag = 'Open' | 'Refund' | 'Advance' | 'Adjusted' | 'Return'

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
  if (kind === 'applied') return 'Adjusted'
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
      label: 'Bill adjustment',
      detail: `Advance adjusted against ${billPart}${entry.note ? ` · ${entry.note}` : ''}`,
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
