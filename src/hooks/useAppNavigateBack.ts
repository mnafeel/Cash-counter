import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/** Browser-style back with safe fallback when there is no history. */
export function useAppNavigateBack(fallback = '/') {
  const navigate = useNavigate()
  return useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate(fallback)
  }, [navigate, fallback])
}
