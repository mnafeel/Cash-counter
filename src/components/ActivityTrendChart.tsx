import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { formatMoney, formatTime } from '../utils/format'
import './ActivityTrendChart.css'

export type ActivityTrendPoint = {
  time: number
  amount: number
  label: string
}

const CHART_WIDTH = 400
const CHART_HEIGHT = 120

type ChartCoord = { x: number; y: number; baseline: number }

type ActiveSample = {
  time: number
  amount: number
  label: string
  xPct: number
  nearestIndex: number
}

function bucketPoints(points: ActivityTrendPoint[]): ActivityTrendPoint[] {
  if (points.length <= 28) return points
  const buckets = new Map<number, { time: number; amount: number; count: number }>()
  for (const point of points) {
    const hourKey = Math.floor(point.time / 3_600_000) * 3_600_000
    const bucket = buckets.get(hourKey)
    if (bucket) {
      bucket.amount += point.amount
      bucket.count += 1
    } else {
      buckets.set(hourKey, { time: hourKey, amount: point.amount, count: 1 })
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .map((bucket) => ({
      time: bucket.time,
      amount: bucket.amount,
      label: bucket.count === 1 ? '1 record' : `${bucket.count} records`,
    }))
}

function coordsFromPoints(points: ActivityTrendPoint[], width: number, height: number): ChartCoord[] {
  const amounts = points.map((p) => p.amount)
  const maxUp = Math.max(0, ...amounts)
  const maxDown = Math.max(0, ...amounts.map((a) => -a))
  const maxMag = Math.max(maxUp, maxDown, 1)
  const baseline = height * 0.52
  const peakRoom = height * 0.44

  return points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width
    const sign = point.amount >= 0 ? -1 : 1
    const magnitude = Math.abs(point.amount) / maxMag
    const y = baseline + sign * magnitude * peakRoom
    return { x, y, baseline }
  })
}

