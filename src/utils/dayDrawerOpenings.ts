import type { AppData, DayDrawerOpening } from '../types'
import {
  buildCashActivityItems,
  cashPeriodDateKey,
  matchesCashDateFilter,
  summarizeCashActivity,
} from './cashActivity'
import {
  buildBankActivityItems,
  summarizeBankActivity,
} from './bankActivity'
import { toInputDate } from './salesReport'

function yesterdayDateKey(todayKey: string): string {
  const [y, m, d] = todayKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 1)
  return toInputDate(date)
}

/**
 * On first open of a new day, seal *yesterday’s* 12 AM opening for the record.
 * Today’s Opening on Home is never taken from this seal — it is always
 * live drawer − today’s In/Out so Opening + In − Out = Cash in Drawer.
 */
export function sealTodayDrawerOpenings(
  data: AppData,
  liveCash: number,
  liveBank: number,
): AppData {
  const today = toInputDate()
  const yesterday = yesterdayDateKey(today)
  const hadTodaySeal = Boolean(data.dayBalances?.[today])
  let dayBalances: Record<string, DayDrawerOpening> = { ...(data.dayBalances ?? {}) }

  // Never keep a frozen “today” seal — Home Opening must track the live drawer.
  if (dayBalances[today]) {
    const { [today]: _drop, ...rest } = dayBalances
    dayBalances = rest
  }

  const existingYesterday = dayBalances[yesterday]
  if (
    existingYesterday &&
    Number.isFinite(existingYesterday.cashOpening) &&
    Number.isFinite(existingYesterday.bankOpening)
  ) {
    if (!hadTodaySeal) return data
    return { ...data, dayBalances }
  }

  const cashItems = buildCashActivityItems(data)
  const bankItems = buildBankActivityItems(data)
  const todayCashNet = summarizeCashActivity(
    cashItems.filter((item) => matchesCashDateFilter(item.date, 'today', '')),
  ).net
  const todayBankNet = summarizeBankActivity(
    bankItems.filter((item) => matchesCashDateFilter(item.date, 'today', '')),
  ).net
  const yCashNet = summarizeCashActivity(
    cashItems.filter((item) => matchesCashDateFilter(item.date, 'yesterday', '')),
  ).net
  const yBankNet = summarizeBankActivity(
    bankItems.filter((item) => matchesCashDateFilter(item.date, 'yesterday', '')),
  ).net

  const todayOpenCash = liveCash - todayCashNet
  const todayOpenBank = liveBank - todayBankNet
  const sealedAt = new Date().toISOString()

  dayBalances = {
    ...dayBalances,
    [yesterday]: {
      cashOpening: todayOpenCash - yCashNet,
      bankOpening: todayOpenBank - yBankNet,
      sealedAt,
    },
  }

  return { ...data, dayBalances }
}

export { cashPeriodDateKey }
