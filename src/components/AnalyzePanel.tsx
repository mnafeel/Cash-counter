import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { AppData } from '../types'
import { usePageEscape } from '../hooks/usePageEscape'
import { formatMoney } from '../utils/format'
import { toInputDate } from '../utils/salesReport'
import type { ReportDatePreset } from '../utils/reportsHub'
import {
  ANALYZE_DATE_PRESETS,
  ANALYZE_TOPICS,
  analyzeFromCache,
  buildAnalyzeCache,
  hasAnalyzeBars,
  type AnalyzeCache,
  type AnalyzeRankItem,
  type AnalyzeSeriesPoint,
  type AnalyzeTopic,
  type AnalyzeMonthPoint,
} from '../utils/businessAnalysis'
import Portal from './Portal'
import { PageBackButton, PageCloseButton, PageCorners } from './PageCorners'
import './AnalyzePanel.css'

interface AnalyzePanelProps {
  open: boolean
  onClose: () => void
  data: AppData
}

function RankBars({
  items,
  emptyLabel,
  accent = 'gold',
}: {
  items: AnalyzeRankItem[]
  emptyLabel: string
  accent?: 'gold' | 'teal' | 'rose' | 'blue'
}) {
  if (!hasAnalyzeBars(items)) {
    return <p className="analyze-empty">{emptyLabel}</p>
  }
  const max = Math.max(...items.map((item) => item.amount), 1)
  return (
    <ul className="analyze-rank-list">
      {items.map((item, index) => (
        <li key={item.key} className="analyze-rank-row">
          <div className="analyze-rank-meta">
            <span className="analyze-rank-name">
              <em>#{index + 1}</em> {item.label}
            </span>
            <strong>{formatMoney(item.amount)}</strong>
          </div>
          <div className="analyze-bar-track">
            <div
              className={`analyze-bar-fill analyze-bar-fill--${accent}`}
              style={{ width: `${Math.max(4, (item.amount / max) * 100)}%` }}
            />
          </div>
          <div className="analyze-rank-sub">
            {item.count} item{item.count === 1 ? '' : 's'} · {item.share.toFixed(0)}%
          </div>
        </li>
      ))}
    </ul>
  )
}

