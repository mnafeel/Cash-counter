import { matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import type { DetailDateFilterMode } from '../components/DetailDateFilter'

export function filterByDetailDate<T extends { date: string }>(
  rows: T[],
  mode: DetailDateFilterMode,
  selectedDate: string,
  rangeTo: string,
): T[] {
  if (mode === 'all') return rows
  const filter = mode as CashDateFilter
  return rows.filter((row) => matchesCashDateFilter(row.date, filter, selectedDate, rangeTo))
}
