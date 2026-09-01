import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { StaffBonusMemberShare, StaffBonusMonthSettings, StaffBonusPart, StaffMember } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import RoundTypeChips from './RoundTypeChips'
import type { SalaryMonthKey } from '../utils/staffLedger'
import {
  collectStaffIdsInPart,
  collectStaffIdsUsedElsewhere,
  computeStaffBonusBreakdown,
  createBonusPart,
  createEmptySharePart,
  createEqualPoolParts,
  distributeBonusToMembers,
  partBalanceAmount,
  partBalancePercent,
  resolvePartAmount,
  sumResolvedSubParts,
} from '../utils/staffBonusAllocation'
import {
  computePoolAmount,
  getStaffBonusRoundOptions,
  resolveCollectedForBonus,
} from '../utils/staffCommission'
import Portal from './Portal'
import './StaffBonusPanel.css'

type StaffBonusPanelProps = {
  open: boolean
  onClose: () => void
  overlayTop?: number
  monthKey: SalaryMonthKey
  monthLabel: string
  staff: StaffMember[]
  collectedActual: number
  settings: StaffBonusMonthSettings
  defaultPoolPercent: number
  onSave: (monthKey: SalaryMonthKey, plan: StaffBonusMonthSettings) => void
}

function clonePlan(settings: StaffBonusMonthSettings): StaffBonusMonthSettings {
  return JSON.parse(JSON.stringify(settings)) as StaffBonusMonthSettings
}

function toggleMember(
  members: StaffBonusMemberShare[] | undefined,
  staffId: string,
): StaffBonusMemberShare[] {
  const list = members ?? []
  if (list.some((member) => member.staffId === staffId)) {
    return list.filter((member) => member.staffId !== staffId)
  }
  return [...list, { staffId }]
}

function updateMemberPercent(
  members: StaffBonusMemberShare[] | undefined,
  staffId: string,
  percent: number | undefined,
): StaffBonusMemberShare[] {
  return (members ?? []).map((member) =>
    member.staffId === staffId ? { ...member, percent } : member,
  )
}

type MemberPickerProps = {
  staff: StaffMember[]
  members: StaffBonusMemberShare[] | undefined
  blockedIds: Set<string>
  sliceAmount: number
  onChange: (members: StaffBonusMemberShare[]) => void
}

const MemberPicker = memo(function MemberPicker({
  staff,
  members,
  blockedIds,
  sliceAmount,
  onChange,
}: MemberPickerProps) {
  const distribution = useMemo(
    () => distributeBonusToMembers(sliceAmount, members ?? []),
    [sliceAmount, members],
  )
  const selectedCount = (members ?? []).length

  return (
    <div className="staff-bonus-member-list">
      {staff.map((member) => {
        const selected = (members ?? []).some((row) => row.staffId === member.id)
        const blocked = !selected && blockedIds.has(member.id)
        const share = (members ?? []).find((row) => row.staffId === member.id)
        const shareAmount = distribution.amounts.get(member.id) ?? 0
        return (
          <div
            key={member.id}
            className={`staff-bonus-member-card ${selected ? 'staff-bonus-member-card--active' : ''} ${
              blocked ? 'staff-bonus-member-card--blocked' : ''
            }`}
          >
            <div className="staff-bonus-member-card-row">
              <button
                type="button"
                disabled={blocked}
                className={`staff-bonus-member-chip ${selected ? 'staff-bonus-member-chip--active' : ''}`}
                onClick={() => onChange(toggleMember(members, member.id))}
              >
                {member.name}
              </button>
              {selected ? (
                <input
                  type="text"
                  inputMode="decimal"
                  className="staff-bonus-member-pct"
                  value={share?.percent !== undefined ? String(share.percent) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    const percent = raw ? parseAmount(raw) : undefined
                    onChange(updateMemberPercent(members, member.id, percent))
                  }}
                  placeholder="%"
                  aria-label={`Percent for ${member.name}`}
                />
              ) : null}
            </div>
            <span className="staff-bonus-member-amount-slot">
              {selected && sliceAmount > 0 ? formatMoney(shareAmount) : '\u00A0'}
            </span>
          </div>
        )
      })}
      {selectedCount > 1 && distribution.roundingRemainder > 0 ? (
        <div className="staff-bonus-rounding-row">
          <span>Rounding balance</span>
          <strong>{formatMoney(distribution.roundingRemainder)}</strong>
        </div>
      ) : null}
    </div>
  )
})

