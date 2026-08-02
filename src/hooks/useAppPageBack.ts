import { useAppNavigateBack } from './useAppNavigateBack'
import { usePageEscape } from './usePageEscape'

/** Browser-style back plus Escape — for full-page routes. */
export function useAppPageBack(fallback = '/') {
  const goBack = useAppNavigateBack(fallback)
  usePageEscape(goBack)
  return goBack
}
