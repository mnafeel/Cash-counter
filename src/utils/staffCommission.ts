import type { AppData, Sale, StaffBonusMonthSettings } from '../types'
import type { RoundOption } from './roundSuggestions'
import { saleCollectedForFilter, sumSalesCollectedForFilter, toInputDate } from './salesReport'
import { computeStaffBonusTotals, sumBonusParts, cloneBonusPlanStructure, bonusMonthHasStructure, normalizeBonusMonthPlanForSave } from './staffBonusAllocation'
import {
  buildStaffMonthSummaries,
  currentSalaryMonth,
  parseSalaryMonth,
  type SalaryMonthKey,
  type StaffMonthSummary,
} from './staffLedger'

export interface StaffCommissionSummary {
  staffId: string
  name: string
  collectedActual: number
  collectedForBonus: number
  poolPercent: number
  poolAmount: number
  commissionEarned: number
  personalCollections: number
  attributedSaleCount: number
  /** @deprecated */
  collections: number
  /** @deprecated */
  salesActual: number
  /** @deprecated */
  bonusBase: number
  /** @deprecated */
  bonusBaseSource: 'collected'
  /** @deprecated */
  sharePercent: number
  /** @deprecated */
  commissionPercent: number
}

export interface StaffCommissionOverview {
  storeCollections: number
  collectedForBonus: number
  poolPercent: number
  poolAmount: number
  totalCommission: number
  totalBonusRemaining: number
  allocatedTotal: number
  remainderAmount: number
  staffCount: number
  /** @deprecated */
  storeSales: number
  /** @deprecated */
  bonusBase: number
  /** @deprecated */
  bonusBaseSource: 'collected'
  /** @deprecated */
  totalAttributedCollections: number
}

const BONUS_ROUND_STEPS = [
  { step: 50_000, label: '50k' },
  { step: 100_000, label: '1L' },
  { step: 500_000, label: '5L' },
  { step: 1_000_000, label: '10L' },
  { step: 10_000_000, label: '1Cr' },
] as const