const SUB_PERCENT_OPTIONS = [25, 33, 40, 50, 60, 67, 75] as const

type SubPercentInputProps = {
  partIndex: number
  percent: number | undefined
  parentAmount: number
  autoFocus?: boolean
  onCommit: (percent: number) => void
}

function SubPercentInput({
  partIndex,
  percent,
  parentAmount,
  autoFocus,
  onCommit,
}: SubPercentInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(percent !== undefined && percent > 0 ? String(percent) : '')

  useEffect(() => {
    if (percent !== undefined && percent > 0) {
      setDraft(String(percent))
    } else if (percent === undefined) {
      setDraft('')
    }
  }, [percent])

  useEffect(() => {
    if (!autoFocus) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [autoFocus])

  const draftPercent = Math.max(0, Math.min(100, parseAmount(draft) || 0))
  const previewAmount =
    draft.trim() === '' ? 0 : Math.floor((parentAmount * draftPercent) / 100)
  const previewBalancePercent = Math.max(0, 100 - draftPercent)

  function commit(raw: string) {
    if (raw.trim() === '') {
      setDraft('')
      onCommit(0)
      return
    }
    const next = Math.max(0, Math.min(100, parseAmount(raw) || 0))
    setDraft(String(next))
    onCommit(next)
  }

  return (
    <div className="staff-bonus-sub-share">
      <div className="staff-bonus-sub-share-head">
        <span className="staff-bonus-sub-share-label">Share %</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="staff-bonus-field-input staff-bonus-field-input--pct"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(draft)
              inputRef.current?.blur()
            }
          }}
          placeholder="Type %"
          aria-label={`Share ${partIndex + 1} percent`}
        />
        <span className="staff-bonus-sub-share-equals">= {formatMoney(previewAmount)}</span>
      </div>
      <p className="staff-bonus-sub-balance-preview">
        Balance after this share · {previewBalancePercent}%
      </p>
      <div className="staff-bonus-pct-chips">
        {SUB_PERCENT_OPTIONS.map((pct) => (
          <button
            key={pct}
            type="button"
            className={`staff-bonus-pct-chip ${percent === pct ? 'staff-bonus-pct-chip--active' : ''}`}
            onClick={() => onCommit(pct)}
          >
            {pct}%
          </button>
        ))}
      </div>
    </div>
  )
}

type PartEditorProps = {
  part: StaffBonusPart
  partIndex: number
  staff: StaffMember[]
  parentAmount?: number
  depth?: number
  blockedTopLevelIds: Set<string>
  blockedWithinParent?: Set<string>
  onChange: (part: StaffBonusPart) => void
  onRemove?: () => void
}

function blockedWithinParentPart(parentPart: StaffBonusPart, excludeSubPartId: string): Set<string> {
  const ids = new Set<string>()
  collectMemberIdsToSet(parentPart.members, ids)
  for (const subPart of parentPart.subParts ?? []) {
    if (subPart.id === excludeSubPartId) continue
    collectStaffIdsInPart(subPart).forEach((id) => ids.add(id))
  }
  return ids
}

