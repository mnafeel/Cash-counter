import type { AppData, Loan, LoanKind, LoanPaySource, LoanSettlementEvent, LoanStatus } from '../types'
import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import { formatDate } from './format'

export interface LoanOverview {
  receivableTotal: number
  receivableCount: number
  payableTotal: number
  payableCount: number
  settledCount: number
}

export interface LoanListItem extends Loan {
  dateLabel: string
  settledDateLabel?: string
  kindLabel: string
  statusLabel: string
  paySourceLabel: string
  remainingAmount: number
}

export function loanSettlementEvents(loan: Loan): LoanSettlementEvent[] {
  if (loan.settlementEvents && loan.settlementEvents.length > 0) return loan.settlementEvents
  if (loan.status === 'settled' && loan.settledAt) {
    return [
      {
        id: `${loan.id}-legacy-settlement`,
        at: loan.settledAt,
        amount: loan.amount,
        paySource: loan.settlementPaySource ?? 'cash',
      },
    ]
  }
  return []
}

export function loanPaidAmount(loan: Loan): number {
  if (loan.paidAmount != null && loan.paidAmount > 0) return loan.paidAmount
  const events = loanSettlementEvents(loan)
  if (events.length > 0) return events.reduce((sum, event) => sum + event.amount, 0)
  return loan.status === 'settled' ? loan.amount : 0
}

export function loanRemainingAmount(loan: Loan): number {
  return Math.max(0, loan.amount - loanPaidAmount(loan))
}

export function buildLoanOverview(data: AppData): LoanOverview {
  const loans = data.loans ?? []
  let receivableTotal = 0
  let receivableCount = 0
  let payableTotal = 0
  let payableCount = 0
  let settledCount = 0

  for (const loan of loans) {
    const remaining = loanRemainingAmount(loan)
    if (remaining <= 0) {
      settledCount += 1
      continue
    }
    if (loan.kind === 'lend') {
      receivableTotal += remaining
      receivableCount += 1
    } else {
      payableTotal += remaining
      payableCount += 1
    }
  }

  return { receivableTotal, receivableCount, payableTotal, payableCount, settledCount }
}

function loanKindLabel(kind: LoanKind): string {
  return kind === 'lend' ? 'Given' : 'Taken'
}

function loanStatusLabel(_status: LoanStatus, remaining: number): string {
  return remaining <= 0 ? 'Settled' : 'Pending'
}

function paySourceLabel(source: LoanPaySource): string {
  return source === 'bank' ? '🏦 Bank' : '💵 Cash'
}

export function decorateLoan(loan: Loan): LoanListItem {
  const remaining = loanRemainingAmount(loan)
  const paid = loanPaidAmount(loan)
  const events = loanSettlementEvents(loan)
  const lastSettlement = events.length > 0 ? events[events.length - 1] : undefined
  return {
    ...loan,
    dateLabel: formatDate(loan.createdAt),
    settledDateLabel: lastSettlement ? formatDate(lastSettlement.at) : loan.settledAt ? formatDate(loan.settledAt) : undefined,
    kindLabel: loanKindLabel(loan.kind),
    statusLabel: loanStatusLabel(loan.status, remaining),
    paySourceLabel: paySourceLabel(loan.paySource),
    remainingAmount: remaining,
    paidAmount: paid,
  }
}

export function buildLoanList(data: AppData, status: LoanStatus): LoanListItem[] {
  return (data.loans ?? [])
    .filter((loan) => {
      const remaining = loanRemainingAmount(loan)
      return status === 'settled' ? remaining <= 0 : remaining > 0
    })
    .map(decorateLoan)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function searchLoans(loans: LoanListItem[], query: string): LoanListItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return loans
  return loans.filter((loan) => {
    if (loan.personName.toLowerCase().includes(q)) return true
    if (loan.note?.toLowerCase().includes(q)) return true
    if (String(loan.amount).includes(q)) return true
    if (String(loan.remainingAmount).includes(q)) return true
    return false
  })
}

/** Person-level totals for search — to collect / to return across all matching loans. */
export interface LoanPersonSearchSummary {
  personName: string
  /** Open lend balance — money to receive from them */
  toCollect: number
  /** Open borrow balance — money to pay them */
  toPay: number
  openCount: number
  settledCount: number
}

export function summarizeLoanPeopleForSearch(
  data: AppData,
  query: string,
): LoanPersonSearchSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const byPerson = new Map<string, LoanPersonSearchSummary>()

  for (const loan of data.loans ?? []) {
    const name = loan.personName.trim()
    if (!name.toLowerCase().includes(q)) continue

    const key = name.toLowerCase()
    let entry = byPerson.get(key)
    if (!entry) {
      entry = {
        personName: name,
        toCollect: 0,
        toPay: 0,
        openCount: 0,
        settledCount: 0,
      }
      byPerson.set(key, entry)
    }

    const remaining = loanRemainingAmount(loan)
    if (remaining <= 0) {
      entry.settledCount += 1
      continue
    }
    entry.openCount += 1
    if (loan.kind === 'lend') entry.toCollect += remaining
    else entry.toPay += remaining
  }

  return [...byPerson.values()].sort((a, b) => a.personName.localeCompare(b.personName))
}

