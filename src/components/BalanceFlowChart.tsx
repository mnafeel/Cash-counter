import { useId, useMemo } from 'react'
import './BalanceFlowChart.css'

export type BalanceFlowTone = 'cash' | 'bank' | 'account' | 'sales'

function seriesToPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const padY = height * 0.18

  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width
    const y = height - padY - ((value - min) / span) * (height - padY * 2)
    return { x, y }
  })

  if (points.length < 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(i + 2, points.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

export default function BalanceFlowChart({
  series,
  tone = 'cash',
  blend = false,
  className = '',
}: {
  series: number[]
  tone?: BalanceFlowTone
  blend?: boolean
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const width = 200
  const height = blend ? 64 : 48

  const { linePath, areaPath } = useMemo(() => {
    const line = seriesToPath(series, width, height)
    if (!line) return { linePath: '', areaPath: '' }
    const area = `${line} L ${width} ${height} L 0 ${height} Z`
    return { linePath: line, areaPath: area }
  }, [series, height])

  if (!linePath) return null

  const fillId = `flow-fill-${uid}`
  const glowId = `flow-glow-${uid}`
  const maskId = `flow-mask-${uid}`

  return (
    <div
      className={`balance-flow-chart balance-flow-chart--${tone}${blend ? ' balance-flow-chart--blend' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={blend ? '0.2' : '0.28'} />
            <stop offset="55%" stopColor="currentColor" stopOpacity={blend ? '0.05' : '0.08'} />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          {blend && (
            <linearGradient id={maskId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="white" stopOpacity="0.15" />
              <stop offset="35%" stopColor="white" stopOpacity="0.85" />
              <stop offset="100%" stopColor="white" stopOpacity="1" />
            </linearGradient>
          )}
          <filter id={glowId} x="-25%" y="-50%" width="150%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {blend && (
          <mask id={`mask-use-${uid}`}>
            <rect width={width} height={height} fill={`url(#${maskId})`} />
          </mask>
        )}
        <g mask={blend ? `url(#mask-use-${uid})` : undefined}>
          <path className="balance-flow-chart-area" d={areaPath} fill={`url(#${fillId})`} />
          <path
            className="balance-flow-chart-line balance-flow-chart-line--glow"
            d={linePath}
            fill="none"
            filter={`url(#${glowId})`}
          />
          <path className="balance-flow-chart-line" d={linePath} fill="none" />
        </g>
      </svg>
    </div>
  )
}
