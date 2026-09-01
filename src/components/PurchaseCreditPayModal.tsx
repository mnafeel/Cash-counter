import { useEffect, useMemo, useState } from 'react'
import type { ExpensePayType } from '../types'
import { NO1_BILL_LABEL, NO2_BILL_LABEL } from '../utils/expenseBillLabels'
import { formatMoney, parseAmount } from '../utils/format'
import {
  buildBulkCreditPaymentPlan,
  groupPurchaseCreditSelectionsByBill,
  type BulkCreditPaySelection,
} from '../utils/purchaseHistory'
import Portal from './Portal'
import './PurchaseHistoryPanel.css'

type PayMode = 'cash' | 'bank' | 'cheque' | 'split'

type BillPayDraft = {
  mode: PayMode
  cashStr: string
  bankStr: string
  chequeStr: string
  chequeApproved: boolean
}

interface PurchaseCreditPayModalProps {
  open: boolean
  selections: BulkCreditPaySelection[]
  onClose: () => void
  onConfirm: (
    payments: Array<{
      id: string
      payment: {
        payType: ExpensePayType
        payAmount: number
        cashAmount?: number
        bankAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
      }
    }>,
  ) => void
}

function defaultBillDraft(total: number, mode: PayMode = 'cash'): BillPayDraft {
  return {
    mode,
    cashStr: mode === 'split' ? String(total) : '',
    bankStr: '',
    chequeStr: '',
    chequeApproved: true,
  }
}

function billKey(billNumber: 1 | 2): string {
  return billNumber === 1 ? 'no1' : 'no2'
}

function payModeLabel(mode: PayMode): string {
  if (mode === 'cash') return '💵 Cash'
  if (mode === 'bank') return '🏦 Bank'
  if (mode === 'cheque') return '🧾 Cheque'
  return '➗ Split'
}

export default function PurchaseCreditPayModal({
  open,
  selections,
  onClose,
  onConfirm,
}: PurchaseCreditPayModalProps) {
  const billGroups = useMemo(() => groupPurchaseCreditSelectionsByBill(selections), [selections])
  const totalDue = useMemo(
    () => selections.reduce((sum, row) => sum + row.amount, 0),
    [selections],
  )
  const [billDrafts, setBillDrafts] = useState<Record<string, BillPayDraft>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const next: Record<string, BillPayDraft> = {}
    for (const group of billGroups) {
      next[billKey(group.billNumber)] = defaultBillDraft(group.total)
    }
    setBillDrafts(next)
    setError('')
  }, [open, billGroups])

  if (!open || selections.length === 0) return null

  function updateBillDraft(billNumber: 1 | 2, patch: Partial<BillPayDraft>) {
    const key = billKey(billNumber)
    setBillDrafts((current) => ({
      ...current,
      [key]: { ...defaultBillDraft(0), ...current[key], ...patch },
    }))
  }

  function modesForBill(billNumber: 1 | 2): PayMode[] {
    return billNumber === 1 ? ['cash', 'bank', 'split'] : ['cash', 'bank', 'cheque', 'split']
  }

  function accountHint(billNumber: 1 | 2, mode: PayMode): string {
    if (billNumber === 1) {
      if (mode === 'cash') return `${NO1_BILL_LABEL} bills clear from cash.`
      if (mode === 'bank') return `${NO1_BILL_LABEL} bills clear from bank.`
      return `${NO1_BILL_LABEL} split between cash and bank.`
    }
    if (mode === 'cheque') return `${NO2_BILL_LABEL} bills clear by cheque.`
    if (mode === 'bank') return `${NO2_BILL_LABEL} bills clear from bank.`
    if (mode === 'cash') return `${NO2_BILL_LABEL} bills clear from cash.`
    return `${NO2_BILL_LABEL} split between cash, bank, and cheque.`
  }

  function handleSubmit() {
    setError('')
    const allPayments: Array<{
      id: string
      payment: {
        payType: ExpensePayType
        payAmount: number
        cashAmount?: number
        bankAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
      }
    }> = []

    for (const group of billGroups) {
      const draft = billDrafts[billKey(group.billNumber)] ?? defaultBillDraft(group.total)
      if (draft.mode === 'split') {
        const cash = parseAmount(draft.cashStr)
        const bank = parseAmount(draft.bankStr)
        const cheque =
          group.billNumber === 2 && draft.chequeApproved ? parseAmount(draft.chequeStr) : 0
        const sum = cash + bank + cheque
        if (Math.abs(sum - group.total) > 0.009) {
          setError(`${group.label}: split must equal ${formatMoney(group.total)}`)
          return
        }
        const plan = buildBulkCreditPaymentPlan(group.selections, 'split', {
          cash,
          bank,
          cheque,
          chequeApproved: draft.chequeApproved,
        })
        if (plan.length === 0) {
          setError(`${group.label}: enter cash or bank amounts.`)
          return
        }
        allPayments.push(...plan)
        continue
      }

      const plan = buildBulkCreditPaymentPlan(group.selections, draft.mode)
      if (plan.length === 0) {
        setError(`Could not build payment for ${group.label}.`)
        return
      }
      allPayments.push(...plan)
    }

    onConfirm(allPayments)
  }

  return (
    <Portal>
      <div className="purchase-credit-pay-overlay" role="dialog" aria-modal="true">
        <div className="purchase-credit-pay-modal purchase-credit-pay-modal--wide">
          <header className="purchase-credit-pay-head">
            <h4>Pay selected credits</h4>
            <button type="button" className="purchase-credit-pay-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <p className="purchase-credit-pay-meta">
            {selections.length} bill{selections.length === 1 ? '' : 's'} · Total{' '}
            <strong>{formatMoney(totalDue)}</strong>
          </p>

          {billGroups.map((group) => {
            const draft = billDrafts[billKey(group.billNumber)] ?? defaultBillDraft(group.total)
            const modes = modesForBill(group.billNumber)
            return (
              <section
                key={group.billNumber}
                className={`purchase-credit-pay-bill purchase-credit-pay-bill--no${group.billNumber}`}
              >
                <div className="purchase-credit-pay-bill-head">
                  <strong>{group.label}</strong>
                  <span>
                    {group.selections.length} bill{group.selections.length === 1 ? '' : 's'} ·{' '}
                    {formatMoney(group.total)}
                  </span>
                </div>

                <div className="purchase-credit-pay-modes purchase-credit-pay-modes--bill">
                  {modes.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`purchase-credit-pay-mode-btn ${draft.mode === mode ? 'purchase-credit-pay-mode-btn--active' : ''}`}
                      onClick={() =>
                        updateBillDraft(group.billNumber, {
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
                        onChange={(e) => updateBillDraft(group.billNumber, { cashStr: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>Bank</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.bankStr}
                        onChange={(e) => updateBillDraft(group.billNumber, { bankStr: e.target.value })}
                      />
                    </label>
                    {group.billNumber === 2 ? (
                      <>
                        <label>
                          <span>Cheque</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.chequeStr}
                            onChange={(e) => updateBillDraft(group.billNumber, { chequeStr: e.target.value })}
                          />
                        </label>
                        <label className="purchase-credit-pay-cheque-approved">
                          <input
                            type="checkbox"
                            checked={draft.chequeApproved}
                            onChange={(e) =>
                              updateBillDraft(group.billNumber, { chequeApproved: e.target.checked })
                            }
                          />
                          <span>Cheque approved to bank</span>
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <p className="purchase-credit-pay-hint">{accountHint(group.billNumber, draft.mode)}</p>
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
              Pay {formatMoney(totalDue)}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  )
}
