import { useMemo } from 'react'
import './BalanceFlowChart.css'

export type BalanceFlowTone = 'cash' | 'bank' | 'account' | 'sales'

function seriesToPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const padY = height * 0.12

  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width
    const y = height - padY - ((value - min) / span) * (height - padY * 2)
    return { x, y }
  })

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const cx = (prev.x + curr.x) / 2
    d += ` C ${cx.toFixed(1)} ${prev.y.toFixed(1)}, ${cx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
  }
  return d
}

export default function BalanceFlowChart({
  series,
  tone = 'cash',
  className = '',
}: {
  series: number[]
  tone?: BalanceFlowTone
  className?: string
}) {
  const width = 120
  const height = 48

  const { linePath, areaPath } = useMemo(() => {
    const line = seriesToPath(series, width, height)
    if (!line) return { linePath: '', areaPath: '' }
    const lastX = width
    const area = `${line} L ${lastX} ${height} L 0 ${height} Z`
    return { linePath: line, areaPath: area }
  }, [series])

  if (!linePath) return null

  return (
    <div
      className={`balance-flow-chart balance-flow-chart--${tone}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`flow-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path className="balance-flow-chart-area" d={areaPath} fill={`url(#flow-fill-${tone})`} />
        <path className="balance-flow-chart-line" d={linePath} fill="none" />
      </svg>
    </div>
  )
}
