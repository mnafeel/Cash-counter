import type { StaffBonusMemberShare, StaffBonusMonthSettings, StaffBonusPart } from '../types'

export type BonusDistribution = {
  amounts: Map<string, number>
  /** Small leftover from equal floor splits — never paid to staff */
  roundingRemainder: number
}

function mergeBonusMaps(target: Map<string, number>, source: Map<string, number>) {
  for (const [staffId, amount] of source) {
    target.set(staffId, (target.get(staffId) ?? 0) + amount)
  }
}

export function resolvePartAmount(
  part: StaffBonusPart,
  parentAmount?: number,
  _poolAmount?: number,
): number {
  if (parentAmount !== undefined && part.percent !== undefined && part.percent > 0) {
    return Math.floor((parentAmount * part.percent) / 100)
  }
  return Math.max(0, part.amount)
}

/** Equal floor shares for everyone; rounding dust returned separately (never to staff). */
export function distributeBonusToMembers(
  amount: number,
  members: StaffBonusMemberShare[],
): BonusDistribution {
  const amounts = new Map<string, number>()
  if (amount <= 0 || members.length === 0) {
    return { amounts, roundingRemainder: Math.max(0, amount) }
  }

  const withPercent = members.filter((member) => (member.percent ?? 0) > 0)
  if (withPercent.length > 0) {
    const totalPercent = withPercent.reduce((sum, member) => sum + (member.percent ?? 0), 0)
    for (const member of withPercent) {
      const share = Math.floor((amount * (member.percent ?? 0)) / totalPercent)
      amounts.set(member.staffId, share)
    }
    const assigned = [...amounts.values()].reduce((sum, value) => sum + value, 0)
    return { amounts, roundingRemainder: Math.max(0, amount - assigned) }
  }

  const each = Math.floor(amount / members.length)
  for (const member of members) {
    amounts.set(member.staffId, each)
  }
  return { amounts, roundingRemainder: Math.max(0, amount - each * members.length) }
}

function collectMemberIds(members: StaffBonusMemberShare[] | undefined, out: Set<string>) {
  for (const member of members ?? []) {
    out.add(member.staffId)
  }
}

/** All staff assigned anywhere inside one part (sub-parts + balance members). */
export function collectStaffIdsInPart(part: StaffBonusPart, excludeSubPartId?: string): Set<string> {
  const ids = new Set<string>()
  for (const subPart of part.subParts ?? []) {
    if (excludeSubPartId && subPart.id === excludeSubPartId) continue
    collectStaffIdsInPartTree(subPart, ids)
  }
  collectMemberIds(part.members, ids)
  return ids
}

function collectStaffIdsInPartTree(part: StaffBonusPart, out: Set<string>) {
  collectMemberIds(part.members, out)
  for (const subPart of part.subParts ?? []) {
    collectStaffIdsInPartTree(subPart, out)
  }
}

/** Staff already used in other top-level parts or remainder. */
export function collectStaffIdsUsedElsewhere(
  settings: StaffBonusMonthSettings,
  options?: { excludePartId?: string; excludeRemainder?: boolean },
): Set<string> {
  const ids = new Set<string>()
  for (const part of settings.parts ?? []) {
    if (options?.excludePartId && part.id === options.excludePartId) continue
    collectStaffIdsInPart(part).forEach((id) => ids.add(id))
  }
  if (!options?.excludeRemainder) {
    collectMemberIds(settings.remainderMembers, ids)
  }
  return ids
}

export function sumResolvedSubParts(part: StaffBonusPart, parentAmount: number): number {
  return (part.subParts ?? []).reduce(
    (sum, subPart) => sum + resolvePartAmount(subPart, parentAmount),
    0,
  )
}

export function partBalanceAmount(part: StaffBonusPart, parentAmount?: number, poolAmount?: number): number {
  const partAmount = resolvePartAmount(part, parentAmount, poolAmount)
  const subTotal = sumResolvedSubParts(part, partAmount)
  return Math.max(0, partAmount - subTotal)
}

function distributeMembers(
  amount: number,
  members: StaffBonusMemberShare[],
  totals: Map<string, number>,
): number {
  const { amounts, roundingRemainder } = distributeBonusToMembers(amount, members)
  mergeBonusMaps(totals, amounts)
  return roundingRemainder
}

function processBonusPart(
  part: StaffBonusPart,
  totals: Map<string, number>,
  roundingDust: { value: number },
  parentAmount?: number,
  poolAmount?: number,
): number {
  const partAmount = resolvePartAmount(part, parentAmount, poolAmount)
  const subParts = part.subParts ?? []
  if (subParts.length > 0) {
    const percentLeftover = partBalanceAmount(part, parentAmount, poolAmount)
    for (const subPart of subParts) {
      processBonusPart(subPart, totals, roundingDust, partAmount)
    }
    const balanceMembers = part.members ?? []
    if (percentLeftover > 0 && balanceMembers.length > 0) {
      roundingDust.value += distributeMembers(percentLeftover, balanceMembers, totals)
    } else if (percentLeftover > 0) {
      return percentLeftover
    }
    return 0
  }

  const members = part.members ?? []
  if (members.length > 0) {
    roundingDust.value += distributeMembers(partAmount, members, totals)
    return 0
  }
  if (partAmount > 0) {
    return partAmount
  }
  return 0
}

