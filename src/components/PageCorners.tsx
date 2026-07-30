import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './PageCorners.css'

type PageBackButtonProps = {
  onClick?: () => void
  to?: string
  label?: string
  iconOnly?: boolean
  ariaLabel?: string
  className?: string
}

export function PageBackButton({
  onClick,
  to,
  label = 'Back',
  iconOnly = false,
  ariaLabel = 'Back',
  className = '',
}: PageBackButtonProps) {
  const classes = `page-back-btn ${iconOnly ? 'page-back-btn--icon' : ''} ${className}`.trim()
  const content = iconOnly ? (
    <span aria-hidden="true">←</span>
  ) : (
    <>
      <span aria-hidden="true">←</span>
      {label ? <span>{label}</span> : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} aria-label={ariaLabel}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" className={classes} onClick={onClick} aria-label={ariaLabel}>
      {content}
    </button>
  )
}

export function PageCloseButton({
  onClick,
  ariaLabel = 'Close',
  className = '',
}: {
  onClick: () => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <button
      type="button"
      className={`page-close-btn ${className}`.trim()}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      ✕
    </button>
  )
}

type PageCornersProps = {
  left?: ReactNode
  right?: ReactNode
}

export function PageCorners({ left, right }: PageCornersProps) {
  return (
    <div className="page-corners">
      <div className="page-corners-start">{left}</div>
      <div className="page-corners-end">{right}</div>
    </div>
  )
}
