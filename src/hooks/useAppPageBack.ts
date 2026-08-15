import { useAppNavigateBack } from './useAppNavigateBack'
import { usePageEscape } from './usePageEscape'
import { useIsActiveRoute } from './useIsActiveRoute'

/** Browser-style back plus Escape — for full-page routes. */
export function useAppPageBack(
  fallback = '/',
  options?: { route?: string },
) {
  const goBack = useAppNavigateBack(fallback)
  const routeActive = options?.route ? useIsActiveRoute(options.route) : true
  usePageEscape(goBack, routeActive)
  return goBack
}
