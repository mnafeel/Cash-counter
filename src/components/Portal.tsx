import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

interface PortalProps {
  children: ReactNode
}

/** Render above Layout chrome — fixed overlays must not sit inside clipped main. */
export default function Portal({ children }: PortalProps) {
  if (typeof document === 'undefined') return children
  return createPortal(children, document.body)
}
