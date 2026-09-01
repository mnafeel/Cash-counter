import type { StaffBonusMemberShare, StaffBonusMonthSettings, StaffBonusPart } from '../types'

export type BonusDistribution = {
  amounts: Map<string, number>
  /** Small leftover from equal floor splits — goes to balance, not last person */
  roundingRemainder: number
}

function mergeBonusMaps(target: Map<string, number>, source: Map<string, number>) {
  for (const [staffId, amount] of source) {
    target.set(staffId, (target.get(staffId) ?? 0) + amount)
  }
}

export function resolvePartAmount(part: StaffBonusPart, parentAmount?: number): number {
  if (parentAmount !== undefined && part.percent !== undefined && part.percent > 0) {
    return Math.floor((parentAmount * part.percent) / 100)
  }
  return Math.max(0, part.amount)
}

/** Equal floor shares for everyone; rounding dust returned separately. */
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

export function partBalanceAmount(part: StaffBonusPart, parentAmount?: number): number {
  const partAmount = resolvePartAmount(part, parentAmount)
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
  parentRounding: { value: number },
  parentAmount?: number,
) {
  const partAmount = resolvePartAmount(part, parentAmount)
  const subParts = part.subParts ?? []
  if (subParts.length > 0) {
    const percentLeftover = partBalanceAmount(part, parentAmount)
    const sectionRounding = { value: 0 }
    for (const subPart of subParts) {
      processBonusPart(subPart, totals, sectionRounding, partAmount)
    }
    const balancePool = percentLeftover + sectionRounding.value
    const balanceMembers = part.members ?? []
    if (balancePool > 0 && balanceMembers.length > 0) {
      sectionRounding.value = distributeMembers(balancePool, balanceMembers, totals)
    } else {
      sectionRounding.value = balancePool
    }
    parentRounding.value += sectionRounding.value
    return
  }

  const members = part.members ?? []
  if (members.length > 0) {
    parentRounding.value += distributeMembers(partAmount, members, totals)
  } else if (partAmount > 0) {
    parentRounding.value += partAmount
  }
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
  const parts = settings.parts ?? []
  const partsTotal = parts.reduce((sum, part) => sum + resolvePartAmount(part), 0)
  const poolRemainder = Math.max(0, poolAmount - partsTotal)
  const poolRounding = { value: 0 }

  for (const part of parts) {
    processBonusPart(part, totals, poolRounding)
  }

  const balanceMembers = settings.remainderMembers ?? []
  const poolBalanceAmount = poolRemainder + poolRounding.value
  let finalRounding = 0

  if (poolBalanceAmount > 0 && balanceMembers.length > 0) {
    finalRounding = distributeMembers(poolBalanceAmount, balanceMembers, totals)
  }

  return {
    totals,
    poolBalanceAmount,
    roundingRemainder: balanceMembers.length > 0 ? finalRounding : poolBalanceAmount,
  }
}

export function sumBonusParts(parts: StaffBonusPart[] | undefined): number {
  return (parts ?? []).reduce((sum, part) => sum + resolvePartAmount(part), 0)
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

/** Split pool into equal top-level parts (last part absorbs rounding). */
export function createEqualPoolParts(poolAmount: number, count: number): StaffBonusPart[] {
  if (count <= 0 || poolAmount <= 0) return []
  const each = Math.floor(poolAmount / count)
  let assigned = 0
  return Array.from({ length: count }, (_, index) => {
    const amount = index === count - 1 ? poolAmount - assigned : each
    assigned += amount
    return createBonusPart(amount)
  })
}
