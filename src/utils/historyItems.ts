import type { AppData } from '../types'
import { formatDate, formatMoney } from './format'

export type HistoryItemType = 'sale' | 'expense' | 'deposit' | 'transfer'

export type HistoryFilter = 'all' | HistoryItemType

export interface HistoryItem {
  type: HistoryItemType
  id: string
  amount: number
  sub: string
  name?: string
  date: string
}

export function getHistoryTypeLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Bill Collected'
  if (type === 'deposit') return 'Money Added'
  if (type === 'transfer') return 'Transfer'
  return 'Expense'
}

export function buildHistoryItems(data: AppData): HistoryItem[] {
  return [
    ...data.sales.map((s) => {
      const payLabel =
        s.status === 'pending'
          ? s.source === 'tally'
            ? '📒 Tally Pending'
            : s.payType === 'cheque'
              ? '🧾 Cheque Pending'
              : '📋 Pending'
          : s.payType === 'bank'
            ? '🏦 Bank'
            : s.payType === 'cheque'
              ? '🧾 Cheque'
              : s.payType === 'credit'
                ? '💳 Credit'
                : s.payType === 'split'
                  ? `💵 ${formatMoney(s.cashAmount ?? 0)} · 🏦 ${formatMoney(s.bankAmount ?? 0)}${(s.chequeAmount ?? 0) > 0 ? ` · 🧾 ${formatMoney(s.chequeAmount ?? 0)}` : ''}${(s.creditAmount ?? 0) > 0 ? ` · 💳 ${formatMoney(s.creditAmount ?? 0)}` : ''}`
                  : '💵 Cash'
      const orig =
        s.originalBillAmount && s.originalBillAmount !== s.billAmount
          ? `Bill ${formatMoney(s.originalBillAmount)} → `
          : ''
      return {
        type: 'sale' as const,
        id: s.id,
        amount: s.billAmount,
        sub: `${orig}${s.status === 'pending' ? 'Pending · ' : s.payType === 'bank' || s.payType === 'credit' || s.payType === 'cheque' ? 'Paid ' : `Give ${formatMoney(s.paidAmount)} · `}${payLabel}${s.changeAmount > 0 ? ` · Change ${formatMoney(s.changeAmount)}` : ''}${s.updatedAt && s.status !== 'pending' ? ` · Collected ${formatDate(s.updatedAt)}` : ''}`,
        name: s.customerName,
        date: s.createdAt,
      }
    }),
    ...data.expenses.map((e) => {
      if (e.kind === 'transfer') {
        const toBank = e.transferDirection === 'cash-to-bank'
        return {
          type: 'transfer' as const,
          id: e.id,
          amount: e.amount,
          sub: toBank ? '💵 → 🏦 Cash to bank' : '🏦 → 💵 Bank to cash',
          name: e.name,
          date: e.createdAt,
        }
      }
      const isAdd = e.kind === 'add'
      return {
        type: isAdd ? ('deposit' as const) : ('expense' as const),
        id: e.id,
        amount: e.amount,
        sub: isAdd
          ? e.payType === 'bank'
            ? '🏦 Added to bank'
            : '💵 Added to counter'
          : e.payType === 'bank'
            ? '🏦 Bank expense'
            : '💵 Cash expense',
        name: e.name,
        date: e.createdAt,
      }
    }),
  ]
}

export function matchesHistorySearch(item: HistoryItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase().trim()
  const haystack = [
    item.name,
    item.sub,
    formatMoney(item.amount),
    formatDate(item.date),
    getHistoryTypeLabel(item.type),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}
