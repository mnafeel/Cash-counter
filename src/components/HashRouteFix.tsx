import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isKnownRoute, normalizeRoutePath } from '../utils/hashRoute'

/** Fix malformed hash paths like /%2Fpurchase before child routes render. */
export default function HashRouteFix() {
  const location = useLocation()
  const clean = normalizeRoutePath(location.pathname)

  if (clean !== location.pathname) {
    return <Navigate to={{ pathname: clean, search: location.search }} replace />
  }

  if (!isKnownRoute(clean)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