export function computeStaffBonusTotals(
  settings: StaffBonusMonthSettings,
  poolAmount: number,
): Map<string, number> {
  return computeStaffBonusBreakdown(settings, poolAmount).totals
}

export function computeStaffBonusBreakdown(
  settings: StaffBonusMonthSettings,
  poolAmount: number,
): { totals: Map<string, number>; poolBalanceAmount: number; roundingRemainder: number } {
  const totals = new Map<string, number>()
  const parts = rebalanceTopLevelPartAmounts(settings.parts ?? [], poolAmount)
  const partsTotal = parts.reduce((sum, part) => sum + resolvePartAmount(part, undefined, poolAmount), 0)
  const poolRemainder = Math.max(0, poolAmount - partsTotal)
  const roundingDust = { value: 0 }
  let unassignedFromParts = 0

  for (const part of parts) {
    unassignedFromParts += processBonusPart(part, totals, roundingDust, undefined, poolAmount)
  }

  const balanceMembers = settings.remainderMembers ?? []
  const distributableBalance = poolRemainder + unassignedFromParts
  let balanceRounding = 0

  if (distributableBalance > 0 && balanceMembers.length > 0) {
    balanceRounding = distributeMembers(distributableBalance, balanceMembers, totals)
  }

  const roundingRemainder = roundingDust.value + balanceRounding
  const poolBalanceAmount =
    balanceMembers.length > 0 ? distributableBalance : distributableBalance + roundingRemainder

  return {
    totals,
    poolBalanceAmount,
    roundingRemainder: balanceMembers.length > 0 ? balanceRounding : roundingRemainder,
  }
}

export function sumBonusParts(parts: StaffBonusPart[] | undefined, poolAmount?: number): number {
  return (parts ?? []).reduce((sum, part) => sum + resolvePartAmount(part, undefined, poolAmount), 0)
}

export function sumSubPartPercents(part: StaffBonusPart): number {
  return (part.subParts ?? []).reduce((sum, sub) => sum + Math.max(0, sub.percent ?? 0), 0)
}

export function partUsesPercentSubs(part: StaffBonusPart): boolean {
  const subs = part.subParts ?? []
  if (subs.length === 0) return false
  return subs.every((sub) => sub.amount <= 0)
}

export function partBalancePercent(part: StaffBonusPart): number {
  return Math.max(0, 100 - sumSubPartPercents(part))
}

export function createEmptySharePart(): StaffBonusPart {
  return {
    id: crypto.randomUUID(),
    amount: 0,
    members: [],
    subParts: [],
  }
}

export function createPercentBonusPart(percent: number): StaffBonusPart {
  return {
    id: crypto.randomUUID(),
    amount: 0,
    percent: Math.max(0, Math.min(100, percent)),
    members: [],
    subParts: [],
  }
}

export function createBonusPart(amount = 0): StaffBonusPart {
  return {
    id: crypto.randomUUID(),
    amount: Math.max(0, amount),
    members: [],
    subParts: [],
  }
}

/** Split pool into equal top-level parts — same floor amount each; dust stays in balance. */
export function createEqualPoolParts(poolAmount: number, count: number): StaffBonusPart[] {
  if (count <= 0 || poolAmount <= 0) return []
  const each = Math.floor(poolAmount / count)
  return Array.from({ length: count }, () => createBonusPart(each))
}

/** Recompute equal top-level part amounts from the current pool (no last-part extra rupee). */
export function rebalanceTopLevelPartAmounts(
  parts: StaffBonusPart[],
  poolAmount: number,
): StaffBonusPart[] {
  if (parts.length === 0 || poolAmount <= 0) return parts
  const each = Math.floor(poolAmount / parts.length)
  return parts.map((part) => ({
    ...part,
    amount: each,
  }))
}

function cloneBonusPartStructure(part: StaffBonusPart): StaffBonusPart {
  return {
    id: part.id,
    amount: 0,
    percent: part.percent,
    members: part.members?.map((member) => ({ ...member })),
    subParts: part.subParts?.map((subPart) => cloneBonusPartStructure(subPart)),
  }
}

/** Keep staff layout; drop stale rupee amounts so each month recalculates from its pool. */
export function cloneBonusPlanStructure(settings: StaffBonusMonthSettings): StaffBonusMonthSettings {
  return {
    poolPercent: settings.poolPercent,
    parts: settings.parts?.map((part) => cloneBonusPartStructure(part)),
    remainderMembers: settings.remainderMembers?.map((member) => ({ ...member })),
  }
}

export function normalizeBonusMonthPlanForSave(
  plan: StaffBonusMonthSettings,
  poolAmount: number,
): StaffBonusMonthSettings {
  const next: StaffBonusMonthSettings = {
    poolPercent: plan.poolPercent,
    collectedRounded: plan.collectedRounded,
    remainderMembers:
      plan.remainderMembers && plan.remainderMembers.length > 0 ? plan.remainderMembers : undefined,
    parts:
      plan.parts && plan.parts.length > 0
        ? rebalanceTopLevelPartAmounts(plan.parts, poolAmount)
        : undefined,
  }
  return next
}

export function bonusMonthHasStructure(settings: StaffBonusMonthSettings | undefined): boolean {
  if (!settings) return false
  return (
    (settings.parts?.length ?? 0) > 0 ||
    (settings.remainderMembers?.length ?? 0) > 0 ||
    settings.poolPercent !== undefined
  )
}
