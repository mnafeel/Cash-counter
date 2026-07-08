import { formatMoney } from '../utils/format'
import './BigAmount.css'

interface BigAmountProps {
  label: string
  value: number
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'highlight'
  size?: 'md' | 'lg' | 'xl'
}

export default function BigAmount({
  label,
  value,
  variant = 'default',
  size = 'lg',
}: BigAmountProps) {
  return (
    <div className={`big-amount big-amount--${variant} big-amount--${size}`}>
      <span className="big-amount-label">{label}</span>
      <span className="big-amount-value">{formatMoney(value)}</span>
    </div>
  )
}