function roundDownTo(value: number, step: number): number {
  return Math.floor(value / step) * step
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

function roundNearestTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

/** Simple round options for sales collected (bonus only). */
export function getStaffBonusRoundOptions(amount: number): RoundOption[] {
  if (amount <= 0) return []

  const options: RoundOption[] = []
  const seen = new Set<number>()

  for (const { step, label } of BONUS_ROUND_STEPS) {
    if (step > amount * 2 && step > 100_000) continue

    for (const candidate of [
      { amount: roundDownTo(amount, step), typeLabel: `↓${label}` },
      { amount: roundUpTo(amount, step), typeLabel: `↑${label}` },
      { amount: roundNearestTo(amount, step), typeLabel: `≈${label}` },
    ]) {
      if (candidate.amount <= 0 || candidate.amount === amount || seen.has(candidate.amount)) continue
      seen.add(candidate.amount)
      options.push({
        amount: candidate.amount,
        typeLabel: candidate.typeLabel,
        saved: Math.abs(amount - candidate.amount),
      })
    }
  }

  return options.sort((a, b) => b.amount - a.amount).slice(0, 5)
}

export function getStaffBonusMonthSettings(
  data: AppData,
  monthKey: SalaryMonthKey,
): StaffBonusMonthSettings {
  return data.staffBonusMonthSettings?.[monthKey] ?? {}
}

function listSavedBonusMonthKeys(data: AppData): SalaryMonthKey[] {
  return Object.keys(data.staffBonusMonthSettings ?? {})
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .sort() as SalaryMonthKey[]
}

/** Latest saved month at or before `monthKey` that defines a bonus structure. */
export function findPriorBonusPlanMonth(
  data: AppData,
  monthKey: SalaryMonthKey,
): SalaryMonthKey | null {
  let match: SalaryMonthKey | null = null
  for (const key of listSavedBonusMonthKeys(data)) {
    if (key > monthKey) continue
    const entry = data.staffBonusMonthSettings?.[key]
    if (bonusMonthHasStructure(entry)) match = key
  }
  return match
}

/**
 * Merge this month's overrides with the nearest prior saved plan.
 * Structure (staff splits) carries forward; sales rounding and pool % stay per month.
 */
export function resolveStaffBonusMonthSettings(
  data: AppData,
  monthKey: SalaryMonthKey,
): StaffBonusMonthSettings {
  const explicit = getStaffBonusMonthSettings(data, monthKey)
  const originKey = findPriorBonusPlanMonth(data, monthKey)
  if (!originKey) return { ...explicit }

  const origin = data.staffBonusMonthSettings?.[originKey] ?? {}
  const structure = cloneBonusPlanStructure(origin)

  return {
    poolPercent: explicit.poolPercent ?? structure.poolPercent,
    collectedRounded: explicit.collectedRounded,
    parts: explicit.parts?.length ? explicit.parts.map((part) => ({ ...part })) : structure.parts,
    remainderMembers: explicit.remainderMembers?.length
      ? explicit.remainderMembers.map((member) => ({ ...member }))
      : structure.remainderMembers,
  }
}

export { normalizeBonusMonthPlanForSave }

export function resolvePoolPercent(data: AppData, monthKey: SalaryMonthKey): number {
  const monthPercent = resolveStaffBonusMonthSettings(data, monthKey).poolPercent
  const raw = monthPercent ?? data.staffCommissionDefaultPercent ?? 0
  return Math.max(0, Math.min(100, Number(raw) || 0))
}

export function salaryMonthDateRange(
  monthKey: SalaryMonthKey,
  asOf = new Date(),
): { fromDate: string; toDate: string } {
  const { year, month } = parseSalaryMonth(monthKey)
  const monthStr = String(month).padStart(2, '0')
  const fromDate = `${year}-${monthStr}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`
  const toDate = monthKey === currentSalaryMonth(asOf) ? toInputDate(asOf) : monthEnd
  return { fromDate, toDate }
}

function monthCollectionFilter(monthKey: SalaryMonthKey) {
  const { fromDate, toDate } = salaryMonthDateRange(monthKey)
  return { fromDate, toDate, dateMode: 'collected' as const }
}

export function saleCollectedInSalaryMonth(sale: Sale, monthKey: SalaryMonthKey): number {
  return saleCollectedForFilter(sale, monthCollectionFilter(monthKey)).total
}

export function getStoreMonthCollections(data: AppData, monthKey: SalaryMonthKey): number {
  return sumSalesCollectedForFilter(data, monthCollectionFilter(monthKey))
}

export function resolveCollectedForBonus(
  settings: StaffBonusMonthSettings,
  collectedActual: number,
): number {
  const rounded = settings.collectedRounded
  return rounded !== undefined && rounded > 0 ? rounded : collectedActual
}

export function computePoolAmount(collectedForBonus: number, poolPercent: number): number {
  return Math.round((collectedForBonus * poolPercent) / 100)
}

export interface StaffCommissionMonthContext {
  settings: StaffBonusMonthSettings
  collectedActual: number
  collectedForBonus: number
  poolPercent: number
  poolAmount: number
  bonusTotals: Map<string, number>
  personalCollections: Map<string, number>
  attributedSaleCounts: Map<string, number>
}

/** One pass per month: collections, pool, and per-staff bonus (avoids N× sales scans). */
export function buildStaffCommissionMonthContext(
  data: AppData,
  monthKey: SalaryMonthKey,
): StaffCommissionMonthContext {
  const settings = resolveStaffBonusMonthSettings(data, monthKey)
  const collectedActual = getStoreMonthCollections(data, monthKey)
  const collectedForBonus = resolveCollectedForBonus(settings, collectedActual)
  const poolPercent = resolvePoolPercent(data, monthKey)
  const poolAmount = computePoolAmount(collectedForBonus, poolPercent)
  const bonusTotals = computeStaffBonusTotals(settings, poolAmount)

  const personalCollections = new Map<string, number>()
  const attributedSaleCounts = new Map<string, number>()
  for (const sale of data.sales) {
    if (!sale.staffId) continue
    const collected = saleCollectedInSalaryMonth(sale, monthKey)
    if (collected <= 0) continue
    personalCollections.set(
      sale.staffId,
      (personalCollections.get(sale.staffId) ?? 0) + collected,
    )
    attributedSaleCounts.set(
      sale.staffId,
      (attributedSaleCounts.get(sale.staffId) ?? 0) + 1,
    )
  }

  return {
    settings,
    collectedActual,
    collectedForBonus,
    poolPercent,
    poolAmount,
    bonusTotals,
    personalCollections,
    attributedSaleCounts,
  }
}

function commissionSummaryFromContext(
  member: { id: string; name: string },
  context: StaffCommissionMonthContext,
): StaffCommissionSummary {
  return {
    staffId: member.id,
    name: member.name,
    collectedActual: context.collectedActual,
    collectedForBonus: context.collectedForBonus,
    poolPercent: context.poolPercent,
    poolAmount: context.poolAmount,
    commissionEarned: context.bonusTotals.get(member.id) ?? 0,
    personalCollections: context.personalCollections.get(member.id) ?? 0,
    attributedSaleCount: context.attributedSaleCounts.get(member.id) ?? 0,
    collections: context.collectedActual,
    salesActual: context.collectedActual,
    bonusBase: context.collectedForBonus,
    bonusBaseSource: 'collected',
    sharePercent: 0,
    commissionPercent: 0,
  }
}

export function buildStaffCommissionSummaryMap(
  data: AppData,
  context: StaffCommissionMonthContext,
): Map<string, StaffCommissionSummary> {
  const map = new Map<string, StaffCommissionSummary>()
  for (const member of data.staff ?? []) {
    map.set(member.id, commissionSummaryFromContext(member, context))
  }
  return map
}

export function buildStaffBonusTotals(
  data: AppData,
  monthKey: SalaryMonthKey,
): Map<string, number> {
  return buildStaffCommissionMonthContext(data, monthKey).bonusTotals
}

export function getStaffMonthCollections(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
): number {
  return data.sales
    .filter((sale) => sale.staffId === staffId)
    .reduce((sum, sale) => sum + saleCollectedInSalaryMonth(sale, monthKey), 0)
}

export function getStaffAttributedSales(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
): { sale: Sale; collected: number }[] {
  return data.sales
    .filter((sale) => sale.staffId === staffId)
    .map((sale) => ({ sale, collected: saleCollectedInSalaryMonth(sale, monthKey) }))
    .filter((row) => row.collected > 0)
    .sort((a, b) => new Date(b.sale.createdAt).getTime() - new Date(a.sale.createdAt).getTime())
}

export function getStaffCommissionSummary(
  data: AppData,
  staffId: string,
  monthKey: SalaryMonthKey,
  context?: StaffCommissionMonthContext,
): StaffCommissionSummary | null {
  const member = (data.staff ?? []).find((row) => row.id === staffId)
  if (!member) return null
  const ctx = context ?? buildStaffCommissionMonthContext(data, monthKey)
  return commissionSummaryFromContext(member, ctx)
}

export function buildStaffBonusRemainingMap(
  data: AppData,
  monthKey: SalaryMonthKey,
  context?: StaffCommissionMonthContext,
): Map<string, number> {
  const ctx = context ?? buildStaffCommissionMonthContext(data, monthKey)
  const summaries = buildStaffMonthSummaries(data, monthKey)
  const map = new Map<string, number>()
  for (const summary of summaries) {
    const bonus = ctx.bonusTotals.get(summary.staffId) ?? 0
    map.set(
      summary.staffId,
      allocateStaffPayout(summary.netSalary, bonus, summary.paidTotal, summary.advanceOut)
        .bonusRemaining,
    )
  }
  return map
}

export function sumBonusRemainingForStaff(
  staffIds: Iterable<string>,
  remainingByStaffId: Map<string, number>,
): number {
  let sum = 0
  for (const id of staffIds) {
    sum += remainingByStaffId.get(id) ?? 0
  }
  return sum
}

export function buildStaffCommissionOverview(
  data: AppData,
  monthKey: SalaryMonthKey,
  context?: StaffCommissionMonthContext,
): StaffCommissionOverview {
  const staff = data.staff ?? []
  const ctx = context ?? buildStaffCommissionMonthContext(data, monthKey)
  const totalCommission = [...ctx.bonusTotals.values()].reduce((sum, amount) => sum + amount, 0)
  const bonusRemainingByStaff = buildStaffBonusRemainingMap(data, monthKey, ctx)
  const totalBonusRemaining = [...bonusRemainingByStaff.values()].reduce((sum, amount) => sum + amount, 0)
  const partsTotal = sumBonusParts(ctx.settings.parts, ctx.poolAmount)
  let totalAttributedCollections = 0
  for (const amount of ctx.personalCollections.values()) {
    totalAttributedCollections += amount
  }

  return {
    storeCollections: ctx.collectedActual,
    collectedForBonus: ctx.collectedForBonus,
    poolPercent: ctx.poolPercent,
    poolAmount: ctx.poolAmount,
    totalCommission,
    totalBonusRemaining,
    allocatedTotal: partsTotal,
    remainderAmount: Math.max(0, ctx.poolAmount - partsTotal),
    staffCount: staff.length,
    storeSales: ctx.collectedActual,
    bonusBase: ctx.collectedForBonus,
    bonusBaseSource: 'collected',
    totalAttributedCollections,
  }
}

export interface StaffPayoutAllocation {
  netSalary: number
  bonusEarned: number
  totalOwed: number
  paid: number
  salaryRemaining: number
  bonusRemaining: number
  totalRemaining: number
  overpaidAmount: number
  canApplyToNextMonth: boolean
}

/** Payments cover salary first, then bonus. Nothing shows negative. */
export function allocateStaffPayout(
  netSalary: number,
  bonusEarned: number,
  paidTotal: number,
  advanceOut = 0,
): StaffPayoutAllocation {
  const net = Math.max(0, netSalary)
  const bonus = Math.max(0, bonusEarned)
  const paid = Math.max(0, paidTotal)
  const totalOwed = net + bonus

  const salaryPortionPaid = Math.min(paid, net)
  const bonusPortionPaid = Math.min(Math.max(0, paid - net), bonus)
  const salaryRemaining = Math.max(0, net - salaryPortionPaid)
  const bonusRemaining = Math.max(0, bonus - bonusPortionPaid)
  const totalRemaining = Math.max(0, totalOwed - paid)
  const rawOverpaid = Math.max(0, paid - totalOwed)
  const overpaidAmount = Math.max(0, rawOverpaid - Math.max(0, advanceOut))

  return {
    netSalary: net,
    bonusEarned: bonus,
    totalOwed,
    paid,
    salaryRemaining,
    bonusRemaining,
    totalRemaining,
    overpaidAmount,
    canApplyToNextMonth: overpaidAmount > 0,
  }
}

export function getStaffPayoutAllocation(
  summary: Pick<StaffMonthSummary, 'netSalary' | 'paidTotal' | 'advanceOut'>,
  commission: StaffCommissionSummary | null,
): StaffPayoutAllocation {
  return allocateStaffPayout(
    summary.netSalary,
    commission?.commissionEarned ?? 0,
    summary.paidTotal,
    summary.advanceOut,
  )
}
export interface StaffPayoutBreakdown {
  netSalary: number
  bonusEarned: number
  bonusRemaining: number
  totalWithBonus: number
  paid: number
  salaryRemaining: number
  totalRemaining: number
  overpaidAmount: number
  canApplyToNextMonth: boolean
  collectedActual: number
  collectedForBonus: number
  poolPercent: number
  poolAmount: number
  /** @deprecated */
  salesActual: number
  /** @deprecated */
  bonusBase: number
  /** @deprecated */
  bonusBaseSource: 'collected'
  /** @deprecated */
  sharePercent: number
  /** @deprecated */
  commissionPercent: number
  /** @deprecated */
  collections: number
  attributedSaleCount: number
}

export function buildStaffPayoutBreakdown(
  summary: Pick<StaffMonthSummary, 'netSalary' | 'paidTotal' | 'advanceOut'>,
  commission: StaffCommissionSummary | null,
): StaffPayoutBreakdown {
  const allocation = getStaffPayoutAllocation(summary, commission)
  return {
    netSalary: allocation.netSalary,
    bonusEarned: allocation.bonusEarned,
    bonusRemaining: allocation.bonusRemaining,
    totalWithBonus: allocation.totalOwed,
    paid: allocation.paid,
    salaryRemaining: allocation.salaryRemaining,
    totalRemaining: allocation.totalRemaining,
    overpaidAmount: allocation.overpaidAmount,
    canApplyToNextMonth: allocation.canApplyToNextMonth,
    collectedActual: commission?.collectedActual ?? 0,
    collectedForBonus: commission?.collectedForBonus ?? 0,
    poolPercent: commission?.poolPercent ?? 0,
    poolAmount: commission?.poolAmount ?? 0,
    salesActual: commission?.collectedActual ?? 0,
    bonusBase: commission?.collectedForBonus ?? 0,
    bonusBaseSource: 'collected',
    sharePercent: 0,
    commissionPercent: 0,
    collections: commission?.collectedActual ?? 0,
    attributedSaleCount: commission?.attributedSaleCount ?? 0,
  }
}
