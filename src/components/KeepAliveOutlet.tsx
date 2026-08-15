import { useEffect, useState, type ReactElement } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { normalizeRoutePath } from '../utils/hashRoute'

function keepAliveKey(pathname: string): string {
  const path = normalizeRoutePath(pathname)
  if (path === '/' || path === '') return '/'
  if (path.startsWith('/counter')) return '/counter'
  if (path.startsWith('/expenses')) return '/expenses'
  if (path.startsWith('/history')) return '/history'
  return path
}

/** Keep main tab routes mounted so switching tabs does not remount heavy pages. */
export default function KeepAliveOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  const key = keepAliveKey(location.pathname)
  const [cache, setCache] = useState<Record<string, ReactElement | null>>({})

  useEffect(() => {
    if (!outlet) return
    setCache((prev) => ({ ...prev, [key]: outlet }))
  }, [key, outlet])

  return (
    <>
      {Object.entries(cache).map(([paneKey, pane]) => (
        <div
          key={paneKey}
          className="keep-alive-pane"
          hidden={paneKey !== key}
          aria-hidden={paneKey !== key}
        >
          {pane}
        </div>
      ))}
    </>
  )
}