export function loanCashToDrawer(loan: Loan): number {
  let impact = 0
  if (loan.kind === 'lend') {
    if (loan.paySource === 'cash') impact -= loan.amount
  } else {
    impact += loan.amount
  }
  for (const event of loanSettlementEvents(loan)) {
    if (loan.kind === 'lend' && event.paySource === 'cash') impact += event.amount
    if (loan.kind === 'borrow' && event.paySource === 'cash') impact -= event.amount
  }
  return impact
}

export function loanBankToBalance(loan: Loan): number {
  let impact = 0
  if (loan.kind === 'lend' && loan.paySource === 'bank') impact -= loan.amount
  for (const event of loanSettlementEvents(loan)) {
    if (loan.kind === 'lend' && event.paySource === 'bank') impact += event.amount
    if (loan.kind === 'borrow' && event.paySource === 'bank') impact -= event.amount
  }
  return impact
}

export interface LoanReportSummary {
  count: number
  givenTotal: number
  givenCount: number
  takenTotal: number
  takenCount: number
  pendingTotal: number
  pendingCount: number
  settledTotal: number
  settledCount: number
}

export function buildLoanReportItems(data: AppData): LoanListItem[] {
  return (data.loans ?? [])
    .map(decorateLoan)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function filterLoanReportItems(
  items: LoanListItem[],
  dateFilter: CashDateFilter,
  selectedDate: string,
  rangeTo?: string,
): LoanListItem[] {
  return items.filter((item) =>
    matchesCashDateFilter(item.createdAt, dateFilter, selectedDate, rangeTo),
  )
}

export function summarizeLoanReportItems(items: LoanListItem[]): LoanReportSummary {
  let givenTotal = 0
  let givenCount = 0
  let takenTotal = 0
  let takenCount = 0
  let pendingTotal = 0
  let pendingCount = 0
  let settledTotal = 0
  let settledCount = 0

  for (const loan of items) {
    if (loan.kind === 'lend') {
      givenTotal += loan.amount
      givenCount += 1
    } else {
      takenTotal += loan.amount
      takenCount += 1
    }
    if (loan.remainingAmount <= 0) {
      settledTotal += loan.amount
      settledCount += 1
    } else {
      pendingTotal += loan.remainingAmount
      pendingCount += 1
    }
  }

  return {
    count: items.length,
    givenTotal,
    givenCount,
    takenTotal,
    takenCount,
    pendingTotal,
    pendingCount,
    settledTotal,
    settledCount,
  }
}

/** Money that left the drawer as a loan (given) or loan repayment (returned). */
export interface LoanOutflowHistoryItem {
  id: string
  amount: number
  date: string
  name: string
  kind: 'given' | 'returned'
  paySource: LoanPaySource
  note?: string
}

export interface LoanOutflowSummary {
  total: number
  count: number
  givenTotal: number
  givenCount: number
  returnedTotal: number
  returnedCount: number
}

export function buildLoanOutflowHistoryItems(data: AppData): LoanOutflowHistoryItem[] {
  const items: LoanOutflowHistoryItem[] = []
  for (const loan of data.loans ?? []) {
    if (loan.kind === 'lend') {
      items.push({
        id: `${loan.id}-give`,
        amount: loan.amount,
        date: loan.createdAt,
        name: loan.personName,
        kind: 'given',
        paySource: loan.paySource,
        note: loan.note,
      })
      continue
    }
    for (const [index, event] of loanSettlementEvents(loan).entries()) {
      items.push({
        id: `${loan.id}-return-${event.id ?? index}`,
        amount: event.amount,
        date: event.at,
        name: loan.personName,
        kind: 'returned',
        paySource: event.paySource,
        note: loan.note,
      })
    }
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function filterLoanOutflowHistoryItems(
  items: LoanOutflowHistoryItem[],
  dateFilter: CashDateFilter,
  selectedDate: string,
  rangeTo?: string,
): LoanOutflowHistoryItem[] {
  return items.filter((item) =>
    matchesCashDateFilter(item.date, dateFilter, selectedDate, rangeTo),
  )
}

export function summarizeLoanOutflows(items: LoanOutflowHistoryItem[]): LoanOutflowSummary {
  const summary: LoanOutflowSummary = {
    total: 0,
    count: 0,
    givenTotal: 0,
    givenCount: 0,
    returnedTotal: 0,
    returnedCount: 0,
  }
  for (const item of items) {
    summary.total += item.amount
    summary.count += 1
    if (item.kind === 'given') {
      summary.givenTotal += item.amount
      summary.givenCount += 1
    } else {
      summary.returnedTotal += item.amount
      summary.returnedCount += 1
    }
  }
  return summary
}