function smoothCurvePath(coords: ChartCoord[]): string {
  if (coords.length === 0) return ''
  if (coords.length === 1) {
    return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  }

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(i - 1, 0)]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[Math.min(i + 2, coords.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return path
}

function buildCurvePaths(
  points: ActivityTrendPoint[],
  width: number,
  height: number,
): { linePath: string; areaPath: string; coords: ChartCoord[] } {
  if (points.length === 0) {
    return { linePath: '', areaPath: '', coords: [] }
  }

  const coords = coordsFromPoints(points, width, height)
  const linePath = smoothCurvePath(coords)
  const baseline = height * 0.52
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${baseline.toFixed(1)} L ${coords[0].x.toFixed(1)} ${baseline.toFixed(1)} Z`

  return { linePath, areaPath, coords }
}

function sampleAtRatio(
  points: ActivityTrendPoint[],
  coords: ChartCoord[],
  ratio: number,
): ActiveSample {
  if (points.length === 0) {
    return { time: 0, amount: 0, label: '', xPct: 0, nearestIndex: 0 }
  }
  if (points.length === 1) {
    return {
      time: points[0].time,
      amount: points[0].amount,
      label: points[0].label,
      xPct: (coords[0].x / CHART_WIDTH) * 100,
      nearestIndex: 0,
    }
  }

  const clamped = Math.max(0, Math.min(1, ratio))
  const exact = clamped * (points.length - 1)
  const lower = Math.floor(exact)
  const upper = Math.min(Math.ceil(exact), points.length - 1)
  const t = exact - lower

  const lowerPoint = points[lower]
  const upperPoint = points[upper]
  const meaningful = [lowerPoint, upperPoint].find((point) => point.label || point.amount !== 0)

  return {
    time: lowerPoint.time + (upperPoint.time - lowerPoint.time) * t,
    amount: lowerPoint.amount + (upperPoint.amount - lowerPoint.amount) * t,
    label:
      t < 0.5
        ? lowerPoint.label || upperPoint.label
        : upperPoint.label || lowerPoint.label || meaningful?.label || '',
    xPct: ((coords[lower].x + (coords[upper].x - coords[lower].x) * t) / CHART_WIDTH) * 100,
    nearestIndex: Math.round(exact),
  }
}

export default function ActivityTrendChart({ points }: { points: ActivityTrendPoint[] }) {
  const uid = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeSample, setActiveSample] = useState<ActiveSample | null>(null)
  const [scrubbing, setScrubbing] = useState(false)

  const chartPoints = useMemo(() => {
    const bucketed = bucketPoints(points)
    if (bucketed.length === 1) {
      const peak = bucketed[0]
      return [
        { ...peak, time: peak.time - 60_000, amount: 0, label: '' },
        peak,
        { ...peak, time: peak.time + 60_000, amount: 0, label: '' },
      ]
    }
    return bucketed
  }, [points])

  const { linePath, areaPath, coords } = useMemo(
    () => buildCurvePaths(chartPoints, CHART_WIDTH, CHART_HEIGHT),
    [chartPoints],
  )

  const updateAtClientX = useCallback(
    (clientX: number) => {
      const root = rootRef.current
      if (!root || chartPoints.length === 0) return
      const rect = root.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      setActiveSample(sampleAtRatio(chartPoints, coords, ratio))
    },
    [chartPoints, coords],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      setScrubbing(true)
      updateAtClientX(event.clientX)
    },
    [updateAtClientX],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const captured = event.currentTarget.hasPointerCapture(event.pointerId)
      if (event.pointerType === 'mouse' || captured) {
        updateAtClientX(event.clientX)
      }
    },
    [updateAtClientX],
  )

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setScrubbing(false)
  }, [])

  const onPointerLeave = useCallback(() => {
    if (!scrubbing) {
      setActiveSample(null)
    }
  }, [scrubbing])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setScrubbing(false)
    setActiveSample(null)
  }, [])

  if (chartPoints.length === 0) {
    return (
      <div className="activity-trend-chart activity-trend-chart--empty">
        <p>No activity in this period yet.</p>
      </div>
    )
  }

  const fillUpId = `activity-fill-up-${uid}`
  const fillDownId = `activity-fill-down-${uid}`
  const glowId = `activity-glow-${uid}`
  const activeCoord =
    activeSample && activeSample.nearestIndex >= 0 && activeSample.nearestIndex < coords.length
      ? coords[activeSample.nearestIndex]
      : null
  const cursorX =
    activeSample !== null
      ? (activeSample.xPct / 100) * CHART_WIDTH
      : activeCoord?.x ?? null

  return (
    <div
      ref={rootRef}
      className={`activity-trend-chart${scrubbing ? ' activity-trend-chart--scrubbing' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
    >
      <svg
        className="activity-trend-chart__svg"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={fillUpId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-sales, #4ade80)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--chart-sales, #4ade80)" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id={fillDownId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--accent-expense, #f87171)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent-expense, #f87171)" stopOpacity="0.04" />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <line
          className="activity-trend-chart__baseline"
          x1="0"
          y1={CHART_HEIGHT * 0.52}
          x2={CHART_WIDTH}
          y2={CHART_HEIGHT * 0.52}
        />

        <path
          className="activity-trend-chart__area"
          d={areaPath}
          fill={`url(#${activeSample && activeSample.amount < 0 ? fillDownId : fillUpId})`}
        />
        <path
          className="activity-trend-chart__line activity-trend-chart__line--glow"
          d={linePath}
          fill="none"
          filter={`url(#${glowId})`}
        />
        <path className="activity-trend-chart__line" d={linePath} fill="none" />

        {coords.map((coord, index) => (
          <circle
            key={index}
            className={`activity-trend-chart__node${
              activeSample?.nearestIndex === index ? ' activity-trend-chart__node--active' : ''
            }`}
            cx={coord.x}
            cy={coord.y}
            r={activeSample?.nearestIndex === index ? 4.2 : 0}
          />
        ))}

        {cursorX !== null ? (
          <line
            className="activity-trend-chart__cursor"
            x1={cursorX}
            y1={8}
            x2={cursorX}
            y2={CHART_HEIGHT - 8}
          />
        ) : null}
      </svg>

      {activeSample ? (
        <div
          className="activity-trend-chart__tooltip"
          style={{ left: `${activeSample.xPct}%` }}
          role="status"
          aria-live="polite"
        >
          <span className="activity-trend-chart__tooltip-time">
            {formatTime(new Date(activeSample.time).toISOString())}
          </span>
          <strong
            className={`activity-trend-chart__tooltip-amount${
              activeSample.amount < 0 ? ' activity-trend-chart__tooltip-amount--down' : ''
            }`}
          >
            {activeSample.amount >= 0 ? '+' : '−'}
            {formatMoney(Math.abs(activeSample.amount))}
          </strong>
          {activeSample.label ? (
            <span className="activity-trend-chart__tooltip-label">{activeSample.label}</span>
          ) : null}
        </div>
      ) : (
        <p className="activity-trend-chart__hint">
          Touch or drag along the chart to explore amount by time
        </p>
      )}
    </div>
  )
}