const PartEditor = memo(function PartEditor({
  part,
  partIndex,
  staff,
  parentAmount,
  depth = 0,
  blockedTopLevelIds,
  blockedWithinParent,
  onChange,
  onRemove,
}: PartEditorProps) {
  const subParts = part.subParts ?? []
  const hasSubParts = subParts.length > 0
  const partAmount = resolvePartAmount(part, parentAmount)
  const subTotal = sumResolvedSubParts(part, partAmount)
  const balanceAmount = partBalanceAmount(part, parentAmount)
  const balancePercent = partBalancePercent(part)
  const isSubPart = depth > 0

  function updatePart(patch: Partial<StaffBonusPart>) {
    onChange({ ...part, ...patch })
  }

  function updateSubPart(index: number, next: StaffBonusPart) {
    const nextSubParts = [...subParts]
    nextSubParts[index] = next
    updatePart({ subParts: nextSubParts })
  }

  function removeSubPart(index: number) {
    updatePart({ subParts: subParts.filter((_, i) => i !== index) })
  }

  function blockedForMembers(): Set<string> {
    const ids = new Set(blockedTopLevelIds)
    if (blockedWithinParent) {
      blockedWithinParent.forEach((id) => ids.add(id))
    }
    return ids
  }

  function blockedForBalanceMembers(): Set<string> {
    const ids = blockedForMembers()
    for (const subPart of subParts) {
      collectStaffIdsInPart(subPart).forEach((id) => ids.add(id))
    }
    return ids
  }

  function setSubPercent(nextPercent: number) {
    updatePart({
      percent: nextPercent > 0 ? nextPercent : undefined,
      amount: 0,
    })
  }

  function startSplit() {
    updatePart({
      subParts: [createEmptySharePart()],
      members: [],
    })
  }

  function addSubPart() {
    const remainingPct = partBalancePercent(part)
    if (remainingPct <= 0) return
    updatePart({
      subParts: [...subParts, createEmptySharePart()],
      members: part.members ?? [],
    })
  }

  const showSharePercent = isSubPart && part.amount <= 0
  const focusSharePercent = showSharePercent && (part.percent === undefined || part.percent <= 0)

  return (
    <div className={`staff-bonus-part ${depth > 0 ? 'staff-bonus-part--nested' : ''}`}>
      <div className="staff-bonus-part-head">
        <strong>
          {depth === 0 ? `Part ${partIndex + 1}` : `Share ${partIndex + 1}`}
          <span className="staff-bonus-part-amount">{formatMoney(partAmount)}</span>
          {showSharePercent ? (
            <span className="staff-bonus-part-pct">
              {part.percent !== undefined && part.percent > 0 ? `${part.percent}%` : 'Type %'}
            </span>
          ) : null}
        </strong>
        {onRemove ? (
          <button type="button" className="staff-bonus-part-remove" onClick={onRemove}>
            ✕
          </button>
        ) : null}
      </div>

      {showSharePercent ? (
        <SubPercentInput
          partIndex={partIndex}
          percent={part.percent}
          parentAmount={parentAmount ?? partAmount}
          autoFocus={focusSharePercent}
          onCommit={setSubPercent}
        />
      ) : !isSubPart && !hasSubParts ? (
        <label className="staff-bonus-field">
          <span className="staff-bonus-field-label">Amount for this part</span>
          <input
            type="text"
            inputMode="decimal"
            value={part.amount > 0 ? String(part.amount) : ''}
            onChange={(e) => updatePart({ amount: Math.max(0, parseAmount(e.target.value)) })}
            placeholder="0"
          />
        </label>
      ) : null}

      {!hasSubParts ? (
        <div className="staff-bonus-members">
          <p className="staff-bonus-step-hint">Select staff for this {isSubPart ? 'share' : 'part'}</p>
          <MemberPicker
            staff={staff}
            members={part.members}
            blockedIds={blockedForMembers()}
            sliceAmount={partAmount}
            onChange={(members) => updatePart({ members })}
          />
        </div>
      ) : (
        <>
          <div className="staff-bonus-inner-step">
            <span className="staff-bonus-inner-step-label">A · Share sections</span>
          </div>
          <div className="staff-bonus-subparts">
            {subParts.map((subPart, index) => (
              <PartEditor
                key={subPart.id}
                part={subPart}
                partIndex={index}
                staff={staff}
                parentAmount={partAmount}
                depth={depth + 1}
                blockedTopLevelIds={blockedTopLevelIds}
                blockedWithinParent={blockedWithinParentPart(part, subPart.id)}
                onChange={(next) => updateSubPart(index, next)}
                onRemove={() => removeSubPart(index)}
              />
            ))}
          </div>
          <div className="staff-bonus-balance staff-bonus-balance--stable">
            <div className="staff-bonus-inner-step">
              <span className="staff-bonus-inner-step-label">B · Balance (remaining)</span>
            </div>
            <div className="staff-bonus-balance-summary">
              <strong>{balancePercent}%</strong>
              <span>{formatMoney(balanceAmount)}</span>
            </div>
            {subTotal > partAmount ? (
              <p className="staff-bonus-warn">Shares exceed this part</p>
            ) : balanceAmount > 0 ? (
              <>
                <p className="staff-bonus-step-hint">Select staff for the balance share</p>
                <MemberPicker
                  staff={staff}
                  members={part.members}
                  blockedIds={blockedForBalanceMembers()}
                  sliceAmount={balanceAmount}
                  onChange={(members) => updatePart({ members })}
                />
              </>
            ) : (
              <p className="staff-bonus-empty">All of this part is in share sections</p>
            )}
          </div>
        </>
      )}

      {!isSubPart ? (
        <div className="staff-bonus-part-actions">
          {hasSubParts ? (
            <>
              <button
                type="button"
                className="staff-bonus-btn staff-bonus-btn--ghost"
                onClick={addSubPart}
                disabled={balancePercent <= 0}
              >
                + Share
              </button>
              <button
                type="button"
                className="staff-bonus-btn staff-bonus-btn--ghost"
                onClick={() => updatePart({ subParts: undefined, members: part.members ?? [] })}
              >
                Flat
              </button>
            </>
          ) : (
            <button type="button" className="staff-bonus-btn staff-bonus-btn--ghost" onClick={startSplit}>
              Split into shares
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
})

function collectMemberIdsToSet(members: StaffBonusMemberShare[] | undefined, out: Set<string>) {
  for (const member of members ?? []) {
    out.add(member.staffId)
  }
}

type StepSectionProps = {
  step: number | string
  title: string
  hint?: string
  children: ReactNode
}

function StepSection({ step, title, hint, children }: StepSectionProps) {
  return (
    <section className="staff-bonus-step">
      <header className="staff-bonus-step-head">
        <span className="staff-bonus-step-num">{step}</span>
        <div>
          <h3>{title}</h3>
          {hint ? <p>{hint}</p> : null}
        </div>
      </header>
      {children}
    </section>
  )
}

export default function StaffBonusPanel({
  open,
  onClose,
  overlayTop = 0,
  monthKey,
  monthLabel,
  staff,
  collectedActual,
  settings,
  defaultPoolPercent,
  onSave,
}: StaffBonusPanelProps) {
  const [draft, setDraft] = useState<StaffBonusMonthSettings>(() => clonePlan(settings))
  const [poolPercentInput, setPoolPercentInput] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(clonePlan(settings))
    const pct = settings.poolPercent
    setPoolPercentInput(pct !== undefined && pct > 0 ? String(pct) : '')
    // Only reload when panel opens or month changes — not on every cloud sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, monthKey])

  const deferredDraft = useDeferredValue(draft)

  const roundOptions = useMemo(() => getStaffBonusRoundOptions(collectedActual), [collectedActual])
  const collectedForBonus = useMemo(
    () => resolveCollectedForBonus(draft, collectedActual),
    [draft, collectedActual],
  )
  const poolPercent = Math.max(0, Math.min(100, parseAmount(poolPercentInput) || 0))
  const poolAmount = useMemo(
    () => computePoolAmount(collectedForBonus, poolPercent),
    [collectedForBonus, poolPercent],
  )

  const remainderBlockedIds = useMemo(
    () => collectStaffIdsUsedElsewhere(deferredDraft, { excludeRemainder: true }),
    [deferredDraft],
  )

  const partBlockedIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const part of deferredDraft.parts ?? []) {
      map.set(part.id, collectStaffIdsUsedElsewhere(deferredDraft, { excludePartId: part.id }))
    }
    return map
  }, [deferredDraft])

  const bonusBreakdown = useMemo(
    () => computeStaffBonusBreakdown(deferredDraft, poolAmount),
    [deferredDraft, poolAmount],
  )
  const bonusTotals = bonusBreakdown.totals
  const poolBalanceAmount = bonusBreakdown.poolBalanceAmount
  const poolRoundingRemainder = bonusBreakdown.roundingRemainder
  const totalPaidOut = useMemo(
    () => [...bonusTotals.values()].reduce((sum, amount) => sum + amount, 0),
    [bonusTotals],
  )

  if (!open) return null

  const panelStyle = {
    '--staff-bonus-top': `${Math.max(overlayTop, 0)}px`,
  } as CSSProperties

  function savePlan() {
    const next: StaffBonusMonthSettings = {
      ...draft,
      poolPercent: poolPercent > 0 ? poolPercent : undefined,
      parts: draft.parts && draft.parts.length > 0 ? draft.parts : undefined,
      remainderMembers:
        draft.remainderMembers && draft.remainderMembers.length > 0
          ? draft.remainderMembers
          : undefined,
    }
    onSave(monthKey, next)
    onClose()
  }

  function updateParts(parts: StaffBonusPart[]) {
    setDraft((current) => ({ ...current, parts }))
  }

  function splitPool(count: number) {
    updateParts(createEqualPoolParts(poolAmount, count))
  }

  function setCollectedRounded(amount: number | null) {
    setDraft((current) => {
      const next = { ...current }
      if (amount === null) {
        delete next.collectedRounded
      } else {
        next.collectedRounded = amount
      }
      return next
    })
  }

  return (
    <Portal>
      <div
        className="staff-bonus-overlay"
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Staff bonus plan"
      >
        <div className="staff-bonus-backdrop" aria-hidden="true" />
        <section className="staff-bonus-panel">
          <header className="staff-bonus-panel-head">
            <div>
              <h2>Bonus plan</h2>
              <p>{monthLabel}</p>
            </div>
            <button type="button" className="staff-bonus-close" onClick={onClose}>
              ✕
            </button>
          </header>

          <StepSection step={1} title="Sales credited" hint="Pick the collection amount used for bonus">
            <div className="staff-bonus-credit">
              <div className="staff-bonus-credit-row">
                <span>Actual {formatMoney(collectedActual)}</span>
                <span className="staff-bonus-credit-arrow">→</span>
                <strong>Credited {formatMoney(collectedForBonus)}</strong>
              </div>
              <div className="staff-bonus-credit-chips">
                <button
                  type="button"
                  className={`staff-bonus-credit-chip ${
                    draft.collectedRounded === undefined ? 'staff-bonus-credit-chip--active' : ''
                  }`}
                  onClick={() => setCollectedRounded(null)}
                >
                  {formatMoney(collectedActual)}
                </button>
                <RoundTypeChips
                  label=""
                  compact
                  options={roundOptions}
                  activeAmount={draft.collectedRounded}
                  onSelect={setCollectedRounded}
                />
              </div>
            </div>
          </StepSection>

          <StepSection step={2} title="Bonus pool" hint="Set pool rate — the bonus amount to split">
            <div className="staff-bonus-summary">
              <label>
                <span>Pool rate % · {monthLabel}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={poolPercentInput}
                  onChange={(e) => setPoolPercentInput(e.target.value)}
                  placeholder={defaultPoolPercent > 0 ? String(defaultPoolPercent) : '0.25'}
                />
              </label>
              <div>
                <span>Pool amount</span>
                <strong>{formatMoney(poolAmount)}</strong>
              </div>
            </div>
          </StepSection>

          <StepSection step={3} title="Split pool" hint="Divide the pool into parts — each part gets its own staff">
            <div className="staff-bonus-section-head staff-bonus-section-head--inline">
              <div className="staff-bonus-split-btns">
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className="staff-bonus-btn staff-bonus-btn--ghost"
                    onClick={() => splitPool(count)}
                    disabled={poolAmount <= 0}
                  >
                    ÷{count}
                  </button>
                ))}
                <button
                  type="button"
                  className="staff-bonus-btn staff-bonus-btn--primary"
                  onClick={() => updateParts([...(draft.parts ?? []), createBonusPart()])}
                >
                  + Part
                </button>
              </div>
            </div>
            {(draft.parts ?? []).length === 0 ? (
              <p className="staff-bonus-empty">Tap ÷2 to split the pool into equal parts.</p>
            ) : (
              <div className="staff-bonus-parts">
                {(draft.parts ?? []).map((part, index) => {
                  const blockedIds = partBlockedIds.get(part.id) ?? new Set<string>()
                  return (
                    <PartEditor
                      key={part.id}
                      part={part}
                      partIndex={index}
                      staff={staff}
                      blockedTopLevelIds={blockedIds}
                      onChange={(next) => {
                        const parts = [...(draft.parts ?? [])]
                        parts[index] = next
                        updateParts(parts)
                      }}
                      onRemove={() => updateParts((draft.parts ?? []).filter((_, i) => i !== index))}
                    />
                  )
                })}
              </div>
            )}
          </StepSection>

          <StepSection
            step={4}
            title="Pool balance"
            hint="Remaining pool after parts — assign staff for this share"
          >
            <div className="staff-bonus-balance staff-bonus-balance--stable staff-bonus-balance--pool">
              <div className="staff-bonus-balance-summary">
                <span>{formatMoney(poolBalanceAmount)}</span>
              </div>
              {poolBalanceAmount > 0 ? (
                <>
                  <p className="staff-bonus-step-hint">
                    Includes part leftovers and rounding — assign staff here
                  </p>
                  <MemberPicker
                    staff={staff}
                    members={draft.remainderMembers}
                    blockedIds={remainderBlockedIds}
                    sliceAmount={poolBalanceAmount}
                    onChange={(remainderMembers) =>
                      setDraft((current) => ({ ...current, remainderMembers }))
                    }
                  />
                  {poolRoundingRemainder > 0 ? (
                    <div className="staff-bonus-rounding-row staff-bonus-rounding-row--pool">
                      <span>Rounding balance left</span>
                      <strong>{formatMoney(poolRoundingRemainder)}</strong>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="staff-bonus-empty">Pool is fully split into parts</p>
              )}
            </div>
          </StepSection>

          <StepSection step={5} title="Payout preview" hint="Each staff member's bonus before saving">
            <div className="staff-bonus-balance-summary staff-bonus-balance-summary--total">
              <span>Total</span>
              <strong>{formatMoney(totalPaidOut)}</strong>
            </div>
            <ul className="staff-bonus-payout-list">
              {staff.map((member) => {
                const amount = bonusTotals.get(member.id) ?? 0
                return (
                  <li
                    key={member.id}
                    className={`staff-bonus-payout-row ${amount > 0 ? 'staff-bonus-payout-row--paid' : 'staff-bonus-payout-row--none'}`}
                  >
                    <span>{member.name}</span>
                    <strong>{amount > 0 ? formatMoney(amount) : 'No bonus'}</strong>
                  </li>
                )
              })}
            </ul>
          </StepSection>

          <footer className="staff-bonus-panel-foot">
            <button type="button" className="staff-bonus-btn staff-bonus-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="staff-bonus-btn staff-bonus-btn--primary" onClick={savePlan}>
              Save
            </button>
          </footer>
        </section>
      </div>
    </Portal>
  )
}
