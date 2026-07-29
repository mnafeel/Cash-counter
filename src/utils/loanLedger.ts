import type { AppData, Loan, LoanKind, LoanPaySource, LoanStatus } from '../types'
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
}

export function buildLoanOverview(data: AppData): LoanOverview {
  const loans = data.loans ?? []
  let receivableTotal = 0
  let receivableCount = 0
  let payableTotal = 0
  let payableCount = 0
  let settledCount = 0

  for (const loan of loans) {
    if (loan.status === 'settled') {
      settledCount += 1
      continue
    }
    if (loan.kind === 'lend') {
      receivableTotal += loan.amount
      receivableCount += 1
    } else {
      payableTotal += loan.amount
      payableCount += 1
    }
  }

  return { receivableTotal, receivableCount, payableTotal, payableCount, settledCount }
}

function loanKindLabel(kind: LoanKind): string {
  return kind === 'lend' ? 'Given' : 'Taken'
}

function loanStatusLabel(status: LoanStatus): string {
  return status === 'settled' ? 'Settled' : 'Pending'
}

function paySourceLabel(source: LoanPaySource): string {
  return source === 'bank' ? '🏦 Bank' : '💵 Cash'
}

export function decorateLoan(loan: Loan): LoanListItem {
  return {
    ...loan,
    dateLabel: formatDate(loan.createdAt),
    settledDateLabel: loan.settledAt ? formatDate(loan.settledAt) : undefined,
    kindLabel: loanKindLabel(loan.kind),
    statusLabel: loanStatusLabel(loan.status),
    paySourceLabel: paySourceLabel(loan.paySource),
  }
}

export function buildLoanList(data: AppData, status: LoanStatus): LoanListItem[] {
  return (data.loans ?? [])
    .filter((loan) => loan.status === status)
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
    return false
  })
}

export function loanCashToDrawer(loan: Loan): number {
  let impact = 0
  if (loan.kind === 'lend') {
    if (loan.paySource === 'cash') impact -= loan.amount
  } else {
    impact += loan.amount
  }
  if (loan.status === 'settled') {
    if (loan.kind === 'lend' && loan.settlementPaySource === 'cash') impact += loan.amount
    if (loan.kind === 'borrow' && loan.settlementPaySource === 'cash') impact -= loan.amount
  }
  return impact
}

export function loanBankToBalance(loan: Loan): number {
  let impact = 0
  if (loan.kind === 'lend' && loan.paySource === 'bank') impact -= loan.amount
  if (loan.status === 'settled') {
    if (loan.kind === 'lend' && loan.settlementPaySource === 'bank') impact += loan.amount
    if (loan.kind === 'borrow' && loan.settlementPaySource === 'bank') impact -= loan.amount
  }
  return impact
}
