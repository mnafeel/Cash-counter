import { useEffect, useMemo, useState } from 'react'
import { formatMoney, parseAmount } from '../utils/format'
import {
  buildBulkSaleCreditPaymentPlan,
  formatSaleCreditPayModeLabel,
  groupSaleCreditSelectionsByParty,
  type SaleCreditPaySelection,
  type SaleCreditPaymentInput,
} from '../utils/saleCreditPayment'
import Portal from './Portal'
import './PurchaseHistoryPanel.css'

type PayMode = 'cash' | 'bank' | 'cheque' | 'split'

type PartyPayDraft = {
  mode: PayMode
  cashStr: string
  bankStr: string
  chequeStr: string
  chequeApproved: boolean
}

interface SaleCreditPayModalProps {
  open: boolean
  selections: SaleCreditPaySelection[]
  onClose: () => void
  onConfirm: (payments: Array<{ id: string; payment: SaleCreditPaymentInput }>) => void
}

function defaultPartyDraft(total: number, mode: PayMode = 'cash'): PartyPayDraft {
  return {
    mode,
    cashStr: mode === 'split' ? String(total) : '',
    bankStr: '',
    chequeStr: '',
    chequeApproved: true,
  }
}

function payModeLabel(mode: PayMode): string {
  if (mode === 'cash') return '💵 Cash'
  if (mode === 'bank') return '🏦 Bank'
  if (mode === 'cheque') return '🧾 Cheque'
  return '➗ Split'
}

export default function SaleCreditPayModal({
  open,
  selections,
  onClose,
  onConfirm,
}: SaleCreditPayModalProps) {
  const partyGroups = useMemo(() => groupSaleCreditSelectionsByParty(selections), [selections])
  const totalDue = useMemo(
    () => selections.reduce((sum, row) => sum + row.amount, 0),
    [selections],
  )
  const [partyDrafts, setPartyDrafts] = useState<Record<string, PartyPayDraft>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const next: Record<string, PartyPayDraft> = {}
    for (const group of partyGroups) {
      next[group.customerName] = defaultPartyDraft(group.total)
    }
    setPartyDrafts(next)
    setError('')
  }, [open, partyGroups])

  if (!open || selections.length === 0) return null

  function updatePartyDraft(customerName: string, patch: Partial<PartyPayDraft>) {
    setPartyDrafts((current) => ({
      ...current,
      [customerName]: { ...defaultPartyDraft(0), ...current[customerName], ...patch },
    }))
  }

  function handleSubmit() {
    setError('')
    const allPayments: Array<{ id: string; payment: SaleCreditPaymentInput }> = []

    for (const group of partyGroups) {
      const draft = partyDrafts[group.customerName] ?? defaultPartyDraft(group.total)
      if (draft.mode === 'split') {
        const cash = parseAmount(draft.cashStr)
        const bank = parseAmount(draft.bankStr)
        const cheque = draft.chequeApproved ? parseAmount(draft.chequeStr) : 0
        const sum = cash + bank + cheque
        if (Math.abs(sum - group.total) > 0.009) {
          setError(`${group.customerName}: split must equal ${formatMoney(group.total)}`)
          return
        }
        const plan = buildBulkSaleCreditPaymentPlan(group.selections, 'split', {
          cash,
          bank,
          cheque,
          chequeApproved: draft.chequeApproved,
        })
        if (plan.length === 0) {
          setError(`${group.customerName}: enter cash, bank, or cheque amounts.`)
          return
        }
        allPayments.push(...plan)
        continue
      }

      const plan = buildBulkSaleCreditPaymentPlan(group.selections, draft.mode)
      if (plan.length === 0) {
        setError(`Could not build payment for ${group.customerName}.`)
        return
      }
      allPayments.push(...plan)
    }

    onConfirm(allPayments)
  }

  return (
    <Portal>
      <div className="purchase-credit-pay-overlay" role="dialog" aria-modal="true" aria-label="Bill clear">
        <div className="purchase-credit-pay-modal purchase-credit-pay-modal--wide">
          <header className="purchase-credit-pay-head">
            <h4>Bill clear</h4>
            <button type="button" className="purchase-credit-pay-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <p className="purchase-credit-pay-meta">
            {selections.length} bill{selections.length === 1 ? '' : 's'} · Total{' '}
            <strong>{formatMoney(totalDue)}</strong>
          </p>

          {partyGroups.map((group) => {
            const draft = partyDrafts[group.customerName] ?? defaultPartyDraft(group.total)
            return (
              <section key={group.customerName} className="sale-credit-pay-party">
                <div className="sale-credit-pay-party-head">
                  <strong>{group.customerName}</strong>
                  <span>
                    {group.selections.length} bill{group.selections.length === 1 ? '' : 's'} ·{' '}
                    {formatMoney(group.total)}
                  </span>
                </div>

                <div className="purchase-credit-pay-modes">
                  {(['cash', 'bank', 'cheque', 'split'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`purchase-hist-date-chip ${draft.mode === mode ? 'purchase-hist-date-chip--active' : ''}`}
                      onClick={() =>
                        updatePartyDraft(group.customerName, {
                          mode,
                          cashStr: mode === 'split' ? String(group.total) : '',
                          bankStr: '',
                          chequeStr: '',
                        })
                      }
                    >
                      {payModeLabel(mode)}
                    </button>
                  ))}
                </div>

                {draft.mode === 'split' ? (
                  <div className="purchase-credit-pay-split">
                    <label>
                      <span>Cash</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.cashStr}
                        onChange={(e) =>
                          updatePartyDraft(group.customerName, { cashStr: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Bank</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.bankStr}
                        onChange={(e) =>
                          updatePartyDraft(group.customerName, { bankStr: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Cheque</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.chequeStr}
                        onChange={(e) =>
                          updatePartyDraft(group.customerName, { chequeStr: e.target.value })
                        }
                      />
                    </label>
                    <label className="purchase-credit-pay-cheque-approved">
                      <input
                        type="checkbox"
                        checked={draft.chequeApproved}
                        onChange={(e) =>
                          updatePartyDraft(group.customerName, { chequeApproved: e.target.checked })
                        }
                      />
                      <span>Cheque approved to bank</span>
                    </label>
                  </div>
                ) : (
                  <p className="purchase-credit-pay-hint">
                    {group.selections.length} bill{group.selections.length === 1 ? '' : 's'} cleared via{' '}
                    {formatSaleCreditPayModeLabel(draft.mode).toLowerCase()}.
                  </p>
                )}
              </section>
            )
          })}

          {error ? <p className="purchase-credit-pay-error">{error}</p> : null}

          <footer className="purchase-credit-pay-actions">
            <button type="button" className="purchase-hist-back" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="purchase-credit-pay-submit" onClick={handleSubmit}>
              Bill clear · {formatMoney(totalDue)}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  )
}
