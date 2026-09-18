import { useMemo, useState } from 'react'
import { formatMoney } from '../utils/format'
import {
  shareReportSummaryImage,
  type ReportShareSummary,
} from '../utils/reportShareCard'
import Portal from './Portal'
import './ReportSharePanel.css'

interface ReportSharePanelProps {
  open: boolean
  onClose: () => void
  summary: ReportShareSummary
  growthSeries?: number[]
}

export default function ReportSharePanel({
  open,
  onClose,
  summary,
  growthSeries = [],
}: ReportSharePanelProps) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const spark = useMemo(() => {
    if (growthSeries.length < 2) {
      const total = Math.max(summary.salesCollected, 1)
      return Array.from({ length: 12 }, (_, i) => (total * (i + 1)) / 12)
    }
    return growthSeries.slice(-16)
  }, [growthSeries, summary.salesCollected])

  if (!open) return null

  async function handleSend() {
    setBusy(true)
    setStatus('')
    try {
      const result = await shareReportSummaryImage(summary)
      if (result === 'shared') setStatus('Shared')
      else if (result === 'downloaded') setStatus('Image saved')
      else setStatus('Could not share')
    } catch {
      setStatus('Could not share')
    } finally {
      setBusy(false)
      window.setTimeout(() => setStatus(''), 2500)
    }
  }

  return (
    <Portal>
      <div className="report-share-overlay" role="dialog" aria-modal="true" aria-label="Share report">
        <button type="button" className="report-share-backdrop" aria-label="Close" onClick={onClose} />
        <div className="report-share-sheet">
          <header className="report-share-sheet__head">
            <div>
              <p className="report-share-kicker">Business snapshot</p>
              <h2>{summary.periodLabel}</h2>
            </div>
            <button type="button" className="report-share-close" onClick={onClose} aria-label="Close share">
              ✕
            </button>
          </header>

          <div className="report-share-card" aria-label="Business summary card">
            <div className="report-share-card__glow" aria-hidden="true" />
            <svg className="report-share-card__spark" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">
              <path
                d={sparkPath(spark)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <div className="report-share-card__brand">
              <span>Shalimar Fashions</span>
              <strong>Business snapshot</strong>
            </div>

            <div className="report-share-lanes">
              <div className="report-share-lane report-share-lane--cash">
                <span>Cash in counter</span>
                <strong>{formatMoney(summary.cashInHand)}</strong>
                <small>Opening {formatMoney(summary.openingCash)}</small>
              </div>
              <div className="report-share-lane report-share-lane--bank">
                <span>Cash at bank</span>
                <strong>{formatMoney(summary.cashAtBank)}</strong>
                <small>Opening {formatMoney(summary.openingBank)}</small>
              </div>
            </div>

            <div className="report-share-grid report-share-grid--transfers">
              <div>
                <span>Cash → Bank</span>
                <strong>{formatMoney(summary.cashToBank)}</strong>
              </div>
              <div>
                <span>Bank → Cash</span>
                <strong>{formatMoney(summary.bankToCash)}</strong>
              </div>
            </div>

            <p className="report-share-section-label">Sales</p>
            <div className="report-share-sales">
              <div className="report-share-box report-share-box--lg report-share-box--sales">
                <span>Sales collected</span>
                <strong>{formatMoney(summary.salesCollected)}</strong>
                <small>
                  💵 {formatMoney(summary.salesCash)} · 🏦 {formatMoney(summary.salesBank)}
                </small>
              </div>
              <div className="report-share-box report-share-box--lg report-share-box--credit report-share-sales__side">
                <span>With credit/cheque</span>
                <strong>{formatMoney(summary.withCreditSales)}</strong>
              </div>
              <div className="report-share-box report-share-box--lg report-share-box--old">
                <span>Old credit/cheque</span>
                <strong>{formatMoney(summary.oldCreditChequeCollected)}</strong>
              </div>
              <div className="report-share-box report-share-box--lg report-share-box--today">
                <span>Today&apos;s only sale</span>
                <strong>{formatMoney(summary.sameDaySales)}</strong>
                <small className="report-share-box__meta report-share-box__meta--cols">
                  <span className="report-share-box__meta-col">
                    <em>Created</em>
                    <i>this period</i>
                  </span>
                  <span className="report-share-box__meta-col">
                    <em>Collected</em>
                    <i>this period</i>
                  </span>
                </small>
              </div>
            </div>

            <p className="report-share-section-label">Expenses</p>
            <div className="report-share-expenses">
              <div className="report-share-box report-share-box--lg report-share-box--total-exp">
                <span>Total expense</span>
                <strong>{formatMoney(summary.expenseTotal)}</strong>
                <small>
                  Purchase {formatMoney(summary.expensePurchase)} · Normal{' '}
                  {formatMoney(summary.expenseNormal)}
                </small>
              </div>
              <div className="report-share-box report-share-box--lg report-share-box--purchase">
                <span>Purchase expense</span>
                <strong>{formatMoney(summary.expensePurchase)}</strong>
                <small>
                  💵 {formatMoney(summary.expensePurchaseCash)} · 🏦{' '}
                  {formatMoney(summary.expensePurchaseBank)}
                </small>
              </div>
              <div className="report-share-box report-share-box--lg report-share-box--normal report-share-expenses__normal">
                <span>Normal expense</span>
                <strong>{formatMoney(summary.expenseNormal)}</strong>
                <small>
                  💵 {formatMoney(summary.expenseNormalCash)} · 🏦{' '}
                  {formatMoney(summary.expenseNormalBank)}
                </small>
              </div>
              <div className="report-share-box report-share-box--lg report-share-box--dues report-share-expenses__dues">
                <span>Credit + Cheque open</span>
                <strong>{formatMoney(summary.creditPending + summary.chequePending)}</strong>
                <small>
                  Credit {formatMoney(summary.creditPending)} · Cheque{' '}
                  {formatMoney(summary.chequePending)}
                </small>
              </div>
            </div>

            {summary.notSaleTotal > 0.01 ? (
              <div className="report-share-box report-share-box--lg" style={{ marginTop: 6 }}>
                <span>Not sale · cash in</span>
                <strong>{formatMoney(summary.notSaleTotal)}</strong>
              </div>
            ) : null}
          </div>

          <div className="report-share-actions">
            <button
              type="button"
              className="report-share-send"
              onClick={() => void handleSend()}
              disabled={busy}
            >
              <span className="report-share-send__shine" aria-hidden="true" />
              <span>{busy ? 'Preparing…' : 'Send'}</span>
            </button>
            {status ? <p className="report-share-status">{status}</p> : null}
            <p className="report-share-hint">Creates a shareable image of this period’s summary.</p>
          </div>
        </div>
      </div>
    </Portal>
  )
}

function sparkPath(values: number[]): string {
  if (values.length === 0) return ''
  const width = 200
  const height = 56
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width
      const y = height - 8 - ((value - min) / span) * (height - 16)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}
