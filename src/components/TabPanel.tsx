import type { ReactNode } from 'react'

/** One main nav tab — stays mounted; visibility toggled without remounting children. */
export default function TabPanel({
  hidden,
  children,
}: {
  hidden: boolean
  children: ReactNode
}) {
  return (
    <div className="keep-alive-pane" hidden={hidden} aria-hidden={hidden}>
      {children}
    </div>
  )
}