function DayBars({
  points,
  emptyLabel,
  periodLabel,
  periodTotal,
}: {
  points: AnalyzeSeriesPoint[]
  emptyLabel: string
  periodLabel: string
  periodTotal: number
}) {
  if (points.length === 0) {
    return <p className="analyze-empty">{emptyLabel}</p>
  }
  const hasSales = hasAnalyzeBars(points)
  const max = Math.max(...points.map((point) => point.amount), 1)
  const dayCount = points.length
  const longSpan = dayCount > 16
  const daysWithSales = points.filter((point) => point.amount > 0)
  return (
    <div className="analyze-day-block">
      <div className="analyze-day-summary">
        <span>
          {periodLabel} · {dayCount} day{dayCount === 1 ? '' : 's'}
          {daysWithSales.length > 0
            ? ` · ${daysWithSales.length} with sales`
            : ''}
        </span>
        <strong>{formatMoney(periodTotal)}</strong>
      </div>
      {!hasSales ? (
        <p className="analyze-empty">{emptyLabel}</p>
      ) : (
        <>
          <p className="analyze-day-scroll-hint">
            Scroll sideways — each bar is one day with its exact total
          </p>
          <div
            className={`analyze-day-chart ${longSpan ? 'analyze-day-chart--scroll' : ''}`}
            role="img"
            aria-label={`Sales by day for ${periodLabel}`}
          >
            {points.map((point) => {
              const tall = point.amount > 0
              const heightPct = tall ? Math.max(10, (point.amount / max) * 100) : 2
              return (
                <div
                  key={point.key}
                  className={`analyze-day-col ${tall ? '' : 'analyze-day-col--zero'}`}
                >
                  <div className="analyze-day-col-bar-wrap">
                    {tall ? (
                      <span className="analyze-day-col-amount" title={formatMoney(point.amount)}>
                        {formatMoney(point.amount)}
                      </span>
                    ) : null}
                    <div
                      className={`analyze-day-col-bar ${tall ? '' : 'analyze-day-col-bar--zero'}`}
                      style={{ height: `${heightPct}%` }}
                      title={`${point.key}: ${formatMoney(point.amount)}`}
                    />
                  </div>
                  <span className="analyze-day-col-label">{point.label}</span>
                </div>
              )
            })}
          </div>
          {daysWithSales.length > 0 ? (
            <div className="analyze-day-ledger">
              <h3 className="analyze-day-ledger-title">Day-by-day totals</h3>
              <ul className="analyze-day-ledger-list">
                {daysWithSales.map((point) => (
                  <li key={`ledger-${point.key}`} className="analyze-day-ledger-row">
                    <span>{point.key}</span>
                    <strong>{formatMoney(point.amount)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function MonthTrend({ points }: { points: AnalyzeMonthPoint[] }) {
  const max = Math.max(
    ...points.flatMap((point) => [point.sales, point.purchases, point.expenses]),
    1,
  )
  return (
    <div className="analyze-month-chart" role="img" aria-label="Monthly trend">
      {points.map((point) => (
        <div key={point.key} className="analyze-month-col">
          <div className="analyze-month-bars">
            <div
              className="analyze-month-bar analyze-month-bar--sales"
              style={{ height: `${Math.max(4, (point.sales / max) * 100)}%` }}
              title={`Sales ${formatMoney(point.sales)}`}
            />
            <div
              className="analyze-month-bar analyze-month-bar--purchase"
              style={{ height: `${Math.max(4, (point.purchases / max) * 100)}%` }}
              title={`Purchase ${formatMoney(point.purchases)}`}
            />
            <div
              className="analyze-month-bar analyze-month-bar--expense"
              style={{ height: `${Math.max(4, (point.expenses / max) * 100)}%` }}
              title={`Expense ${formatMoney(point.expenses)}`}
            />
          </div>
          <span className="analyze-month-label">{point.label}</span>
        </div>
      ))}
      <div className="analyze-month-legend">
        <span className="analyze-month-legend-item analyze-month-legend-item--sales">Sales</span>
        <span className="analyze-month-legend-item analyze-month-legend-item--purchase">Purchase</span>
        <span className="analyze-month-legend-item analyze-month-legend-item--expense">Expense</span>
      </div>
    </div>
  )
}

export default function AnalyzePanel({ open, onClose, data }: AnalyzePanelProps) {
  const [datePreset, setDatePreset] = useState<ReportDatePreset>('month')
  const [selectedDate, setSelectedDate] = useState(() => toInputDate())
  const [rangeTo, setRangeTo] = useState(() => toInputDate())
  const [topic, setTopic] = useState<AnalyzeTopic>('overview')
  const [cache, setCache] = useState<AnalyzeCache | null>(null)
  const [cacheReady, setCacheReady] = useState(false)

  const deferredPreset = useDeferredValue(datePreset)
  const deferredSelectedDate = useDeferredValue(selectedDate)
  const deferredRangeTo = useDeferredValue(rangeTo)

  useEffect(() => {
    if (!open) {
      setCache(null)
      setCacheReady(false)
      return
    }
    setDatePreset('month')
    setSelectedDate(toInputDate())
    setRangeTo(toInputDate())
    setTopic('overview')
    setCacheReady(false)
    setCache(null)

    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const next = buildAnalyzeCache(data)
      if (cancelled) return
      setCache(next)
      setCacheReady(true)
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, data])

  usePageEscape(onClose, open)

  const analysis = useMemo(() => {
    if (!cache) return null
    return analyzeFromCache(cache, deferredPreset, deferredSelectedDate, deferredRangeTo)
  }, [cache, deferredPreset, deferredSelectedDate, deferredRangeTo])

  const filtering =
    cacheReady &&
    analysis != null &&
    (deferredPreset !== datePreset ||
      deferredSelectedDate !== selectedDate ||
      deferredRangeTo !== rangeTo)

  function setPresetFast(next: ReportDatePreset) {
    startTransition(() => setDatePreset(next))
  }

  if (!open) return null

  return (
    <Portal>
      <div className="analyze-overlay" role="dialog" aria-modal="true" aria-label="Analyze">
        <div className="analyze-panel page-shell">
          <PageCorners
            left={<PageBackButton onClick={onClose} ariaLabel="Back" />}
            right={<PageCloseButton onClick={onClose} ariaLabel="Close analyze" />}
          />
          <header className="analyze-head page-head--corners">
            <div>
              <h1 className="analyze-title">Analyze</h1>
              <p className="analyze-sub">
                {analysis ? `${analysis.periodLabel} · business growth` : 'Preparing…'}
              </p>
            </div>
          </header>

          <div className="analyze-toolbar">
            <div className="analyze-date-bar">
              {ANALYZE_DATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`analyze-chip ${datePreset === preset.id ? 'analyze-chip--active' : ''}`}
                  onClick={() => setPresetFast(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`analyze-chip ${datePreset === 'date' ? 'analyze-chip--active' : ''}`}
                onClick={() => setPresetFast('date')}
              >
                Pick
              </button>
              <button
                type="button"
                className={`analyze-chip ${datePreset === 'range' ? 'analyze-chip--active' : ''}`}
                onClick={() => setPresetFast('range')}
              >
                Range
              </button>
            </div>

            {datePreset === 'date' ? (
              <label className="analyze-date-pick">
                <span>Date</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    const value = e.target.value
                    startTransition(() => setSelectedDate(value))
                  }}
                />
              </label>
            ) : null}

            {datePreset === 'range' ? (
              <div className="analyze-range-pick">
                <label className="analyze-date-pick">
                  <span>From</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      const value = e.target.value
                      startTransition(() => {
                        setSelectedDate(value)
                        setDatePreset('range')
                      })
                    }}
                  />
                </label>
                <label className="analyze-date-pick">
                  <span>To</span>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => {
                      const value = e.target.value
                      startTransition(() => {
                        setRangeTo(value)
                        setDatePreset('range')
                      })
                    }}
                  />
                </label>
              </div>
            ) : null}

            <div className="analyze-topic-bar">
              {ANALYZE_TOPICS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`analyze-topic ${topic === entry.id ? 'analyze-topic--active' : ''}`}
                  onClick={() => setTopic(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className={`analyze-body ${filtering ? 'analyze-body--filtering' : ''}`}>
            {!cacheReady || !analysis ? (
              <p className="analyze-empty">Loading analysis…</p>
            ) : (
              <>
                {topic === 'overview' ? (
                  <>
                    <div className="analyze-summary-grid">
                      <div className="analyze-summary-card analyze-summary-card--sales">
                        <span>Sales</span>
                        <strong>{formatMoney(analysis.salesTotal)}</strong>
                        <small>{analysis.salesCount} bills</small>
                      </div>
                      <div className="analyze-summary-card analyze-summary-card--purchase">
                        <span>Purchases</span>
                        <strong>{formatMoney(analysis.purchaseTotal)}</strong>
                        <small>{analysis.purchaseCount} bills</small>
                      </div>
                      <div className="analyze-summary-card analyze-summary-card--expense">
                        <span>Expenses</span>
                        <strong>{formatMoney(analysis.expenseTotal)}</strong>
                        <small>{analysis.expenseCount} items</small>
                      </div>
                      <div
                        className={`analyze-summary-card ${
                          analysis.net >= 0
                            ? 'analyze-summary-card--net-pos'
                            : 'analyze-summary-card--net-neg'
                        }`}
                      >
                        <span>Net</span>
                        <strong>{formatMoney(analysis.net)}</strong>
                        <small>Sales − purchase − expense</small>
                      </div>
                    </div>

                    <section className="analyze-section">
                      <h2>Highlights</h2>
                      <ul className="analyze-highlights">
                        <li>
                          Top customer ·{' '}
                          <strong>
                            {analysis.topCustomer
                              ? `${analysis.topCustomer.label} (${formatMoney(analysis.topCustomer.amount)})`
                              : '—'}
                          </strong>
                        </li>
                        <li>
                          Top expense ·{' '}
                          <strong>
                            {analysis.topExpense
                              ? `${analysis.topExpense.label} (${formatMoney(analysis.topExpense.amount)})`
                              : '—'}
                          </strong>
                        </li>
                        <li>
                          Top supplier ·{' '}
                          <strong>
                            {analysis.topSupplier
                              ? `${analysis.topSupplier.label} (${formatMoney(analysis.topSupplier.amount)})`
                              : '—'}
                          </strong>
                        </li>
                        <li>
                          Best sales day ·{' '}
                          <strong>
                            {analysis.bestSalesDay
                              ? `${analysis.bestSalesDay.label} (${formatMoney(analysis.bestSalesDay.amount)})`
                              : '—'}
                          </strong>
                        </li>
                        <li>
                          Best month (6 mo) ·{' '}
                          <strong>
                            {analysis.bestSalesMonth
                              ? `${analysis.bestSalesMonth.label} (${formatMoney(analysis.bestSalesMonth.sales)})`
                              : '—'}
                          </strong>
                        </li>
                      </ul>
                    </section>

                    <section className="analyze-section">
                      <h2>6-month trend</h2>
                      <MonthTrend points={analysis.monthlyTrend} />
                    </section>
                  </>
                ) : null}

                {topic === 'customers' ? (
                  <section className="analyze-section">
                    <h2>Top customers by sales</h2>
                    <p className="analyze-section-sub">
                      Who collected the most in {analysis.periodLabel.toLowerCase()}
                    </p>
                    <RankBars
                      items={analysis.topCustomers}
                      emptyLabel="No customer sales in this period."
                      accent="gold"
                    />
                  </section>
                ) : null}

                {topic === 'sales' ? (
                  <>
                    <div className="analyze-summary-grid analyze-summary-grid--two">
                      <div className="analyze-summary-card analyze-summary-card--sales">
                        <span>Period sales</span>
                        <strong>{formatMoney(analysis.salesTotal)}</strong>
                      </div>
                      <div className="analyze-summary-card">
                        <span>Best day</span>
                        <strong>
                          {analysis.bestSalesDay
                            ? formatMoney(analysis.bestSalesDay.amount)
                            : '—'}
                        </strong>
                        <small>{analysis.bestSalesDay?.label ?? 'No sales'}</small>
                      </div>
                    </div>
                    <section className="analyze-section">
                      <h2>Sales by day</h2>
                      <p className="analyze-section-sub">
                        Day-by-day from your filter. All starts on the first sale date and scrolls
                        through every day since; Range/Month show only that window.
                      </p>
                      <DayBars
                        points={analysis.salesByDay}
                        periodLabel={analysis.periodLabel}
                        periodTotal={analysis.salesTotal}
                        emptyLabel="No sales collections in this period."
                      />
                    </section>
                    <section className="analyze-section">
                      <h2>Top customers</h2>
                      <RankBars
                        items={analysis.topCustomers}
                        emptyLabel="No customer sales in this period."
                        accent="gold"
                      />
                    </section>
                    <section className="analyze-section">
                      <h2>6-month sales trend</h2>
                      <MonthTrend points={analysis.monthlyTrend} />
                    </section>
                  </>
                ) : null}

                {topic === 'purchases' ? (
                  <section className="analyze-section">
                    <h2>Top suppliers</h2>
                    <p className="analyze-section-sub">
                      Purchase total {formatMoney(analysis.purchaseTotal)}
                    </p>
                    <RankBars
                      items={analysis.topSuppliers}
                      emptyLabel="No purchases in this period."
                      accent="teal"
                    />
                  </section>
                ) : null}

                {topic === 'expenses' ? (
                  <section className="analyze-section">
                    <h2>Top expense names</h2>
                    <p className="analyze-section-sub">
                      Expense total {formatMoney(analysis.expenseTotal)}
                    </p>
                    <RankBars
                      items={analysis.topExpenseNames}
                      emptyLabel="No expenses in this period."
                      accent="rose"
                    />
                  </section>
                ) : null}

                {topic === 'credit' ? (
                  <section className="analyze-section">
                    <h2>Open credit parties</h2>
                    <p className="analyze-section-sub">
                      Total open credit {formatMoney(analysis.creditTotal)} · current dues
                    </p>
                    <RankBars
                      items={analysis.creditParties}
                      emptyLabel="No open credit dues."
                      accent="gold"
                    />
                  </section>
                ) : null}

                {topic === 'cheque' ? (
                  <section className="analyze-section">
                    <h2>Open cheque parties</h2>
                    <p className="analyze-section-sub">
                      Total open cheque {formatMoney(analysis.chequeTotal)} · current dues
                    </p>
                    <RankBars
                      items={analysis.chequeParties}
                      emptyLabel="No open cheque dues."
                      accent="blue"
                    />
                  </section>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
